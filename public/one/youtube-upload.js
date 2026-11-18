'use strict';

(() => {
 const mimeTypes={mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm'};
 let dialog,editor,previewURL,inProgress=false,pause=false;
 const selected=()=>data.accounts.filter(a=>snsRecord(a)&&a.channel==='youtube'&&a.authType==='oauth2'&&a.verifiedAt&&!a.connectionError);

 async function request(payload, chunk, id, offset) {
  if(!navigator.onLine)throw Error('인터넷 연결을 복구한 뒤 이어 올리세요.');
  const headers=chunk?{'Content-Type':'application/octet-stream','X-Upload-Id':id,'X-Upload-Offset':String(offset)}:{'Content-Type':'application/json'};
  const r=await fetch('/api/dashboard/youtube-upload',{method:chunk?'PUT':'POST',headers,body:chunk||JSON.stringify(payload),signal:AbortSignal.timeout(50000)});
  const result=await r.json().catch(()=>null);
  if(!r.ok||!result)throw Error(result?.error||'전송 응답을 확인할 수 없습니다. 같은 파일로 이어 올리세요.');
  return result;
 }

 async function fingerprint(file){
  const sample=65536;
  const pieces=await new Blob([JSON.stringify([file.name,file.size,file.lastModified]),file.slice(0,sample),file.slice(-sample)]).arrayBuffer();
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',pieces));
  return Array.from(digest,n=>n.toString(16).padStart(2,'0')).join('');
 }

 function clearPreview(){
  const video=dialog?.querySelector('video');
  if(video){video.removeAttribute('src');video.load();video.hidden=true;}
  if(previewURL){URL.revokeObjectURL(previewURL);previewURL=null;}
 }

 function open(source){
  editor=source.closest('form');
  if(!editor?.elements.youtubeVideoId)return;
  if(!dialog){
   dialog=document.createElement('dialog');
   dialog.className='youtube-upload-dialog';
   dialog.setAttribute('aria-labelledby','youtube-upload-title');
   document.body.append(dialog);
   dialog.addEventListener('cancel',e=>{if(inProgress){e.preventDefault();pause=true;}});
   dialog.addEventListener('close',clearPreview);
   dialog.addEventListener('submit',upload);
   dialog.addEventListener('change',e=>{
    if(e.target.name!=='video')return;
    clearPreview();
    const file=e.target.files[0];
    if(file){
     const video=dialog.querySelector('video');
     previewURL=URL.createObjectURL(file);
     video.src=previewURL;
     video.hidden=false;
    }
   });
   dialog.addEventListener('click',e=>{
    if(e.target.closest('[data-youtube-close]')){if(inProgress)pause=true;else dialog.close();}
   });
  }
  const accounts=selected();
  const meta=metadata();
  const valid=!!meta.title&&!!meta.description&&typeof meta.madeForKids==='boolean'&&typeof meta.synthetic==='boolean';
  dialog.innerHTML=`<header><h2 id="youtube-upload-title">YouTube 비공개 업로드</h2><button class="btn" type="button" data-youtube-close>닫기</button></header>${
   !accounts.length?`<p class="caption">설정에서 YouTube 채널을 연결하고 권한을 확인하세요.</p><button type="button" class="btn" data-youtube-settings data-action="sns-settings">SNS 연결 열기</button>`:
   !valid?`<p class="caption">원고의 제목·설명과 아동용·변경 합성 여부를 먼저 입력하세요.</p>`:
   `<form class="form-grid"><p class="caption full">같은 파일과 원고를 선택하면 중단된 위치부터 이어 올릴 수 있습니다. 공개 예약은 승인함에서 진행합니다.</p>
    ${selectField('업로드 채널','account',accounts.map(a=>[a.id,a.username||a.label]))}
    ${selectField('영상 카테고리','categoryId',[['22','인물 및 블로그'],['24','엔터테인먼트'],['26','노하우 및 스타일'],['27','교육']])}
    <label class="field full">영상 파일 · MP4, MOV, WebM · 최대 512 MB<input required type="file" name="video" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"></label>
    <video class="full" controls playsinline preload="metadata" hidden aria-label="선택한 영상 미리보기"></video>
    <div class="full"><progress max="100" value="0" aria-label="YouTube 업로드 진행률"></progress><p class="caption" role="status"></p></div>
    <div class="toolbar full"><button class="btn primary" type="submit">비공개로 올리기</button></div>
   </form>`}`;
  dialog.showModal();
 }

 function metadata() {
  const fields=editor.elements;
  const flag=name=>fields[name].value==='true'?true:fields[name].value==='false'?false:null;
  return {title:fields.title.value.trim(),description:fields.body.value.trim(),madeForKids:flag('youtubeMadeForKids'),synthetic:flag('youtubeSynthetic')};
 }

 async function upload(e){
  e.preventDefault();
  if(inProgress)return;
  const form=e.target;
  const status=form.querySelector('[role=status]'),progress=form.querySelector('progress'),submit=form.querySelector('[type=submit]');
  const close=dialog.querySelector('[data-youtube-close]');
  const file=form.elements.video.files[0],account=form.elements.account.value,categoryId=form.elements.categoryId.value;
  if(!file)return;
  const mime=mimeTypes[file.name.split('.').pop().toLowerCase()];
  if(!mime||!file.size||file.size>512*1024*1024){status.textContent='512 MB 이하의 MP4, MOV, WebM 파일을 선택하세요.';return;}
  inProgress=true;
  pause=false;
  submit.disabled=true;
  const fields=[form.elements.video,form.elements.account,form.elements.categoryId];
  fields.forEach(field=>field.disabled=true);
  close.textContent='전송 멈추기';
  status.textContent='YouTube 업로드 준비 중';
  try{
   let result=await request({action:'begin',...metadata(),account,categoryId,mime,size:file.size,fingerprint:await fingerprint(file)});
   if(!result.videoId&&!pause)result=await request({action:'status',id:result.id});
   const update=()=>{
    progress.value=Math.floor(100*result.received/file.size);
    status.textContent=progress.value+'% 전송됨';
   };
   update();
   while(!result.videoId&&!pause){
    const previous=result.received;
    result=await request(null,file.slice(previous,previous+result.chunkSize),result.id,previous);
    update();
    if(!result.videoId&&result.received<=previous)throw Error('YouTube 진행 위치를 확인한 뒤 이어 올리세요.');
   }
   if(!result.videoId){status.textContent='전송을 멈췄습니다. 같은 파일을 이어 올릴 수 있습니다.';return;}
   const videoId=editor.elements.youtubeVideoId;
   if(editor.isConnected){
    videoId.value=result.videoId;
    editor.elements.youtubeCheckAccount.value=account;
    videoId.dispatchEvent(new Event('input',{bubbles:true}));
    videoId.dispatchEvent(new Event('change',{bubbles:true}));
   }
   status.textContent='비공개 업로드 완료 · 초안을 저장하면 승인함에서 영상 처리 상태를 확인할 수 있습니다.';
   const url=new URL(result.studioUrl);
   if(url.origin==='https://studio.youtube.com'){
    const link=document.createElement('a');
    link.className='btn';
    link.href=url.href;
    link.target='_blank';
    link.rel='noopener noreferrer';
    link.textContent='YouTube Studio에서 확인 ↗';
    form.querySelector('.toolbar').append(link);
   }
   submit.hidden=true;
  }catch(error){
   status.textContent=error instanceof TypeError?'네트워크 연결을 확인하고 같은 파일로 이어 올리세요.':error.message;
  }finally{
   inProgress=false;
   close.textContent='닫기';
   submit.disabled=false;
   submit.textContent='같은 파일 이어 올리기';
   fields.forEach(field=>field.disabled=false);
  }
 }

 document.addEventListener('click',e=>{
  const source=e.target.closest('[data-youtube-upload]');
  if(source&&!session?.readOnly&&!data.demo)open(source);
  if(e.target.closest('[data-youtube-settings]'))dialog.close();
  const setup=e.target.closest('[data-sns-provider]');
  if(setup){
   const form=document.getElementById((setup.dataset.snsConfigured==='true'?'social-connect-':'social-app-')+setup.dataset.snsProvider);
   if(!form)return;
   form.closest('details').open=true;
   (form.elements.clientId||form.elements.label).focus();
   form.scrollIntoView({block:'nearest'});
  }
 });
})();
