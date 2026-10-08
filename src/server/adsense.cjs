'use strict';
const crypto=require('node:crypto');
const scope='https://www.googleapis.com/auth/adsense.readonly',domain='doto1.tistory.com';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex'),now=()=>new Date().toISOString();
const failure=(message='AdSense 조회를 완료하지 못했습니다. 앱·동의·계정 권한을 확인하고 다시 시도하세요.',status=502)=>Object.assign(new Error(message),{status});
function text(v,max=5000){if(typeof v!=='string'||!v.trim()||v.length>max||/[\r\n\0]/.test(v))throw failure();return v.trim();}
function accountName(v){if(typeof v!=='string'||!/^accounts\/pub-\d{1,30}$/.test(v))throw failure();return v;}
function version(v,old){if(!Number.isSafeInteger(v)||v<1||v!==(old?.version??1))throw failure('다른 작업에서 변경했습니다. 새로고침 후 다시 저장해주세요.',409);}
async function json(url,options={},request=fetch){
 // Only fixed Google endpoints are reachable; provider bodies and token-bearing URLs never become errors.
 const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.port||!['oauth2.googleapis.com','adsense.googleapis.com'].includes(u.hostname))throw failure();
 try{const r=await request(u.href,{...options,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw failure();const v=await r.json();if(!v||typeof v!=='object'||Array.isArray(v)||v.error)throw failure();return v;}catch{throw failure();}
}
function authorization(c,{state,verifier,redirectUri}){
 const redirect=new URL(redirectUri);if(redirect.username||redirect.password||redirect.hash||redirect.search||redirect.pathname!=='/api/adsense'||!(redirect.protocol==='https:'||redirect.protocol==='http:'&&['127.0.0.1','localhost'].includes(redirect.hostname)))throw failure();
 if(!/^[A-Za-z0-9_-]{43}$/.test(state)||!/^[A-Za-z0-9_-]{43}$/.test(verifier))throw failure();
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:text(c.clientId,500),redirect_uri:redirect.href,response_type:'code',scope,state,access_type:'offline',prompt:'consent select_account',include_granted_scopes:'false',code_challenge:hashBuffer(verifier),code_challenge_method:'S256'}).toString();return u.href;
}
const hashBuffer=v=>crypto.createHash('sha256').update(v).digest('base64url');
async function token(c,values,request=fetch){
 const v=await json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:text(c.clientId,500),client_secret:text(c.clientSecret),...values})},request);
 if(v.token_type!=='Bearer'||!Number.isSafeInteger(v.expires_in)||v.expires_in<1||v.expires_in>86400||v.scope!==undefined&&v.scope!==scope||values.grant_type==='authorization_code'&&v.scope!==scope)throw failure();
 return {token:text(v.access_token),refreshToken:text(v.refresh_token??c.refreshToken),expiresAt:new Date(Date.now()+v.expires_in*1000).toISOString()};
}
async function exchange(c,{code,verifier,redirectUri},request=fetch){
 authorization(c,{state:verifier,verifier,redirectUri});
 return token(c,{grant_type:'authorization_code',code:text(code,2000),code_verifier:verifier,redirect_uri:redirectUri},request);
}
async function accounts(c,request=fetch){
 let pageToken='',result=[];
 for(let page=0;page<10;page++){
  const u=new URL('https://adsense.googleapis.com/v2/accounts');u.search=new URLSearchParams({pageSize:'100',...(pageToken?{pageToken}:{})}).toString();const v=await json(u.href,{headers:{Authorization:'Bearer '+text(c.token)}},request);
  if(v.accounts!==undefined&&!Array.isArray(v.accounts))throw failure();
  for(const a of v.accounts||[]){const timeZone=text(a.timeZone?.id,100);try{new Intl.DateTimeFormat('en',{timeZone}).format();}catch{throw failure();}result.push({name:accountName(a.name),displayName:text(a.displayName||a.name,200),timeZone});}
  if(!v.nextPageToken)return result;pageToken=text(v.nextPageToken,2000);
 }throw failure('AdSense 계정 목록이 너무 큽니다. 조회 범위를 확인해주세요.');
}
function connection(ctx){const a=ctx.get('adsense-app','config'),c=ctx.get('adsense-connection','google');if(!a?.secret||!c?.secret||c.appHash!==hash(a.secret))throw failure('AdSense Google 계정을 먼저 연결하세요.',400);return {app:a,connection:c};}
function view(ctx){
 const a=ctx.get('adsense-app','config'),c=ctx.get('adsense-connection','google'),configured=!!a?.secret,connected=configured&&!!c?.secret&&c.appHash===hash(a.secret),config=configured?ctx.decrypt(a.secret):{};
 return {configured,clientId:config.clientId||'',appVersion:a?.version??1,connected,version:c?.version??1,accounts:connected?c.accounts:[],selectedAccount:connected?c.selectedAccount:null,connectedAt:connected?c.connectedAt:null,redirectUri:(process.env.MARKET_ORIGIN||'http://127.0.0.1:3110')+'/api/adsense',reports:ctx.list('adsense-report'),payments:ctx.list('adsense-payments')};
}
async function configure(ctx,v,email){await ctx.transaction(async()=>{await ctx.lock('adsense');await ctx.reload();const old=ctx.get('adsense-app','config');version(v.version,old);const prior=old?.secret?ctx.decrypt(old.secret):{},c={clientId:text(v.clientId,500),clientSecret:v.clientSecret?text(v.clientSecret):prior.clientSecret};if(!c.clientId.endsWith('.apps.googleusercontent.com')||!c.clientSecret||prior.clientId&&c.clientId!==prior.clientId&&!v.clientSecret)throw failure('Google 웹 앱 Client ID와 Client Secret을 확인하세요.',400);const secret=old&&c.clientId===prior.clientId&&c.clientSecret===prior.clientSecret?old.secret:ctx.encrypt(c);await ctx.put('adsense-app','config',{secret,version:(old?.version??1)+1,updatedAt:now()});await ctx.audit(email,'adsense.app_configured','google');});}
async function select(ctx,v,email){await ctx.transaction(async()=>{await ctx.lock('adsense');await ctx.reload();const {connection:c}=connection(ctx);version(v.version,c);const a=c.accounts.find(a=>a.name===v.account);if(!a)throw failure('연결된 AdSense 계정을 직접 선택하세요.',400);await ctx.put('adsense-connection','google',{...c,selectedAccount:a.name,version:c.version+1});await ctx.audit(email,'adsense.account_selected',a.name);});}
function isoDate(v){const s=v&&[v.year,String(v.month).padStart(2,'0'),String(v.day).padStart(2,'0')].join('-'),d=new Date(s);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(+d)||d.toISOString().slice(0,10)!==s)throw failure();return s;}
function range(month,timeZone){if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw failure('조회 월을 확인하세요.',400);const startDate=month+'-01',today=new Intl.DateTimeFormat('sv-SE',{timeZone}).format(new Date()),last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),endDate=last<today?last:today;if(startDate>endDate)throw failure('미래 월은 조회할 수 없습니다.',400);return {startDate,endDate};}
function parseReport(v,requested){
 if(v.warnings?.length)throw failure('AdSense 보고서에 경고가 있어 완전한 집계를 확인하지 못했습니다.');
 if(!Array.isArray(v.rows)||!v.rows.length)throw failure('이 기간·도메인의 집계 데이터가 없습니다. 0으로 간주하지 않습니다.');
 if(v.rows.length!==1||String(v.totalMatchedRows)!=='1'||!Array.isArray(v.headers))throw failure();
 const startDate=isoDate(v.startDate),endDate=isoDate(v.endDate);if(startDate<requested.startDate||endDate>requested.endDate||startDate>endDate)throw failure();
 const cells=v.rows[0].cells;if(!Array.isArray(cells)||cells.length!==v.headers.length)throw failure();
 const values=Object.fromEntries(v.headers.map((h,i)=>[h.name,{...h,value:cells[i]?.value}]));if(values.DOMAIN_CODE?.value!==domain)throw failure();
 const output={};for(const [key,metric] of Object.entries({estimatedEarnings:'ESTIMATED_EARNINGS',pageViews:'PAGE_VIEWS',impressions:'IMPRESSIONS',clicks:'CLICKS'})){
  const h=values[metric],raw=h?.value;if(typeof raw!=='string'||!/^(-?\d+)(\.\d+)?$/.test(raw))throw failure();const n=Number(raw);if(!Number.isFinite(n)||Math.abs(n)>1e12||key!=='estimatedEarnings'&&(!Number.isSafeInteger(n)||n<0))throw failure();output[key]=n;
 }
 const currencyCode=values.ESTIMATED_EARNINGS.currencyCode;if(!/^[A-Z]{3}$/.test(currencyCode)||values.ESTIMATED_EARNINGS.type!=='METRIC_CURRENCY')throw failure();
 return {metrics:{...output,pageRPM:output.pageViews>0?output.estimatedEarnings/output.pageViews*1000:null},currencyCode,startDate,endDate};
}
function parsePayments(v,account){
 if(v.payments!==undefined&&!Array.isArray(v.payments))throw failure();
 return (v.payments||[]).map(p=>{if(typeof p.name!=='string'||!p.name.startsWith(account+'/payments/'))throw failure();const id=p.name.slice((account+'/payments/').length);if(!/^(?:youtube-)?(?:unpaid|\d{4}-\d{2}-\d{2})$/.test(id))throw failure();return {name:p.name,type:id.includes('unpaid')?'unpaid':'paid',youtube:id.startsWith('youtube-'),date:id.includes('unpaid')?null:isoDate(p.date),amount:text(p.amount,200)};});
}
async function report(ctx,month,email,request=fetch){
 // ponytail: one operator's read-only report holds one integration lock; split token/report locks only if concurrent reporting matters.
 await ctx.transaction(async()=>{await ctx.lock('adsense');await ctx.reload();const {app,connection:c}=connection(ctx),a=c.accounts.find(a=>a.name===c.selectedAccount);if(!a)throw failure('AdSense 계정을 선택하세요.',400);const dates=range(month,a.timeZone),id=a.name+':'+month,checkedAt=now();let config=ctx.decrypt(c.secret),auth;
  try{if(!Number.isFinite(Date.parse(config.expiresAt)))throw failure();if(Date.parse(config.expiresAt)-Date.now()<60000){config=await token({...ctx.decrypt(app.secret),...config},{grant_type:'refresh_token',refresh_token:text(config.refreshToken)},request);await ctx.put('adsense-connection','google',{...c,secret:ctx.encrypt(config)});}auth={headers:{Authorization:'Bearer '+text(config.token)}};}catch{const old=ctx.get('adsense-report',id)||{account:a.name,month,domain,...dates,metrics:null,currencyCode:null,timeZone:a.timeZone};await ctx.put('adsense-report',id,{...old,checkedAt,stale:true,error:'AdSense 인증을 갱신하지 못했습니다. 계정을 다시 연결하세요.'});const payments=ctx.get('adsense-payments',a.name)||{account:a.name,items:null};await ctx.put('adsense-payments',a.name,{...payments,checkedAt,stale:true,error:'AdSense 인증을 갱신하지 못했습니다.'});return;}
  const u=new URL('https://adsense.googleapis.com/v2/'+accountName(a.name)+'/reports:generate');u.searchParams.set('dateRange','CUSTOM');for(const [key,value] of Object.entries(dates)){const [year,m,d]=value.split('-');for(const [part,n] of [['year',year],['month',m],['day',d]])u.searchParams.set(key+'.'+part,String(Number(n)));}u.searchParams.set('dimensions','DOMAIN_CODE');for(const metric of ['ESTIMATED_EARNINGS','PAGE_VIEWS','IMPRESSIONS','CLICKS'])u.searchParams.append('metrics',metric);u.searchParams.set('filters','DOMAIN_CODE=='+domain);u.searchParams.set('currencyCode','KRW');u.searchParams.set('reportingTimeZone','ACCOUNT_TIME_ZONE');u.searchParams.set('limit','10');
  const [result,payments]=await Promise.allSettled([json(u.href,auth,request).then(v=>parseReport(v,dates)),json('https://adsense.googleapis.com/v2/'+accountName(a.name)+'/payments',auth,request).then(v=>parsePayments(v,a.name))]);
  const old=ctx.get('adsense-report',id)||{account:a.name,month,domain,...dates,metrics:null,currencyCode:null,timeZone:a.timeZone};await ctx.put('adsense-report',id,result.status==='fulfilled'?{...old,...result.value,timeZone:a.timeZone,observedAt:now(),checkedAt,stale:false,error:null}:{...old,checkedAt,stale:true,error:result.reason?.status?result.reason.message:'AdSense 보고서를 확인하지 못했습니다.'});
  const prior=ctx.get('adsense-payments',a.name)||{account:a.name,items:null};await ctx.put('adsense-payments',a.name,payments.status==='fulfilled'?{account:a.name,items:payments.value,observedAt:now(),checkedAt,stale:false,error:null}:{...prior,checkedAt,stale:true,error:'계정 전체 지급 내역을 조회하지 못했습니다.'});await ctx.audit(email,'adsense.report',id);
 });
}
module.exports={scope,domain,hash,authorization,exchange,accounts,view,configure,select,report,parseReport,parsePayments};
