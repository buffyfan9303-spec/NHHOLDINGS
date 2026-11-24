import {projectPerformance} from './personal-connectors';
import {createHash} from 'node:crypto';
import type {PoolClient} from 'pg';
import {pool} from '@/server/postgres.cjs';
import {personalWorkspace,uuidPattern} from '@/server/personal-workspace.cjs';
import {canRunPersonalAutomation} from '@/lib/personal-automation-access';
import {readWorkbench} from '@/lib/personal-workbench';
import {integer,MarketError,textValue} from '@/lib/security';

const formatDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});
const dayMs=86400_000;
const ruleKind='personal-recurring-task';
type Frequency='daily'|'weekly'|'monthly';
type Rule={id:string;ownerId:string;email:string;projectId:string;title:string;frequency:Frequency;startOn:string;nextOn:string;active:boolean;version:number};
type Actor={id:string;email:string};
const ownerScope="workspace='live' AND kind='personal-recurring-task' AND data->>'ownerId'=$1 AND id LIKE $1||':%'";
const projectScope="workspace='live' AND kind='personal-workbench' AND id=$1 AND data->>'ownerId'=$1 AND data->'projects' @> $2::jsonb";
const conflict=()=>new MarketError('업무 상태가 변경되었습니다. 다시 확인해 주세요.',409);
const missing=()=>new MarketError('프로젝트 또는 업무를 찾을 수 없습니다.',404);
const utc=(day:string)=>new Date(day+'T00:00:00Z');
const isoDay=(value:Date|number)=>new Date(value).toISOString().slice(0,10);
export const addPlanningDays=(day:string,offset:number)=>isoDay(+utc(day)+offset*dayMs);
const today=(now=new Date())=>formatDay.format(now);

function id(value:unknown) {
  if(typeof value!=='string'||!uuidPattern.test(value))throw new MarketError('업무 식별자를 확인해 주세요.');
  return value;
}
function validDay(value:unknown){
  if(typeof value!=='string'||!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(+utc(value))||isoDay(utc(value))!==value){
    throw new MarketError('날짜를 확인해 주세요.');
  }
  return value;
}
function reviewWeek(value:unknown){
  const start=validDay(value);
  if(utc(start).getUTCDay()!==1)throw new MarketError('월요일 기준의 주를 선택해 주세요.');
  return {start,end:addPlanningDays(start,6),nextStart:addPlanningDays(start,7),nextEnd:addPlanningDays(start,13)};
}

export function nextOccurrence(start:string,frequency:Frequency,onOrAfter:string){
  if(onOrAfter<=start)return start;
  if(frequency==='daily')return onOrAfter;
  if(frequency==='weekly'){
    const weeks=Math.ceil((+utc(onOrAfter)-+utc(start))/(7*dayMs));
    return addPlanningDays(start,weeks*7);
  }
  const anchor=utc(start), threshold=utc(onOrAfter);
  const month=threshold.getUTCMonth(),year=threshold.getUTCFullYear();
  const inMonth=(offset:number)=>isoDay(Date.UTC(year,month+offset,
    Math.min(anchor.getUTCDate(),new Date(Date.UTC(year,month+offset+1,0)).getUTCDate())));
  const thisMonth=inMonth(0);
  return thisMonth>=onOrAfter?thisMonth:inMonth(1);
}

async function transaction<T>(work:(client:PoolClient)=>Promise<T>){
  const client=await pool().connect();
  try{
    await client.query('BEGIN');
    const result=await work(client);
    await client.query('COMMIT');
    return result;
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}
async function lockProject(client:PoolClient,owner:string,projectId:string){
  const {rows}=await client.query("SELECT 1 FROM nh_documents WHERE "+projectScope+" FOR SHARE",
    [owner,JSON.stringify([{id:projectId}])]);
  return rows.length===1;
}

export async function projectPlanning(owner:string,selected:unknown,week:unknown) {
  const projectId=id(selected);
  const window=reviewWeek(week);
  const workbench=await readWorkbench(owner);
  if(!workbench.projects.some(row=>row.id===projectId))throw missing();
  const [items,{rows},performance]=await Promise.all([
    personalWorkspace(owner).list(),
    pool().query<{data:Rule}>("SELECT data FROM nh_documents WHERE "+ownerScope+" AND data->>'projectId'=$2 ORDER BY updated DESC,id",[owner,projectId]),
    projectPerformance(owner,projectId,window.start),
  ]);
  const tasks=items.filter(item=>item.kind==='task'&&item.projectId===projectId);
  const display=({id,title,dueOn,version}:typeof tasks[number])=>({id,title,dueOn,version});
  const completed=tasks.filter(item=>{
    if(!item.done)return false;
    const day=today(new Date(item.completedAt??item.updatedAt));
    return day>=window.start&&day<=window.end;
  }).map(display);
  const unfinished=tasks.filter(item=>!item.done&&(!item.dueOn||item.dueOn<=window.end))
    .sort((a,b)=>(a.dueOn??'9999').localeCompare(b.dueOn??'9999')).map(display);
  const approvals=workbench.decisions.filter(row=>row.projectId===projectId&&row.status==='pending')
    .map(({id,title})=>({id,title}));
  const rules=rows.map(({data:{id,title,frequency,startOn,nextOn,active,version}})=>({id,title,frequency,startOn,nextOn,active,version}));
  return {window,completed,unfinished,approvals,rules,performance};
}

type PlanItem={kind:'task'|'schedule';title:string;detail:string;dueOn:string|null;dueTime:string|null};

function planKey({kind,title,dueOn,dueTime}:PlanItem){
  return JSON.stringify([kind,title.normalize('NFKC').toLowerCase().trim().replace(/\s+/g,' '),dueOn||null,dueTime||null]);
}

function planItem(value:unknown,window:ReturnType<typeof reviewWeek>):PlanItem{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new MarketError('가져올 항목을 확인해 주세요.');
  const {kind,title,detail,dueOn,dueTime}=value as Record<string,unknown>;
  if(kind!=='task'&&kind!=='schedule')throw new MarketError('할 일이나 일정을 선택해 주세요.');
  const date=dueOn==null||dueOn===''?null:validDay(dueOn);
  const time=dueTime==null||dueTime===''?null:dueTime;
  if(kind==='schedule'&&!date)throw new MarketError('일정에는 날짜가 필요합니다.');
  if(date&&(date<window.nextStart||date>window.nextEnd||date<today())){
    throw new MarketError('날짜는 리뷰 다음 주의 오늘 이후로 선택해 주세요.');
  }
  if(time!==null&&(!date||typeof time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))){
    throw new MarketError('날짜와 시간을 확인해 주세요.');
  }
  return {kind,title:textValue(title,'제목',160),detail:textValue(detail??'','메모',1000,true),dueOn:date,dueTime:time};
}

async function importPlan(actor:Actor,projectId:string,input:Record<string,unknown>){
  const window=reviewWeek(input.week);
  if(window.nextEnd<today())throw new MarketError('다음 주가 지난 리뷰는 가져올 수 없습니다.');
  if(!Array.isArray(input.items)||!input.items.length||input.items.length>20){
    throw new MarketError('등록할 할 일과 일정을 1~20개 선택해 주세요.');
  }
  const selected=input.items.map(row=>planItem(row,window));
  return transaction(async client=>{
    if(!await lockProject(client,actor.id,projectId))throw missing();
    const {rows}=await client.query<{data:PlanItem}>(
      "SELECT data FROM nh_documents WHERE workspace='live' AND kind='personal-item' AND id LIKE $1||':%' AND data->>'ownerId'=$1 "+
      "AND data->>'projectId'=$2 AND data->>'kind' IN ('task','schedule')",[actor.id,projectId],
    );
    const known=new Set(rows.map(row=>planKey(row.data)));
    // A stable insert order prevents two overlapping imports from locking identical rows in reverse order.
    const pending=selected.map(item=>({item,key:planKey(item)})).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
    const stamp=new Date().toISOString();
    let created=0;
    for(const {item,key} of pending){
      if(known.has(key))continue;
      known.add(key);
      const recordId=actor.id+':'+deterministicId(JSON.stringify(['weekly-plan',projectId,key]));
      const result=await client.query(
        "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-item',$1,$2) ON CONFLICT DO NOTHING RETURNING id",
        [recordId,JSON.stringify({...item,ownerId:actor.id,projectId,done:false,createdAt:stamp,updatedAt:stamp,version:1})],
      );
      created+=result.rows.length;
    }
    return {created,skipped:selected.length-created};
  });
}

export async function changeProjectPlanning(actor:Actor,input:Record<string,unknown>) {
  const projectId=id(input.projectId);
  if(input.action==='import-plan')return importPlan(actor,projectId,input);
  if(input.action==='carry'){
    const window=reviewWeek(input.week), target=validDay(input.target);
    if(target<window.nextStart||target>window.nextEnd||target<today())throw new MarketError('다음 주의 오늘 이후 날짜를 선택해 주세요.');
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>100)throw new MarketError('옮길 업무를 1~100개 선택해 주세요.');
    const selections=input.items.map(row=>({id:id(row?.id),version:integer(row?.version,'저장 버전',1)}));
    if(new Set(selections.map(row=>row.id)).size!==selections.length)throw new MarketError('같은 업무를 한 번만 선택해 주세요.');
    return transaction(async client=>{
      if(!await lockProject(client,actor.id,projectId))throw missing();
      for(const pick of selections.sort((a,b)=>a.id.localeCompare(b.id))){
        const result=await client.query(
          "UPDATE nh_documents SET data=(data-'focusOn'-'focusTime')||jsonb_build_object('dueOn',$5::text,'updatedAt',$6::text,'version',$4::int+1),updated=clock_timestamp() "+
          "WHERE workspace='live' AND kind='personal-item' AND id=$1||':'||$2 AND data->>'ownerId'=$1 AND data->>'projectId'=$3 "+
          "AND data->>'kind'='task' AND data->>'done'='false' AND data->>'version'=$4::text AND COALESCE(data->>'dueOn','')<=$7",
          [actor.id,pick.id,projectId,pick.version,target,new Date().toISOString(),window.end],
        );
        if(result.rowCount!==1)throw conflict();
      }
      return {moved:selections.length};
    });
  }
  if(input.action==='repeat-create'){
    const frequency=input.frequency;
    if(frequency!=='daily'&&frequency!=='weekly'&&frequency!=='monthly')throw new MarketError('반복 주기를 선택해 주세요.');
    const startOn=validDay(input.startOn);
    if(startOn<today())throw new MarketError('오늘 이후의 시작 날짜를 선택해 주세요.');
    const title=textValue(input.title,'할 일 이름',160);
    const rule:Rule={id:deterministicId(JSON.stringify([projectId,title,frequency,startOn])),ownerId:actor.id,email:actor.email,projectId,title,
      frequency,startOn,nextOn:startOn,active:true,version:1};
    return transaction(async client=>{
      if(!await lockProject(client,actor.id,projectId))throw missing();
      const key=actor.id+':'+rule.id;
      const result=await client.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live',$1,$2,$3) ON CONFLICT DO NOTHING RETURNING id",
        [ruleKind,key,JSON.stringify(rule)]);
      if(!result.rows.length){
        const saved=await client.query<{data:Rule}>("SELECT data FROM nh_documents WHERE "+ownerScope+" AND id=$2",[actor.id,key]);
        const old=saved.rows[0]?.data;
        if(!old||old.projectId!==projectId||old.title!==rule.title||old.startOn!==startOn||old.frequency!==frequency)throw conflict();
      }
      return {id:rule.id,created:result.rows.length===1};
    });
  }
  if(input.action!=='repeat-state'||typeof input.active!=='boolean')throw new MarketError('반복 업무 설정을 확인해 주세요.');
  const ruleId=id(input.id),version=integer(input.version,'저장 버전',1);
  return transaction(async client=>{
    if(!await lockProject(client,actor.id,projectId))throw missing();
    const key=actor.id+':'+ruleId;
    const {rows}=await client.query<{data:Rule}>("SELECT data FROM nh_documents WHERE "+ownerScope+" AND id=$2 FOR UPDATE",[actor.id,key]);
    const rule=rows[0]?.data;
    if(!rule||rule.projectId!==projectId)throw missing();
    if(rule.version!==version)throw conflict();
    const nextOn=input.active&&!rule.active?nextOccurrence(rule.startOn,rule.frequency,rule.nextOn>today()?rule.nextOn:today()):rule.nextOn;
    await client.query("UPDATE nh_documents SET data=$3,updated=clock_timestamp() WHERE "+ownerScope+" AND id=$2",
      [actor.id,key,JSON.stringify({...rule,active:input.active,nextOn,version:version+1})]);
    return {active:input.active};
  });
}

// The rule cursor and the occurrence insert commit together, including on worker retries.
function deterministicId(value:string){
  const hash=createHash('sha256').update(value).digest('hex');
  return hash.slice(0,8)+'-'+hash.slice(8,12)+'-8'+hash.slice(13,16)+'-8'+hash.slice(17,20)+'-'+hash.slice(20,32);
}
export async function runPersonalRecurringTasks(now=new Date(),allowed=canRunPersonalAutomation){
  const day=today(now);
  const {rows}=await pool().query<{id:string;data:Rule}>(
    "SELECT r.id,r.data FROM nh_documents r WHERE r.workspace='live' AND r.kind=$1 AND r.data->>'active'='true' AND r.data->>'nextOn'<=$2 "+
    "AND EXISTS(SELECT 1 FROM nh_documents p WHERE p.workspace='live' AND p.kind='personal-workbench' AND p.id=r.data->>'ownerId' "+
    "AND p.data->>'ownerId'=p.id AND p.data->'projects' @> jsonb_build_array(jsonb_build_object('id',r.data->>'projectId'))) "+
    "ORDER BY r.updated,r.id LIMIT 100",[ruleKind,day]);
  let generated=0,failed=0;
  for(const candidate of rows){
    try{
      generated+=await transaction(async client=>{
        if(!await allowed(candidate.data.ownerId,candidate.data.email,client)){
          // Avoid starving other due rules while this account is suspended.
          await client.query("UPDATE nh_documents SET updated=clock_timestamp() WHERE "+ownerScope+" AND id=$2",[candidate.data.ownerId,candidate.id]);
          return 0;
        }
        if(!await lockProject(client,candidate.data.ownerId,candidate.data.projectId))return 0;
        const found=await client.query<{data:Rule}>("SELECT data FROM nh_documents WHERE "+ownerScope+" AND id=$2 FOR UPDATE",
          [candidate.data.ownerId,candidate.id]);
        const rule=found.rows[0]?.data;
        if(!rule?.active||rule.nextOn!==candidate.data.nextOn||rule.projectId!==candidate.data.projectId||rule.nextOn>day)return 0;
        const dueOn=rule.nextOn;
        const stamp=now.toISOString();
        const insert=await client.query(
          "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-item',$1,$2) ON CONFLICT DO NOTHING RETURNING id",
          [rule.ownerId+':'+deterministicId(rule.id+':'+dueOn),JSON.stringify({ownerId:rule.ownerId,projectId:rule.projectId,kind:'task',
            title:rule.title,detail:'',dueOn,dueTime:null,done:false,createdAt:stamp,updatedAt:stamp,version:1})]);
        const nextOn=nextOccurrence(rule.startOn,rule.frequency,addPlanningDays(dueOn,1));
        await client.query("UPDATE nh_documents SET data=$3,updated=clock_timestamp() WHERE "+ownerScope+" AND id=$2",
          [rule.ownerId,candidate.id,JSON.stringify({...rule,nextOn})]);
        return insert.rows.length;
      });
    }catch{failed++;}
  }
  return {checked:rows.length,generated,failed};
}
