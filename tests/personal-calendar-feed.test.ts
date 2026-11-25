import assert from 'node:assert/strict';
import test from 'node:test';
import {NextRequest} from 'next/server';

const owner='11111111-1111-4111-8111-111111111111',email='owner@example.invalid',origin='https://nuri.test.invalid';
Object.assign(process.env,{MARKET_ORIGIN:origin,OPERATOR_USER_ID:owner,OPERATOR_EMAIL:email,DATABASE_URL:'postgres://mock-only'});

import {basicPassword,feedRange,fold,renderCalendar,usable,FEED_PATH,FEED_USER,MAX_EVENTS} from '../src/lib/personal-calendar-feed';
import {GET as feedGet} from '../src/app/api/personal/calendar-subscription/feed/route';

const row=(extra:Record<string,unknown>={})=>({id:'o:1',title:'x',dueOn:'2026-12-01',dueTime:null,updatedAt:'2026-11-01T00:00:00.000Z',...extra}) as Parameters<typeof renderCalendar>[0][number];
const basic=(user:string,password:string)=>'Basic '+Buffer.from(user+':'+password).toString('base64');
const secret='A'.repeat(43);

test('feed has CRLF, folds by UTF-8 octets, all-day end, KST timed, no private fields',()=>{
  const out=renderCalendar([
    row({title:'회의 준비 한글'.repeat(12),dueOn:'2026-12-31'}),
    row({id:'o:2',title:'a\nb',dueTime:'09:30'}),
  ]);
  assert.ok(out.endsWith('END:VCALENDAR\r\n'));assert.ok(!/[^\r]\n/.test(out));
  assert.match(out,/DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.match(out,/DTSTART:20261201T003000Z\r\nDTEND:20261201T010000Z/);
  assert.ok(out.includes(String.raw`SUMMARY:a\nb`));
  assert.ok(!/DESCRIPTION|ATTENDEE|ORGANIZER/.test(out));
  for(const line of out.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75,line);
  assert.equal(fold('a'.repeat(80)).split('\r\n')[0].length,75);
});

test('payload escapes semicolon, comma, backslash and newline, and drops control characters',()=>{
  const out=renderCalendar([row({title:'a;b,c\\d\r\ne\u0000f'})]);
  assert.ok(out.includes(String.raw`SUMMARY:a\;b\,c\\d\nef`+'\r\n'));
  assert.ok(!out.includes('a;b'));
  // a title that would otherwise inject a property line stays inside SUMMARY
  const hostile=renderCalendar([row({title:'x\r\nATTENDEE:mailto:evil@example.invalid'})]);
  assert.ok(!/\r\nATTENDEE:/.test(hostile));
});

test('UID is stable for the same item id and differs between items',()=>{
  const uid=(rows:Parameters<typeof renderCalendar>[0])=>renderCalendar(rows).match(/UID:\S+/)![0];
  assert.equal(uid([row()]),uid([row({title:'changed',dueOn:'2027-01-01'})]));
  assert.notEqual(uid([row()]),uid([row({id:'o:2'})]));
});

test('invalid date, time or title is isolated and the rest of the feed still renders',()=>{
  assert.equal(usable(row({dueOn:'2026-02-31'})),false);
  assert.equal(usable(row({dueOn:'not-a-date'})),false);
  assert.equal(usable(row({dueTime:'25:99'})),false);
  assert.equal(usable(row({title:'   '})),false);
  assert.equal(usable(row({dueTime:'23:59'})),true);
  const out=renderCalendar([row({id:'bad:1',dueOn:'2026-02-31'}),row({id:'bad:2',dueTime:'7:5'}),row({id:'ok:1',title:'정상'})]);
  assert.equal(out.match(/BEGIN:VEVENT/g)?.length,1);
  assert.match(out,/SUMMARY:정상/);
});

test('range and size are bounded: -30/+365 KST days, 500 events, 200-char titles',()=>{
  const {from,until}=feedRange(Date.parse('2026-11-25T03:00:00Z'));
  assert.equal(from,'2026-10-26');assert.equal(until,'2027-11-25');
  const many=Array.from({length:MAX_EVENTS+25},(_,index)=>row({id:'o:'+index}));
  assert.equal(renderCalendar(many).match(/BEGIN:VEVENT/g)?.length,MAX_EVENTS);
  assert.ok(!renderCalendar([row({title:'가'.repeat(400)})]).replace(/\r\n /g,'').includes('가'.repeat(201)));
});

test('credentials come only from a Basic header with user nuri and a 43-character password',()=>{
  assert.equal(basicPassword(basic(FEED_USER,secret)),secret);
  assert.equal(basicPassword(basic('other',secret)),null);
  assert.equal(basicPassword(basic(FEED_USER,'short')),null);
  assert.equal(basicPassword(basic(FEED_USER,secret+'x')),null);
  assert.equal(basicPassword('Bearer '+secret),null);
  assert.equal(basicPassword(null),null);
  assert.equal(basicPassword('Basic %%%'),null);
  assert.equal(FEED_PATH,'/api/personal/calendar-subscription/feed');
});

test('feed route: 401 + WWW-Authenticate without valid header credentials; URL secrets are never accepted',async()=>{
  const queries:unknown[][]=[];
  (globalThis as {nhPool?:unknown}).nhPool={query:async(_sql:string,params:unknown[])=>{queries.push(params);return {rows:[]};}};
  for(const [path,headers] of [
    [FEED_PATH,{}],
    [FEED_PATH+'?password='+secret+'&user=nuri',{}],
    [FEED_PATH+'?token='+secret,{}],
    [FEED_PATH,{authorization:'Basic !!'}],
    [FEED_PATH,{authorization:basic('wrong',secret)}],
    [FEED_PATH,{authorization:'Bearer '+secret}],
  ] as [string,Record<string,string>][]) {
    const response=await feedGet(new NextRequest(origin+path,{headers}));
    assert.equal(response.status,401,path);
    assert.match(response.headers.get('www-authenticate')??'',/^Basic realm="NURI ONE calendar"/);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.ok(!(await response.text()).includes(secret));
  }
  assert.equal(queries.length,0,'rejected requests never reach the database');
  // right shape but unknown/rotated password: one lookup by digest, still the same generic 401
  const unknown=await feedGet(new NextRequest(origin+FEED_PATH,{headers:{authorization:basic(FEED_USER,secret)}}));
  assert.equal(unknown.status,401);
  assert.equal(queries.length,1);
  assert.ok(!JSON.stringify(queries[0]).includes(secret),'only the digest is queried');
});

test('feed route: valid header credentials return the owner calendar, no-store, no URL data',async()=>{
  const seen:string[]=[];
  (globalThis as {nhPool?:unknown}).nhPool={query:async(sql:string,params:unknown[])=>{
    seen.push(sql);
    if(sql.includes("passwordHash'=$1"))return {rows:[{ownerId:owner,email}]};
    assert.equal(params[0],owner);
    return {rows:[{id:owner+':a',title:'회의, 준비; 끝',dueOn:'2026-12-01',dueTime:'09:00',updatedAt:'2026-11-01T00:00:00Z'}]};
  }};
  const url=origin+FEED_PATH;
  assert.ok(!url.includes(secret));
  const response=await feedGet(new NextRequest(url,{headers:{authorization:basic(FEED_USER,secret)}}));
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type')??'',/^text\/calendar/);
  assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
  const body=await response.text();
  assert.ok(body.includes(String.raw`SUMMARY:회의\, 준비\; 끝`));
  assert.equal(seen.length,2);
});
