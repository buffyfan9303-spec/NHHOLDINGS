'use strict';

const {createHash} = require('node:crypto');
const {sendNotification} = require('web-push');
const keyPattern = /^[A-Za-z0-9_-]+$/;
const acceptedHosts = new Set(['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com']);
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
 await ctx.put('push-device',id,{
  active:true,email,cursor:old?.active ? old.cursor : ctx.audits[0]?.id ?? 0,
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

async function dispatch(ctx,send=sendNotification) {
 const vapidDetails = config();
 if (!vapidDetails) return;
 const operators = [process.env.OPERATOR_EMAIL,process.env.SECOND_OPERATOR_EMAIL].map(email => email?.trim().toLowerCase()).filter(Boolean);
 const events = ctx.audits;
 const cursor = events[0]?.id ?? 0;
 for (const device of ctx.list('push-device')) {
  if (!device.active || cursor <= device.cursor) continue;
  if (!operators.includes(device.email?.toLowerCase())) {
   await ctx.put('push-device',device.id,{active:false}).catch(()=>{});
   continue;
  }
  const activity = events.some(event => event.id > device.cursor && instagramActivity(ctx,event));
  // Claim before sending so an ambiguous push response cannot cause duplicate notifications.
  try {await ctx.put('push-device',device.id,{...device,cursor});} catch {continue;}
  if (!activity) continue;
  try {
   const subscription = ctx.decrypt(device.subscription);
   if (!endpoint(subscription.endpoint)) continue;
   await send(subscription,JSON.stringify({type:'instagram-activity'}),{vapidDetails,TTL:300,timeout:5000});
  } catch (error) {
   if ([404,410].includes(error.statusCode)) await ctx.put('push-device',device.id,{active:false}).catch(()=>{});
  }
 }
}

module.exports = {config,update,dispatch,publicKey:()=>config()?.publicKey};
