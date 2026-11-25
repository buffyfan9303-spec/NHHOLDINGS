import {randomBytes} from 'node:crypto';
import {pool} from '@/server/postgres.cjs';
import {canRunPersonalAutomation} from '@/lib/personal-automation-access';
import {equal,hash} from '@/lib/security';

// Read-only iCalendar feed of one owner's personal schedule items.
// Vercel Runtime Logs record the request path, so NO secret may appear in the URL, query or webcal link.
// The feed lives at one fixed HTTPS path and is read with HTTP Basic auth: user name 'nuri' + a generated, read-only
// password that is shown once in the authenticated create response. nh_documents (kind 'personal-calendar-feed',
// id '<owner>:calendar-feed') keeps only the SHA-256 digest of that password.
export const feedHeaders={'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','Content-Type':'text/calendar; charset=utf-8','X-Content-Type-Options':'nosniff'};
const feedId=(owner:string)=>owner+':calendar-feed';
export const FEED_USER='nuri';
export const FEED_PATH='/api/personal/calendar-subscription/feed';
const secretShape=/^[A-Za-z0-9_-]{43}$/;
// Filter bounds: schedule items from 30 days ago to 365 days ahead (KST dates), at most 500 events, titles cut at 200 characters.
export const FEED_PAST_DAYS=30,FEED_FUTURE_DAYS=365,MAX_EVENTS=500,MAX_TITLE=200;
const DAY=86400_000;
const kst=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'});

type Row={id:string;title:string;dueOn:string;dueTime:string|null;updatedAt:string};

export async function feedStatus(owner:string) {
  const {rows}=await pool().query<{active:boolean;createdAt:string}>(
    "SELECT COALESCE((data->>'active')::boolean,false) AS active, data->>'createdAt' AS \"createdAt\" FROM nh_documents WHERE workspace='live' AND kind='personal-calendar-feed' AND id=$1 AND data->>'ownerId'=$2",[feedId(owner),owner]);
  return {active:rows[0]?.active===true,createdAt:rows[0]?.active?rows[0].createdAt:null};
}

// Create or rotate. One atomic upsert replaces the previous digest, so the old password stops working immediately.
export async function issueFeed(owner:string,email:string) {
  const password=randomBytes(32).toString('base64url');
  await pool().query(
    "INSERT INTO nh_documents(workspace,kind,id,data) VALUES('live','personal-calendar-feed',$1,$2) ON CONFLICT(workspace,kind,id) DO UPDATE SET data=EXCLUDED.data",
    [feedId(owner),JSON.stringify({ownerId:owner,email:email.toLowerCase(),passwordHash:hash(password),active:true,createdAt:new Date().toISOString()})]);
  return password;
}

export async function disableFeed(owner:string) {
  await pool().query(
    "UPDATE nh_documents SET data=(data-'passwordHash')||'{\"active\":false}'::jsonb WHERE workspace='live' AND kind='personal-calendar-feed' AND id=$1 AND data->>'ownerId'=$2",[feedId(owner),owner]);
}

const text=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
const stamp=(value:number)=>new Date(value).toISOString().replace(/[-:]|\.\d{3}/g,'');
const dateOnly=(value:string)=>value.replaceAll('-','');

// RFC 5545 folding at 75 octets without splitting a UTF-8 code point.
export function fold(line:string) {
  const encoder=new TextEncoder();
  let result='',size=0;
  for(const char of line){
    const count=encoder.encode(char).length;
    if(size+count>75){result+='\r\n ';size=1;}
    result+=char;size+=count;
  }
  return result;
}

const dateShape=/^20\d{2}-\d{2}-\d{2}$/,timeShape=/^([01]\d|2[0-3]):[0-5]\d$/;
// A row with an impossible date (2026-02-31), bad time or empty title is skipped on its own; it never breaks the feed.
export function usable(row:Row) {
  if(!row||typeof row.title!=='string'||!row.title.trim()||typeof row.dueOn!=='string'||!dateShape.test(row.dueOn))return false;
  const day=Date.parse(row.dueOn+'T00:00:00Z');
  if(!Number.isFinite(day)||new Date(day).toISOString().slice(0,10)!==row.dueOn)return false;
  return !row.dueTime||timeShape.test(row.dueTime);
}

export function renderCalendar(rows:Row[]) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//NH HOLDINGS//NURI ONE//KO','CALSCALE:GREGORIAN','METHOD:PUBLISH','X-WR-CALNAME:NURI ONE 개인 일정','X-WR-TIMEZONE:Asia/Seoul','REFRESH-INTERVAL;VALUE=DURATION:PT1H','X-PUBLISHED-TTL:PT1H'];
  for(const row of rows.filter(usable).slice(0,MAX_EVENTS)){
    const updated=Date.parse(row.updatedAt);
    const sealed=Number.isFinite(updated)?updated:0;
    lines.push('BEGIN:VEVENT','UID:'+hash('nuri-one-feed:'+row.id).slice(0,40)+'@nhholdings.xyz','DTSTAMP:'+stamp(sealed));
    if(row.dueTime){
      const start=Date.parse(row.dueOn+'T'+row.dueTime+':00+09:00');
      lines.push('DTSTART:'+stamp(start),'DTEND:'+stamp(start+30*60000));
    } else {
      const end=kst.format(Date.parse(row.dueOn+'T12:00:00+09:00')+DAY);
      lines.push('DTSTART;VALUE=DATE:'+dateOnly(row.dueOn),'DTEND;VALUE=DATE:'+dateOnly(end));
    }
    lines.push('SUMMARY:'+text(row.title.slice(0,MAX_TITLE)),'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n')+'\r\n';
}

export function feedRange(now=Date.now()) {return {from:kst.format(now-FEED_PAST_DAYS*DAY),until:kst.format(now+FEED_FUTURE_DAYS*DAY)};}

// 'Authorization: Basic base64(nuri:password)' -> password, or null for any other shape, user name or password format.
export function basicPassword(header:string|null) {
  const match=/^Basic ([A-Za-z0-9+/=]{1,200})$/i.exec(header??'');
  if(!match)return null;
  const decoded=Buffer.from(match[1],'base64').toString('utf8');
  const colon=decoded.indexOf(':');
  if(colon<0)return null;
  const user=decoded.slice(0,colon),password=decoded.slice(colon+1);
  return equal(user,FEED_USER)&&secretShape.test(password)?password:null;
}

// Generic null on every failure (missing/invalid credentials, rotated/disabled password, owner no longer approved).
export async function feedForAuthorization(header:string|null):Promise<string|null> {
  const password=basicPassword(header);
  if(!password)return null;
  const {rows}=await pool().query<{ownerId:string;email:string}>(
    "SELECT data->>'ownerId' AS \"ownerId\", data->>'email' AS email FROM nh_documents WHERE workspace='live' AND kind='personal-calendar-feed' AND data->>'passwordHash'=$1 AND data->>'active'='true' AND id=data->>'ownerId'||':calendar-feed'",[hash(password)]);
  const feed=rows[0];
  if(!feed||!await canRunPersonalAutomation(feed.ownerId,feed.email))return null;
  const {from,until}=feedRange();
  const events=await pool().query<Row>(
    "SELECT id, left(data->>'title',"+MAX_TITLE+") AS title, data->>'dueOn' AS \"dueOn\", NULLIF(data->>'dueTime','') AS \"dueTime\", COALESCE(data->>'updatedAt','') AS \"updatedAt\" FROM nh_documents WHERE workspace='live' AND kind='personal-item' AND data->>'ownerId'=$1 AND id LIKE $1||':%' AND data->>'kind'='schedule' AND data->>'dueOn' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' AND data->>'dueOn'>=$2 AND data->>'dueOn'<=$3 ORDER BY data->>'dueOn', id LIMIT "+MAX_EVENTS,
    [feed.ownerId,from,until]);
  return renderCalendar(events.rows);
}
