'use strict';

const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {generateKeyPairSync}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {context}=require('../src/server/context.cjs');
const {controller}=require('../src/server/dashboard.cjs');
const desk=require('../src/server/operator-desk.cjs');

async function main(){
 const link=desk.tracking({service:'holdem',channel:'youtube',path:'/guides?a=1'.replace('a=','page='),campaign:'weekly'});
 assert.equal(new URL(link.url).searchParams.get('utm_content'),link.id);
 assert.equal(new URL(link.url).host,'nuriholdem.com');
 for(const path of ['//elsewhere.invalid/','/\\elsewhere.invalid/','/checkout?token=opaque'])assert.throws(()=>desk.tracking({service:'market',channel:'instagram',path,campaign:'reel'}),{status:400});
 let requests=0;
 const probe=await desk.probeWebsite('mind',async url=>{
  requests++;
  assert.equal(new URL(url).hostname,'www.nurimind.co.kr');
  return new Response(null,{status:302,headers:{location:'https://outside.invalid/'}});
 });
 assert.equal(requests,1);
 assert.equal(probe.state,'http');
 const hit={state:'up',checkedAt:'2026-11-19T00:00:00.000Z'};
 const down={state:'timeout',checkedAt:'2026-11-19T00:05:00.000Z'};
 const initial=desk.recordSiteProbe(null,hit,true);
 const lost=desk.recordSiteProbe(initial,down,false);
 const restored=desk.recordSiteProbe(lost,{...hit,checkedAt:'2026-11-19T00:10:00.000Z'},false);
 assert.equal(lost.probe.lastSuccessAt,initial.probe.checkedAt);
 assert.equal(restored.incidents[0].endedAt,'2026-11-19T00:10:00.000Z');
 assert.equal(restored.incidents[1].kind,'data');

 const db=new PGlite(),fetchOriginal=globalThis.fetch;
 try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
  await db.exec(readFileSync('db/dashboard.sql','utf8'));
  process.env.DATABASE_URL='postgres://test.invalid/operator-desk';
  process.env.SESSION_SECRET='synthetic-operator-desk-encryption-key';
  globalThis.nhPool={
   async query(sql,args){const result=await db.query(sql,args);return {...result,rowCount:result.rows.length||result.affectedRows};},
   async connect(){return {...this,release(){}};},
  };
  const ctx=await context('live');
  const base={service:'tistory',channel:'instagram'};
  await ctx.put('channel','a',{...base,label:'첫 채널',verifiedAt:new Date().toISOString(),userId:'101',secret:ctx.encrypt({token:'synthetic',version:'v25.0',authType:'manual'})});
  await ctx.put('channel','b',{...base,label:'둘째 채널',verifiedAt:new Date().toISOString(),userId:'102',secret:ctx.encrypt({token:'synthetic',version:'v25.0',authType:'manual'})});
  const put=(id,fields)=>ctx.put('content',id,{...base,title:'원본',body:'원본 내용',media:'https://images.example.test/photo.jpg',version:1,...fields});
  await put('first',{status:'draft'});
  await put('second',{status:'scheduled',account:'b',scheduledAt:new Date(Date.now()+3600000).toISOString()});
  await put('running',{status:'publishing',account:'a'});
  await put('published',{status:'published',account:'a',externalId:'123456',publishedChannelId:'101',link:'https://www.instagram.com/p/fixture123/'});
  const at=new Date(Date.now()+3600000).toISOString();
  const marketKey='market-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const options={inquiries:async(_page,id)=>({rows:id&&id!==marketKey.slice(7)?[]:[{id:marketKey,kind:'market',body:'합성 문의',createdAt:at}],total:1,page:1,pageSize:20})};
  const call=async(route,body,status=200)=>{
   const app=await controller(options),method=body===undefined?'GET':'POST';
   const res=await app.handle({url:'http://fixture.invalid'+route,method},route.split('?')[0],body||{},'operator@example.test');
   const result=await res.json();
   assert.equal(res.status,status,route+' '+JSON.stringify(result).slice(0,160));
   return result;
  };
  const approval={id:'first',account:'a',at,approved:true,version:1};
  assert.deepEqual((await call('/api/content/readiness',{...approval,at:''})).issues.map(issue=>issue.field),['at']);
  assert.equal((await call('/api/content/readiness',approval)).ready,true);
  let state=await call('/api/content/schedule',approval);
  assert.equal(state.desk.approved[0].title,'원본');
  const timeline=(await call('/api/content/timeline',{id:'first'})).events;
  assert.equal(timeline.find(event=>event.type==='approved').actor,'operator@example.test');
  assert.equal(timeline.find(event=>event.type==='scheduled').scheduledAt,at);
  state=await call('/api/desk/hold',{id:'a',active:true,version:1,reason:'권한 확인'});
  assert.equal(state.contents.find(p=>p.id==='first').status,'paused');
  assert.equal(state.contents.find(p=>p.id==='second').status,'scheduled');
  assert.equal(state.contents.find(p=>p.id==='running').status,'publishing');
  assert.deepEqual(state.desk.holds[0].inFlight,['running']);
  await call('/api/desk/hold',{id:'a',active:false,version:1},409);
  await call('/api/content/schedule',{id:'first',account:'a',at,approved:true,version:3},409);
  state=await call('/api/desk/hold',{id:'a',active:false,version:2});
  assert.equal(state.contents.find(p=>p.id==='first').status,'paused');
  state=await call('/api/desk/brand',{id:'mind',instagram:'a',youtube:'',tone:'차분한 말투',footer:'공통 문구',thumbnail:'가독성 유지',version:1});
  assert.equal(state.desk.brands[0].instagram,'a');
  await call('/api/desk/brand',{id:'mind',instagram:'a',version:1},409);
  const utm=await call('/api/desk/link',{service:'mind',channel:'instagram',path:'/',campaign:'mood',contentId:'published'});
  assert.equal((await call('/api/desk/link',{service:'mind',channel:'instagram',path:'/',campaign:'mood',contentId:'published'})).id,utm.id);
  assert.notEqual((await call('/api/desk/link',{service:'mind',channel:'instagram',path:'/',campaign:'mood',contentId:'first'})).id,utm.id);
  await call('/api/desk/link',{service:'mind',channel:'youtube',path:'/',campaign:'mood',contentId:'published'},400);

  await ctx.reload();
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  await ctx.put('google','config',{secret:ctx.encrypt({client_email:'reports@example.test',private_key:privateKey.export({type:'pkcs8',format:'pem'})})});
  globalThis.fetch=async(url,init)=>{
   const target=new URL(url);
   if(target.hostname==='oauth2.googleapis.com')return Response.json({access_token:'isolated-test'});
   if(target.hostname==='analyticsdata.googleapis.com'){
    const filter=JSON.parse(init.body).dimensionFilter.andGroup.expressions;
    assert.equal(filter[1].filter.stringFilter.value,utm.id);
    return Response.json({rows:[{metricValues:[{value:'0'}]}],metadata:{timeZone:'Asia/Seoul'}});
   }
   assert.equal(target.pathname,'/v25.0/123456/comments');
   assert.equal(init.method,undefined,'comments are only read');
   return Response.json({data:[{id:'private-comment-id',text:'합성 댓글',timestamp:new Date().toISOString()}]});
  };
  assert.equal((await call('/api/desk/traffic',{id:utm.id,property:'12345'})).sessions,0);
  assert.equal((await call('/api/desk/comments',{id:'published'})).received,1);
  const inbox=await call('/api/desk/inbox');
  assert.equal(inbox.items.length,2);
  assert(!JSON.stringify(inbox).includes('private-comment-id'));
  const commentId=inbox.items.find(row=>row.kind==='instagram').id;
  assert.equal((await call('/api/desk/inbox?commentFilter=new')).commentTotal,1);
  await call('/api/desk/comment-seen',{id:commentId});
  assert.equal((await call('/api/desk/inbox?commentFilter=new')).commentTotal,0);
  assert.equal((await call('/api/desk/inbox?commentFilter=open')).commentTotal,1);
  await call('/api/desk/inbox',{id:marketKey,status:'working',assignee:'검증 담당',draft:'합성 답변 초안',version:1});
  assert.equal((await call('/api/desk/inbox')).items.find(x=>x.id===marketKey).work.status,'working');
  console.log('Operator desk passed: pause/reapproval, snapshot, presets, safe links, GA4 zero, comments and inquiry work, website incidents.');
 }finally{
  globalThis.fetch=fetchOriginal;
  await db.close();
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
