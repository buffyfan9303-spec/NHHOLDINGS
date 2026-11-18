'use strict';

const {randomUUID}=require('node:crypto');
const {ensureFresh}=require('./social.cjs');
const {socialComments}=require('./operator-desk.cjs');
const {sns,excluded}=require('./social-followup.cjs');
const youtube=require('./youtube.cjs');

const minute=60_000;
const activeAge=30*24*60*minute;
const batchSize=3;
const localStatuses=['draft','review','approved','scheduled','paused'];
const conflictingStatuses=['scheduled','paused','publishing','published','review'];
const eventTypes=new Set(['created','edited','restored','approved','scheduled','paused','cancelled','attempt','response','confirmed','excluded']);
const auditTypes={
 'content.saved':'edited','content.restored':'restored','content.instagram_approved':'approved','content.youtube_approved':'approved',
 'content.scheduled':'scheduled','content.instagram_paused':'paused','content.youtube_paused':'paused','content.cancelled':'cancelled',
 'content.published':'response','content.sample_published':'response','content.preflight_review':'response','content.publish_review':'response',
 'content.youtube_reconciled':'confirmed','content.checked':'confirmed','content.manual_registered':'response','content.url_registration_checked':'confirmed',
 'content.platform_excluded':'excluded','content.platform_restored':'restored',
};

function fail(message,status=400){throw Object.assign(new Error(message),{status});}
const issue=(field,reason,action,status=400)=>({field,reason,action,status});
const publishTime=value=>Number.isFinite(Date.parse(value))?value:null;
const string=(v,max=160)=>typeof v==='string'&&v.length<=max?v:null;
const idOf=(v,label='게시물')=>string(v,80)?.trim()||fail(label+'을 선택하세요.');

function preflightIssues(post){
 const issues=[];
 const field=(name,reason)=>issues.push(issue(name,reason,'edit'));
 const title=post.title||'',body=post.body||'';
 if(post.channel==='instagram'){
  if(!post.media&&!post.videoUrl)field('media','Instagram 공개 이미지 또는 릴스 영상의 HTTPS 주소를 입력하세요.');
  const mediaConflict='릴스와 사진을 구분하고 대체 텍스트는 단일 이미지에만 사용하세요.';
  if(post.videoUrl&&(post.media||post.slides?.length||post.altText))field('videoUrl',mediaConflict);
  if(post.altText&&post.slides?.length&&!post.videoUrl)field('altText',mediaConflict);
  if(Array.from(body).length>2200)field('body','인스타그램 캡션을 2200자 이하로 줄이세요.');
 }
 if(post.channel==='youtube'){
  if(!post.youtubeVideoId||youtube.videoId(post.youtubeVideoId)!==post.youtubeVideoId)field('youtubeVideoId','비공개로 올린 YouTube 영상 주소를 입력하세요.');
  if(typeof post.youtubeMadeForKids!=='boolean')field('youtubeMadeForKids','아동용 콘텐츠 여부를 선택하세요.');
  if(typeof post.youtubeSynthetic!=='boolean')field('youtubeSynthetic','변경·합성 콘텐츠 여부를 선택하세요.');
  if(!youtube.validMetadata(title,'x'))field('title','YouTube 제목은 100자 이하로 입력하고 꺾쇠 문자를 제외하세요.');
  if(!youtube.validMetadata('x',body))field('body','YouTube 설명은 UTF-8 5,000바이트 이하로 입력하고 꺾쇠 문자를 제외하세요.');
 }
 return issues;
}

function create(ctx,{demo=false,accountFits,publicationApproved,fetchComments=socialComments,refreshAccount=ensureFresh,clock=Date.now}){
 const {get,list,put,audit,transaction,decrypt}=ctx;
 const now=()=>new Date(clock()).toISOString();
 function requiredPost(id){
  const p=get('content',id);
  if(!sns(p))fail('Instagram 또는 YouTube 게시물을 선택하세요.',404);
  return {...p,id};
 }

 function scheduleIssues(post,v){
  const issues=[];
  if(v.approved!==true)issues.push(issue('approved','콘텐츠와 게시 계정, 예약 시각을 확인한 뒤 승인하세요.','field'));
  if((post.uncertain||post.status==='review'&&!['preflight','connection'].includes(post.attempt?.code))&&v.checked!==true){
   issues.push(issue('checked','채널에서 게시되지 않았음을 먼저 확인하세요.','field'));
  }
  const account=typeof v.account==='string'&&v.account.length<=120?get('channel',v.account):null;
  if(!account?.verifiedAt||!accountFits(account,post)||!account.userId||account.connectionError){
   const candidates=list('channel').filter(a=>accountFits(a,post)&&a.verifiedAt&&a.userId&&!a.connectionError);
   const hasAvailable=candidates.some(a=>!get('channel-hold',a.id)?.active);
   if(!account&&candidates.length&&!hasAvailable)issues.push(issue('account','이 채널의 확인된 계정은 모두 예약이 일시정지되어 있습니다.','schedule',409));
   else if(account?.connectionError)issues.push(issue('account','선택한 게시 계정의 연결을 확인하세요.','connections'));
   else issues.push(issue('account','해당 브랜드 또는 SNS 공용의 확인된 계정을 선택하세요.',hasAvailable?'field':'connections'));
  }
  issues.push(...preflightIssues(post));
  if(!v.at||!(Date.parse(v.at)>clock()))issues.push(issue('at','게시할 미래 시각을 선택하세요.','field'));
  if(account&&get('channel-hold',v.account)?.active)issues.push(issue('account','일시정지 중인 채널에는 예약할 수 없습니다.','schedule',409));
  if(post.channel==='youtube'&&post.youtubeVideoId&&list('content').some(row=>
   row.id!==post.id&&sns(row)&&row.channel==='youtube'&&row.youtubeVideoId===post.youtubeVideoId&&conflictingStatuses.includes(row.status))){
   issues.push(issue('youtubeVideoId','같은 YouTube 영상의 기존 예약 또는 확인 건을 먼저 처리하세요.','edit',409));
  }
  return issues;
 }

 function readiness(v){
  const post=requiredPost(idOf(v.id));
  if(excluded(post)||post.externalId||!localStatuses.includes(post.status))fail('검토할 예약 초안을 선택하세요.',409);
  if(!Number.isSafeInteger(v.version)||v.version!==(post.version??1))fail('다른 작업에서 변경했습니다. 새로고침 후 다시 확인하세요.',409);
  const issues=scheduleIssues(post,v),warnings=[];
  if(post.channel==='youtube'&&!demo&&post.youtubeVideoId){
   const prep=get('sns-followup',post.id)?.preparation;
   const matches=post.youtubeCheck?.account===v.account&&prep?.key===post.youtubeCheck?.key&&prep?.reference===post.youtubeVideoId;
   if(matches&&prep.state!=='ready'&&prep.state!=='unavailable'){
    const stateMessages={account:'선택한 채널의 영상인지 YouTube Studio에서 확인하세요.',privacy:'공개·일부 공개·Studio 예약 영상을 비공개 상태로 확인하세요.',failed:'YouTube Studio에서 영상 처리 실패 사유를 확인하세요.',processing:'YouTube에서 영상 처리가 끝난 뒤 다시 확인하세요.',metadata:'제목과 설명을 YouTube Studio의 영상 정보와 맞추세요.'};
    if(Object.hasOwn(stateMessages,prep.state))warnings.push(issue('youtubeVideoId',stateMessages[prep.state],'studio'));
   }else if(!matches||prep.state==='unavailable')warnings.push(issue('youtubeVideoId','선택 채널의 영상 처리와 원고 대조는 채널 조회에서 확인됩니다.','track'));
  }
  return {id:post.id,ready:!issues.length,issues,warnings};
 }

 async function log(id,event){
  if(!eventTypes.has(event.type)||!sns(get('content',id)))return;
  const previous=get('social-event',id)?.events||[];
  const next={
   type:event.type,at:publishTime(event.at)||now(),actor:string(event.actor,320),
   provider:string(event.provider,20),accountId:string(event.accountId,120),scheduledAt:publishTime(event.scheduledAt),
   outcome:string(event.outcome,80),externalId:string(event.externalId,250),
   version:Number.isSafeInteger(event.version)&&event.version>0?event.version:null,revisionId:string(event.revisionId,80),
  };
  await put('social-event',id,{events:[next,...previous].slice(0,60)});
 }

 async function timeline(v){
  const post=requiredPost(idOf(v.id));
  const durable=get('social-event',post.id)?.events||[];
  const audits=typeof ctx.contentAudits==='function'?await ctx.contentAudits(post.id):ctx.audits;
  const fromAudit=audits.flatMap(e=>{
   const [target,revisionId]=String(e.target).split(':');
   const type=Object.hasOwn(auditTypes,e.action)?auditTypes[e.action]:null;
   if(target!==post.id||!type||durable.some(x=>x.type===type&&Math.abs(Date.parse(x.at)-Date.parse(e.at))<1500))return [];
   const failed=e.action==='content.preflight_review'?'preflight':e.action==='content.publish_review'?'uncertain':null;
   return [{type,at:e.at,actor:e.email,provider:post.channel,revisionId:revisionId||null,outcome:failed}];
  });
  const events=[...durable,...fromAudit];
  if(!events.some(e=>e.type==='created')&&post.createdAt)events.push({type:'created',at:post.createdAt});
  const snapshot=get('approval-snapshot',post.id);
  const approval=post.approval?.at||snapshot?.at;
  if(!events.some(e=>e.type==='approved')&&approval)events.push({type:'approved',at:approval,scheduledAt:snapshot?.scheduledAt||post.scheduledAt,accountId:snapshot?.accountId||post.account});
  if(post.attempt?.at&&!events.some(e=>['attempt','response'].includes(e.type)&&e.at===post.attempt.at)){
   events.push({type:post.attempt.code==='sending'?'attempt':'response',at:post.attempt.at,outcome:post.attempt.code,externalId:post.externalId});
  }
  if(post.publishedAt&&!events.some(e=>e.type==='response'&&(e.outcome==='published'||e.outcome==null))){
   events.push({type:'response',at:post.publishedAt,outcome:post.manual?'registered':'published',externalId:post.manual?null:post.externalId});
  }
  if(post.checkedAt&&!events.some(e=>e.type==='confirmed'&&e.at===post.checkedAt)){
   events.push({type:'confirmed',at:post.checkedAt,outcome:post.checkStatus});
  }
  for(const revision of list('content-revision').filter(r=>r.contentId===post.id)){
   if(events.some(e=>e.revisionId===revision.id||['edited','restored'].includes(e.type)&&Math.abs(Date.parse(e.at)-Date.parse(revision.createdAt))<1500))continue;
   events.push({type:revision.reason==='restored'?'restored':'edited',at:revision.createdAt,revisionId:revision.id,version:revision.version});
  }
  return {events:events.filter(e=>publishTime(e.at)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)).slice(0,60)};
 }

 function connected(post,account,{automatic=false}={}){
  if(!sns(post)||excluded(post)||post.status!=='published'||post.manual||!post.externalId||!post.account||
    !accountFits(account,post)||!account?.verifiedAt||!account.secret||!account.userId)return false;
  if(post.publishedChannelId?post.publishedChannelId!==account.userId:!publicationApproved(post,account))return false;
  if(!automatic)return true;
  if(account.connectionError||!(clock()-Date.parse(post.publishedAt)>=0&&clock()-Date.parse(post.publishedAt)<=activeAge))return false;
  try{
   const config=decrypt(account.secret);
   return !!config.token&&(post.channel!=='instagram'||config.authType!=='oauth2'||config.comments===true);
  }catch{return false;}
 }

 function commentState(){
  return list('comment-sync').filter(row=>row.at||row.errorAt).slice(0,100).map(row=>({id:row.id,at:row.at||null,
   errorAt:row.errorAt||null,error:row.error||null,received:row.received??0,mode:row.mode||'manual'}));
 }

 function inboxComments({page=1,filter='all',brand='all'}={}){
  const pageSize=25;
  if(!Number.isSafeInteger(page)||page<1||page>10000||!['all','new','open'].includes(filter)||!['all','mind','holdem','common'].includes(brand))fail('댓글 목록을 확인하세요.');
  const comments=list('inbox-comment').flatMap(row=>{
   const post=get('content',row.contentId);
   if(excluded(post)||brand!=='all'&&(post?.brand||'common')!==brand)return [];
   const work=get('inbox-work',row.id);
   const seenAt=get('comment-seen',row.id)?.at||null;
   const isNew=!seenAt&&!work;
   if(filter==='new'&&!isNew||filter==='open'&&work?.status==='done')return [];
   return [{...row,seenAt,isNew}];
  }).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const current=Math.min(page,Math.max(1,Math.ceil(comments.length/pageSize)));
  return {rows:comments.slice((current-1)*pageSize,current*pageSize),total:comments.length,page:current,pageSize};
 }

 async function markSeen(input,actor){
  const id=idOf(input,'댓글');
  if(!/^(youtube|instagram)-[0-9a-z-]{1,80}$/.test(id))fail('댓글을 선택하세요.');
  return transaction(async()=>{
   await ctx.lock('comment-seen:'+id);
   await ctx.reload();
   const row=get('inbox-comment',id);
   if(!row||excluded(get('content',row.contentId)))fail('댓글을 찾을 수 없습니다.',404);
   if(!get('comment-seen',id)){
    await put('comment-seen',id,{at:now()});
    await audit(actor,'desk.comment_seen',id);
   }
   return {ok:true};
  });
 }

 const within=(at,limit)=>clock()-Date.parse(at)<limit;
 function pending(last,automatic){
  return within(last?.startedAt,2*minute)||within(last?.at,(automatic?30:1)*minute)||within(last?.errorAt,(automatic?60:1)*minute);
 }

 async function sync(id,actor,automatic){
  if(demo)fail('샘플에서는 외부 댓글을 조회하지 않습니다.',404);
  const lease=randomUUID(),mode=automatic?'automatic':'manual';
  const claim=await transaction(async()=>{
   await ctx.lock('comment-sync:'+id);
   await ctx.reload();
   const post=requiredPost(id),account=get('channel',post.account);
   if(!connected(post,account,{automatic}))fail('게시한 채널의 연결을 확인하세요.',409);
   const previous=get('comment-sync',id);
   if(pending(previous,automatic))return {cached:true,received:previous?.received??0,at:previous?.at||null};
   await put('comment-sync',id,{...previous,lease,startedAt:now()});
   return {post,account};
  });
  if(claim.cached)return {...claim,added:0};
  const {post,account}=claim;
  try{
   const fresh=await refreshAccount(ctx,{...account,id:post.account});
   const rows=await fetchComments(post,decrypt(fresh.secret));
   return await transaction(async()=>{
    await ctx.lock('comment-sync:'+id);
    await ctx.lockRow('channel',post.account);
    await ctx.lockRow('content',id);
    await ctx.reload();
    const last=get('comment-sync',id),latest=requiredPost(id),current=get('channel',latest.account);
    if(last?.lease!==lease||latest.externalId!==post.externalId||latest.account!==post.account||current?.secret!==fresh.secret||!connected(latest,current)){
     fail('게시물 또는 채널 정보가 변경됐습니다.',409);
    }
    let added=0;
    const batch=rows.slice(0,25);
    for(const {id:commentId,...item} of batch){
     const old=get('inbox-comment',commentId);
     if(old&&old.contentId!==id)continue;
     if(!old||old.body!==item.body){
      await put('inbox-comment',commentId,{...old,...item,subject:latest.title,contentId:id,sourceLink:latest.link||'',firstSeenAt:old?.firstSeenAt||now()});
      if(!old)added++;
     }
    }
    const at=now();
    await put('comment-sync',id,{at,received:batch.length,mode});
    await audit(actor,'desk.comments_read',id);
    return {received:batch.length,added,at,cached:false};
   });
  }catch(error){
   const status=error.status===403||error.status===409?error.status:502;
   const message=status===403?'Instagram 댓글 조회 권한을 선택해 다시 연결하세요.':status===409?'게시물 또는 채널 정보가 변경됐습니다.':'댓글을 가져오지 못했습니다. 채널 연결과 댓글 공개 상태를 확인하세요.';
   await transaction(async()=>{
    await ctx.lock('comment-sync:'+id);
    await ctx.reload();
    const last=get('comment-sync',id);
    if(last?.lease!==lease)return;
    await put('comment-sync',id,{at:last.at||null,received:last.received??0,errorAt:now(),error:message,mode});
   });
   fail(message,status);
  }
 }

 async function sweep(){
  if(demo)return {checked:0,added:0,failed:0};
  const jobs=list('content').map(post=>({post,last:get('comment-sync',post.id)}))
   .filter(({post,last})=>connected(post,get('channel',post.account),{automatic:true})&&!pending(last,true))
   .sort((a,b)=>(a.last?.errorAt||a.last?.at||'').localeCompare(b.last?.errorAt||b.last?.at||'')||Date.parse(b.post.publishedAt)-Date.parse(a.post.publishedAt)).slice(0,batchSize);
  let checked=0,added=0,failed=0;
  for(const {post} of jobs){
   try{const result=await sync(post.id,'예약 실행',true);if(!result.cached){checked++;added+=result.added;}}
   catch(error){if(error.status===502||error.status===403)failed++;else if(error.status!==409)throw error;}
  }
  return {checked,added,failed};
 }

 return {readiness,scheduleIssues,log,timeline,commentState,inboxComments,markSeen,readComments:(id,actor)=>sync(idOf(id),actor,false),sweep};
}

module.exports={create,preflightIssues};
