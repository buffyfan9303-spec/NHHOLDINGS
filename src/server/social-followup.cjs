'use strict';

const HOUR=3600000;
const WINDOWS=Object.freeze([{hours:24,tolerance:2},{hours:168,tolerance:12}]);
const ytDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
const sns=p=>p?.service==='tistory'&&(p.business||'platform')==='platform'&&['instagram','youtube'].includes(p.channel);
const excluded=p=>p?.platformExclusion?.status==='excluded';
const digits=value=>typeof value==='string'&&/^\d{1,30}$/.test(value);
const count=value=>{
 const n=digits(value)?Number(value):value;
 return Number.isSafeInteger(n)&&n>=0?n:null;
};

function issue(post,account,now=Date.now()){
 if(!sns(post)||excluded(post))return null;
 if(post.status==='review'&&post.uncertain)return 'result';
 if(post.status==='scheduled'&&(post.attempt?.code==='connection'||account?.connectionError||Number.isFinite(Date.parse(account?.expiresAt))&&Date.parse(account.expiresAt)<=now))return 'connection';
 if(post.status==='scheduled'&&Date.parse(post.scheduledAt)<=now-5*60000)return 'delay';
 return null;
}

async function read(url,token,request){
 const res=await request(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!res.ok)return {data:null,forbidden:[401,403].includes(res.status)};
 const data=await res.json();
 return {data:data&&typeof data==='object'&&!data.error?data:null,forbidden:false};
}

async function metrics(post,account,config,request=fetch,now=Date.now()){
 if(post.channel==='instagram'){
  if(!config.analytics)return {views:null,reach:null,reason:'permission'};
  if(!digits(post.externalId)||!/^v\d{1,3}\.0$/.test(config.version||''))return null;
  const url='https://graph.instagram.com/'+config.version+'/'+post.externalId+'/insights?metric=reach,views';
  const {data,forbidden}=await read(url,config.token,request);
  const find=name=>count(data?.data?.find?.(metric=>metric.name===name)?.values?.[0]?.value);
  return {views:find('views'),reach:find('reach'),reason:forbidden?'permission':null};
 }
 const {readVideo}=require('./youtube.cjs');
 const video=await readVideo(post.externalId,config.token,request,{statistics:true});
 if(video?.snippet?.channelId!==account.userId||video.status?.privacyStatus!=='public')return null;
 const sample={views:count(video.statistics?.viewCount),reason:null};
 if(!config.analytics)return {...sample,reason:'permission'};
 const startDate=ytDate.format(new Date(post.publishedAt));
 const endDate=ytDate.format(now);
 const params=new URLSearchParams({ids:'channel==MINE',startDate,endDate,dimensions:'day',filters:'video=='+post.externalId,metrics:'averageViewDuration',sort:'-day',maxResults:'1'});
 const report=await read('https://youtubeanalytics.googleapis.com/v2/reports?'+params,config.token,request).catch(()=>({data:null,forbidden:false}));
 const fields=report.data?.columnHeaders?.map?.(h=>h.name);
 const values=report.data?.rows?.[0];
 const day=fields&&values?.[fields.indexOf('day')], seconds=fields?count(values?.[fields.indexOf('averageViewDuration')]):null;
 if(typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&day>=startDate&&day<=endDate&&seconds!=null){
  return {...sample,watchDay:day,averageWatchSeconds:seconds};
 }
 return {...sample,reason:report.forbidden?'permission':'watch-pending'};
}

function windows(post,records,now=Date.now()){
 const published=Date.parse(post.publishedAt);
 if(!Number.isFinite(published))return [];
 return WINDOWS.map(({hours,tolerance})=>{
  const due=published+hours*HOUR;
  const previous=records?.samples?.[hours];
  return {hours,due,until:due+tolerance*HOUR,previous,
   state:previous?.observedAt?'observed':now<due?'upcoming':now>due+tolerance*HOUR?'missed':'due'};
 });
}

module.exports={issue,metrics,windows,sns,excluded};
