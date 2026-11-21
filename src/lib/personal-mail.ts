import {randomUUID} from 'node:crypto';
import {pool} from '@/server/postgres.cjs';
import {MarketError} from '@/lib/security';
import {canRunPersonalAutomation} from './personal-automation-access';
import {mailAccessToken, mailConnection} from './personal-mail-auth';
import {uuidPattern} from '@/server/personal-workspace.cjs';

type MailStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'review' | 'cancelled';
type MailDraft = {to: string; subject: string; body: string};
type MailItem = MailDraft & {
  id: string; ownerId: string; ownerEmail:string; version: number; status: MailStatus; createdAt: string; updatedAt: string;
  scheduledAt: string | null; connectionId: string | null; retryable?: boolean; sentAt?: string | null; reason?: string | null; messageId?: string | null;
};

const documentScope = "workspace='live' AND kind='personal-mail-item'";
const ownScope = documentScope + " AND id=$1 AND data->>'ownerId'=$2";
const changed = () => new MarketError('저장 내용이 바뀌었습니다. 새로고침 후 다시 시도해 주세요.', 409);
const iso = () => new Date().toISOString();

function itemID(value: unknown) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new MarketError('메일 항목을 확인해 주세요.');
  return value;
}

function cleanText(value: unknown, limit: number, label: string) {
  if (typeof value !== 'string' || value.length>limit || !value.trim() || value.includes('\0')) {
    throw new MarketError(label+'을 확인해 주세요.');
  }
  return value.trim();
}

export function mailDraft(input: Record<string,unknown>): MailDraft {
  const to = cleanText(input.to,254,'받는 주소');
  if (!/^[A-Za-z0-9.!#$%&'*+/?=^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(to) || to.includes('..')) {
    throw new MarketError('받는 사람은 이메일 주소 한 개를 입력해 주세요.');
  }
  const subject = cleanText(input.subject,160,'제목');
  if (/[\r\n]/.test(subject)) throw new MarketError('제목은 한 줄로 입력해 주세요.');
  return {to,subject,body:cleanText(input.body,16000,'내용')};
}

const visibleItem = ({ownerId,ownerEmail,connectionId,messageId,...item}:MailItem) => item;

export async function listPersonalMail(actor: string) {
  const db=pool();
  const rows=await db.query<{data:MailItem}>(
    "SELECT data FROM nh_documents WHERE "+documentScope+" AND id LIKE $1 AND data->>'ownerId'=$2 ORDER BY updated DESC,id LIMIT 200",
    [actor+':%',actor],
  );
  return rows.rows.map(r=>visibleItem(r.data));
}

async function getItem(actor: string, id: string) {
  const db=pool();
  const row=(await db.query<{data:MailItem}>('SELECT data FROM nh_documents WHERE '+ownScope,[actor+':'+id,actor])).rows[0];
  if(!row)throw new MarketError('메일 항목을 찾을 수 없습니다.',404);
  return row.data;
}

async function changeItem(previous:MailItem, patch:Partial<MailItem>){
  const next={...previous,...patch,version:previous.version+1,updatedAt:iso()};
  const db=pool();
  const saved=await db.query(
    "UPDATE nh_documents SET data=$3,updated=clock_timestamp() WHERE "+ownScope+" AND data->>'version'=$4",
    [previous.ownerId+':'+previous.id,previous.ownerId,JSON.stringify(next),String(previous.version)],
  );
  return saved.rowCount===1?next:null;
}

export async function editPersonalMail(actor:string,input:Record<string,unknown>,ownerEmail:string){
  const action=input.action;
  if(action==='draft'&&!input.id){
    const id=randomUUID(), now=iso();
    const item={...mailDraft(input),id,ownerId:actor,ownerEmail,status:'draft' as const,version:1,createdAt:now,updatedAt:now,scheduledAt:null,connectionId:null};
    const db=pool();
    await db.query("INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-mail-item',$1,$2)",
      [actor+':'+id,JSON.stringify(item)]);
    return visibleItem(item);
  }
  if(action!=='draft'&&action!=='schedule'&&action!=='cancel')throw new MarketError('메일 작업을 확인해 주세요.');
  const previous=await getItem(actor,itemID(input.id));
  if(previous.version!==input.version)throw changed();
  let patch:Partial<MailItem>;
  if(action==='draft'){
    if(!['draft','cancelled'].includes(previous.status))throw new MarketError('발송을 준비 중이거나 결과가 있는 메일은 복사해 새 초안으로 작성해 주세요.',409);
    patch={...mailDraft(input),status:'draft',reason:null,scheduledAt:null,connectionId:null};
  }else if(action==='schedule'){
    if(!['draft','cancelled'].includes(previous.status)&&!(previous.status==='review'&&previous.retryable===true))throw new MarketError('현재 상태에서 예약할 수 없습니다.',409);
    if(input.approved!==true)throw new MarketError('받는 주소, 제목, 본문과 발송 시각을 확인해 주세요.');
    const stamp=typeof input.at==='string'?Date.parse(input.at):NaN;
    if(!Number.isFinite(stamp)||stamp<=Date.now())throw new MarketError('앞으로의 발송 시각을 선택해 주세요.');
    const connection=await mailConnection(actor);
    if(!connection.connected||connection.paused||!connection.connectionId)throw new MarketError('Gmail을 연결하고 자동화를 켜 주세요.',409);
    patch={status:'scheduled',scheduledAt:new Date(stamp).toISOString(),connectionId:connection.connectionId,reason:null,retryable:false};
  }else{
    if(previous.status!=='scheduled')throw new MarketError('예약 중인 메일만 취소할 수 있습니다.',409);
    patch={status:'cancelled',scheduledAt:null,connectionId:null,reason:null};
  }
  const saved=await changeItem(previous,patch);
  if(!saved)throw changed();
  return visibleItem(saved);
}

function mimeSubject(subject:string){
  const parts=[];
  let part='';
  for(const char of subject){
    if(Buffer.byteLength(part+char)>42){parts.push(part);part='';}
    part+=char;
  }
  if(part)parts.push(part);
  return parts.map(value=>'=?UTF-8?B?'+Buffer.from(value).toString('base64')+'?=').join('\r\n ');
}

export function gmailRaw(item:MailDraft){
  const textLines=Buffer.from(item.body,'utf8').toString('base64').match(/.{1,76}/g)||[];
  const mime=[
    'To: '+item.to,'Subject: '+mimeSubject(item.subject),'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',...textLines,
  ].join('\r\n');
  return Buffer.from(mime,'utf8').toString('base64url');
}

type SenderOptions = {
  canRun?: (actor:string,email:string)=>Promise<boolean>;
  token?: (actor:string,id:string)=>Promise<string>;
  request?: typeof fetch;
};

export async function runPersonalMail({canRun=canRunPersonalAutomation,token=mailAccessToken,request=fetch}:SenderOptions={}){
  const db=pool();
  const overdue=await db.query<{data:MailItem}>(
    "SELECT data FROM nh_documents WHERE "+documentScope+" AND data->>'status'='sending' AND data->>'updatedAt'<$1 ORDER BY updated LIMIT 12",
    [new Date(Date.now()-15*60_000).toISOString()],
  );
  let review=0;
  for(const {data:item} of overdue.rows){
    if(await changeItem(item,{status:'review',retryable:false,reason:'이전 발송 결과를 확인하세요.'}))review++;
  }
  const due=await db.query<{data:MailItem}>(
    "SELECT data FROM nh_documents WHERE "+documentScope+" AND data->>'status'='scheduled' AND data->>'scheduledAt'<=$1 ORDER BY data->>'scheduledAt',id LIMIT 4",
    [iso()],
  );
  let checked=0, sent=0;
  for(const {data:item} of due.rows){
    const claim=await changeItem(item,{status:'sending'});
    if(!claim)continue;
    checked++;
    let submitted=false;
    try{
      if(!claim.connectionId||!await canRun(claim.ownerId,claim.ownerEmail))throw new Error('Access unavailable');
      const access=await token(claim.ownerId,claim.connectionId);
      if(!await canRun(claim.ownerId,claim.ownerEmail))throw new Error('Access unavailable');
      submitted=true;
      const response=await request('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{
        method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},
        body:JSON.stringify({raw:gmailRaw(claim)}),signal:AbortSignal.timeout(12_000),redirect:'error',
      });
      if(!response.ok)throw new Error('Gmail send rejected');
      const result=await response.json();
      if(typeof result.id!=='string'||!result.id)throw new Error('Gmail result unconfirmed');
      if(await changeItem(claim,{status:'sent',sentAt:iso(),messageId:result.id.slice(0,160),reason:null}))sent++;
    }catch{
      const reason=submitted?'Gmail의 보낸편지함에서 발송 여부를 확인하세요.':'계정 승인 또는 Gmail 연결을 다시 확인하세요.';
      if(await changeItem(claim,{status:'review',retryable:!submitted,reason}))review++;
    }
  }
  return {checked,sent,review};
}
