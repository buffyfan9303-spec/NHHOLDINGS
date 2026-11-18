import {randomUUID} from 'node:crypto';
import {personalWorkspace} from '@/server/personal-workspace.cjs';
import {pool} from '@/server/postgres.cjs';
import {MarketError, textValue} from '@/lib/security';
import {personalAgenda} from '@/lib/personal-agenda';
import {changePersonalSocial,personalSocialState} from '@/lib/personal-social';
import {editPersonalMail} from '@/lib/personal-mail';
import {createPersonalCard} from '@/lib/personal-cards';
import type {PersonalAIProvider} from '@/lib/personal-ai-providers';

export type AIMode = 'chat'|'brief'|'task'|'schedule'|'note'|'social'|'mail'|'cards';
export type AIAction = {kind:string;id:string;title:string;href:string;slides?:number};
export type AIMessage = {
  id:string; provider:PersonalAIProvider; mode:AIMode; prompt:string; response:string;
  createdAt:string; action?:AIAction;
};
type Actor = {id:string;email:string};
type Social = 'instagram'|'threads'|'youtube'|'x';

const modes=new Set<AIMode>(['chat','brief','task','schedule','note','social','mail','cards']);
const socialProviders=new Set<Social>(['instagram','threads','youtube','x']);
const scope="workspace='live' AND kind='personal-ai-message'";

export function aiInput(value:Record<string,unknown>){
  const mode=value.mode===undefined?'chat':value.mode;
  if(typeof mode!=='string'||!modes.has(mode as AIMode))throw new MarketError('작업 종류를 확인해 주세요.');
  const prompt=textValue(value.prompt,'메시지',6000);
  const social=typeof value.socialProvider==='string'&&socialProviders.has(value.socialProvider as Social)?value.socialProvider as Social:null;
  if(mode==='social'&&!social)throw new MarketError('SNS 초안을 만들 채널을 선택해 주세요.');
  return {mode:mode as AIMode,prompt,social};
}

export async function personalAIHistory(actor:string){
  const rows=await pool().query<{data:AIMessage & {ownerId:string}}>(
    "SELECT data FROM nh_documents WHERE "+scope+" AND id LIKE $1 AND data->>'ownerId'=$2 ORDER BY updated DESC,id LIMIT 40",
    [actor+':%',actor],
  );
  return rows.rows.reverse().map(({data:{ownerId,...record}})=>record);
}

export function aiRecord(provider:PersonalAIProvider,mode:AIMode,prompt:string,response:string,action?:AIAction):AIMessage {
  return {id:randomUUID(),provider,mode,prompt,response,createdAt:new Date().toISOString(),...(action?{action}:{})};
}

export async function savePersonalAIMessage(actor:string,record:AIMessage){
  await pool().query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-ai-message',$1,$2) ON CONFLICT DO NOTHING",
    [actor+':'+record.id,JSON.stringify({...record,ownerId:actor})]);
}

export async function clearPersonalAIHistory(actor:string){
  await pool().query("DELETE FROM nh_documents WHERE "+scope+" AND id LIKE $1 AND data->>'ownerId'=$2",[actor+':%',actor]);
}

export async function briefContext(actor:string){
  const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
  const [items,agenda]=await Promise.all([personalWorkspace(actor).list(),personalAgenda(actor)]);
  return {kst,items:items.filter(x=>x.kind==='task'&&!x.done&&(!x.dueOn||x.dueOn<=kst)||x.kind==='schedule'&&x.dueOn===kst)
    .slice(0,12).map(({title,kind,dueOn,dueTime})=>({title,kind,dueOn,dueTime})),agenda:agenda.slice(0,8)};
}

export function actionInstructions(mode:AIMode,social:Social|null){
  switch(mode){
    case 'task':return '할 일 하나를 JSON으로 작성하세요. 키는 title(1~160자), detail(최대 4000자), dueOn(명시된 날짜 YYYY-MM-DD 또는 null)입니다.';
    case 'schedule':return '개인 일정 하나를 JSON으로 작성하세요. 키는 title(최대 160자), detail, dueOn(YYYY-MM-DD), dueTime(한국 시각 HH:MM 또는 null)입니다. 날짜를 알 수 없으면 dueOn을 null로 반환하세요.';
    case 'note':return '메모 하나를 JSON으로 작성하세요. 키는 title(1~160자), detail(최대 4000자)입니다.';
    case 'social':return '채널 '+social+'의 게시용 초안을 JSON으로 작성하세요. 키는 title(최대 100자), body입니다. X는 가중 280자 이내, Threads는 500자 이내, Instagram은 2200자 이내로 작성하세요. 임의 주소나 미디어 ID를 만들지 마세요.';
    case 'mail':return '발송할 메일 초안을 JSON으로 작성하세요. 키는 subject(1~160자), body(최대 16000자)입니다. 실제 전송하거나 받는 주소를 추측하지 마세요.';
    case 'cards':return '세로형 카드뉴스를 JSON으로 작성하세요. 키는 title(최대 64자), theme(mint,cobalt,ink 중 하나), slides 배열입니다. slides는 1~8개이며 각각 headline(최대 58자), body(최대 130자), label(최대 20자)을 갖습니다. 카드당 한 가지 내용을 다루고, Markdown을 넣지 마세요.';
    default:throw new MarketError('만들 작업을 확인해 주세요.');
  }
}

function jsonDraft(output:string){
  const clean=output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{
    const parsed:unknown=JSON.parse(clean);
    if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))return parsed as Record<string,unknown>;
  }catch{}
  throw new MarketError('결과를 저장할 형식으로 받지 못했습니다. 요청을 한 번 더 작성해 주세요.',422);
}

function dateValue(value:unknown){
  if(value==null||value==='')return null;
  if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)){
    const d=new Date(value+'T00:00:00Z');
    if(Number.isFinite(+d)&&d.toISOString().slice(0,10)===value)return value;
  }
  throw new MarketError('생성된 업무 날짜를 확인해 주세요.',422);
}

function userEmail(prompt:string){
  const addresses=new Set(prompt.match(/[A-Za-z0-9.!#$%&'*+/?=^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)||[]);
  return addresses.size===1?[...addresses][0]:'';
}

async function saveWork(actor:Actor,kind:'task'|'schedule'|'note',title:string,detail:string,dueOn:string|null,dueTime:string|null=null):Promise<AIAction>{
  const item=await personalWorkspace(actor.id).create({kind,title,detail,dueOn,dueTime,done:false});
  if(!item)throw new MarketError('업무를 저장하지 못했습니다.',409);
  return {id:item.id,kind,title:item.title,href:'/personal#'+(kind==='task'?'tasks':kind==='schedule'?'schedule':'notes')};
}

export async function applyPersonalAI(actor:Actor, mode:AIMode, prompt:string, social:Social|null, output:string){
  const draft=jsonDraft(output);
  if(mode==='schedule'){
    const title=textValue(draft.title,'제목',160),detail=textValue(draft.detail??'','내용',4000,true);
    const date=dateValue(draft.dueOn);
    const time=draft.dueTime??null;
    if(!date||time!==null&&(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))){
      throw new MarketError('일정을 추가하려면 날짜와 한국 시각을 확인해 주세요.',422);
    }
    const action=await saveWork(actor,'schedule',title,detail,date,time);
    return {action,response:'내 일정에 추가했습니다.\n'+title+' · '+date+(time?' '+time+' KST':'')+(detail?'\n'+detail:'')};
  }
  if(mode==='task'||mode==='note'){
    const title=textValue(draft.title,'제목',160);
    const detail=textValue(draft.detail??'','내용',4000,true);
    const action=await saveWork(actor,mode,title,detail,mode==='task'?dateValue(draft.dueOn):null);
    return {action,response:(mode==='task'?'할 일을 추가했습니다. ':'메모를 저장했습니다. ')+title+(detail?'\n\n'+detail:'')};
  }
  if(mode==='cards'){
    const record=await createPersonalCard(actor.id,draft);
    const action={id:record.id,kind:'cards',title:record.title,href:'/api/personal/ai/cards/'+record.id+'?slide=0',slides:record.slides.length};
    return {action,response:record.title+' 카드뉴스 '+record.slides.length+'장을 만들었습니다.'};
  }
  if(mode==='mail'){
    const to=userEmail(prompt);
    const subject=textValue(draft.subject,'제목',160),content=textValue(draft.body,'내용',16000);
    const record=await editPersonalMail(actor.id,{action:'draft',to,subject,body:content},actor.email);
    const action={id:record.id,kind:'mail',title:record.subject,href:'/personal#mail'};
    return {action,response:'메일 초안을 저장했습니다.\n받는 사람 '+to+'\n제목 '+subject+'\n\n'+content};
  }
  if(mode==='social'&&social){
    const title=textValue(draft.title,'제목',160),content=textValue(draft.body,'본문',3700);
    const state=await personalSocialState(actor);
    const accounts=state.accounts.filter(account=>account.provider===social&&!account.paused);
    const mediaUrl=prompt.match(/https:\/\/[^\s<>"]+?\.jpe?g(?:\?[^\s<>"]*)?(?=$|[\s<>"])/i)?.[0]||'';
    if(accounts.length===1&&social!=='youtube'&&(social!=='instagram'||mediaUrl)){
      try{
        const result=await changePersonalSocial(actor,{action:'save',accountId:accounts[0].id,title,body:content,mediaUrl:social==='x'?'':mediaUrl});
        if(result.post)return {
          action:{id:result.post.id,kind:'social',title,href:'/personal#social'},
          response:'게시 초안을 내 SNS에 저장했습니다.\n\n'+title+'\n'+content,
        };
      }catch(error){if(!(error instanceof MarketError))throw error;}
    }
    const action=await saveWork(actor,'note',title,content,null);
    return {action,response:'게시 원고를 메모에 저장했습니다. 내 SNS에서 채널 계정, 미디어와 게시 조건을 확인한 뒤 사용하세요.\n\n'+content};
  }
  throw new MarketError('만들 작업을 확인해 주세요.');
}

export function hasMailRecipient(prompt:string){return !!userEmail(prompt);}
