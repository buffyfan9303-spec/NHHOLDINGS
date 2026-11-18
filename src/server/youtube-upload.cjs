'use strict';

const {createHash,randomUUID}=require('node:crypto');
const {ensureFresh,identity}=require('./social.cjs');
const {channelPattern,videoId,studioUrl,validMetadata}=require('./youtube.cjs');

const chunkSize=2*1024*1024;
const maxSize=512*1024*1024;
const kind='youtube-upload';
const endpoint='https://www.googleapis.com/upload/youtube/v3/videos';
const types=new Set(['video/mp4','video/quicktime','video/webm']);
const categories=new Set(['22','24','26','27']);
const digest=/^[a-f0-9]{64}$/;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};

function uploadURL(value) {
 let url;
 try { url=new URL(value); } catch { fail('YouTube 업로드 주소를 확인할 수 없습니다.',502); }
 if(typeof value!=='string'||value.length>4000||url.origin!==new URL(endpoint).origin||url.pathname!==new URL(endpoint).pathname
  ||!url.searchParams.get('upload_id')||url.username||url.password||url.hash)fail('YouTube 업로드 주소를 확인할 수 없습니다.',502);
 return url.href;
}

async function providerRequest(request,url,options) {
 try { return await request(url,{...options,redirect:'manual',signal:AbortSignal.timeout(25000)}); }
 catch { fail('YouTube 응답이 중단됐습니다. 같은 파일로 다시 이어 올리세요.',502); }
}

async function credentials(ctx,reference,expected,request) {
 const current=ctx.get('channel',reference);
 if(current?.service!=='tistory'||current.channel!=='youtube'||!current.verifiedAt||current.connectionError||
  !channelPattern.test(current.userId||'')||expected&&current.userId!==expected)fail('확인된 YouTube 채널을 선택하거나 다시 연결하세요.',409);
 const account=await ensureFresh(ctx,{...current,id:reference},request);
 const config=ctx.decrypt(account.secret);
 if(config.authType!=='oauth2'||!config.token)fail('공식 OAuth로 연결한 YouTube 채널을 선택하세요.',409);
 return {account,config};
}

const publicStatus=(id,row)=>({id,received:row.received,size:row.size,videoId:row.videoId||null,
 studioUrl:row.videoId?studioUrl(row.videoId):null,chunkSize});

async function begin(ctx,owner,input,request=fetch) {
 const {account:reference,fingerprint,size,madeForKids,synthetic,categoryId}=input;
 const mime=input.mime;
 const title=typeof input.title==='string'?input.title.trim():'';
 const description=typeof input.description==='string'?input.description.trim():'';
 if(typeof reference!=='string'||reference.length>120||!types.has(mime)||!categories.has(categoryId)||
  typeof fingerprint!=='string'||!digest.test(fingerprint)||!Number.isSafeInteger(size)||size<1||size>maxSize||
  !validMetadata(title,description)||typeof madeForKids!=='boolean'||typeof synthetic!=='boolean') {
  fail('영상 형식·크기, 제목과 설명, 카테고리 및 공개 설정을 확인하세요.');
 }
 const {account,config}=await credentials(ctx,reference,null,request);
 const id=createHash('sha256').update(JSON.stringify([owner,reference,account.userId,fingerprint,size,mime,title,description,madeForKids,synthetic,categoryId])).digest('hex');
 let startup;
 await ctx.transaction(async()=>{
  await ctx.lock(kind+':owner:'+owner);
  await ctx.reload();
  const existing=ctx.get(kind,id);
  if(existing?.secret||existing?.videoId){startup=existing;return;}
  if(existing?.leaseUntil>Date.now())fail('같은 영상의 업로드 준비 중입니다. 잠시 뒤 다시 시도하세요.',409);
  const attempts=ctx.list(kind).filter(row=>row.owner===owner&&row.createdAt>Date.now()-3600000).length;
  if(attempts>=12&&!existing)fail('최근 업로드 요청이 많습니다. 잠시 뒤 다시 시도하세요.',429);
  startup={owner,reference,channel:account.userId,size,mime,received:0,createdAt:Date.now(),lease:randomUUID(),leaseUntil:Date.now()+45000};
  await ctx.put(kind,id,startup);
 });
 if(startup.secret||startup.videoId)return publicStatus(id,startup);
 try {
  const target=await identity('youtube',config,request);
  if(target.userId!==account.userId||ctx.get('channel',reference)?.secret!==account.secret)fail('연결한 YouTube 채널이 바뀌었습니다. 계정을 다시 확인하세요.',409);
  const response=await providerRequest(request,endpoint+'?uploadType=resumable&part=snippet%2Cstatus&notifySubscribers=false',{
   method:'POST',headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json','X-Upload-Content-Length':String(size),'X-Upload-Content-Type':mime},
   body:JSON.stringify({snippet:{title,description,categoryId},status:{privacyStatus:'private',selfDeclaredMadeForKids:madeForKids,containsSyntheticMedia:synthetic}}),
  });
  if(!response.ok)fail('YouTube가 업로드 준비를 거절했습니다. 채널 권한·할당량을 확인하세요.',502);
  const sessionURL=uploadURL(response.headers.get('location'));
  const current=ctx.get(kind,id);
  if(current?.lease!==startup.lease)fail('업로드 준비가 변경됐습니다. 다시 확인하세요.',409);
  const next={...current,secret:ctx.encrypt({url:sessionURL}),lease:null,leaseUntil:0};
  await ctx.put(kind,id,next);
  return publicStatus(id,next);
 } catch (error) {
  await ctx.reload();
  const current=ctx.get(kind,id);
  if(current?.lease===startup.lease)await ctx.put(kind,id,{...current,lease:null,leaseUntil:0});
  throw error;
 }
}

async function transfer(ctx,owner,id,offset,bytes,request=fetch) {
 if(typeof id!=='string'||!digest.test(id))fail('업로드를 확인하세요.');
 const saved=ctx.get(kind,id);
 if(!saved||saved.owner!==owner)fail('이 업로드를 찾을 수 없습니다.',404);
 const {config}=await credentials(ctx,saved.reference,saved.channel,request);
 let current,lease;
 await ctx.transaction(async()=>{
  await ctx.lock(kind+':'+id);
  await ctx.reload();
  current=ctx.get(kind,id);
  if(current.videoId)return;
  if(!current.secret)fail('업로드 준비를 다시 시작하세요.',409);
  if(current.leaseUntil>Date.now())fail('이 영상의 전송이 진행 중입니다. 잠시 뒤 이어 올리세요.',409);
  if(bytes&&(offset!==current.received||bytes.length!==Math.min(chunkSize,current.size-offset)||!bytes.length)) {
   fail('서버에서 진행률을 다시 확인한 뒤 이어 올리세요.',409);
  }
  lease=randomUUID();
  current={...current,lease,leaseUntil:Date.now()+45000,finalAttempted:!!current.finalAttempted||!!bytes&&offset+bytes.length===current.size};
  await ctx.put(kind,id,current);
 });
 if(current.videoId)return publicStatus(id,current);
 let next=current;
 try {
  const url=uploadURL(ctx.decrypt(current.secret).url);
  const range=bytes?'bytes '+offset+'-'+(offset+bytes.length-1)+'/'+current.size:'bytes */'+current.size;
  const response=await providerRequest(request,url,{
   method:'PUT',headers:{Authorization:'Bearer '+config.token,'Content-Type':current.mime,'Content-Length':String(bytes?.length||0),'Content-Range':range},
   body:bytes||Buffer.alloc(0),
  });
  if(response.status===308){
   const header=response.headers.get('range');
   const match=header==null?null:/^bytes=0-(\d+)$/.exec(header);
   const received=match?Number(match[1])+1:0;
   if(header&&!match||!Number.isSafeInteger(received)||received<current.received||received>=current.size||bytes&&received>offset+bytes.length)fail('YouTube 업로드 진행률을 확인하지 못했습니다.',502);
   next={...current,received};
  }else if(response.status===200||response.status===201){
   const video=await response.json().catch(()=>null);
   if(!video?.id||videoId(video.id)!==video.id||video.snippet?.channelId!==current.channel||video.status?.privacyStatus!=='private'){
    fail('YouTube Studio에서 영상과 공개 여부를 확인하세요.',502);
   }
   next={...current,videoId:video.id,received:current.size,secret:null};
  }else if([404,410].includes(response.status)){
   if(!current.finalAttempted)next={...current,secret:null,received:0};
   fail(current.finalAttempted?'마지막 전송 결과를 YouTube Studio에서 확인하세요.':'이어 올리기 기간이 끝났습니다. 같은 파일로 다시 시작하세요.',409);
  }else fail('YouTube 전송을 완료하지 못했습니다. 권한과 연결을 확인한 뒤 같은 파일을 선택하세요.',502);
 } finally {
  await ctx.reload();
  if(ctx.get(kind,id)?.lease===lease){
   next={...next,lease:null,leaseUntil:0};
   await ctx.put(kind,id,next);
  }
 }
 return publicStatus(id,next);
}

module.exports={begin,transfer,chunkSize,maxSize};
