import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {NextRequest, NextResponse} from 'next/server';
import {pool} from '@/server/postgres.cjs';
import {personalWorkspace, uuidPattern} from '@/server/personal-workspace.cjs';
import {editPersonalMail} from './personal-mail';
import {readWorkbenchProjects,workbenchProject} from './personal-workbench';
import {hash, MarketError, marketOrigin, seal, textValue, unseal} from './security';

const names = {calendar:'Google Calendar', gmail:'Gmail', analytics:'YouTube Analytics · GA4',
  kakao:'카카오톡', notion:'Notion', github:'GitHub'} as const;
type Provider = keyof typeof names;
type OAuthProvider = 'calendar'|'gmail'|'analytics'|'kakao';
type Input = Record<string,unknown>;
type App = {clientId:string;clientSecret:string};
type Token = {accessToken:string;refreshToken?:string;expiresAt?:number;resource?:string;connectionId:string};
type Settings = {app?:string;token?:string;flow?:string};
type Proposal = {id:string;taskId:string;taskVersion:number;title:string;start:string;end:string;connectionId:string;expiresAt:number};
const doc = "workspace='live' AND kind=$1 AND id=$2 AND data->>'ownerId'=$3";
const headers = {'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'};
const callbackPath = '/api/personal/connectors/oauth';
const cookieName = 'nh_personal_connect';
const enc = encodeURIComponent;
export const connectorCallback = () => marketOrigin()+callbackPath;
const integrationKind = 'personal-connectors';
const approvalKind = 'personal-calendar-approval';
const googleScopes = {
  calendar:['https://www.googleapis.com/auth/calendar.freebusy','https://www.googleapis.com/auth/calendar.events.owned'],
  gmail:['https://www.googleapis.com/auth/gmail.readonly'],
  analytics:['https://www.googleapis.com/auth/yt-analytics.readonly','https://www.googleapis.com/auth/youtube.readonly','https://www.googleapis.com/auth/analytics.readonly'],
};
const needConnection = () => new MarketError('본인 서비스 계정을 연결해 주세요.',412);
const connectionChanged = () => new MarketError('연결이 바뀌었습니다. 화면을 새로고침해 주세요.',409);

async function document<T>(owner:string,id:string,kind=integrationKind) {
  return (await pool().query<{data:T}>('SELECT data FROM nh_documents WHERE '+doc,[kind,owner+':'+id,owner])).rows[0]?.data;
}

async function put(owner:string,id:string,data:Input,remove:string[]=[],kind=integrationKind) {
  await pool().query(
    "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live',$1,$2,$3) " +
    "ON CONFLICT(workspace,kind,id) DO UPDATE SET data=(nh_documents.data - $4::text[]) || excluded.data,updated=clock_timestamp() WHERE nh_documents.data->>'ownerId'=$5",
    [kind,owner+':'+id,JSON.stringify({...data,ownerId:owner}),remove,owner]);
}

async function setToken(owner:string,provider:Provider,token:Token,field:string,value:string) {
  const result=await pool().query("UPDATE nh_documents SET data=jsonb_set(data,'{token}',to_jsonb($6::text)),updated=clock_timestamp() WHERE "+doc+" AND data->>$4=$5",
    [integrationKind,owner+':'+provider,owner,field,value,seal(JSON.stringify(token))]);
  if(result.rowCount!==1) throw connectionChanged();
}

function providerOf(value:unknown):Provider {
  if(typeof value!=='string'||!Object.hasOwn(names,value)) throw new MarketError('연결할 서비스를 선택해 주세요.');
  return value as Provider;
}

function oauthProvider(provider:Provider):provider is OAuthProvider {
  return provider!=='notion'&&provider!=='github';
}

function credential<T>(input?:string):T {
  if(!input) throw needConnection();
  return JSON.parse(unseal(input)) as T;
}

async function upstream(url:string, options:RequestInit={}) {
  try {
    return await fetch(url,{...options,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  } catch {
    throw new MarketError('서비스 응답이 지연됐습니다. 잠시 후 다시 시도해 주세요.',502);
  }
}

async function providerJSON<T>(url:string, token:string, options:RequestInit={}) {
  const response=await upstream(url,{...options,headers:{Authorization:'Bearer '+token,Accept:'application/json',...options.headers}});
  if(response.status===401||response.status===403) throw new MarketError('서비스 연결과 접근 권한을 확인해 주세요.',412);
  if(!response.ok) throw new MarketError('서비스에서 요청을 처리하지 못했습니다. 설정과 연결 대상을 확인해 주세요.',502);
  return await response.json() as T;
}

const post = (payload:unknown):RequestInit => ({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});

export async function connectorOverview(owner:string) {
  const records=await Promise.all(Object.keys(names).map(async id=>[id,await document<Settings>(owner,id)] as const));
  const [items,projects]=await Promise.all([personalWorkspace(owner).list(),readWorkbenchProjects(owner)]);
  return {projects:projects.map(({id,name})=>({id,name})),callback:connectorCallback(),services:records.map(([id,state])=>({id,label:names[id as Provider],connected:!!state?.token,
    config:state?.app ? credential<App>(state.app).clientId : undefined})),
    tasks:items.filter(item=>item.kind==='task'&&!item.done).slice(0,100).map(({id,title})=>({id,title}))};
}

function oauthSession(req:NextRequest) {
  const jwt=req.cookies.get('nh_access')?.value??'';
  try {
    if(jwt.length>20_000||!/^[-\w]+\.[-\w]+\.[-\w]+$/.test(jwt)) throw Error();
    const session=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString('utf8')).session_id;
    if(typeof session==='string'&&uuidPattern.test(session)) return hash(session.toLowerCase());
  } catch {}
  throw new MarketError('로그인 세션을 확인해 주세요.',403);
}

type Flow = {provider:OAuthProvider;state:string;verifier:string;session:string;deadline:number;appHash:string};
function flowCookie(req:NextRequest,maxAge:number) {
  return {httpOnly:true,sameSite:'lax' as const,secure:req.nextUrl.protocol==='https:',path:callbackPath,maxAge};
}

async function authorize(req:NextRequest,owner:string,provider:OAuthProvider,settings:Settings) {
  if(req.nextUrl.origin!==marketOrigin()) throw new MarketError('운영 누리원 주소에서 연결해 주세요.',403);
  const app=credential<App>(settings.app);
  const flow:Flow={provider,state:randomBytes(32).toString('base64url'),verifier:randomBytes(32).toString('base64url'),
    session:oauthSession(req),deadline:Date.now()+600_000,appHash:hash(settings.app!)};
  await put(owner,provider,{flow:hash(flow.state)});
  const kakao=provider==='kakao';
  const url=new URL(kakao?'https://kauth.kakao.com/oauth/authorize':'https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({response_type:'code',client_id:app.clientId,redirect_uri:connectorCallback(),state:flow.state,
    ...(kakao?{scope:'talk_message'}:{scope:googleScopes[provider].join(' '),prompt:'consent select_account',access_type:'offline',
      code_challenge_method:'S256',code_challenge:createHash('sha256').update(flow.verifier).digest('base64url')})}).toString();
  const response=NextResponse.json({url:url.href},{headers});
  response.cookies.set(cookieName,seal(JSON.stringify({owner,...flow})),flowCookie(req,600));
  return response;
}

async function tokenExchange(provider:OAuthProvider,app:App,fields:Record<string,string>,prior?:Token):Promise<Token> {
  const kakao=provider==='kakao';
  const response=await upstream(kakao?'https://kauth.kakao.com/oauth/token':'https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({client_id:app.clientId,...(app.clientSecret?{client_secret:app.clientSecret}:{}),...fields})});
  const token=await response.json();
  const refresh=token.refresh_token??prior?.refreshToken;
  const required=kakao?['talk_message']:googleScopes[provider];
  const granted=typeof token.scope==='string'?token.scope.split(/\s+/):[];
  if(!response.ok||typeof token.access_token!=='string'||!token.access_token||typeof refresh!=='string'||
    !Number.isSafeInteger(token.expires_in)||token.expires_in<1||token.expires_in>86_400||
    (!prior||granted.length>0)&&!required.every(scope=>granted.includes(scope))) {
    throw new MarketError('서비스에서 승인한 권한을 확인해 주세요.',412);
  }
  return {accessToken:token.access_token,refreshToken:refresh,expiresAt:Date.now()+token.expires_in*1000,
    connectionId:prior?.connectionId??randomUUID()};
}

export async function finishConnector(req:NextRequest,owner:string) {
  const flow=credential<Flow&{owner:string}>(req.cookies.get(cookieName)?.value);
  const state=req.nextUrl.searchParams.get('state');
  const code=req.nextUrl.searchParams.get('code');
  if(!state||!code||state!==flow.state||flow.owner!==owner||flow.session!==oauthSession(req)||flow.deadline<Date.now()) throw connectionChanged();
  const settings=await document<Settings>(owner,flow.provider);
  if(!settings?.app||hash(settings.app)!==flow.appHash||settings.flow!==hash(state)) throw connectionChanged();
  const claimed=hash(randomBytes(32).toString('hex'));
  const affected=await pool().query("UPDATE nh_documents SET data=jsonb_set(data,'{flow}',to_jsonb($5::text)),updated=clock_timestamp() WHERE "+doc+" AND data->>'flow'=$4",
    [integrationKind,owner+':'+flow.provider,owner,settings.flow,claimed]);
  if(affected.rowCount!==1) throw connectionChanged();
  const token=await tokenExchange(flow.provider,credential<App>(settings.app),{
    grant_type:'authorization_code',code,redirect_uri:connectorCallback(),...(flow.provider==='kakao'?{}:{code_verifier:flow.verifier})});
  await setToken(owner,flow.provider,token,'flow',claimed);
}

export function connectorRedirect(req:NextRequest,complete:boolean) {
  const response=NextResponse.redirect(new URL('/personal?connect='+(complete?'connected':'failed')+'#connector-workflow',marketOrigin()));
  Object.entries(headers).forEach(([key,value])=>response.headers.set(key,value));
  response.cookies.set(cookieName,'',flowCookie(req,0));
  return response;
}

async function access(owner:string,provider:Provider) {
  const settings=await document<Settings>(owner,provider);
  const token=credential<Token>(settings?.token);
  if(!oauthProvider(provider)||(token.expiresAt??0)>Date.now()+30_000) return token;
  if(!token.refreshToken) throw needConnection();
  const fresh=await tokenExchange(provider,credential<App>(settings?.app),{grant_type:'refresh_token',refresh_token:token.refreshToken},token);
  await setToken(owner,provider,fresh,'token',settings!.token!);
  return fresh;
}

const notionRoot='https://api.notion.com/v1/blocks/';
const githubRoot='https://api.github.com/repos/';
const notionOptions={headers:{'Notion-Version':'2026-03-11'}};
async function connectToken(owner:string,provider:'notion'|'github',input:Input) {
  const token=textValue(input.token,'토큰',2000),resource=textValue(input.resource,'연결 대상',210);
  if(!/^[!-~]+$/.test(token)) throw new MarketError('서비스 토큰을 확인해 주세요.');
  if(provider==='notion'){
    if(!/^[0-9a-f]{32}$/i.test(resource)&&!uuidPattern.test(resource)) throw new MarketError('Notion 페이지 ID를 입력해 주세요.');
    await providerJSON('https://api.notion.com/v1/pages/'+enc(resource),token,notionOptions);
  }else{
    if(!/^[a-z\d][a-z\d-]{0,38}\/[a-z\d_.-]{1,100}$/i.test(resource)||/\/(?:\.|\.\.)$/.test(resource)) throw new MarketError('GitHub 저장소를 owner/repo 형식으로 입력해 주세요.');
    await providerJSON(githubRoot+resource,token);
  }
  await put(owner,provider,{token:seal(JSON.stringify({accessToken:token,resource,connectionId:randomUUID()}))});
}

const gmailRoot='https://gmail.googleapis.com/gmail/v1/users/me/';
type Message = {id:string;labelIds?:string[];snippet?:string;payload?:{headers?:{name:string;value:string}[]}};
async function inboxLabel(token:string) {
  const data=await providerJSON<{labels?:{name:string;id:string}[]}>(gmailRoot+'labels',token);
  const label=data.labels?.find(row=>row.name==='누리원');
  if(!label) throw new MarketError('Gmail에서 ‘누리원’ 라벨을 만들고 가져올 메일에 붙여 주세요.',412);
  return label.id;
}

async function gmailMessage(token:string,id:unknown,label:string) {
  if(typeof id!=='string'||!/^[a-f\d]{8,64}$/i.test(id)) throw new MarketError('메일을 다시 선택해 주세요.');
  const query='?format=metadata&metadataHeaders=Subject&metadataHeaders=From';
  const row=await providerJSON<Message>(gmailRoot+'messages/'+id+query,token);
  if(!row.labelIds?.includes(label)||row.id!==id) throw new MarketError('누리원 라벨이 붙은 메일을 선택해 주세요.',404);
  const header=(name:string)=>row.payload?.headers?.find(item=>item.name===name)?.value?.replace(/[\r\n\x00-\x1f]/g,' ').trim()||'';
  const from=header('From').slice(0,300);
  const address=/<([^<>\s]+)>$/.exec(from)?.[1]??from;
  return {id,title:header('Subject').slice(0,150)||'제목 없는 메일',from,
    address:/^[^@\s<>]+@[^@\s<>]+$/.test(address)?address:'',snippet:(row.snippet??'').slice(0,480)};
}

async function listInbox(token:string) {
  const label=await inboxLabel(token);
  const data=await providerJSON<{messages?:{id:string}[]}>(gmailRoot+'messages?maxResults=10&labelIds='+enc(label),token);
  return Promise.all((data.messages??[]).slice(0,10).map(row=>gmailMessage(token,row.id,label)));
}

function stableId(key:string) {
  const value=hash(key).slice(0,32);
  return value.slice(0,8)+'-'+value.slice(8,12)+'-5'+value.slice(13,16)+'-a'+value.slice(17,20)+'-'+value.slice(20,32);
}

const calendarRoot='https://www.googleapis.com/calendar/v3/';
const seoulDay=(time:number)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(time);
function calendarDay(input:unknown) {
  if(typeof input!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(input)) throw new MarketError('날짜를 입력해 주세요.');
  if(input<seoulDay(Date.now())||input>seoulDay(Date.now()+90*86400_000)) throw new MarketError('오늘부터 90일 이내의 날짜를 선택해 주세요.');
  const value=new Date(input+'T12:00:00+09:00');
  if(!Number.isFinite(+value)||seoulDay(+value)!==input) throw new MarketError('유효한 날짜를 선택해 주세요.');
  return input;
}

async function busy(token:string,timeMin:string,timeMax:string) {
  const response=await providerJSON<{calendars?:Record<string,{errors?:unknown[];busy?:{start:string;end:string}[]}>}>(
    calendarRoot+'freeBusy',token,post({timeMin,timeMax,items:[{id:'primary'}]}));
  const calendars=Object.values(response.calendars??{});
  const primary=calendars.length===1?calendars[0]:undefined;
  if(!primary||primary.errors?.length||!Array.isArray(primary.busy)) throw new MarketError('Google Calendar의 빈 시간을 확인하지 못했습니다.',502);
  return primary.busy;
}
const validId=(id:unknown):id is string=>typeof id==='string'&&uuidPattern.test(id);
const overlaps = (items:{start:string;end:string}[],start:number,end:number) =>
  items.some(item=> Date.parse(item.start)<end&&Date.parse(item.end)>start);

async function propose(owner:string,token:Token,input:Input) {
  const day=calendarDay(input.date), workspace=personalWorkspace(owner);
  const all=await workspace.list();
  const task=all.find(item=>item.id===input.taskId&&item.kind==='task'&&!item.done);
  if(!task) throw new MarketError('미완료 할 일을 선택해 주세요.');
  const from=Date.parse(day+'T09:00:00+09:00'),until=Date.parse(day+'T18:00:00+09:00'),slot=30*60_000;
  const occupied=await busy(token.accessToken,new Date(from).toISOString(),new Date(until).toISOString());
  for(const item of all) {
    const time=item.kind==='schedule'&&item.dueOn===day?item.dueTime:item.focusOn===day&&!item.done?item.focusTime:null;
    if(item.kind==='schedule'&&item.dueOn===day&&!item.dueTime) throw new MarketError('선택한 날에 누리원 종일 일정이 있습니다.',409);
    if(time) {
      const start=new Date(day+'T'+time+':00+09:00');
      occupied.push({start:start.toISOString(),end:new Date(+start+slot).toISOString()});
    }
  }
  for(let time=from;time+slot<=until;time+=slot) {
    if(time<Date.now()||overlaps(occupied,time,time+slot)) continue;
    const proposal:Proposal={id:randomUUID(),taskId:task.id,taskVersion:task.version,title:task.title,start:new Date(time).toISOString(),
      end:new Date(time+slot).toISOString(),connectionId:token.connectionId,expiresAt:Date.now()+900_000};
    await put(owner,proposal.id,{proposal},[],approvalKind);
    return {proposal:{id:proposal.id,title:proposal.title,start:proposal.start,end:proposal.end}};
  }
  throw new MarketError('선택한 날 오전 9시부터 오후 6시 사이에 빈 30분이 없습니다.',409);
}

async function approve(owner:string,token:Token,input:Input) {
  if(!validId(input.proposalId)) throw new MarketError('일정 제안을 먼저 확인해 주세요.');
  const client=await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['connector-calendar:'+owner]);
    const current=(await client.query<{data:Settings}>('SELECT data FROM nh_documents WHERE '+doc+' FOR SHARE',
      [integrationKind,owner+':calendar',owner])).rows[0]?.data;
    if(credential<Token>(current?.token).connectionId!==token.connectionId) throw connectionChanged();
    const saved=(await client.query<{data:{proposal:Proposal;applied?:boolean}}>(
      'SELECT data FROM nh_documents WHERE '+doc,[approvalKind,owner+':'+input.proposalId,owner])).rows[0]?.data;
    const plan=saved?.proposal;
    if(!plan||plan.connectionId!==token.connectionId) throw new MarketError('이 계정의 일정 제안을 확인해 주세요.',404);
    if(!saved.applied) {
      if(plan.expiresAt<Date.now()||Date.parse(plan.start)<=Date.now()) throw new MarketError('일정 제안이 만료됐습니다. 빈 시간을 다시 찾으세요.',409);
      const task=(await client.query<{data:{kind:string;done:boolean;version:number;projectId?:string}}>(
        'SELECT data FROM nh_documents WHERE '+doc+' FOR SHARE',
        ['personal-item',owner+':'+plan.taskId,owner])).rows[0]?.data;
      if(!task||task.kind!=='task'||task.done||task.version!==plan.taskVersion) throw new MarketError('할 일이 변경됐습니다. 일정을 다시 제안해 주세요.',409);
      const event=hash(owner+':'+plan.taskId+':'+plan.start).slice(0,48);
      const target=calendarRoot+'calendars/primary/events';
      const authorization={Authorization:'Bearer '+token.accessToken};
      const existing=await upstream(target+'/'+event,{headers:authorization});
      if(existing.status===404) {
        if(overlaps(await busy(token.accessToken,plan.start,plan.end),Date.parse(plan.start),Date.parse(plan.end))) {
          throw new MarketError('해당 시간이 이미 사용 중입니다. 다시 제안해 주세요.',409);
        }
        await providerJSON(target+'?sendUpdates=none',token.accessToken,post({id:event,summary:plan.title,
          start:{dateTime:plan.start},end:{dateTime:plan.end}}));
      } else if(!existing.ok) throw new MarketError('Google Calendar 연결 상태를 확인해 주세요.',412);
      const stamp = new Date(plan.start);
      const localTime = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(stamp);
      const now=new Date().toISOString();
      const schedule={ownerId:owner,kind:'schedule',title:plan.title,detail:'Google Calendar에서 승인해 등록한 일정',
        dueOn:seoulDay(+stamp),dueTime:localTime,done:false,projectId:task.projectId,createdAt:now,updatedAt:now,version:1};
      await client.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-item',$1,$2) ON CONFLICT DO NOTHING",
        [owner+':'+stableId('linked-calendar:'+event),JSON.stringify(schedule)]);
      await client.query("UPDATE nh_documents SET data=jsonb_set(data,'{applied}','true'::jsonb),updated=clock_timestamp() WHERE "+doc,
        [approvalKind,owner+':'+input.proposalId,owner]);
    }
    await client.query('COMMIT');
    return {saved:true};
  } catch(error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {client.release();}
}

async function readAnalytics(owner:string,token:string,input:Input) {
  const property=typeof input.property==='string'?input.property.trim():'';
  if(property&&!/^\d{1,20}$/.test(property)) throw new MarketError('GA4 속성 ID를 숫자로 입력해 주세요.');
  const project=input.projectId ? await workbenchProject(owner,input.projectId) : null;
  const latest=seoulDay(Date.now()-86400_000);
  const reference=new Date(latest+'T00:00:00Z');
  const monday=new Date(+reference-((reference.getUTCDay()+6)%7)*86400_000).toISOString().slice(0,10);
  const day=latest;
  const previous=project?monday:seoulDay(Date.now()-7*86400_000);
  const query=new URLSearchParams({ids:'channel==MINE',startDate:previous,endDate:day,metrics:'views,estimatedMinutesWatched'});
  const [channel,site]=await Promise.allSettled([
    providerJSON<{rows?:number[][]}>('https://youtubeanalytics.googleapis.com/v2/reports?'+query,token),
    property?providerJSON<{rows?:{metricValues:{value:string}[]}[]}>('https://analyticsdata.googleapis.com/v1beta/properties/'+property+':runReport',token,
      post({dateRanges:[{startDate:previous,endDate:day}],metrics:[{name:'sessions'},{name:'totalUsers'}]})):null,
  ]);
  if(channel.status==='rejected'&&site.status==='rejected') throw new MarketError('YouTube 및 GA4 접근 권한을 확인해 주세요.',412);
  const data={channel:channel.status==='fulfilled'?(channel.value.rows??[]).map(([views,minutes])=>({views,minutes})):[],
    site:site.status==='fulfilled'?(site.value?.rows??[]).map(row=>({sessions:Number(row.metricValues[0]?.value??0),users:Number(row.metricValues[1]?.value??0)})):[],
    period:{start:previous,end:day},unavailable:[...(channel.status==='rejected'?['YouTube']:[]),...(site.status==='rejected'?['GA4']:[])]};
  if(project&&(data.channel.length||data.site.length)) {
    await put(owner,project.id+':'+monday,{performance:data},[],'personal-project-performance');
  }
  return data;
}

type Performance = Awaited<ReturnType<typeof readAnalytics>>;
export async function projectPerformance(owner:string,projectId:string,week:string) {
  return (await document<{performance:Performance}>(owner,projectId+':'+week,'personal-project-performance'))?.performance??null;
}

type NotionBlock={type:string;[key:string]:unknown};
async function readNotion(token:Token) {
  const data=await providerJSON<{results:NotionBlock[]}>(notionRoot+enc(token.resource!)+'/children?page_size=30',token.accessToken,notionOptions);
  return {blocks:data.results.flatMap(block=>{
    const value=block[block.type] as {rich_text?:{plain_text?:string}[]}|undefined;
    return value?.rich_text?[value.rich_text.map(text=>text.plain_text??'').join('').slice(0,800)].filter(Boolean):[];
  })};
}

async function readGithub(token:Token) {
  const base=githubRoot+token.resource!;
  const [runs,pulls]=await Promise.all([
    providerJSON<{workflow_runs:{name:string;status:string;conclusion:string|null;html_url:string}[]}>(base+'/actions/runs?per_page=8',token.accessToken),
    providerJSON<{title:string;html_url:string}[]>(base+'/pulls?state=open&per_page=8',token.accessToken),
  ]);
  return {runs:runs.workflow_runs.map(row=>({name:row.name,status:row.conclusion??row.status,url:row.html_url})),
    pulls:pulls.map(row=>({title:row.title,url:row.html_url}))};
}

async function deliverKakao(owner:string,token:Token) {
  const today=seoulDay(Date.now());
  const tasks=(await personalWorkspace(owner).list()).filter(item=>item.kind==='task'&&!item.done&&item.dueOn&&item.dueOn<=today);
  const claim=await pool().query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-kakao-delivery',$1,$2) ON CONFLICT DO NOTHING",
    [owner+':'+today,JSON.stringify({ownerId:owner})]);
  if(claim.rowCount!==1) throw new MarketError('오늘의 알림 요청을 이미 처리했습니다.',409);
  const text=['누리원 오늘 마감 '+tasks.length+'건',...tasks.slice(0,4).map(item=>item.title)].join('\n').slice(0,180);
  const options={method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({template_object:JSON.stringify({object_type:'text',text,link:{web_url:marketOrigin()+'/personal',
      mobile_web_url:marketOrigin()+'/personal'},button_title:'누리원 열기'})})};
  const data=await providerJSON<{result_code:number}>('https://kapi.kakao.com/v2/api/talk/memo/default/send',token.accessToken,options);
  if(data.result_code!==0) throw new MarketError('카카오톡에서 알림을 확인하지 못했습니다.',502);
  return {sent:true};
}

export async function changeConnector(req:NextRequest,actor:{id:string;email:string},input:Input) {
  const owner=actor.id,provider=providerOf(input.provider);
  if(input.action==='disconnect') {
    await put(owner,provider,{},['token','flow','app']);
    return connectorOverview(owner);
  }
  if(input.action==='configure'&&oauthProvider(provider)) {
    const clientId=textValue(input.clientId,'Client ID',250);
    const clientSecret=textValue(input.clientSecret??'','Client Secret',1024,provider==='kakao');
    if(provider==='kakao'?!/^[a-f0-9]{32}$/i.test(clientId):!/^[-\w]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new MarketError('제공사 웹 앱 Client ID를 확인해 주세요.');
    }
    await put(owner,provider,{app:seal(JSON.stringify({clientId,clientSecret}))},['flow','token']);
    return connectorOverview(owner);
  }
  if(input.action==='connect'&&!oauthProvider(provider)) {
    await connectToken(owner,provider,input);
    return connectorOverview(owner);
  }
  if(input.action==='authorize'&&oauthProvider(provider)) {
    return authorize(req,owner,provider,await document<Settings>(owner,provider)??{});
  }
  if(input.action==='draft'&&provider==='gmail') {
    await access(owner,provider);
    return {draft:await editPersonalMail(owner,{action:'draft',to:input.to,subject:input.subject,body:input.body},actor.email)};
  }
  const token=await access(owner,provider);
  if(input.action==='read') {
    if(provider==='gmail') return {data:await listInbox(token.accessToken)};
    if(provider==='analytics') return {data:await readAnalytics(owner,token.accessToken,input)};
    if(provider==='notion') return {data:await readNotion(token)};
    if(provider==='github') return {data:await readGithub(token)};
  }
  if(input.action==='task'&&provider==='gmail') {
    const message=await gmailMessage(token.accessToken,input.messageId,await inboxLabel(token.accessToken));
    const itemId=stableId('gmail-task:'+message.id);
    const workspace=personalWorkspace(owner);
    const task=await workspace.create({kind:'task',title:message.title,detail:'Gmail 회신 · '+message.from,dueOn:null,dueTime:null,done:false},itemId)
      ??await workspace.get(itemId);
    return {task};
  }
  if(input.action==='save-reference'&&provider==='notion') {
    const project=await workbenchProject(owner,input.projectId);
    const {blocks}=await readNotion(token);
    if(!blocks.length) throw new MarketError('저장할 텍스트가 없습니다.',422);
    const workspace=personalWorkspace(owner);
    const id=stableId('notion:'+project.id+':'+token.resource);
    const existing=await workspace.get(id);
    const title=('Notion 참고 자료 · '+project.name).slice(0,160);
    const draft={kind:'note' as const,title,detail:blocks.join('\n').slice(0,4000),dueOn:null,dueTime:null,done:false,projectId:project.id};
    const note=existing?await workspace.update(existing,draft):await workspace.create(draft,id);
    if(!note) throw new MarketError('참고 자료가 바뀌었습니다. 다시 확인해 주세요.',409);
    return {saved:true};
  }
  if(input.action==='propose'&&provider==='calendar') return propose(owner,token,input);
  if(input.action==='approve'&&provider==='calendar') return approve(owner,token,input);
  if(input.action==='deliver'&&provider==='kakao') return deliverKakao(owner,token);
  throw new MarketError('지원하는 작업을 선택해 주세요.');
}
