'use strict';

window.NuriOperator = (() => {
 const auditLabels = {
  'content.instagram_approved': 'Instagram 게시를 승인했습니다',
  'content.youtube_approved': 'YouTube 영상 공개를 승인했습니다',
  'content.youtube_reconciled': 'YouTube 공개 결과를 확인했습니다',
  'content.youtube_paused': 'YouTube 공개 예약을 일시정지했습니다',
  'content.instagram_paused': 'Instagram 예약을 일시정지했습니다',
  'content.cancelled': '게시 예약을 취소했습니다',
  'content.published': '채널에 게시를 완료했습니다',
  'content.preflight_review': '게시 조건 확인이 필요합니다',
  'content.publish_review': '채널에서 게시 결과를 확인해야 합니다',
  'content.sample_published': '샘플 게시를 완료했습니다',
 };
 const filters={channel:'all',account:'all',status:'all'};
 const attemptLabels={connection:'재연결 필요',approval:'재승인 필요',preflight:'게시 조건 확인',uncertain:'게시 결과 확인 필요',processing:'미디어 처리 중'};
 const diagnostics=p=>attemptLabels[p.attempt?.code]||(p.status==='scheduled'&&!p.approval?'재승인 필요':
  p.status==='scheduled'&&Date.parse(p.scheduledAt)<Date.now()-5*60000?'예약 지연':'');
 const readyAccounts=()=>data.accounts.filter(a=>snsRecord(a)&&['instagram','youtube'].includes(a.channel));
 const needsConnection=()=>['instagram','youtube'].filter(channel=>!readyAccounts().some(a=>a.channel===channel&&a.verifiedAt&&!a.connectionError));
 const info=id=>(data.snsFollowups||[]).find(row=>row.id===id);
 const preparationMessage={ready:'영상 처리와 원고 대조 완료',processing:'YouTube에서 영상 처리 중',metadata:'원고 대조 필요',privacy:'공개 상태 확인 필요',account:'채널 확인 필요',failed:'영상 처리 실패',unavailable:'처리 상태 조회 지연'};
 const readinessFields={approved:'검토 확인',checked:'기존 게시 여부',account:'게시 계정',at:'예약 시각',media:'공개 이미지 또는 릴스 주소',videoUrl:'릴스 영상 주소',altText:'이미지 대체 텍스트',youtubeVideoId:'비공개 영상',youtubeMadeForKids:'아동용 콘텐츠',youtubeSynthetic:'변경·합성 콘텐츠',title:'제목',body:'본문·설명'};
 const timelineLabels={created:'초안 작성',edited:'원고 수정',restored:'원고 또는 게시 기록 복원',approved:'게시 승인',scheduled:'예약 등록',paused:'예약 일시정지',cancelled:'예약 취소',attempt:'채널 게시 시도',response:'채널 응답',confirmed:'공개 확인',excluded:'플랫폼 삭제로 제외'};
 const timelineOutcomes={published:'게시 ID 수신',registered:'직접 게시 주소 등록',sending:'제공자에 요청',processing:'미디어 처리 중',uncertain:'게시 결과 확인 필요',connection:'계정 연결 확인 필요',preflight:'게시 조건 확인 필요',approval:'재승인 필요',visible:'공개 게시 확인',missing:'게시물 없음',unavailable:'조회 불가','not-listed':'공개 상태 미확인',sample:'샘플 응답'};
 const readinessRequests=new WeakMap();
 const supported = p => snsPost(p) && requiresApproval(p);
 const channelName = p => p.channel==='youtube'?'YouTube':'Instagram';
 const mediaReady = p => p.channel==='youtube'?!!p.youtubeVideoId&&typeof p.youtubeMadeForKids==='boolean'&&typeof p.youtubeSynthetic==='boolean':!!webLink(p.videoUrl||p.media);
 const waiting = p => ['draft', 'approved', 'review'].includes(p.status) ||
  p.status === 'scheduled' && !p.approval;
 const dateField = at => at && Date.parse(at) > Date.now()
  ? new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 16)
  : '';
 const accountName = account => account?.username ? account.label + ' · ' + (account.channel==='youtube'?'':'@') + account.username : account?.label;
 const pagesToOpen = [
  ['approval', '게시 승인함', '승인 예약 일시정지 인스타그램 유튜브 게시'],
  ['desk','운영 도구','예약 중지 브랜드 문의 유입 주간 보고'],
  ['studio', '콘텐츠 작업실', '새 카드뉴스 생성 작성 초안 만들기'],
  ['calendar', '게시 캘린더', '일정 달력 스케줄'],
  ['overview', '업무 대시보드', '전체 현황 홈 요약'],
  ['websites', '웹사이트별 현황', '사이트 연결 갱신 유저'],
  ['market-operations', '쇼핑몰 운영', '누리마켓 주문 배송 환불'],
  ['connections', '설정 · 계정 연결', '연동 계정 설정'],
  ['partners', '거래처', '거래처 이름 검색'],
 ];

 function scheduleForm(post) {
  const accounts = data.accounts.filter(a => accountFits(a, post) && a.verifiedAt && !a.connectionError && !NuriDesk.hold(a.id)?.active);
  const ready = mediaReady(post);
  const channel = channelName(post);
  const accountOptions = accounts.map(account => [account.id, accountName(account)]);
  return `<form class="schedule-form approval-form form-grid" data-id="${esc(post.id)}">
   <input type="hidden" name="version" value="${post.version ?? 1}">
   ${selectField('게시 계정', 'account', [['', '게시 계정 선택'], ...accountOptions], post.account||post.youtubeCheck?.account||NuriDesk.preset(post.brand)?.[post.channel])}
   ${formField('게시 시각 · 한국 시간', 'at', dateField(post.scheduledAt), 'datetime-local', 'required')}
   <div class="full desk-reservation-warning" data-desk-conflicts aria-live="polite"></div>
   ${post.uncertain || post.status === 'review' && !['preflight','connection'].includes(post.attempt?.code) ? `<div class="full">${checkbox(channel+'에서 기존 게시물이 없음을 확인했습니다.', 'checked')}</div>` : ''}
   <label class="check-label full"><input type="checkbox" name="approved" required>위 원고와 미디어, 선택한 계정과 시각을 확인했습니다.</label>
   <div class="approval-readiness full" data-approval-readiness></div>
   <div class="full"><button class="btn primary" type="submit" ${!accounts.length || !ready ? 'disabled' : ''}>${post.status === 'paused' ? '다시 승인하고 예약' : '승인하고 예약'}</button></div>
   ${!accounts.length ? '<p class="caption full">설정에서 '+channel+' 계정을 연결하고 확인하세요.</p>' : ''}
   ${!data.demo&&post.channel==='youtube'&&post.youtubeVideoId&&accounts.length&&['draft','paused','approved'].includes(post.status)?`<div class="full"><button class="btn" type="button" data-action="youtube-track" data-id="${esc(post.id)}">선택 채널로 처리 상태 확인</button></div>`:''}
   ${!ready ? '<p class="caption full">'+(post.channel==='youtube'?'원고에 비공개 영상과 공개 설정을 등록하세요.':'원고에 공개 사진 또는 릴스 주소를 추가하세요.')+'</p>' : ''}
  </form>`;
 }

 function readinessItem(item){
  const field=esc(readinessFields[item.field]||'게시 조건');
  const label={edit:'필드 수정',field:'입력으로 이동',connections:'계정 연결',schedule:'예약 관리',studio:'Studio 확인',track:'채널 조회'}[item.action];
  return `<li><span><strong>${field}</strong><span>${esc(item.reason)}</span></span>${label?`<button class="btn" type="button" data-readiness-action="${esc(item.action)}" data-field="${esc(item.field)}">${label}</button>`:''}</li>`;
 }

 async function loadReadiness(form){
  const target=form.querySelector('[data-approval-readiness]');
  if(!target)return;
  const request={};
  readinessRequests.set(form,request);
  target.setAttribute('aria-busy','true');
  const time=Date.parse(form.elements.at.value+'+09:00');
  const values={id:form.dataset.id,version:Number(form.elements.version.value),account:form.elements.account.value,
   at:Number.isFinite(time)?new Date(time).toISOString():'',approved:form.elements.approved.checked,checked:form.elements.checked?.checked===true};
  if(!target.hasChildNodes())target.innerHTML='<p class="caption" role="status">예약 조건을 확인하고 있습니다.</p>';
  try{
   const result=await api('content/readiness',values);
   if(!form.isConnected||readinessRequests.get(form)!==request)return;
   const items=[...result.issues,...result.warnings];
   target.innerHTML=`<p class="caption" role="status">${result.ready?(items.length?'입력 조건 충족 · 채널 확인 사항':'예약 조건을 충족했습니다.'):`예약 전 확인 ${result.issues.length}개`}</p>${items.length?`<ul>${items.map(readinessItem).join('')}</ul>`:''}`;
  }catch(error){
   if(form.isConnected&&readinessRequests.get(form)===request)target.innerHTML=`<p class="caption" role="status">${esc(error.message)}</p><button type="button" class="btn" data-readiness-action="retry">조건 다시 확인</button>`;
  }finally{if(readinessRequests.get(form)===request)target.removeAttribute('aria-busy');}
 }

 function focusEditor(form,field){
  const edit=form.closest('.approval-card').querySelector('[data-action="content-edit"]');
  if(!edit)return;
  const workspace=document.getElementById('content');
  const observer=new MutationObserver(()=>{
   const editor=document.getElementById('content-form');
   if(editor?.elements.id.value!==form.dataset.id)return;
   observer.disconnect();
   editor.elements.namedItem(field)?.focus();
  });
  if(workspace)observer.observe(workspace,{childList:true,subtree:true});
  setTimeout(()=>observer.disconnect(),2000);
  edit.click();
 }

 async function loadTimeline(details){
  const body=details.querySelector('[data-timeline-body]');
  if(!body||body.dataset.loaded)return;
  body.dataset.loaded='true';
  body.innerHTML='<p class="caption" role="status">게시 기록을 조회하고 있습니다.</p>';
  try{
   const {events}=await api('content/timeline',{id:details.dataset.approvalTimeline});
   body.innerHTML=events.length?`<ol>${events.map(event=>{
    const account=data.accounts.find(a=>a.id===event.accountId);
    const meta=[event.actor,event.provider&&labels[event.provider],accountName(account)||event.accountId,event.scheduledAt&&'예약 '+dt(event.scheduledAt)+' KST',event.version&&'버전 '+event.version,event.externalId&&'게시 ID '+event.externalId].filter(Boolean);
    return `<li><strong>${esc(timelineLabels[event.type]||'기록')}</strong><time class="caption" datetime="${esc(event.at)}">${esc(dt(event.at))} KST</time>${meta.length?`<span class="caption">${meta.map(esc).join(' · ')}</span>`:''}${Object.hasOwn(timelineOutcomes,event.outcome)?`<span>${timelineOutcomes[event.outcome]}</span>`:''}</li>`;
   }).join('')}</ol>`:empty('기록된 게시 이력이 없습니다.');
  }catch(error){
   delete body.dataset.loaded;
   body.innerHTML=`<p class="caption" role="status">${esc(error.message)}</p><button type="button" class="btn" data-timeline-retry>이력 다시 확인</button>`;
  }
 }

 function contentControl(post) {
  return `<button type="button" class="btn" data-page="approval" data-approval-id="${esc(post.id)}">${post.status === 'scheduled' && post.approval ? '예약 관리' : '승인함에서 검토'}</button>`;
 }

 function card(post) {
  const account = data.accounts.find(a => a.id === post.account);
  const media = [post.media, ...(post.slides || [])].map(webLink).filter(Boolean);
  const isYouTube=post.channel==='youtube',channel=channelName(post);
  const video=isYouTube&&/^[A-Za-z0-9_-]{11}$/.test(post.youtubeVideoId||'')
   ? 'https://studio.youtube.com/video/'+post.youtubeVideoId+'/edit' : webLink(post.videoUrl);
  const yesNo=value=>value===true?'예':value===false?'아니요':'미입력';
  const status=diagnostics(post)||statusLabels[post.status];
  const published=post.status==='published';
  const followup=info(post.id),prep=followup?.preparation;
  const ownerCheck=post.youtubeCheck&&['draft','approved','paused'].includes(post.status);
  const permalink=published&&webLink(post.link||followup?.publication?.link);
  const actions = session.readOnly ? '' : (post.status === 'scheduled' && post.approval ? button('일시정지', 'pause', post.id) : '')
   + (['paused', 'scheduled'].includes(post.status) ? button('예약 취소', 'cancel', post.id) : '')
   + (isYouTube && post.status==='review' && post.uncertain ? button('YouTube 공개 여부 확인', 'youtube-reconcile', post.id) : '')
   + (post.attempt?.code==='connection' ? button('계정 연결 확인','sns-settings') : '')
   + (published&&!permalink&&post.externalId ? button('게시 주소 다시 확인','check-post',post.id) : '')
   + (!published&&post.status!=='publishing' ? button('원고 수정', 'content-edit', post.id) : '');
  const showForm = !session.readOnly && (waiting(post) || post.status === 'paused');
  return `<article class="approval-card" id="approval-${esc(post.id)}">
   <div class="approval-card-head">
    <div><span class="caption">${channel}${account ? ' · ' + esc(accountName(account)) : ''}</span><h3>${esc(post.title)}</h3></div>
    <span class="approval-state ${waiting(post)||diagnostics(post) ? 'needs-review' : ''}">${esc(status)}</span>
   </div>
   <p class="caption">${post.status === 'publishing' ? channel+' 응답을 기다리는 중입니다.' : published&&post.publishedAt ? '게시 '+dt(post.publishedAt)+' KST' : post.scheduledAt ? '예약 '+dt(post.scheduledAt) + ' KST' : '게시 계정과 일정을 선택해 주세요.'}${post.approval ? ' · 승인 ' + dt(post.approval.at) : ''}</p>
   ${post.attempt?.at ? `<p class="caption">마지막 기록 <time datetime="${esc(post.attempt.at)}">${dt(post.attempt.at)} KST</time></p>` : ''}
   ${ownerCheck?`<p class="caption" role="status">${esc(preparationMessage[prep?.state]||'처리 상태 조회 대기')}${prep?.checkedAt?' · '+esc(dt(prep.checkedAt))+' KST':''}${prep?.message?' · '+esc(prep.message):''}</p>`:''}
   ${published&&post.checkStatus==='visible'?`<p class="caption">채널 조회로 게시 확인 · ${esc(dt(post.checkedAt))} KST</p>`:''}
   ${published&&!post.manual&&followup?.publication?.state&&followup.publication.state!=='visible'?'<p class="caption">채널의 공개 결과를 확인하는 중입니다.</p>':''}
   ${post.accountPaused&&post.status==='paused'?'<p class="warning">계정 일시정지로 해제된 예약입니다. 새 시각과 원고를 다시 승인하세요.</p>':''}
   ${session.readOnly?'':NuriDesk.approvalComparison(post)}
   ${post.error ? `<p class="warning">${esc(post.error)}</p>` : ''}
   <details class="approval-preview">
    <summary>원고와 미디어 보기</summary>
    <p class="approval-caption">${esc(post.body)}</p>
    ${video?`<p><a class="btn" href="${esc(video)}" target="_blank" rel="noopener noreferrer">${isYouTube?'YouTube Studio에서 영상 확인':'릴스 영상 확인'}</a></p>`:''}
    ${isYouTube?`<p class="caption">아동용 ${yesNo(post.youtubeMadeForKids)} · 변경·합성 ${yesNo(post.youtubeSynthetic)}</p>`:''}
    ${post.altText?`<p class="caption">이미지 대체 텍스트 · ${esc(post.altText)}</p>`:''}
    ${media.length ? `<div class="approval-media">${media.map((url, i) => `<a class="approval-image" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" alt="게시 이미지 ${i + 1}">${i + 1}번 이미지 ↗</a>`).join('')}</div>` : ''}
    ${showForm ? scheduleForm(post) : ''}
   </details>
   ${session.readOnly?'':`<details class="approval-timeline" data-approval-timeline="${esc(post.id)}"><summary>이 게시물의 진행 이력</summary><div data-timeline-body></div></details>`}
   ${actions||permalink ? `<div class="toolbar">${permalink?`<a class="btn" href="${esc(permalink)}" target="_blank" rel="noopener noreferrer">게시물 열기 ↗</a>`:''}${actions}</div>` : ''}
  </article>`;
 }

 function pendingCount() {
  return data.contents.filter(p=>supported(p)&&waiting(p)&&p.status!=='review'&&!diagnostics(p)).length;
 }

 function attentionCount(){
  return data.contents.filter(p=>supported(p)&&['review','scheduled'].includes(p.status)&&!p.externalId&&(p.status==='review'||!!diagnostics(p)&&p.attempt?.code!=='processing')).length;
 }

 function setFilter(name,value){
  if(name==='channel')filters.account='all';
  if(Object.hasOwn(filters,name))filters[name]=value;
 }

 function renderApproval() {
  const accounts=readyAccounts().filter(a=>filters.channel==='all'||a.channel===filters.channel);
  if(!accounts.some(a=>a.id===filters.account))filters.account='all';
  const posts=data.contents.filter(p=>supported(p)&&(!window.NuriDaily||window.NuriDaily.matchesBrand(p)||window.NuriDaily.reveals(p.id))&&(filters.channel==='all'||p.channel===filters.channel)&&(filters.account==='all'||p.account===filters.account));
  const titles = new Map(posts.map(p => [p.id, p.title]));
  const sections=[
   ['pending','검토 대기',p=>waiting(p)&&p.status!=='review'&&!diagnostics(p),'승인할 원고가 없습니다.'],
   ['issues','확인 필요',p=>p.status==='review'||p.status==='scheduled'&&diagnostics(p)&&p.attempt?.code!=='processing','확인이 필요한 예약이 없습니다.'],
   ['scheduled','예약과 실행',p=>['scheduled','paused','publishing'].includes(p.status)&&(!diagnostics(p)||p.attempt?.code==='processing'),'진행 중인 예약이 없습니다.'],
   ['published','게시 완료',p=>p.status==='published','게시 완료 기록이 없습니다.'],
  ];
  const audit = data.audit.filter(event => titles.has(event.target) && auditLabels[event.action]).slice(0, 8);
  return `<div class="approval-filters" role="group" aria-label="승인함 필터">
    ${selectField('채널','approval-channel',[['all','모든 채널'],['instagram','Instagram'],['youtube','YouTube']],filters.channel)}
    ${selectField('게시 계정','approval-account',[['all','모든 계정'],...accounts.map(a=>[a.id,accountName(a)])],filters.account)}
    ${selectField('상태','approval-status',[['all','모든 상태'],...sections.map(([key,label])=>[key,label])],filters.status)}
   </div><div class="approval-layout">${sections.filter(([key])=>filters.status==='all'||filters.status===key).map(([key,label,test,blank])=>{
    const matches=posts.filter(test);
    if(key==='published')matches.sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
    return `<section class="panel approval-section"><h2>${label}</h2>${(key==='published'&&filters.status==='all'?matches.slice(0,5):matches).map(card).join('')||empty(blank)}${key==='published'&&filters.status==='all'&&matches.length>5?'<button type="button" class="btn" data-approval-filter="published">게시 기록 전체 보기</button>':''}</section>`;
   }).join('')}${session.readOnly||filters.status!=='all' ? '' : `<section class="panel approval-section approval-history">
    <h2>최근 게시 활동</h2>${audit.length ? `<ol>${audit.map(event => `<li><time datetime="${esc(event.at)}">${dt(event.at)} KST</time><span><strong>${esc(titles.get(event.target))}</strong><span>${auditLabels[event.action]}</span></span></li>`).join('')}</ol>` : empty('기록된 게시 활동이 없습니다.')}
   </section>`}</div>`;
 }

 function reveal(id) {
  let article=document.getElementById('approval-'+id);
  if(!article&&data.contents.some(post=>post.id===id&&supported(post))){
   resetFilters();
   filters.status=data.contents.find(post=>post.id===id)?.status==='published'?'published':'all';
   render();
   article=document.getElementById('approval-'+id);
  }
  if (!article) return;
  const details = article.querySelector('.approval-preview');
  details.open = true;
  details.querySelector('summary').focus();
  article.scrollIntoView({block:'nearest'});
 }

 function pushPanel() {
  if (!session?.pushPublicKey || !('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return '';
  return `<section class="panel panel-inner section-gap">
   <h2>이 기기의 게시 알림</h2>
   <p class="panel-desc">예약 지연, 계정 연결, 게시 결과 확인이 필요한 경우 알려드립니다.</p>
   <label class="check-label"><input type="checkbox" id="device-regular-activity">일반 Instagram 활동도 받기</label>
   ${window.NuriDaily?.pushFields()||''}
   <div class="toolbar"><button type="button" class="btn" data-device-push="connect">알림 받기</button><button type="button" class="btn" data-device-push="disconnect">알림 끄기</button></div>
   <p class="caption" id="device-push-status" role="status"></p>
  </section>`;
 }

 async function disconnectPush() {
  if (!session?.pushPublicKey || !('serviceWorker' in navigator)) return;
  const worker=await navigator.serviceWorker.getRegistration('/dashboard');
  const subscription=await worker?.pushManager.getSubscription();
  if (!subscription) return;
  await subscription.unsubscribe();
  await api('push/subscription',{enabled:false,subscription:{endpoint:subscription.endpoint}});
 }

 async function changePush(button) {
  const status=document.getElementById('device-push-status');
  button.disabled=true;
  try {
   if (button.dataset.devicePush==='disconnect') {
    await disconnectPush();
    if(window.NuriDaily)window.NuriDaily.pushSettings=null;
    status.textContent='이 기기의 알림을 껐습니다.';
    return;
   }
   if (!navigator.onLine) throw Error('인터넷에 연결한 뒤 시도해주세요.');
   if (await Notification.requestPermission()!=='granted') throw Error('브라우저에서 알림 권한을 허용해주세요.');
   const worker=await navigator.serviceWorker.getRegistration('/dashboard');
   if (!worker?.active) throw Error('페이지를 새로 열고 다시 시도해주세요.');
   const encoded=session.pushPublicKey.replace(/-/g,'+').replace(/_/g,'/');
   const applicationServerKey=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0));
   const saved=await worker.pushManager.getSubscription();
   const subscription=saved||await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey});
   const activity=document.getElementById('device-regular-activity')?.checked===true;
   const settings=window.NuriDaily?.pushOptions()||{};
   try {await api('push/subscription',{enabled:true,activity,...settings,subscription:subscription.toJSON()});}
   catch (error) {if(!saved)await subscription.unsubscribe().catch(()=>{});throw error;}
   if(window.NuriDaily)window.NuriDaily.pushSettings={active:true,activity,...settings};
   status.textContent='이 기기의 게시 알림 설정을 저장했습니다.';
  } catch (error) {
   status.textContent=error.message||'이 기기에서 알림을 설정하지 못했습니다.';
  } finally {button.disabled=false;}
 }

 function resetFilters(){
  Object.assign(filters,{channel:'all',account:'all',status:'all'});
 }

 function renderDashboardFilter(name){
  window.requestAnimationFrame(()=>{
   render();
   document.querySelector('.approval-filters [name="'+name+'"]')?.focus({preventScroll:true});
  });
 }

 function init() {
  document.addEventListener('toggle',e=>{
   if(!e.target.open)return;
   if(e.target.matches('.approval-preview')){
    const form=e.target.querySelector('.approval-form');
    if(form)void loadReadiness(form);
   }
   if(e.target.matches('[data-approval-timeline]'))void loadTimeline(e.target);
  },true);
  document.addEventListener('change',e=>{
   const form=e.target.closest('.approval-form');
   if(form&&['account','at','approved','checked'].includes(e.target.name))void loadReadiness(form);
  });
  document.addEventListener('click',e=>{
   const retry=e.target.closest('[data-timeline-retry]');
   if(retry){void loadTimeline(retry.closest('[data-approval-timeline]'));return;}
   const control=e.target.closest('[data-readiness-action]');
   if(!control)return;
   const form=control.closest('.approval-form'),field=control.dataset.field;
   switch(control.dataset.readinessAction){
    case 'retry':void loadReadiness(form);break;
    case 'field':form.elements.namedItem(field)?.focus();break;
    case 'edit':focusEditor(form,field);break;
    case 'connections': state.setupTab='integrations';navigate('connections');break;
    case 'schedule':NuriDesk.goTo('schedule');break;
    case 'studio':form.closest('.approval-preview').querySelector('a[href^="https://studio.youtube.com/video/"]')?.click();break;
    case 'track':{
     const track=form.querySelector('[data-action="youtube-track"]');
     if(track&&form.elements.account.value)track.click();else form.elements.account.focus();
     break;
    }
   }
  });
  document.addEventListener('change',e=>{
   const match=/^approval-(channel|account|status)$/.exec(e.target.name||'');
   if(!match)return;
   setFilter(match[1],e.target.value);
   renderDashboardFilter(e.target.name);
  });
  document.addEventListener('click',e=>{
   const control=e.target.closest('[data-approval-filter]');
   if(!control)return;
   setFilter('status',control.dataset.approvalFilter);
   if(state.page==='approval')renderDashboardFilter('approval-status');
   else navigate('approval');
  });
  const palette = document.getElementById('command-palette');
  const query = document.getElementById('command-query');
  const results = document.getElementById('command-results');
  const update = () => {
   const tokens = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
   const matches = pagesToOpen.filter(([page, label, aliases]) => (page!=='market-operations'||session?.owner)&&tokens.every(token => (label + ' ' + aliases).toLowerCase().includes(token)));
   results.innerHTML = matches.map(([page, label]) => `<li><button type="button" data-command="${page}">${label}</button></li>`).join('')
    || '<li class="caption" role="status">검색 결과가 없습니다.</li>';
  };
  const open = () => {
   if (palette.open || !data) return;
   query.value = '';
   update();
   palette.showModal();
   query.focus();
  };
  query.addEventListener('input', update);
  query.addEventListener('keydown', e => {
   if (e.key === 'Enter' || e.key === 'ArrowDown') {
    e.preventDefault();
    const first = results.querySelector('button');
    if (e.key === 'Enter') first?.click();
    else first?.focus();
   }
  });
  results.addEventListener('click', e => {
   const button = e.target.closest('[data-command]');
   if (!button) return;
   palette.close();
   navigate(button.dataset.command);
  });
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (typeof SpeechRecognition?.available === 'function' && 'processLocally' in SpeechRecognition.prototype) {
   const voice = document.getElementById('command-voice');
   const status = document.getElementById('command-voice-status');
   let recognition;
   document.getElementById('command-voice-controls').hidden = false;
   voice.addEventListener('click', async () => {
    voice.disabled = true;
    status.textContent = '기기의 한국어 인식 지원을 확인하는 중입니다.';
    try {
     const available = await SpeechRecognition.available({langs:['ko-KR'],processLocally:true});
     if (!palette.open) { voice.disabled = false; return; }
     if (available !== 'available') {
      status.textContent = '기기에 한국어 음성 인식이 준비되면 사용할 수 있습니다.';
      voice.disabled = false;
      return;
     }
     recognition = new SpeechRecognition();
     recognition.lang = 'ko-KR';
     recognition.processLocally = true;
     recognition.onstart = () => { status.textContent = '듣는 중입니다.'; };
     recognition.onresult = e => {
      query.value = e.results[0][0].transcript;
      update();
      query.focus();
      status.textContent = '';
     };
     recognition.onerror = () => { status.textContent = '음성을 인식하지 못했습니다. 입력창에 검색어를 적어주세요.'; };
     recognition.onend = () => {
      if (status.textContent === '듣는 중입니다.') status.textContent = '';
      voice.disabled = false;
      recognition = undefined;
     };
     recognition.start();
    } catch {
     status.textContent = '음성 검색을 시작하지 못했습니다.';
     voice.disabled = false;
    }
   });
   palette.addEventListener('close', () => recognition?.abort());
  }
  document.getElementById('command-open').addEventListener('click', open);
  document.getElementById('command-close').addEventListener('click', () => palette.close());
  document.addEventListener('keydown', e => {
   if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.getElementById('post-inspector').open && !document.getElementById('sidebar').classList.contains('open')) {
    e.preventDefault();
    open();
   }
  });

  document.addEventListener('click',e=>{
   const button=e.target.closest('[data-device-push]');
   if(button&&!button.disabled)void changePush(button);
  });
  const offline = document.getElementById('operator-offline');
  const connection = () => {
   offline.hidden = navigator.onLine;
   document.body.classList.toggle('operator-offline', !navigator.onLine);
  };
  window.addEventListener('offline', connection);
  window.addEventListener('online', connection);
  connection();
  if ('serviceWorker' in navigator && !location.search) navigator.serviceWorker.register('/one/operator-sw.js', {scope:'/dashboard'}).catch(() => {});
 }

 function performance(){
  const posts=new Map(data.contents.filter(p=>supported(p)&&p.status==='published'&&kstMonth(p.publishedAt)===state.month).map(p=>[p.id,p]));
  const rows=[];
  for(const [id,p] of posts){
   const measurements=info(id)?.metrics;
   if(!measurements?.length)continue;
   for(const m of measurements){
    const sample=m.sample;
    const stateLabel={observed:'수집 완료',upcoming:'수집 예정',due:'수집 대기',missed:'조회 가능 시간 경과'}[m.state];
    const note=sample?.reason==='permission'?'성과 권한 확인 필요':sample?.reason==='watch-pending'?'시청 지표 집계 대기':sample?.reason==='unavailable'?'채널 응답 미확인':'';
    const watch=sample?.averageWatchSeconds!=null?money(sample.averageWatchSeconds)+'초 · '+esc(sample.watchDay)+' (미국 태평양 시간)':'—';
    const title=esc(p.title);
    rows.push(row([channelName(p),title,m.hours===24?'24시간':'7일',stateLabel+(note?`<small class="row-note">${note}</small>`:''),money(sample?.views),money(sample?.reach),watch,sample?.observedAt?dt(sample.observedAt)+' KST':'—']));
   }
  }
  return `<section class="panel studio-tools section-gap"><h2>게시물 자동 성과</h2><p class="caption">24시간·7일 경과 후 조회한 누적 값입니다. 날짜가 표시된 YouTube 평균 시청 시간은 해당 날짜 집계입니다.</p>
  ${rows.length?table(['채널','게시물','경과','상태','누적 조회','누적 도달','평균 시청','수집 시각'],rows):empty('연결한 채널의 공개 게시물이 생기면 성과를 수집합니다.')}</section>`;
 }
 return {render:renderApproval,performance, pendingCount, attentionCount, needsConnection, resetFilters, diagnostics, contentControl, reveal, init, pushPanel, disconnectPush};
})();
