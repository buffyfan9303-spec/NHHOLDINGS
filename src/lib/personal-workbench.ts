import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool} from '@/server/postgres.cjs';
import {personalAgenda} from '@/lib/personal-agenda';
import {createPersonalCard,validatePersonalCard,type PersonalCardBlueprint} from '@/lib/personal-cards';
import {integer, MarketError, textValue} from '@/lib/security';

type Project = {id:string; name:string; rules:string; version:number; starter?:string};
const categories = ['content','seller','business','mail','drive'] as const;
type Category = typeof categories[number];
type Move = {id:string; title:string; version:number; day:string; time:string};
type Decision = {
  id:string; title:string; text:string; category:Category|'schedule'|'cards'; projectId:string|null;
  pack?:{id:string; topic:string; format:string}; revision?:number; originalText?:string;
  card?:PersonalCardBlueprint; cardId?:string; projectVersion?:number; projectOnly?:boolean; moves?:Move[]; start?:string; end?:string; source:string;
  status:'pending'|'applied'|'declined'|'undone'; created:string; decided?:string;
};
type Workbench = {projects: Project[]; decisions:Decision[]};
type TimedItem = {projectId?:string; title:string; kind:string; dueOn:string|null; dueTime:string|null; done:boolean; focusOn?:string|null; focusTime?:string|null; version:number; updatedAt:string};
const workspaceKind = "workspace='live' AND kind='personal-workbench' AND id=$1 AND data->>'ownerId'=$1";
const personalItems = "workspace='live' AND kind='personal-item' AND data->>'ownerId'=$1 AND id LIKE $1||':%'";
const kstDay = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const kstTime = new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const blank = ():Workbench => ({projects:[], decisions:[]});
const conflict = () => new MarketError('일정이나 업무가 바뀌었습니다. 새 제안을 만들어 주세요.',409);
const missing = () => new MarketError('업무 항목을 찾을 수 없습니다.',404);

function ownedProject(state:Workbench, id:unknown) {
  const project = state.projects.find(project=>project.id===id);
  if (!project) throw missing();
  return project;
}

function publicState(state:Workbench) {
  return {projects:state.projects,decisions:state.decisions};
}

export async function readWorkbench(owner:string) {
  const {rows} = await pool().query<{data:Workbench}>('SELECT data FROM nh_documents WHERE '+workspaceKind,[owner]);
  return publicState(rows[0]?.data??blank());
}

export async function readWorkbenchProjects(owner:string){
  const {rows}=await pool().query<{projects:Project[]}>(
    "SELECT data->'projects' AS projects FROM nh_documents WHERE "+workspaceKind,[owner],
  );
  return rows[0]?.projects??[];
}

export async function workbenchProject(owner:string,id:unknown){
  const project=(await readWorkbenchProjects(owner)).find(row=>row.id===id);
  if(!project)throw missing();
  return project;
}

async function change<T>(owner:string, fn:(state:Workbench, client:PoolClient)=>Promise<T>) {
  const client = await pool().connect();
  try {
    await client.query('BEGIN');
    await client.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-workbench',$1,$2) ON CONFLICT DO NOTHING",[owner,JSON.stringify({...blank(),ownerId:owner})]);
    const {rows} = await client.query<{data:Workbench}>('SELECT data FROM nh_documents WHERE '+workspaceKind+' FOR UPDATE',[owner]);
    if (!rows[0]) throw missing();
    const state = rows[0].data;
    const result = await fn(state,client);
    await client.query('UPDATE nh_documents SET data=$2,updated=clock_timestamp() WHERE '+workspaceKind,[owner,JSON.stringify({...state,ownerId:owner})]);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const clock = (value:unknown) => typeof value==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const minutes = (time:string) => Number(time.slice(0,2))*60 + Number(time.slice(3));
const humanTime = (minute:number) => String(Math.floor(minute/60)).padStart(2,'0')+':'+String(minute%60).padStart(2,'0');
function date(value:unknown, now=new Date()) {
  const today=kstDay.format(now);
  const last=kstDay.format(+now+30*86400_000);
  if (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new MarketError('날짜를 확인해 주세요.');
  const timestamp=new Date(value+'T00:00:00+09:00');
  if (!Number.isFinite(+timestamp)||kstDay.format(timestamp)!==value||value<today||value>last) {
    throw new MarketError('오늘부터 30일 이내의 날짜를 선택해 주세요.');
  }
  return value;
}

async function items(client:PoolClient, owner:string) {
  const {rows} = await client.query<{id:string; data:TimedItem}>(
    'SELECT id,data FROM nh_documents WHERE '+personalItems+' ORDER BY id FOR UPDATE',[owner]);
  return rows.map(row=>({id:row.id.slice(owner.length+1),...row.data}));
}

function agendaOn(client:PoolClient,owner:string,day:string) {
  const from=new Date(day+'T00:00:00+09:00');
  return personalAgenda(owner,{from:from.toISOString(),until:new Date(+from+86400_000-1).toISOString()},client);
}

type Item = Awaited<ReturnType<typeof items>>[number];
type Agenda = Awaited<ReturnType<typeof personalAgenda>>;
export function proposeMoves(all:Item[], events:Agenda, day:string, start:string, end:string, now=new Date(), projectId?:string) {
  const boundary = day===kstDay.format(now) ? Math.max(minutes(start),Math.ceil((minutes(kstTime.format(now))+1)/30)*30) : minutes(start);
  const busy = all.filter(item=>!item.done&&item.dueOn===day&&item.dueTime&&clock(item.dueTime)).map(item=>minutes(item.dueTime!));
  for (const item of all) {
    if (!item.done&&item.focusOn===day&&item.focusTime&&clock(item.focusTime)) busy.push(minutes(item.focusTime));
  }
  for (const event of events) {
    const at = Date.parse(event.scheduledAt);
    if (Number.isFinite(at)&&kstDay.format(at)===day) busy.push(minutes(kstTime.format(at)));
  }
  const eligible = all.filter(item=>(!projectId||item.projectId===projectId)&&item.kind==='task'&&!item.done&&!item.focusOn&&!!item.dueOn&&item.dueOn<=day&&(item.dueOn<day||!item.dueTime))
    .sort((a,b)=>a.dueOn!.localeCompare(b.dueOn!)||Number(!!b.dueTime)-Number(!!a.dueTime)||a.id.localeCompare(b.id));
  const moves:Move[]=[];
  for (let slot=boundary;slot+30<=minutes(end)&&moves.length<Math.min(8,eligible.length);slot+=30) {
    if (busy.some(at=>at<slot+30&&at+30>slot)) continue;
    const task=eligible[moves.length];
    moves.push({id:task.id,title:task.title,version:task.version,day,time:humanTime(slot)});
  }
  return moves;
}

const productionFormats={short:'숏폼 대본',blog:'블로그',social:'SNS 문구'} as const;
const starterNames={business:'고객 제안 준비',content:'첫 콘텐츠 기획',seller:'상품 소개 준비',personal:'이번 주 업무 정리'};

export async function submitContentPack(owner:string,input:Record<string,unknown>,source:string) {
  const topic=textValue(input.topic,'주제와 원본 자료',2000);
  const title=textValue(input.title,'콘텐츠 묶음 제목',80);
  const variants=Object.entries(productionFormats).flatMap(([key,label])=>
    input[key]?[{format:key,label,text:textValue(input[key],label,4000)}]:[]);
  const card=input.card ? validatePersonalCard(input.card) : null;
  if(!variants.length&&!card)throw new MarketError('검토할 콘텐츠 초안을 하나 이상 입력해 주세요.');
  return change(owner,async state=>{
    const project=ownedProject(state,input.projectId);
    const id=randomUUID();
    const common={projectId:project.id,projectVersion:project.version,source};
    const decisions=variants.map(({format,label,text})=>putDecision(state,{
      ...common,title:title+' · '+label,text,category:'content',
      pack:{id,topic,format},
    }));
    if(card)decisions.push(putDecision(state,{
      ...common,title:card.title,text:card.slides.length+'장 카드뉴스',category:'cards',card,
      pack:{id,topic,format:'cards'},
    }));
    return {decisions};
  });
}

function putDecision(state:Workbench, draft:Omit<Decision,'id'|'status'|'created'>) {
  if (state.decisions.filter(row=>row.status==='pending').length>=40) throw new MarketError('대기 중인 제안을 먼저 검토해 주세요.',409);
  const row:Decision = {...draft,id:randomUUID(),status:'pending',created:new Date().toISOString()};
  state.decisions.unshift(row);
  if (state.decisions.length>100) {
    const settled=state.decisions.map(item=>item.status!=='pending').lastIndexOf(true);
    state.decisions.splice(settled,1);
  }
  return row;
}

export async function submitDraft(owner:string,input:Record<string,unknown>,source:string) {
  const category=categories.find(category=>category===input.category);
  if (!category) throw new MarketError('초안 유형을 확인해 주세요.');
  const title=textValue(input.title,'제목',160), text=textValue(input.text,'초안',4000);
  return change(owner,async state=>{
    const project=input.projectId?ownedProject(state,input.projectId):null;
    return putDecision(state,{title,text,category,projectId:project?.id??null,projectVersion:project?.version,source});
  });
}

export async function submitCardDraft(owner:string,input:Record<string,unknown>,source:string) {
  const card=validatePersonalCard(input);
  return change(owner,async state=>{
    const project=input.projectId?ownedProject(state,input.projectId):null;
    return putDecision(state,{title:card.title,text:card.slides.length+'장 카드뉴스',category:'cards',card,
      projectId:project?.id??null,projectVersion:project?.version,source});
  });
}

async function changeSlots(client:PoolClient, owner:string, decision:Decision, all:Item[], undo:boolean) {
  for (const move of decision.moves??[]) {
    const item=all.find(item=>item.id===move.id);
    const expectedVersion=move.version+Number(undo);
    if (!item||item.done||item.kind!=='task'||item.version!==expectedVersion) throw conflict();
    const changed=await client.query(
      'UPDATE nh_documents SET data=data||$3::jsonb,updated=clock_timestamp() WHERE '+personalItems+
      " AND id=$2 AND data->>'version'=$4 RETURNING id",
      [owner,owner+':'+move.id,JSON.stringify({focusTime:undo?null:move.time,focusOn:undo?null:move.day,version:expectedVersion+1,updatedAt:new Date().toISOString()}),String(expectedVersion)],
    );
    if (!changed.rowCount) throw conflict();
  }
}

export async function updateWorkbench(owner:string,input:Record<string,unknown>) {
  if (input.action==='cards-import') {
    const text=textValue(input.text,'카드뉴스 초안',18_000).replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
    let card:unknown;
    try { card=JSON.parse(text); } catch { throw new MarketError('AI가 반환한 카드뉴스 JSON을 붙여넣어 주세요.'); }
    if (!card||typeof card!=='object'||Array.isArray(card)) throw new MarketError('카드뉴스 초안 형식을 확인해 주세요.');
    return {decision:await submitCardDraft(owner,{...card,projectId:input.projectId},'구독 AI 답변 가져오기')};
  }
  if (input.action==='content-pack') return submitContentPack(owner,input,'콘텐츠 제작');
  if (input.action==='start-project') {
    const kind=String(input.starter);
    if (!Object.hasOwn(starterNames,kind)) throw new MarketError('시작할 업무를 선택해 주세요.');
    const name=textValue(input.name,'프로젝트 이름',80),rules=textValue(input.rules,'프로젝트 기억',1600);
    const firstStep=textValue(input.firstStep,'첫 업무',400);
    return change(owner,async state=>{
      const starter=kind as keyof typeof starterNames;
      const existing=state.projects.find(project=>project.starter===starter);
      if(existing)return {...publicState(state),projectId:existing.id};
      if(state.projects.length>=30)throw new MarketError('프로젝트는 최대 30개까지 저장할 수 있습니다.');
      const project={id:randomUUID(),name,rules,version:1,starter};
      state.projects.push(project);
      putDecision(state,{title:starterNames[starter],text:firstStep,category:starter==='personal'?'business':starter,
        projectId:project.id,projectVersion:project.version,source:'첫 업무 안내'});
      return {...publicState(state),projectId:project.id};
    });
  }
  if (input.action==='revise') return change(owner,async state=>{
    const row=state.decisions.find(item=>item.id===input.id);
    if(!row)throw missing();
    if(row.status!=='pending'||row.card||row.moves||(row.revision??1)!==input.revision)throw conflict();
    const text=textValue(input.text,'수정할 초안',4000);
    if(text!==row.text){
      row.originalText??=row.text;
      row.text=text;
      row.revision=(row.revision??1)+1;
    }
    return {decision:row};
  });
  if (input.action==='draft') return {decision:await submitDraft(owner,input,'내가 작성')};
  if (input.action==='project') {
    const name=textValue(input.name,'프로젝트 이름',80),rules=textValue(input.rules,'프로젝트 기억',1600);
    return change(owner,async state=>{
      if (input.id) {
        const project=ownedProject(state,input.id);
        if (project.version!==integer(input.version,'저장 버전',1)) throw new MarketError('프로젝트를 다시 열어 최신 기억을 확인해주세요.',409);
        Object.assign(project,{name,rules,version:project.version+1});
      } else {
        if (state.projects.length>=30) throw new MarketError('프로젝트는 최대 30개까지 저장할 수 있습니다.');
        state.projects.push({id:randomUUID(),name,rules,version:1});
      }
      return publicState(state);
    });
  }
  if (input.action==='project-remove') return change(owner,async state=>{
    const project=ownedProject(state,input.id);
    if (project.version!==integer(input.version,'저장 버전',1)) throw conflict();
    state.projects=state.projects.filter(item=>item.id!==project.id);
    return publicState(state);
  });
  if (input.action==='plan') {
    const day=date(input.day);
    if (!clock(input.start)||!clock(input.end)||minutes(input.end as string)-minutes(input.start as string)<30) {
      throw new MarketError('30분 이상의 가용 시간을 입력해 주세요.');
    }
    const start=input.start as string,end=input.end as string;
    return change(owner,async(state,client)=>{
      const project=input.projectId?ownedProject(state,input.projectId):null;
      const projectOnly=input.projectOnly===true;
      if(projectOnly&&!project)throw new MarketError('할 일을 배치할 프로젝트를 선택해 주세요.');
      const events=await agendaOn(client,owner,day);
      const moves=proposeMoves(await items(client,owner),events,day,start,end,new Date(),projectOnly?project?.id:undefined);
      if (!moves.length) throw new MarketError('배치할 할 일이나 빈 30분이 없습니다.',422);
      return {decision:putDecision(state,{title:day+' 집중 시간',text:(projectOnly?'선택한 프로젝트의 할 일만 대상으로 합니다. ':'')+'기한이 이른 순서대로 기존 일정과 예약을 피해 30분씩 배치합니다.',category:'schedule',projectId:project?.id??null,projectVersion:project?.version,projectOnly,moves,start,end,source:'일정 재계획'})};
    });
  }
  if (!['approve','decline','undo'].includes(String(input.action))) throw new MarketError('실행할 작업을 확인해 주세요.');
  return change(owner,async(state,client)=>{
    const row=state.decisions.find(row=>row.id===input.id);
    if (!row) throw missing();
    const undo=input.action==='undo';
    if (row.status!==(undo?'applied':'pending')) throw new MarketError('이미 처리된 제안입니다.',409);
    if (input.action==='approve'&&(row.revision??1)!==(input.revision??1))throw conflict();
    if (input.action==='decline') row.status='declined';
    else if (row.category==='schedule') {
      const all=await items(client,owner);
      if (!undo) {
        const day=date(row.moves?.[0]?.day);
        const projectId=row.projectOnly?ownedProject(state,row.projectId).id:undefined;
        const next=proposeMoves(all,await agendaOn(client,owner,day),day,row.start!,row.end!,new Date(),projectId);
        if (next.length!==row.moves?.length||next.some((move,index)=>{
          const saved=row.moves![index];
          return move.id!==saved.id||move.version!==saved.version||move.time!==saved.time||move.day!==saved.day;
        })) throw conflict();
      }
      await changeSlots(client,owner,row,all,undo);
      row.status=undo?'undone':'applied';
    } else if (row.category==='cards'&&row.card) {
      if (undo) throw new MarketError('만든 카드뉴스는 승인 내역에서 확인할 수 있습니다.',409);
      row.cardId=(await createPersonalCard(owner,row.card,client)).id;
      row.status='applied';
    } else {
      // The approval records a reviewed draft. Channel delivery stays in the existing channel approval flow.
      row.status=undo?'undone':'applied';
    }
    row.decided=new Date().toISOString();
    return {decision:row};
  });
}

export async function readDeliveryActivity(owner:string) {
  type Activity = {id:string; kind:string; status:string; title:string; provider:string|null;
    accountId:string|null; reason:string|null; at:string; unconfirmed:boolean};
  const {rows}=await pool().query<Activity>(
    "SELECT substr(id,length($2)+2) AS id, CASE WHEN kind='personal-mail-item' THEN 'mail' ELSE 'social' END AS kind,"+
    " data->>'status' AS status, left(COALESCE(data->>'subject',data->>'title','예약'),160) AS title,"+
    " data->>'provider' AS provider, data->>'accountId' AS \"accountId\", left(COALESCE(data->>'reason',data->>'error'),220) AS reason,"+
    " updated::text AS at, CASE WHEN kind='personal-mail-item' THEN COALESCE(data->>'retryable','false')<>'true'"+
    " ELSE COALESCE(data->>'uncertain','true')<>'false' END AS unconfirmed"+
    " FROM nh_documents WHERE workspace='live' AND kind IN ('personal-mail-item','personal-social-post')"+
    " AND id LIKE $1 AND data->>'ownerId'=$2 AND data->>'status' IN ('review','scheduled','sent','published','sending','publishing','cancelled')"+
    " ORDER BY CASE WHEN data->>'status'='review' THEN 0 ELSE 1 END,updated DESC,id LIMIT 30",
    [owner+':%',owner],
  );
  return rows;
}
