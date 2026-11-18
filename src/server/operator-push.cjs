'use strict';

const {createHash} = require('node:crypto');
const {sendNotification} = require('web-push');
const keyPattern = /^[A-Za-z0-9_-]+$/;
const acceptedHosts = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
const attentionActions=new Set(['sns.attention.connection','sns.attention.delay','sns.attention.result']);
const postId=/^[A-Za-z0-9_-]{1,80}$/;
const eventActions = new Set(['content.saved','content.generated','content.published','content.publish_review']);
const digest = value => createHash('sha256').update(value).digest('hex');

function key(value,length) {
 return typeof value === 'string' && value.length <= 100 && keyPattern.test(value) &&
  Buffer.from(value,'base64url').length === length && Buffer.from(value,'base64url').toString('base64url') === value;
}

function config() {
 const publicKey = process.env.ONE_PUSH_PUBLIC_KEY;
 const privateKey = process.env.ONE_PUSH_PRIVATE_KEY;
 const subject = process.env.ONE_PUSH_SUBJECT;
 if (!key(publicKey,65) || !key(privateKey,32) || !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(subject||'')) return null;
 return {publicKey,privateKey,subject};
}

function endpoint(value) {
 if (typeof value !== 'string' || value.length > 2200) return null;
 try {
  const url = new URL(value);
  if (url.protocol === 'https:' && acceptedHosts.has(url.hostname) && !url.username && !url.password &&
      !url.port && !url.hash && url.pathname !== '/') return url.href;
 } catch {}
 return null;
}

function invalid() {
 return Object.assign(new Error('이 브라우저의 알림 주소나 인증 정보를 확인할 수 없습니다.'),{status:400});
}

const DEFAULT_TIMING=Object.freeze({immediate:true,morning:false,quiet:false,from:'22:00',to:'08:00',morningAt:'08:00'});
const kstClock=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short',hourCycle:'h23'});
const asMinutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
function timing(value){
 if(!value||typeof value!=='object'||!['immediate','morning','quiet'].every(key=>typeof value[key]==='boolean')||
   !['from','to','morningAt'].every(key=>typeof value[key]==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key]))||value.quiet&&value.from===value.to){
  throw Object.assign(new Error('조용한 시간의 시작과 종료, 아침 시각을 확인하세요.'),{status:400});
 }
 const {immediate,morning,quiet,from,to,morningAt}=value;
 return {immediate,morning,quiet,from,to,morningAt};
}

function preferences(ctx,address,email){
 const url=endpoint(address);
 if(!url)throw invalid();
 const device=ctx.get('push-device',digest(url));
 if(device?.active&&device.email!==email)throw Object.assign(new Error('이 기기는 다른 운영 계정에 연결되어 있습니다.'),{status:409});
 return {active:!!device?.active,activity:device?.active?device.activity!==false:false,timing:device?.timing||DEFAULT_TIMING};
}

async function update(ctx,input,email) {
 if (!config()) throw Object.assign(new Error('운영 알림을 사용할 수 없습니다.'),{status:503});
 if (typeof input.enabled !== 'boolean') throw invalid();
 const address = endpoint(input.subscription?.endpoint);
 if (!address) throw invalid();
 const id = digest(address);
 const old = ctx.get('push-device',id);
 if (old?.active && old.email !== email) throw Object.assign(new Error('이 기기는 다른 운영 계정에 연결되어 있습니다.'),{status:409});
 if (!input.enabled) {
  if (old?.active) await ctx.put('push-device',id,{active:false});
  return;
 }
 const {p256dh,auth} = input.subscription.keys || {};
 if (!key(p256dh,65) || !key(auth,16)) throw invalid();
 const nextTiming=input.timing===undefined?old?.timing||DEFAULT_TIMING:timing(input.timing);
 const pending=old?.active?old.pending:null;
 await ctx.put('push-device',id,{
  active:true,email,activity:input.activity===undefined?(old?.activity??true):input.activity===true,cursor:old?.active ? old.cursor : ctx.audits[0]?.id ?? 0,
  timing:nextTiming,pending,lastDigestDay:old?.active?old.lastDigestDay:null,
  subscription:ctx.encrypt({endpoint:address,keys:{p256dh,auth}}),
 });
}

function instagramActivity(ctx,event) {
 if (!eventActions.has(event.action)) return false;
 return event.target.split(',').some(id=>{
  const post=ctx.get('content',id);
  return post?.service==='tistory' && (post.business||'platform')==='platform' && post.channel==='instagram' &&
   ['draft','review','published'].includes(post.status);
 });
}

function eventIsCurrent(ctx,event){
 const {issue}=require('./social-followup.cjs');
 const post=ctx.get('content',event.target);
 return !!post&&'sns.attention.'+issue(post,ctx.get('channel',post.account))===event.action;
}

function notificationPlan(ctx,device,events,stamp) {
 const [day,clock]=kstClock.format(stamp).split(' ');
 const prefs=device.timing||DEFAULT_TIMING;
 const quiet=prefs.quiet&&(prefs.from<prefs.to?clock>=prefs.from&&clock<prefs.to:clock>=prefs.from||clock<prefs.to);
 const previous=device.pending||{};
 const unseen=events.filter(event=>event.id>device.cursor);
 const add=unseen.filter(event=>attentionActions.has(event.action)&&postId.test(event.target))
  .map(({target,action})=>({target,action}));
 const byId=new Map([...add,...(previous.attention||[])].filter(event=>eventIsCurrent(ctx,event)).map(event=>[event.target,event]));
 const attention=Array.from(byId.values()).slice(0,30);
 const activity=device.activity!==false&&(!!previous.activity||unseen.some(event=>instagramActivity(ctx,event)));
 let message=null,remaining=attention,lastDigestDay=device.lastDigestDay||null,pendingActivity=activity;
 if(!quiet&&prefs.immediate&&attention.length){
  const event=attention[0];
  message={type:'sns-attention',id:event.target,reason:event.action.split('.').at(-1)};
  remaining=attention.slice(1);
 }else if(!quiet&&prefs.morning&&lastDigestDay!==day&&clock>=prefs.morningAt&&asMinutes(clock)<asMinutes(prefs.morningAt)+60&&(attention.length||activity)){
  message={type:'operator-digest',attention:attention.length,activity};
  lastDigestDay=day;
  remaining=[];
  pendingActivity=false;
 }else if(!quiet&&!prefs.morning&&activity){
  message={type:'instagram-activity'};
  pendingActivity=false;
 }
 if(!prefs.immediate&&!prefs.morning)remaining=[];
 return {message,lastDigestDay,pending:remaining.length||pendingActivity?{attention:remaining,activity:pendingActivity}:null};
}

async function dispatch(ctx,send=sendNotification,stamp=Date.now()) {
 const vapidDetails = config();
 if (!vapidDetails) return;
 const operators = [process.env.OPERATOR_EMAIL,process.env.SECOND_OPERATOR_EMAIL].map(email => email?.trim().toLowerCase()).filter(Boolean);
 const events = ctx.audits;
 const cursor = events[0]?.id ?? 0;
 for (const device of ctx.list('push-device')) {
  if (!device.active || cursor <= device.cursor&&!device.pending) continue;
  if (!operators.includes(device.email?.toLowerCase())) {
   await ctx.put('push-device',device.id,{active:false}).catch(()=>{});
   continue;
  }
  const {message,pending,lastDigestDay}=notificationPlan(ctx,device,events,stamp);
  if(!message&&cursor<=device.cursor&&JSON.stringify(device.pending)===JSON.stringify(pending))continue;
  // Claim before sending so an ambiguous push response cannot cause duplicate notifications.
  const {id,...old}=device;
  try {await ctx.put('push-device',id,{...old,cursor:Math.max(device.cursor,cursor),pending,lastDigestDay});} catch {continue;}
  if (!message) continue;
  try {
   const subscription = ctx.decrypt(device.subscription);
   if (!endpoint(subscription.endpoint)) continue;
   await send(subscription,JSON.stringify(message),{vapidDetails,TTL:300,timeout:5000});
  } catch (error) {
   if ([404,410].includes(error.statusCode)) await ctx.put('push-device',device.id,{active:false}).catch(()=>{});
  }
 }
}

module.exports = {config,update,dispatch,preferences,publicKey:()=>config()?.publicKey};
