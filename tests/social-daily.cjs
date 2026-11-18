'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {create,preflightIssues}=require('../src/server/social-daily.cjs');

function fixture(options={}){
 const documents=new Map(),audits=[];
 let time=Date.parse('2026-11-19T08:00:00Z');
 const ctx={
  get(kind,id){return structuredClone(documents.get(kind)?.get(id)||null);},
  list(kind){return [...(documents.get(kind)||[])].map(([id,row])=>({id,...structuredClone(row)}));},
  async put(kind,id,row){if(!documents.has(kind))documents.set(kind,new Map());documents.get(kind).set(id,structuredClone(row));},
  async audit(email,action,target){audits.push({at:new Date(time).toISOString(),email,action,target});},
  async lock(){},async lockRow(){},async reload(){},async transaction(fn){return fn();},
  decrypt(value){return JSON.parse(value);},audits,
 };
 const app=create(ctx,{accountFits:(a,p)=>a?.service===p.service&&a?.channel===p.channel,publicationApproved:()=>false,
  refreshAccount:async(_ctx,account)=>account,clock:()=>time,...options});
 return {ctx,app,increase(ms){time+=ms;}};
}

const sns={service:'tistory',channel:'instagram'};
const at='2026-11-19T10:00:00.000Z';
const publishedAt='2026-11-18T10:00:00.000Z';

test('readiness carries all actionable field reasons and matches the gated content checks',async()=>{
 const {app,ctx}=fixture();
 const account={...sns,verifiedAt:at,userId:'241',label:'합성 계정'};
 await ctx.put('channel','valid',account);
 await ctx.put('channel','held',account);
 await ctx.put('channel-hold','held',{active:true});
 const draft={...sns,status:'draft',version:1,body:'가'.repeat(2201)};
 await ctx.put('content','draft',draft);
 const first=app.readiness({id:'draft',version:1,account:'held',approved:true});
 assert.deepEqual(first.issues.map(x=>[x.field,x.action,x.status]),[['media','edit',400],['body','edit',400],['at','field',400],['account','schedule',409]]);
 assert.deepEqual(preflightIssues(draft),first.issues.slice(0,2));
 await ctx.put('content','draft',{...draft,body:'게시 문구',media:'https://test.invalid/image.jpg'});
 assert.deepEqual(app.readiness({id:'draft',version:1,account:'valid',approved:true,at}),{id:'draft',ready:true,issues:[],warnings:[]});
 assert.throws(()=>app.readiness({id:'draft',version:2}),{status:409});
 const video={...sns,channel:'youtube',status:'draft',version:1,body:'나'.repeat(2000),title:'<길이 검사>'};
 assert.deepEqual(preflightIssues(video).map(x=>x.field),['youtubeVideoId','youtubeMadeForKids','youtubeSynthetic','title','body']);
});

test('timeline preserves typed actor, account, version, and response history per post',async()=>{
 const {app,ctx,increase}=fixture();
 await ctx.put('content','one',{...sns,status:'published',version:3,createdAt:publishedAt});
 await ctx.put('content','other',{...sns,status:'draft'});
 await app.log('one',{type:'edited',actor:'editor@example.test',provider:'instagram',version:2,revisionId:'rev-1'});
 await ctx.put('content-revision','rev-1',{contentId:'one',version:1,createdAt:'2026-11-19T08:00:00Z'});
 increase(120_000);
 await app.log('one',{type:'approved',actor:'owner@example.test',provider:'instagram',accountId:'account',scheduledAt:at});
 await ctx.audit('owner@example.test','content.instagram_approved','one');
 increase(120_000);
 await app.log('one',{type:'attempt',actor:'예약 실행',provider:'instagram',outcome:'sending'});
 increase(120_000);
 await app.log('one',{type:'response',actor:'예약 실행',provider:'instagram',outcome:'published',externalId:'1234',secret:'private'});
 increase(120_000);
 await app.log('one',{type:'confirmed',actor:'owner@example.test',provider:'instagram',outcome:'visible'});
 await app.log('other',{type:'edited',actor:'other@example.test'});
 const {events}=await app.timeline({id:'one'});
 assert.deepEqual(events.map(x=>x.type),['confirmed','response','attempt','approved','edited','created']);
 assert.equal(events[1].externalId,'1234');
 assert.equal(events[3].scheduledAt,at);
 assert.equal(events[3].actor,'owner@example.test');
 assert.equal(events[4].version,2);
 assert(!JSON.stringify(events).includes('private'));
 for(let i=0;i<65;i++)await app.log('one',{type:'response',actor:'예약 실행'});
 assert.equal(ctx.get('social-event','one').events.length,60);
});

test('comment sweep is bounded, date and permission scoped, deduplicates, and retains read and work on edits',async()=>{
 const fetched=[];
 let text='새 댓글';
 const {app,ctx,increase}=fixture({fetchComments:async(post)=>{
  fetched.push(post.id);
  return [{id:'instagram-id-'+post.id,kind:'instagram',body:text,createdAt:publishedAt}];
 }});
 const secret={token:'fixture',authType:'oauth2',comments:true};
 await ctx.put('channel','yes',{...sns,verifiedAt:at,secret:JSON.stringify(secret),userId:'241'});
 await ctx.put('channel','no',{...sns,verifiedAt:at,secret:JSON.stringify({...secret,comments:false}),userId:'256'});
 for(const id of ['a','b','c','d','old','denied','switched','manual','excluded']){
  await ctx.put('content',id,{...sns,title:id,status:'published',externalId:'1234',account:id==='denied'?'no':'yes',
   publishedChannelId:id==='switched'?'999':id==='denied'?'256':'241',publishedAt:id==='old'?'2026-09-01T00:00:00Z':publishedAt,
   manual:id==='manual',platformExclusion:id==='excluded'?{status:'excluded'}:null});
 }
 assert.deepEqual(await app.sweep(),{checked:3,added:3,failed:0});
 assert.deepEqual(await app.sweep(),{checked:1,added:1,failed:0});
 assert.deepEqual(await app.sweep(),{checked:0,added:0,failed:0});
 assert.deepEqual(fetched,['a','b','c','d']);
 const read=async filter=>app.inboxComments({filter});
 assert.equal((await read('new')).total,4);
 assert.equal((await app.markSeen('instagram-id-a','owner@example.test')).ok,true);
 assert.equal((await app.markSeen('instagram-id-a','owner@example.test')).ok,true);
 assert.equal(ctx.audits.filter(x=>x.action==='desk.comment_seen').length,1);
 await ctx.put('inbox-work','instagram-id-b',{status:'done',draft:'보존'});
 assert.equal((await read('new')).total,2);
 assert.equal((await read('open')).total,3);
 assert.equal((await app.readComments('a','owner@example.test')).cached,true);
 increase(65*60_000);
 text='수정된 원문';
 assert.deepEqual((await app.readComments('a','owner@example.test')).added,0);
 await app.readComments('b','owner@example.test');
 assert.equal((await read('all')).rows.find(x=>x.id==='instagram-id-a').body,text);
 assert.equal((await read('all')).rows.find(x=>x.id==='instagram-id-a').isNew,false);
 assert.equal(ctx.get('inbox-work','instagram-id-b').draft,'보존');
 assert.equal(app.commentState().filter(s=>s.mode==='automatic').length,2);
});
