'use strict';

window.NuriDesk=(()=>{
 const sections=[['schedule','예약 관리'],['brand','브랜드·소재'],['inbox','댓글·문의'],['traffic','링크 유입'],['weekly','주간 보고'],['rehearsal','판매 리허설']];
 const brands=[['mind','누리마인드'],['holdem','누리홀덤']];
 const stateLabels={open:'대기',working:'처리 중',done:'정리 완료'};
 const websiteLabels={up:'공개 접속 정상',http:'공개 HTTP 오류',timeout:'공개 응답 지연',network:'공개 접속 실패'};
 const ui={tab:'schedule',inbox:null,inboxPage:1,loadingInbox:false,inboxError:'',rehearsal:null,rehearsing:false};
 const props=()=>data.desk||{holds:[],brands:[],links:[],traffic:[],approved:[]};
 const accountTitle=a=>(labels[a.channel]||a.channel)+' · '+a.label;
 const nameOf=id=>brands.find(b=>b[0]===id)?.[1]||id;
 const hold=id=>props().holds?.find(a=>a.id===id);
 const preset=id=>props().brands?.find(b=>b.id===id);
 const buttonFor=(label,key,id='')=>`<button class="btn" type="button" data-desk-action="${key}" data-id="${esc(id)}">${label}</button>`;
 const message=(text='')=>`<p class="caption" role="status">${esc(text)}</p>`;

 function schedule(){
  const accounts=data.accounts.filter(a=>snsRecord(a)&&a.verifiedAt&&supportedChannel(a.channel));
  return `<section class="panel panel-inner"><h2>계정별 예약 일시정지</h2>
   <p class="caption">중지된 예약은 승인함에서 다시 검토합니다. 이미 채널에 요청을 보낸 건은 게시 결과를 확인하세요.</p>
   ${accounts.map(a=>{
    const s=hold(a.id),active=s?.active===true;
    const jobs=data.contents.filter(p=>p.account===a.id&&['scheduled','paused','publishing'].includes(p.status));
    return `<details class="desk-item" ${accounts.length===1?'open':''}><summary>${esc(accountTitle(a))} · ${active?'일시정지 중':'예약 가능'} · ${jobs.length}건</summary>
     ${s?.reason?`<p class="caption">${esc(s.reason)}</p>`:''}
     ${jobs.length?`<ul class="desk-list">${jobs.map(p=>`<li><button class="btn text" type="button" data-page="${requiresApproval(p)?'approval':'publish'}" ${requiresApproval(p)?'data-approval-id="'+esc(p.id)+'"':''}>${esc(p.title)}</button><span>${esc(statusLabels[p.status])} · ${esc(dt(p.scheduledAt))} KST</span></li>`).join('')}</ul>`:''}
     <form class="form-grid" data-desk-form="hold">
      <input type="hidden" name="id" value="${esc(a.id)}"><input type="hidden" name="version" value="${s?.version||1}"><input type="hidden" name="active" value="${!active}">
      ${active?'':formField('중지 사유','reason','','text','required maxlength="200"')}
      <div class="toolbar full"><button class="btn ${active?'':'primary'}" type="submit">${active?'새 예약 허용':'이 계정 예약 중지'}</button></div>
     </form>
    </details>`;
   }).join('')||empty('설정에서 게시 계정을 연결하면 예약을 관리할 수 있습니다.')}
   </section>`;
 }

 function brand(){
  return `<section class="panel panel-inner"><h2>브랜드별 작성 설정</h2>
   ${brands.map(([id,title])=>{
    const p=preset(id)||{};
    return `<details class="desk-item"><summary>${title}</summary><form data-desk-form="brand" class="form-grid">
     <input type="hidden" name="id" value="${id}"><input type="hidden" name="version" value="${p.version||1}">
     ${['instagram','youtube'].map(c=>selectField(labels[c]+' 계정',c,[['','선택 안 함'],...data.accounts.filter(a=>snsRecord(a)&&a.verifiedAt&&a.channel===c).map(a=>[a.id,a.label])],p[c])).join('')}
     ${formField('말투','tone',p.tone||'','text','maxlength="200"')}
     ${formField('공통 문구','footer',p.footer||'','textarea','maxlength="1200" rows="2"')}
     ${formField('썸네일 규칙','thumbnail',p.thumbnail||'','textarea','maxlength="1200" rows="2"')}
     <div class="full"><button type="submit" class="btn primary">작성 설정 저장</button></div></form></details>`;
   }).join('')}
   </section>${assetForm()}`;
 }

 function assetForm(){
  return `<section class="panel panel-inner section-gap"><h2>게시 소재 미리 점검</h2><form class="form-grid" data-desk-form="assets">
   ${selectField('게시 형식','format',[['photo','Instagram 사진'],['reel','Instagram 릴스'],['youtube','YouTube 영상']],'photo')}
   <label class="field full">파일<input type="file" name="files" required multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm"></label>
   ${formField('단일 사진 대체 텍스트','altText','','text','maxlength="1000"')}
   <p class="caption full">이 기기에서 파일의 규격을 확인합니다.</p>
   <div class="full"><button type="submit" class="btn primary">소재 점검</button></div>
   <div class="full" data-desk-asset-result aria-live="polite"></div>
  </form></section>`;
 }

 function videoMetadata(file){
  return new Promise((resolve,reject)=>{
   const element=document.createElement('video');
   const url=URL.createObjectURL(file);
   const timeout=setTimeout(()=>finish(Error('영상 속성을 읽는 시간이 초과됐습니다.')),10000);
   function finish(error){
    clearTimeout(timeout);
    element.onerror=null;element.onloadedmetadata=null;
    const result={width:element.videoWidth,height:element.videoHeight,duration:element.duration};
    element.removeAttribute('src');element.load();URL.revokeObjectURL(url);
    if(error)reject(error);else resolve(result);
   }
   element.onerror=()=>finish(Error('이 브라우저에서 영상 속성을 읽을 수 없습니다.'));
   element.onloadedmetadata=()=>finish();
   element.preload='metadata';element.muted=true;element.src=url;
  });
 }

 async function checkAssets(form){
  const files=[...form.elements.files.files],format=form.elements.format.value,total=files.length;
  const output=form.querySelector('[data-desk-asset-result]');
  const messages=[];
  if(!total)return;
  output.textContent='파일을 점검하고 있습니다.';
  if(format==='photo'){
   messages.push('사진 '+total+'개');
   if(total>10)messages.push('Instagram 사진은 누리원에서 최대 10개를 등록할 수 있습니다.');
   if(files.some(file=>file.type!=='image/jpeg'))messages.push('누리원 Instagram 사진은 JPEG로 내보내세요.');
   if(files.some(file=>file.size>8*1024*1024))messages.push('8 MB를 넘는 JPEG 파일이 있습니다.');
   if(total===1&&!form.elements.altText.value.trim())messages.push('단일 사진 대체 텍스트를 입력하세요.');
   const samples=files.slice(0,10).filter(file=>file.type==='image/jpeg'&&file.size<=8*1024*1024);
   for(const file of samples){
    try {
     const bitmap=await createImageBitmap(file);
     messages.push(file.name+' · '+bitmap.width+' × '+bitmap.height);
     bitmap.close();
    }catch{messages.push(file.name+' · 이미지 속성을 읽을 수 없습니다.');}
   }
  }else{
   if(total!==1)messages.push('영상은 한 번에 한 파일을 점검하세요.');
   const file=files[0];
   if(format==='youtube'&&file.size>512*1024*1024)messages.push('누리원 업로드 한도 512 MB를 초과했습니다.');
   if(format==='reel'&&!['video/mp4','video/quicktime'].includes(file.type))messages.push('릴스는 MP4 또는 MOV로 내보내세요.');
   try{
    const {width,height,duration}=await videoMetadata(file);
    if(!width||!height||!Number.isFinite(duration))throw Error('영상 길이 또는 해상도를 확인할 수 없습니다.');
    messages.push(width+' × '+height+' · '+duration.toFixed(1)+'초 · '+(file.size/1048576).toFixed(1)+' MB');
    if(format==='reel'&&Math.abs(width/height-9/16)>.03)messages.push('릴스 화면에 맞추려면 세로 9:16을 권장합니다.');
   }catch(error){messages.push(error.message);}
  }
  output.replaceChildren(...messages.map(value=>{const p=document.createElement('p');p.textContent=value;return p;}));
 }

 function brandFields(p){
  return `<div class="full desk-editor-preset">${selectField('브랜드 작성 설정','brand',[['','공통'],...brands],p.brand||'')}
   <div class="desk-brand-note" data-desk-brand-note>${brandNote(p.brand)}</div></div>`;
 }
 function brandNote(id){
  const p=preset(id);
  if(!p)return '';
  return `${p.tone?`<p class="caption">말투 ${esc(p.tone)}</p>`:''}
   ${p.thumbnail?`<p class="caption">썸네일 ${esc(p.thumbnail)}</p>`:''}
   ${p.footer?buttonFor('공통 문구를 본문에 추가','append-footer'):''}`;
 }

 function approvalComparison(p){
  const old=props().approved?.find(r=>r.id===p.id);
  if(!old)return '';
  const media=[p.media,...(p.slides||[]),p.videoUrl].filter(Boolean).join('\n');
  const pairs=[
   ['제목',old.title,p.title],['본문',old.body,p.body],['미디어',old.media?.join('\n'),media],
   ['YouTube 영상',old.videoId,p.youtubeVideoId],['대체 텍스트',old.altText,p.altText],
   ['예약 시각',old.scheduledAt?dt(old.scheduledAt)+' KST':'',p.scheduledAt?dt(p.scheduledAt)+' KST':''],
  ].filter(([,a,b])=>(a||'')!==(b||''));
  return `<details class="desk-compare"><summary>마지막 승인본 비교</summary><p class="caption">마지막 승인 ${esc(dt(old.at))} KST · ${esc(old.account)}</p>
   ${pairs.length?pairs.map(([label,a,b])=>`<section><h4>${label}</h4><div class="desk-compare-grid"><div><span class="caption">승인본</span><p>${esc(a||'미입력')}</p></div><div><span class="caption">현재</span><p>${esc(b||'미입력')}</p></div></div></section>`).join(''):'<p class="caption">저장된 승인본과 현재 원고가 일치합니다.</p>'}
  </details>`;
 }

 function conflicts(form){
  const output=form.querySelector('[data-desk-conflicts]');
  if(!output)return;
  const account=form.elements.account.value,at=form.elements.at.value;
  const time=Date.parse(at+'+09:00');
  if(!account||!Number.isFinite(time)){output.replaceChildren();return;}
  const nearby=data.contents.filter(p=>p.id!==form.dataset.id&&snsRecord(p)&&p.account===account&&['scheduled','publishing'].includes(p.status)&&Number.isFinite(Date.parse(p.scheduledAt)))
   .sort((a,b)=>Date.parse(a.scheduledAt)-Date.parse(b.scheduledAt));
  const interval=30*60000;
  const collision=nearby.filter(p=>Math.abs(Date.parse(p.scheduledAt)-time)<interval);
  let next=time;
  for(const p of nearby){
   const when=Date.parse(p.scheduledAt);
   if(next+interval<=when)break;
   if(Math.abs(next-when)<interval)next=Math.ceil((when+interval)/60000)*60000;
  }
  const approved=props().approved?.find(r=>r.id===form.dataset.id);
  const changed=approved&&(approved.scheduledAt!==new Date(time).toISOString()||approved.accountId!==account);
  output.innerHTML=(changed?'<p class="caption">마지막 승인 이후 계정 또는 예약 시간이 변경됩니다.</p>':'')+
   (collision.length?`<p class="warning">같은 계정 앞뒤 30분에 예약 ${collision.length}건이 있습니다.</p><ul>${collision.slice(0,5).map(p=>`<li>${esc(dt(p.scheduledAt))} · ${esc(p.title)}</li>`).join('')}</ul>
   ${buttonFor(dt(new Date(next).toISOString())+' KST로 이동','move-time',new Date(next+9*3600000).toISOString().slice(0,16))}`:'');
 }

 function siteStatus(site){
  const p=site?.snapshot?.probe;
  if(!p)return '<p class="caption">공개 주소 확인 대기</p>';
  const label=websiteLabels[p.state]||'공개 주소 미확인';
  return `<p class="caption desk-site-state">${esc(label)}${p.status&&p.state!=='up'?' · HTTP '+esc(p.status):''} · ${esc(dt(p.checkedAt))} KST
   ${p.state!=='up'&&p.lastSuccessAt?`<small>마지막 정상 접속 ${esc(dt(p.lastSuccessAt))} KST</small>`:''}</p>`;
 }

 async function loadInbox(page=ui.inboxPage){
  if(ui.loadingInbox)return;
  ui.loadingInbox=true;ui.inboxError='';
  if(state.page==='desk')render();
  try{ui.inbox=await api('desk/inbox?page='+page);ui.inboxPage=ui.inbox.page;}
  catch(error){ui.inboxError=error.message;}
  finally{ui.loadingInbox=false;if(state.page==='desk')render();}
 }

 function inbox(){
  const posts=data.contents.filter(p=>snsRecord(p)&&['instagram','youtube'].includes(p.channel)&&p.status==='published'&&p.account&&p.externalId&&!p.manual&&!p.platformExclusion?.excludedAt);
  const result=ui.inbox;
  return `<section class="panel panel-inner"><h2>댓글·문의 처리함</h2>
   <p class="caption">채널의 최근 댓글을 가져오고, 쇼핑몰 문의와 함께 담당·답변 초안을 정리합니다.</p>
   ${posts.length?`<form data-desk-form="comments" class="form-grid">${selectField('댓글을 가져올 게시물','id',posts.map(p=>[p.id,labels[p.channel]+' · '+p.title]))}<div class="full"><button type="submit" class="btn primary">댓글 조회</button></div></form>`:''}
   ${ui.loadingInbox?message('목록을 조회하고 있습니다.'):ui.inboxError?message(ui.inboxError):''}
   ${result?`<div class="toolbar section-gap">${buttonFor('목록 새로고침','reload-inbox')}<span class="caption">쇼핑몰 문의 ${money(result.marketTotal)}건 · ${result.page}페이지</span></div>
    ${result.items.map(item=>{
     const work=item.work||{},link=webLink(item.sourceLink)||item.sourceLink==='/nurimarket/admin'&&item.sourceLink;
     return `<details class="desk-item"><summary>${esc(labels[item.kind]||'누리마켓')} · ${esc(item.subject)} · ${esc(stateLabels[work.status||'open'])}</summary>
      <p class="desk-inbox-text">${esc(item.body)}</p><p class="caption">${esc(dt(item.createdAt))} KST${item.answered?' · 쇼핑몰 답변 등록됨':''}</p>
      ${link?`<a class="link" href="${esc(link)}" target="_blank" rel="noopener noreferrer">원본 열기 ↗</a>`:''}
      <form class="form-grid section-gap" data-desk-form="inbox"><input type="hidden" name="id" value="${esc(item.id)}"><input type="hidden" name="version" value="${work.version||1}">
      ${formField('담당자','assignee',work.assignee||'','text','maxlength="80"')}${selectField('처리 상태','status',Object.entries(stateLabels),work.status||'open')}
      ${formField('답변 초안','draft',work.draft||'','textarea','maxlength="2000"')}
      <div class="full"><button type="submit" class="btn">처리·초안 저장</button></div></form></details>`;
    }).join('')||empty('가져온 댓글과 쇼핑몰 문의가 없습니다.')}
    <div class="toolbar">${result.page>1?buttonFor('이전 문의 페이지','inbox-page',String(result.page-1)):''}
     ${result.page*result.pageSize<result.marketTotal?buttonFor('다음 문의 페이지','inbox-page',String(result.page+1)):''}</div>`:buttonFor('댓글·문의 목록 열기','reload-inbox')}
  </section>`;
 }

 function traffic(){
  return `<section class="panel panel-inner"><h2>게시물의 사이트 유입</h2>
   <form class="form-grid" data-desk-form="link">
    ${selectField('목적지','service',data.services.filter(s=>['mind','holdem','crm','market','tistory'].includes(s.id)).map(s=>[s.id,s.name]))}
    ${selectField('배포 채널','channel',Object.entries(labels),'instagram')}
    ${selectField('연결할 게시물','contentId',[['','캠페인 공통'],...data.contents.filter(p=>snsRecord(p)&&supportedChannel(p.channel)&&!platformExcluded(p)).slice(0,100).map(p=>[p.id,labels[p.channel]+' · '+p.title])],'')}
    ${formField('사이트 공개 경로','path','','text','required maxlength="1200" placeholder="/ 또는 /nurimarket"')}
    ${formField('캠페인 이름','campaign','','text','required maxlength="70" pattern="[a-z0-9][a-z0-9_\\-]*" placeholder="nuri-holdem-weekly"')}
    <div class="full"><button type="submit" class="btn primary">추적 링크 만들기</button></div></form>
   ${(props().links||[]).map(link=>{
    const stats=props().traffic?.find(t=>t.id===link.id);
    const title=data.contents.find(p=>p.id===link.contentId)?.title;
    return `<details class="desk-item"><summary>${esc(link.campaign)} · ${esc(labels[link.channel])} · ${esc(serviceName(link.service))}</summary>
     ${title?`<p class="caption">${esc(title)}</p>`:''}
     <p class="desk-tracking-link"><a class="link" href="${esc(webLink(link.url))}" target="_blank" rel="noopener noreferrer">${esc(link.url)}</a></p>
     <div class="toolbar">${buttonFor('링크 복사','copy-link',link.id)}</div>
     <p class="caption">${stats?.sessions!=null?'최근 30일 '+money(stats.sessions)+' 세션':'세션 집계 미확인'}${stats?.checkedAt?' · 조회 '+esc(dt(stats.checkedAt))+' KST':''}${stats?.timezone?' · 집계 '+esc(stats.timezone):''}</p>
     <form class="form-grid" data-desk-form="traffic"><input type="hidden" name="id" value="${esc(link.id)}">
      ${formField('목적지 GA4 속성 ID','property',stats?.property||'','text','required inputmode="numeric" pattern="[0-9]{4,20}"')}
      <div class="full"><button type="submit" class="btn">GA4 세션 조회</button></div>
     </form></details>`;
   }).join('')||empty('추적 링크를 만들면 이곳에서 조회합니다.')}
  </section>`;
 }

 function weeklyRows(){
  const from=Date.now()-7*86400000;
  const posts=new Map(data.contents.map(p=>[p.id,p]));
  const best=new Map();
  for(const item of data.snsFollowups||[]){
   const p=posts.get(item.id),sample=item.metrics?.find(x=>x.hours===24)?.sample;
   if(!p||p.status!=='published'||Date.parse(p.publishedAt)<from||sample?.views==null)continue;
   if(!best.has(p.channel)||sample.views>best.get(p.channel).count)best.set(p.channel,{title:p.title,count:sample.views});
  }
  return [
   ...data.services.filter(s=>s.userTrend).map(s=>[s.name,'가입 유저 7일 순변동',s.userTrend.change==null?'미확인':formatUserChange(s.userTrend.change)]),
   ...data.services.map(s=>[s.name,'미처리 업무',data.tasks.filter(t=>t.service===s.id&&t.status!=='done').length]),
   ...[...best].map(([key,b])=>[labels[key],'24시간 조회 상위 게시물',b.title+' · '+money(b.count)+'회']),
   ...data.services.flatMap(s=>(s.snapshot?.incidents||[]).filter(i=>Date.parse(i.at)>=from||!i.endedAt||Date.parse(i.endedAt)>=from)
    .map(i=>[s.name,i.kind==='website'?'공개 접속 장애':'데이터 수집 장애',dt(i.at)+' KST · '+(i.endedAt?dt(i.endedAt)+' 복구':'진행 중')])),
  ];
 }

 function weekly(){
  return `<section class="panel panel-inner"><div class="panel-head"><div><h2>주간 운영 보고</h2><p class="caption">최근 7일 · ${today()} KST</p></div>${buttonFor('CSV 내려받기','weekly-csv')}</div>
   ${table(['서비스·채널','항목','확인 결과'],weeklyRows().map(values=>row(values.map(v=>esc(v)))))}</section>`;
 }

 function rehearsal(){
  const r=ui.rehearsal,checklist=data.services.find(s=>s.id==='market')?.snapshot?.data?.readiness||[];
  return `<section class="panel panel-inner"><h2>누리마켓 판매 리허설</h2><p class="caption">격리한 샘플 데이터로 주문·문의·배송과 미결제 취소를 실행합니다.</p>
   <div class="toolbar"><button class="btn primary" type="button" data-desk-action="rehearse" ${ui.rehearsing?'disabled':''}>${ui.rehearsing?'실행 중':'리허설 실행'}</button></div>
   ${r?`<p class="caption" role="status">${esc(dt(r.checkedAt))} KST 검사</p><ul class="desk-list">${r.checks.map(c=>`<li><span>${esc(c.label)}</span><strong>${c.ok?'통과':'확인 필요'}</strong></li>`).join('')}</ul>`:''}
   </section><section class="panel panel-inner section-gap"><h2>운영 판매 준비</h2>${checklist.length?`<ul class="desk-list">${checklist.map(x=>`<li><span>${esc(x.label)}</span><strong>${x.ready?'완료':'확인 필요'}</strong></li>`).join('')}</ul>`:message('운영 준비 상태를 조회할 수 없습니다.')}</section>`;
 }

 function renderDesk(){
  if(session.readOnly)return empty('운영 도구는 운영자 계정에서 사용할 수 있습니다.');
  const views={schedule,brand,inbox,traffic,weekly,rehearsal};
  return `<nav class="site-tabs desk-tabs" aria-label="운영 도구">
   ${sections.map(([id,l])=>`<button type="button" id="desk-tab-${id}" data-desk-tab="${id}" ${ui.tab===id?'aria-current="page"':''}>${l}</button>`).join('')}
   </nav>${views[ui.tab]()}`;
 }

 document.addEventListener('toggle',e=>{
  if(e.target.open&&e.target.matches('.approval-preview')){const form=e.target.querySelector('form');if(form)conflicts(form);}
 },true);
 document.addEventListener('change',e=>{
  if(e.target.name==='contentId'&&e.target.closest('[data-desk-form="link"]')){
   const post=data.contents.find(p=>p.id===e.target.value);
   if(post)e.target.form.elements.channel.value=post.channel;
  }
  if(e.target.name==='brand'){
   const form=e.target.closest('form');
   const note=form?.querySelector('[data-desk-brand-note]');
   if(note)note.innerHTML=brandNote(e.target.value);
  }
  const form=e.target.closest('.approval-form');
  if(form&&['account','at'].includes(e.target.name))conflicts(form);
 });
 document.addEventListener('input',e=>{
  const form=e.target.closest('.approval-form');
  if(form&&e.target.name==='at')conflicts(form);
 });
 document.addEventListener('click',async e=>{
  const tab=e.target.closest('[data-desk-tab]'),trigger=e.target.closest('[data-desk-action]');
  if(!tab&&!trigger)return;
  if(tab){ui.tab=tab.dataset.deskTab;render();document.getElementById(tab.id)?.focus();return;}
  const action=trigger.dataset.deskAction,id=trigger.dataset.id;
  try{
   if(action==='move-time'){
    const time=trigger.closest('form').elements.at;
    time.value=id;conflicts(time.form);time.focus();
   }else if(action==='append-footer'){
    const form=trigger.closest('form'),body=form?.elements.body,value=preset(form?.elements.brand.value)?.footer;
    if(body&&value&&!body.value.endsWith(value)){body.value=[body.value.trimEnd(),value].filter(Boolean).join('\n\n');body.dispatchEvent(new Event('input',{bubbles:true}));body.focus();}
   }else if(action==='reload-inbox'||action==='inbox-page')await loadInbox(action==='inbox-page'?Number(id):ui.inboxPage);
   else if(action==='copy-link'){const link=props().links.find(link=>link.id===id);if(link){await navigator.clipboard.writeText(link.url);toast('추적 링크를 복사했습니다.');}}
   else if(action==='weekly-csv'){
    const cells=[['서비스·채널','항목','확인 결과'],...weeklyRows()];
    download('누리원-주간-운영-'+today()+'.csv','\ufeff'+cells.map(line=>line.map(cell=>{
     const value=String(cell);return '"'+(/^[\s]*[=+@-]/.test(value)?"'":"")+value.replaceAll('"','""')+'"';
    }).join(',')).join('\n'),'text/csv;charset=utf-8');
   }else if(action==='rehearse'&&!ui.rehearsing){
    ui.rehearsing=true;render();
    try{ui.rehearsal=await api('desk/rehearsal',{});}
    finally{ui.rehearsing=false;if(state.page==='desk')render();}
   }
  }catch(error){toast(error.message);}
 });
 document.addEventListener('submit',async e=>{
  const form=e.target,action=form.dataset.deskForm;
  if(!action)return;
  e.preventDefault();
  const values=Object.fromEntries(new FormData(form)),button=form.querySelector('[type=submit]');
  if(session.readOnly||button.disabled)return;
  button.disabled=true;
  try{
   if(action==='assets'){await checkAssets(form);return;}
   if(values.version)values.version=Number(values.version);
   if(action==='hold')values.active=values.active==='true';
   const result=await api('desk/'+action,values);
   if(action==='inbox'||action==='comments'){await loadInbox();toast(action==='comments'?result.received+'건의 댓글을 확인했습니다.':'처리 상태와 초안을 저장했습니다.');return;}
   data=action==='hold'||action==='brand'?result:await api('state');
   if(state.page==='desk')render();
   toast(action==='link'?'추적 링크를 만들었습니다.':action==='traffic'?'유입 조회 결과를 갱신했습니다.':'저장했습니다.');
  }catch(error){toast(error.message);}
  finally{button.disabled=false;}
 });
 return {render:renderDesk,brandFields,preset,hold,approvalComparison,siteStatus};
})();
