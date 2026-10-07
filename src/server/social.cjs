'use strict';
const crypto=require('node:crypto');
const providers=Object.freeze({
 x:Object.freeze({name:'X',scopes:Object.freeze(['tweet.read','tweet.write','users.read','offline.access']),authorize:'https://x.com/i/oauth2/authorize',token:'https://api.x.com/2/oauth2/token',docs:'https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code'}),
 instagram:Object.freeze({name:'Instagram',scopes:Object.freeze(['instagram_business_basic','instagram_business_content_publish']),authorize:'https://www.instagram.com/oauth/authorize',token:'https://api.instagram.com/oauth/access_token',docs:'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login/'}),
 threads:Object.freeze({name:'Threads',scopes:Object.freeze(['threads_basic','threads_content_publish']),authorize:'https://threads.net/oauth/authorize',token:'https://graph.threads.net/oauth/access_token',docs:'https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions/'}),
});
const failure=()=>Object.assign(new Error('SNS 인증 응답을 확인할 수 없습니다. 계정을 다시 연결해주세요.'),{status:502});
function provider(id){if(!Object.hasOwn(providers,id))throw Object.assign(new Error('지원하는 SNS를 선택하세요.'),{status:400});return providers[id];}
function value(v){if(typeof v!=='string'||!v.trim()||v.length>10000||/[\r\n\0]/.test(v))throw failure();return v;}
function app(c){return {clientId:value(c?.clientId),clientSecret:value(c?.clientSecret),...(c?.version?{version:version(c.version)}:{})};}
function version(v='v25.0'){if(!/^v\d{1,3}\.0$/.test(v))throw failure();return v;}
function redirect(v){try{const u=new URL(value(v));if(u.username||u.password||u.hash||!(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw failure();return u.href;}catch{throw failure();}}
function authorization(id,c,{state,verifier,redirectUri}){
 const p=provider(id),a=app(c),u=new URL(p.authorize);u.search=new URLSearchParams({client_id:a.clientId,redirect_uri:redirect(redirectUri),response_type:'code',scope:p.scopes.join(id==='x'?' ':','),state:value(state)}).toString();
 if(id==='x'){if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier||''))throw failure();u.searchParams.set('code_challenge',crypto.createHash('sha256').update(verifier).digest('base64url'));u.searchParams.set('code_challenge_method','S256');}
 return u.href;
}
// Errors and redirected responses never expose provider bodies, request URLs or credentials.
async function json(url,options,request){try{const r=await request(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw failure();const v=await r.json();if(!v||typeof v!=='object'||v.error||v.errors)throw failure();return v;}catch{throw failure();}}
function issued(c,v){const token=value(v.access_token),seconds=Number(v.expires_in);if(!Number.isFinite(seconds)||seconds<=0||seconds>366*86400)throw failure();const now=Date.now();return {...c,token,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+seconds*1000).toISOString(),authType:'oauth2'};}
function form(body){return {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)};}
function xForm(c,body){const options=form({...body,client_id:c.clientId});options.headers.Authorization='Basic '+Buffer.from(encodeURIComponent(c.clientId)+':'+encodeURIComponent(c.clientSecret)).toString('base64');return options;}
function graph(id){return id==='instagram'?'https://graph.instagram.com':'https://graph.threads.net';}
async function exchange(id,c,{code,verifier,redirectUri},request=fetch){
 const p=provider(id),a=app(c),body={grant_type:'authorization_code',code:value(code),redirect_uri:redirect(redirectUri)};
 if(id==='x'){
  if(!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier||''))throw failure();
  const v=await json(p.token,xForm(a,{...body,code_verifier:verifier}),request);
  if(v.scope!==undefined&&(typeof v.scope!=='string'||!p.scopes.every(s=>v.scope.split(' ').includes(s))))throw failure();
  return {...issued(a,v),refreshToken:value(v.refresh_token)};
 }
 const short=await json(p.token,form({...body,client_id:a.clientId,client_secret:a.clientSecret}),request);
 const shortToken=value(short.access_token||short.data?.[0]?.access_token),u=new URL(graph(id)+'/access_token');
 u.search=new URLSearchParams({grant_type:id==='instagram'?'ig_exchange_token':'th_exchange_token',client_secret:a.clientSecret,access_token:shortToken}).toString();
 const v=await json(u.href,{method:'GET'},request);return issued({...a,...(id==='instagram'?{version:version(a.version)}:{})},v);
}
async function refresh(id,c,request=fetch){
 provider(id);if(c?.authType!=='oauth2'||!Number.isFinite(Date.parse(c.expiresAt)))throw failure();
 if(id==='x'){const a=app(c),v=await json(providers.x.token,xForm(a,{grant_type:'refresh_token',refresh_token:value(c.refreshToken)}),request);return {...issued({...c,...a},v),refreshToken:v.refresh_token===undefined?value(c.refreshToken):value(v.refresh_token)};}
 if(Date.parse(c.expiresAt)<=Date.now()||!Number.isFinite(Date.parse(c.issuedAt))||Date.now()-Date.parse(c.issuedAt)<86400000)throw failure();
 const u=new URL(graph(id)+'/refresh_access_token');u.search=new URLSearchParams({grant_type:id==='instagram'?'ig_refresh_token':'th_refresh_token',access_token:value(c.token)}).toString();
 return issued(c,await json(u.href,{method:'GET'},request));
}
async function identity(id,c,request=fetch){
 provider(id);const url=id==='x'?'https://api.x.com/2/users/me':id==='instagram'?'https://graph.instagram.com/'+version(c?.version)+'/me?fields=user_id,username':'https://graph.threads.net/v1.0/me?fields=id,username';
 const v=await json(url,{headers:{Authorization:'Bearer '+value(c?.token)}},request),u=v.data||v,userId=String(id==='instagram'?u.user_id||u.id||'':u.id||'');
 if(!/^\d+$/.test(userId)||typeof u.username!=='string'||!u.username.trim()||u.username.length>200)throw failure();return {userId,username:u.username};
}
async function ensureFresh(ctx,account,request=fetch){
 if(!account?.id||!account.secret)throw failure();
 let c;try{c=ctx.decrypt(account.secret);}catch{throw failure();}
 if(c.authType!=='oauth2')return account;
 provider(account.channel);
 const due=config=>{const expiry=Date.parse(config.expiresAt);if(!Number.isFinite(expiry))throw failure();return expiry-Date.now()<(account.channel==='x'?300000:7*86400000);};
 if(!due(c))return account;
 if(typeof ctx.lock!=='function'||typeof ctx.lockRow!=='function')throw Object.assign(new Error('SNS 토큰 갱신 잠금 설정이 필요합니다.'),{status:503});
 return ctx.transaction(async()=>{
  // Serialize token rotation across instances before reading the latest encrypted record.
  await ctx.lock('social:'+account.id);await ctx.lockRow('channel',account.id);await ctx.reload();
  const latest=ctx.get('channel',account.id);if(!latest||latest.channel!==account.channel||latest.service!==account.service||latest.userId!==account.userId)throw failure();
  try{c=ctx.decrypt(latest.secret);}catch{throw failure();}
  if(c.authType!=='oauth2'||!due(c))return {...latest,id:account.id};
  // Meta cannot refresh tokens less than 24h old; an unexpired new token stays usable.
  if(account.channel!=='x'&&Date.now()-Date.parse(c.issuedAt)<86400000&&Date.parse(c.expiresAt)>Date.now())return {...latest,id:account.id};
  const next=await refresh(account.channel,c,request),saved={...latest,connectionError:null,secret:ctx.encrypt(next)};
  await ctx.put('channel',account.id,saved);return {...saved,id:account.id};
 });
}
module.exports={providers,authorization,exchange,refresh,identity,ensureFresh};
