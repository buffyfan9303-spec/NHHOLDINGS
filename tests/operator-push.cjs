'use strict';
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const vm=require('node:vm');
const {createECDH,randomBytes}=require('node:crypto');
const {generateVAPIDKeys}=require('web-push');
const {config,update,dispatch}=require('../src/server/operator-push.cjs');

async function main(){
 const owner='owner@example.test';
 const vapid=generateVAPIDKeys();
 Object.assign(process.env,{ONE_PUSH_PUBLIC_KEY:vapid.publicKey,ONE_PUSH_PRIVATE_KEY:vapid.privateKey,ONE_PUSH_SUBJECT:'mailto:'+owner,OPERATOR_EMAIL:owner});
 const rows=new Map();
 const edits=[];
 const ctx={
  audits:[],
  get(kind,id){return structuredClone(rows.get(kind+':'+id));},
  async put(kind,id,data){rows.set(kind+':'+id,structuredClone(data));},
  list(kind){return [...rows].filter(([name])=>name.startsWith(kind+':')).map(([name,data])=>({id:name.slice(kind.length+1),...structuredClone(data)}));},
  encrypt(data){edits.push(data);return String(edits.length-1);},
  decrypt(cipher){return edits[Number(cipher)];},
 };
 const ec=createECDH('prime256v1');
 const keys={p256dh:ec.generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')};
 const address='https://fcm.googleapis.com/fcm/send/fixture';
 assert(config());
 await assert.rejects(()=>update(ctx,{enabled:true,subscription:{endpoint:'https://example.org/push',keys}},owner),{status:400});
 await assert.rejects(()=>update(ctx,{enabled:true,subscription:{endpoint:'https://fake@fcm.googleapis.com/fcm/send/fixture',keys}},owner),{status:400});
 await update(ctx,{enabled:true,subscription:{endpoint:address,keys}},owner);
 await assert.rejects(()=>update(ctx,{enabled:false,subscription:{endpoint:address}},'other@example.test'),{status:409});
 await ctx.put('content','draft',{service:'tistory',channel:'instagram',status:'draft'});
 await ctx.put('content','legacy',{service:'crm',channel:'instagram',status:'draft'});
 const payloads=[];
 const send=async(subscription,payload,options)=>{
  assert.equal(subscription.endpoint,address);
  assert.equal(options.TTL,300);
  assert.equal(options.vapidDetails.publicKey,vapid.publicKey);
  payloads.push(JSON.parse(payload));
 };
 ctx.audits=[{id:1,action:'content.saved',target:'legacy'}];
 await dispatch(ctx,send);
 assert.deepEqual(payloads,[]);
 ctx.audits.unshift({id:2,action:'content.generated',target:'legacy,draft'});
 await dispatch(ctx,send);
 await dispatch(ctx,send);
 assert.deepEqual(payloads,[{type:'instagram-activity'}]);
 await update(ctx,{enabled:false,subscription:{endpoint:address}},owner);
 ctx.audits.unshift({id:3,action:'content.saved',target:'draft'});
 await dispatch(ctx,send);
 assert.equal(payloads.length,1);
 await update(ctx,{enabled:true,subscription:{endpoint:address,keys}},owner);
 ctx.audits.unshift({id:4,action:'content.saved',target:'draft'});
 await dispatch(ctx,async()=>{throw Object.assign(Error('expired fixture'),{statusCode:410});});
 assert.equal(ctx.list('push-device')[0].active,false);

 const events=new Map();
 const notices=[];
 const destinations=[];
 const runtimes={
  URL,
  self:{
   location:{origin:'https://nuri.example.test'},
   addEventListener:(type,listener)=>events.set(type,listener),
   registration:{showNotification:async(title,options)=>notices.push({title,...options})},
   clients:{matchAll:async()=>[],openWindow:async(url)=>destinations.push(String(url))},
  },
 };
 vm.runInNewContext(readFileSync('public/one/operator-sw.js','utf8'),runtimes);
 async function event(type,data) {
  let completion;
  events.get(type)({...data,waitUntil:value=>{completion=value;}});
  await completion;
 }
 await event('push',{data:{json:()=>({type:'unexpected',url:'https://unrelated.example.test'})}});
 assert.equal(notices.length,0);
 await event('push',{data:{json:()=>({type:'instagram-activity',title:'원고 제목'})}});
 assert.equal(notices.length,1);
 assert(!JSON.stringify(notices).includes('원고 제목'));
 await event('notificationclick',{notification:{tag:notices[0].tag,close(){}}});
 assert.deepEqual(destinations,['https://nuri.example.test/dashboard#approval']);
 console.log('Approval activity push passed: private payload, device ownership, deduplication, expiry, and approval navigation.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
