'use strict';
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {PGlite} = require('@electric-sql/pglite');
const {Pool} = require('pg');
const {context} = require('../src/server/context.cjs');
const {controller} = require('../src/server/dashboard.cjs');

async function main() {
 const originalNow = Date.now;
 const originalFetch = globalThis.fetch;
 const localPg = process.argv[2] === '--local-docker';
 const db = localPg ? new Pool({connectionString:'postgres://postgres@127.0.0.1:19461/postgres',max:1}) : new PGlite();
 if (!localPg) {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
  await db.exec(readFileSync('db/dashboard.sql','utf8'));
 }
 globalThis.nhPool = localPg ? db : {
  async query(sql, args) {
   const result = await db.query(sql, args);
   return {...result,rowCount:result.rows.length || result.affectedRows};
  },
  // PGlite runs one connection. Tests use separate controllers sequentially when simulating competing operations.
  async connect() { return {...this, release() {}}; },
 };
 process.env.DATABASE_URL = 'postgres://test.invalid/test';
 process.env.SESSION_SECRET = 'fixture-context-key-only-for-operator-tests';
 const input = {service:'tistory',business:'platform',channel:'instagram'};
 const at = new Date(Date.now()+3600000).toISOString();
 const due = Date.parse(at)+1;
 const post = (title, extra) => ({...input,title,body:title+' 설명',media:'https://images.example.com/image-1.jpg',status:'draft',version:1,...extra});
 const account = (ctx, label, userId) => ({
  ...input,label,userId,verifiedAt:new Date().toISOString(),secret:ctx.encrypt({version:'v25.0',token:'fixture-only'}),
 });
 const open = () => controller({demo:false});
 async function call(route,value,status=200,app) {
  const response = await (app || await open()).handle({method:'POST'},'/api/content/'+route,value,'operator@example.test');
  const payload = await response.json();
  assert.equal(response.status,status,route+' '+(payload.error||''));
  return payload;
 }
 try {
  const ctx = await context('live');
  const first = account(ctx,'홀덤 테스트','10001');
  const second = account(ctx,'마인드 테스트','10002');
  await ctx.put('channel','holdem-test',first);
  await ctx.put('channel','mind-test',second);
  await ctx.put('content','unapproved',post('이전 예약',{status:'scheduled',account:'holdem-test',scheduledAt:at}));
  await ctx.put('content','holdem',post('홀덤 카드뉴스',{slides:['https://images.example.com/image-2.jpg']}));
  await ctx.put('content','mind',post('마인드 카드뉴스'));
  await ctx.put('content','third',post('마인드 두 번째 카드뉴스'));
  await ctx.put('content','cancel',post('취소할 카드뉴스'));

  const schedule = (id,account='holdem-test',version=1) => ({id,account,version,approved:true,at});
  await call('schedule',{...schedule('holdem'),approved:false},400);
  await call('schedule',{...schedule('holdem'),version:undefined},400);
  await call('schedule',{...schedule('holdem'),version:2},409);
  await call('schedule',{...schedule('holdem'),at:undefined},400);
  const initial = await call('schedule',schedule('holdem'));
  const approved = initial.contents.find(p=>p.id==='holdem');
  assert.deepEqual(Object.keys(approved.approval),['at']);
  await call('publish',{id:'holdem'},409);

  await call('pause',{id:'holdem',version:1},409);
  const paused = await call('pause',{id:'holdem',version:2});
  assert.equal(paused.contents.find(p=>p.id==='holdem').status,'paused');
  await call('publish',{id:'holdem'},400);
  await call('schedule',schedule('holdem','holdem-test',3));
  await call('schedule',schedule('mind','mind-test'));
  await call('schedule',schedule('third','mind-test'));
  await call('schedule',schedule('cancel'));
  await call('cancel',{id:'cancel',version:2});
  await ctx.put('channel','mind-test',{...second,userId:'99999'});
  assert.equal((await open()).view().contents.find(p=>p.id==='mind').approval,null);
  Date.now = () => due;
  await call('publish',{id:'mind'},409);
  await call('publish',{id:'unapproved'},409);
  await ctx.put('channel','mind-test',second);

  const graph = [];
  const containers = new Map();
  let next = 2000;
  let publishAttempts = 0;
  globalThis.fetch = async (endpoint,options) => {
   const url = new URL(endpoint);
   assert.equal(url.origin,'https://graph.instagram.com');
   const [version,id,action] = url.pathname.split('/').slice(1);
   assert.equal(version,'v25.0');
   const request = Object.fromEntries(options.body || []);
   graph.push({id,action,request});
   if (action==='media') return Response.json({id:String(++next)});
   if (action==='media_publish') {
    publishAttempts++;
    return Response.json({id:String(++next)});
   }
   if (url.searchParams.get('fields')==='status_code') {
    const checks = (containers.get(id)||0)+1;
    containers.set(id,checks);
    return Response.json({status_code:checks===1?'IN_PROGRESS':'FINISHED'});
   }
   assert.equal(url.searchParams.get('fields'),'permalink');
   return Response.json({permalink:'https://www.instagram.com/p/test-post/'});
  };
  await (await open()).tick();
  assert.equal(publishAttempts,0,'nothing publishes while the container is processing');
  await (await open()).tick();
  const result = (await open()).view();
  assert.equal(publishAttempts,3);
  assert.equal(result.contents.find(p=>p.id==='unapproved').status,'scheduled');
  assert.equal(result.contents.find(p=>p.id==='cancel').status,'draft');
  for (const id of ['holdem','mind','third']) assert.equal(result.contents.find(p=>p.id===id).status,'published');
  assert.equal(graph.filter(g=>g.action==='media_publish'&&g.id==='10001').length,1);
  assert.equal(graph.filter(g=>g.action==='media_publish'&&g.id==='10002').length,2);
  const children = graph.filter(g=>g.request.is_carousel_item==='true');
  assert.deepEqual(children.map(g=>g.request.image_url),['https://images.example.com/image-1.jpg','https://images.example.com/image-2.jpg']);
  assert.match(graph.find(g=>g.request.media_type==='CAROUSEL').request.children,/^\d+,\d+$/);
  assert.equal(result.audit.filter(item=>item.action==='content.published').length,3);
  assert.equal(result.audit.filter(item=>item.action==='content.instagram_paused').length,1);
  await (await open()).tick();
  assert.equal(publishAttempts,3,'no repeat publication after a successful response');
  console.log('Instagram approval, legacy gate, exact account, pause, cancel, media polling, and three simulated publications passed.');
 } finally {
  Date.now = originalNow;
  globalThis.fetch = originalFetch;
  if(localPg)await db.end();else await db.close();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
