'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {context}=require('../src/server/context.cjs');
const {controller}=require('../src/server/dashboard.cjs');
const trend=require('../src/server/source-trend.cjs');
const followup=require('../src/server/social-followup.cjs');

const channel='UC'+'a'.repeat(22);
const base={service:'tistory',business:'platform'};
const post=(fields)=>({...base,channel:'youtube',title:'동영상',body:'설명',version:1,...fields});
const hour=3600000;

async function main(){
 const beforeFetch=globalThis.fetch, beforeNow=Date.now;
 const clock=beforeNow();
 const iso=ms=>new Date(ms).toISOString();
 let points=trend.update([], {observedAt:'2026-11-11T15:00:00Z',users:12});
 points=trend.update(points,{observedAt:'2026-11-18T14:59:59Z',users:10});
 points=trend.update(points,{observedAt:'2026-11-18T15:00:00Z',users:9});
 points=trend.update(points,{observedAt:'2026-11-18T15:32:00Z',users:0});
 points=trend.update(points,{observedAt:'2026-11-18T15:15:00Z',users:1});
 const summary=trend.summarize(points,Date.parse('2026-11-18T16:00:00Z'));
 assert.equal(summary.points.length,30);
 assert.equal(summary.points.at(-1).day,'2026-11-19');
 assert.equal(summary.points.at(-1).users,0);
 assert.equal(summary.change,-12);
 assert.equal(summary.points.at(-3).users,null);
 assert.equal(trend.update(points,{observedAt:'2026-11-18T16:01:00Z',users:null}),points);
 assert.equal(followup.issue({...post({status:'scheduled',scheduledAt:iso(clock-9*60000)})},null,clock),'delay');
 assert.equal(followup.issue(post({status:'review',uncertain:true}),null,clock),'result');

 const db=new PGlite();
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE nh_web;');
 await db.exec(readFileSync('db/dashboard.sql','utf8'));
 const pool={async query(sql,args){const r=await db.query(sql,args);return {...r,rowCount:r.rows.length||r.affectedRows};},async connect(){return {...this,release(){}};}};
 globalThis.nhPool=pool;
 process.env.DATABASE_URL='postgres://test.invalid/followup';
 process.env.SESSION_SECRET='isolated-followup-test-key-no-production-access';
 Date.now=()=>clock;
 try {
  const ctx=await context('live');
  const put=(kind,id,data)=>ctx.put(kind,id,data);
  await put('channel','yt',{...base,channel:'youtube',userId:channel,label:'테스트 YouTube',verifiedAt:iso(clock),
   secret:ctx.encrypt({authType:'oauth2',token:'isolated',analytics:true,expiresAt:iso(clock+60*hour)})});
  await put('channel','ig',{...base,channel:'instagram',userId:'123456',label:'테스트 Instagram',verifiedAt:iso(clock),
   secret:ctx.encrypt({authType:'oauth2',issuedAt:iso(clock),token:'isolated',analytics:true,version:'v25.0',expiresAt:iso(clock+1000*hour)})});
  await put('content','prepare',post({status:'draft',youtubeVideoId:'Prepare1234'}));
  await put('content','published-youtube',post({status:'published',externalId:'Published12',publishedAt:iso(clock-24.25*hour),account:'yt',publishedChannelId:channel,link:'https://www.youtube.com/watch?v=Published12'}));
  await put('content','published-instagram',post({channel:'instagram',status:'published',externalId:'55555',publishedAt:iso(clock-167.9*hour),account:'ig',publishedChannelId:'123456',link:'https://www.instagram.com/p/fixture123/'}));
  await put('content','delayed-post',post({status:'scheduled',scheduledAt:iso(clock-8*60000),account:'yt'}));
  let ready=false,publicRecovery=false,writes=0;
  globalThis.fetch=async (input,init)=>{
   const url=new URL(input);
   if(init?.method==='PUT') {writes++;throw Error('simulated lost response after YouTube accepted request');}
   assert.equal(init?.method??'GET','GET');
   if(url.hostname==='youtubeanalytics.googleapis.com'){
    assert.equal(url.searchParams.get('filters'),'video==Published12');
    return Response.json({columnHeaders:[{name:'day'},{name:'averageViewDuration'}],rows:[[url.searchParams.get('startDate'),75]]});
   }
   if(url.hostname==='graph.instagram.com'){
    assert.equal(url.pathname,'/v25.0/55555/insights');
    return Response.json({data:[{name:'reach',values:[{value:44}]},{name:'views',values:[{value:0}]}]});
   }
   assert.equal(url.hostname,'www.googleapis.com');
   const id=url.searchParams.get('id');
   return Response.json({items:[{id,snippet:{channelId:channel,title:'동영상',description:'설명',publishedAt:iso(clock+60001)},
    status:{privacyStatus:id==='Published12'||id==='Reconcile12'&&publicRecovery?'public':'private',
     uploadStatus:id==='Prepare1234'&&!ready?'uploaded':'processed'},statistics:{viewCount:'333'}}]});
  };
  const open=()=>controller({demo:false});
  async function call(path,v){
   const res=await (await open()).handle({method:'POST'},'/api/content/'+path,v,'operator@example.test');
   assert.equal(res.status,200,JSON.stringify(await res.json()));
  }
  await call('youtube-track',{id:'prepare',account:'yt',version:1});
  await (await open()).followup();
  const read=async()=> (await open()).view();
  let state=await read();
  let prep=state.snsFollowups.find(r=>r.id==='prepare');
  assert.equal(prep.preparation.state,'processing');
  let sample=state.snsFollowups.find(r=>r.id==='published-youtube').metrics.find(m=>m.hours===24).sample;
  assert.equal(sample.views,333);
  assert.equal(sample.averageWatchSeconds,75);
  assert.equal(state.contents.find(p=>p.id==='published-youtube').checkStatus,'visible');
  assert.equal((await context('live')).audits.filter(a=>a.action==='sns.attention.delay').length,1);
  await (await open()).followup();
  assert.equal((await context('live')).audits.filter(a=>a.action==='sns.attention.delay').length,1);

  await ctx.reload();
  await put('content','recover',post({status:'draft',youtubeVideoId:'Reconcile12',youtubeMadeForKids:false,youtubeSynthetic:false}));
  await call('schedule',{id:'recover',account:'yt',version:1,at:iso(clock+60000),approved:true});
  Date.now=()=>clock+60001;
  await (await open()).tick();
  assert.equal((await read()).contents.find(p=>p.id==='recover').status,'review');
  publicRecovery=true;
  ready=true;
  Date.now=()=>clock+16*60000;
  await (await open()).followup();
  state=await read();
  assert.equal(state.contents.find(p=>p.id==='recover').status,'published');
  assert.equal(state.snsFollowups.find(r=>r.id==='prepare').preparation.state,'ready');
  assert.equal(writes,1);
  sample=state.snsFollowups.find(r=>r.id==='published-instagram').metrics.find(m=>m.hours===168).sample;
  assert.equal(sample.views,0);
  assert.equal(sample.reach,44);
  console.log('KST snapshots, readiness, read-only reconciliation, two metrics windows and issue deduplication passed.');
 } finally{
  globalThis.fetch=beforeFetch;
  Date.now=beforeNow;
  await db.close();
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
