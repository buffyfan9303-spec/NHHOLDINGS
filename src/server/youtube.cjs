'use strict';

const videoPattern = /^[A-Za-z0-9_-]{11}$/;
const channelPattern = /^UC[A-Za-z0-9_-]{22}$/;
const watchUrl = id => 'https://www.youtube.com/watch?v=' + id;
const studioUrl = id => 'https://studio.youtube.com/video/' + id + '/edit';

function videoId(value) {
 if (typeof value !== 'string' || value.length > 2000) return '';
 const input = value.trim();
 if (videoPattern.test(input)) return input;
 let url;
 try { url = new URL(input); } catch { return ''; }
 if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
 let id;
 if (['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)) {
  if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) id = url.searchParams.get('v');
  else id = /^\/shorts\/([^/]+)\/?$/.exec(url.pathname)?.[1];
 } else if (url.hostname === 'youtu.be') id = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
 else if (url.hostname === 'studio.youtube.com') id = /^\/video\/([^/]+)\/edit\/?$/.exec(url.pathname)?.[1];
 return typeof id === 'string' && videoPattern.test(id) ? id : '';
}

function validMetadata(title, description) {
 return !!title&&!!description&&Array.from(title).length<=100&&Buffer.byteLength(description,'utf8')<=5000&&!/[<>]/.test(title+description);
}

function fail(message, status = 409) {
 throw Object.assign(new Error(message), {status});
}

async function requestVideo(token, params, request, update) {
 const url = new URL('https://www.googleapis.com/youtube/v3/videos');
 url.search = new URLSearchParams(params).toString();
 const headers = {Authorization: 'Bearer ' + token};
 let response;
 try {
  response = await request(url.href, {
   headers: {...headers, ...(update ? {'Content-Type':'application/json'} : {})},
   ...(update ? {method:'PUT',body:JSON.stringify(update)} : {}),
   redirect:'error',signal:AbortSignal.timeout(20000),
  });
 } catch { fail('YouTube의 응답을 확인하지 못했습니다. Studio에서 공개 여부를 확인하세요.',502); }
 if (!response.ok) {
  throw Object.assign(new Error('YouTube 요청을 완료하지 못했습니다. 계정 권한과 Studio 상태를 확인하세요.'),{status:502,connectionIssue:response.status===401});
 }
 return await response.json().catch(() => fail('YouTube 응답 형식을 확인할 수 없습니다.',502));
}

async function readVideo(id, token, request = fetch, {statistics=false}={}) {
 if (!videoPattern.test(id || '') || typeof token !== 'string' || !token) fail('영상과 YouTube 연결을 확인하세요.');
 const body = await requestVideo(token, {part:statistics?'snippet,status,statistics':'snippet,status',id}, request);
 return Array.isArray(body.items) && body.items.length === 1 && body.items[0].id === id ? body.items[0] : null;
}

async function preparation(post, account, config, request = fetch) {
 if (!channelPattern.test(account?.userId || '') || config?.authType !== 'oauth2') return {state:'account',message:'공식 OAuth로 연결한 YouTube 채널을 선택하세요.'};
 const video = await readVideo(post.youtubeVideoId,config.token,request);
 if (!video || video.snippet?.channelId !== account.userId) return {state:'account',message:'선택한 채널의 영상인지 YouTube Studio에서 확인하세요.'};
 if (video.status?.privacyStatus !== 'private' || video.status.publishAt) return {state:'privacy',message:'공개·일부 공개·Studio에서 예약한 영상은 누리원에서 공개할 수 없습니다.'};
 const status=video.status.uploadStatus;
 if (['failed','rejected','deleted'].includes(status)) return {state:'failed',message:'YouTube Studio에서 영상 처리 실패 사유를 확인하세요.'};
 if (status !== 'processed') return {state:'processing',message:'YouTube에서 영상 처리가 끝난 뒤 다시 확인하세요.'};
 const description = video.snippet?.description;
 if (video.snippet?.title !== post.title || typeof description !== 'string' || description.replace(/\r\n/g,'\n').trim() !== post.body.replace(/\r\n/g,'\n').trim()) {
  return {state:'metadata',message:'누리원에서 검토한 제목·설명과 YouTube Studio의 영상 정보가 다릅니다.'};
 }
 return {state:'ready',video};
}

async function checkReady(post, account, config, request = fetch) {
 const result=await preparation(post,account,config,request);
 if(result.state!=='ready')fail(result.message);
 return result.video;
}

async function publish(post, account, config, request = fetch, beforeWrite = ()=>{}) {
 const video = await checkReady(post,account,config,request);
 // YouTube replaces writable fields in the status part. Carry over existing settings that this workflow does not manage.
 const {license,embeddable,publicStatsViewable} = video.status;
 const status = {privacyStatus:'public',license,embeddable,publicStatsViewable,
  selfDeclaredMadeForKids:post.youtubeMadeForKids,containsSyntheticMedia:post.youtubeSynthetic};
 await beforeWrite();
 const result = await requestVideo(config.token,{part:'status'},request,{id:video.id,status});
 if (result.id !== video.id || result.status?.privacyStatus !== 'public') fail('YouTube 공개 응답을 확인하지 못했습니다. Studio에서 확인하세요.',502);
 return {externalId:video.id,link:watchUrl(video.id)};
}
module.exports = {videoId,channelPattern,watchUrl,studioUrl,validMetadata,readVideo,preparation,checkReady,publish};
