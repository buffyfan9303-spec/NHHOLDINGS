'use strict';

const {createHash}=require('node:crypto');
const {videoId}=require('./youtube.cjs');

const destinations=Object.freeze({
 mind:'https://www.nurimind.co.kr',
 holdem:'https://nuriholdem.com',
 crm:'https://www.nuricrm.co.kr',
 market:'https://nhholdings.xyz',
 tistory:'https://doto1.tistory.com',
});
const brands=new Set(['mind','holdem']);
const channels=new Set(['blog','instagram','youtube','threads','x','bluesky']);
const states=new Set(['open','working','done']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const error=(message,status=400)=>Object.assign(new Error(message),{status});

function clean(value,limit,{required=false}={}){
 if(typeof value!=='string'||value.length>limit||required&&!value.trim())throw error('입력한 내용을 확인해주세요.');
 return value.trim();
}

function approvedSnapshot(post,account,at){
 return {at,title:post.title,body:post.body,channel:post.channel,account:account.label,accountId:post.account,
  scheduledAt:post.scheduledAt,media:[post.media,...(post.slides||[]),post.videoUrl].filter(Boolean),
  videoId:post.youtubeVideoId||null,altText:post.altText||null};
}

async function probeWebsite(service,request=fetch){
 const origin=destinations[service];
 const path=service==='market'?'/nurimarket':'/';
 if(!origin)return null;
 const checkedAt=new Date().toISOString();
 try {
  const signal=AbortSignal.timeout(5500);
  const result=await request(origin+path,{method:'GET',redirect:'manual',signal});
  await result.body?.cancel().catch(()=>{});
  let state=result.ok?'up':'http';
  if([301,302,303,307,308].includes(result.status)){
   const target=new URL(result.headers.get('location'),origin);
   const source=new URL(origin);
   const same=target.hostname.replace(/^www\./,'')===source.hostname.replace(/^www\./,'');
   if(target.protocol==='https:'&&same&&!target.username&&!target.password&&!target.port){
    const followed=await request(target.href,{method:'GET',redirect:'manual',signal});
    await followed.body?.cancel().catch(()=>{});
    state=followed.ok?'up':'http';
    return {state,status:followed.status,checkedAt,respondedAt:checkedAt};
   }
  }
  return {state,status:result.status,checkedAt,respondedAt:checkedAt};
 }catch(e){return {state:e.name==='TimeoutError'||e.name==='AbortError'?'timeout':'network',status:null,checkedAt};}
}

function recordSiteProbe(previous,probe,dataHealthy){
 if(!probe)return previous||{};
 const severity=probe.state!=='up'?'website':dataHealthy?'clear':'data';
 const before=previous?.incidents||[];
 const latest=before.at(-1);
 const incidents=[...before];
 if(latest&&!latest.endedAt&&latest.kind!==severity)incidents[incidents.length-1]={...latest,endedAt:probe.checkedAt};
 if(severity!=='clear'&&(!latest||latest.endedAt||latest.kind!==severity))incidents.push({kind:severity,at:probe.checkedAt});
 return {probe:{...probe,lastSuccessAt:probe.state==='up'?probe.checkedAt:previous?.probe?.lastSuccessAt||null},incidents:incidents.slice(-20)};
}

function tracking(input){
 const origin=destinations[input.service];
 if(!origin||!channels.has(input.channel))throw error('서비스와 SNS 채널을 선택하세요.');
 const path=clean(input.path,1200,{required:true});
 if(!path.startsWith('/')||path.startsWith('//')||/[\\\u0000-\u001f]/.test(path))throw error('선택한 사이트의 경로를 입력하세요.');
 const url=new URL(path,origin);
 if(url.origin!==origin||url.username||url.password||url.hash||[...url.searchParams.keys()].some(k=>!/^(utm_[a-z_]+|category|page|q)$/.test(k)))throw error('허용된 공개 경로와 검색어만 입력하세요.');
 if(input.service==='market'&&!/^\/(?:nurimarket(?:\/|$)|product\/|search(?:\/|$)|$)/.test(url.pathname))throw error('공개 쇼핑몰 경로를 입력하세요.');
 const campaign=clean(input.campaign,70,{required:true});
 if(!/^[a-z0-9][a-z0-9_-]*$/.test(campaign))throw error('캠페인은 영문 소문자·숫자·하이픈으로 입력하세요.');
 for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_'))url.searchParams.delete(key);
 const contentId=input.contentId||'';
 if(typeof contentId!=='string'||contentId&&!/^[A-Za-z0-9_-]{1,80}$/.test(contentId))throw error('연결할 게시물을 확인하세요.');
 const id=sha(JSON.stringify([input.service,input.channel,campaign,url.href,contentId])).slice(0,24);
 for(const [key,value] of Object.entries({utm_source:input.channel,utm_medium:'social',utm_campaign:campaign,utm_content:id}))url.searchParams.set(key,value);
 return {id,service:input.service,channel:input.channel,campaign,contentId,host:url.hostname.replace(/^www\./,''),url:url.href};
}

async function socialComments(post,config,request=fetch){
 let url;
 if(post.channel==='youtube'&&videoId(post.externalId)===post.externalId){
  url='https://www.googleapis.com/youtube/v3/commentThreads?'+new URLSearchParams({part:'snippet',videoId:post.externalId,maxResults:'25',order:'time',textFormat:'plainText'});
 }else if(post.channel==='instagram'&&/^\d{1,30}$/.test(post.externalId)&&/^v\d{1,3}\.0$/.test(config.version||'')){
  if(config.authType==='oauth2'&&!config.comments)throw error('Instagram 댓글 조회 권한을 선택해 다시 연결하세요.',403);
  url='https://graph.instagram.com/'+config.version+'/'+post.externalId+'/comments?fields=id,text,timestamp&limit=25';
 }else throw error('API로 게시한 Instagram 또는 YouTube 게시물을 선택하세요.');
 const resp=await request(url,{headers:{Authorization:'Bearer '+config.token},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!resp.ok)throw error('댓글을 가져오지 못했습니다. 채널 권한과 댓글 공개 상태를 확인하세요.',502);
 const body=await resp.json();
 const rows=post.channel==='youtube'?body.items:body.data;
 if(!Array.isArray(rows))throw error('댓글 목록을 확인할 수 없습니다.',502);
 return rows.slice(0,25).flatMap(row=>{
  const yt=row?.snippet?.topLevelComment;
  const id=post.channel==='youtube'?yt?.id:row?.id;
  const content=post.channel==='youtube'?yt?.snippet?.textDisplay:row?.text;
  const createdAt=post.channel==='youtube'?yt?.snippet?.publishedAt:row?.timestamp;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,180}$/.test(id)||typeof content!=='string'||!Number.isFinite(Date.parse(createdAt)))return [];
  return [{id:post.channel+'-'+sha(id).slice(0,24),kind:post.channel,body:content.slice(0,2000),createdAt}];
 });
}

module.exports={destinations,brands,channels,states,clean,approvedSnapshot,probeWebsite,recordSiteProbe,tracking,socialComments};
