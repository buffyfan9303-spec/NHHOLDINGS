'use strict';

window.NuriOperator = (() => {
 const auditLabels = {
  'content.instagram_approved': 'Instagram 게시를 승인했습니다',
  'content.instagram_paused': 'Instagram 예약을 일시정지했습니다',
  'content.cancelled': '게시 예약을 취소했습니다',
  'content.published': '채널에 게시를 완료했습니다',
  'content.publish_review': '채널에서 게시 결과를 확인해야 합니다',
  'content.sample_published': '샘플 게시를 완료했습니다',
 };
 const instagram = p => snsPost(p) && p.channel === 'instagram';
 const waiting = p => ['draft', 'approved', 'review'].includes(p.status) ||
  p.status === 'scheduled' && !p.approval;
 const dateField = at => at && Date.parse(at) > Date.now()
  ? new Date(Date.parse(at) + 9 * 3600000).toISOString().slice(0, 16)
  : '';
 const accountName = account => account?.username ? account.label + ' · @' + account.username : account?.label;
 const pagesToOpen = [
  ['approval', '게시 승인함', '승인 예약 일시정지 인스타그램 게시'],
  ['studio', '콘텐츠 작업실', '새 카드뉴스 생성 작성 초안 만들기'],
  ['calendar', '게시 캘린더', '일정 달력 스케줄'],
  ['overview', '전체 현황', '대시보드 홈 요약'],
  ['connections', '설정 · 계정 연결', '연동 계정 설정'],
  ['partners', '거래처', '거래처 이름 검색'],
 ];

 function scheduleForm(post) {
  const accounts = data.accounts.filter(a => accountFits(a, post) && a.verifiedAt);
  const media = webLink(post.media);
  const accountOptions = accounts.map(account => [account.id, accountName(account)]);
  return `<form class="schedule-form approval-form form-grid" data-id="${esc(post.id)}">
   <input type="hidden" name="version" value="${post.version ?? 1}">
   ${selectField('게시 계정', 'account', [['', '게시 계정 선택'], ...accountOptions], post.account)}
   ${formField('게시 시각 · 한국 시간', 'at', dateField(post.scheduledAt), 'datetime-local', 'required')}
   ${post.uncertain || post.status === 'review' ? `<div class="full">${checkbox('Instagram에서 기존 게시물이 없음을 확인했습니다.', 'checked')}</div>` : ''}
   <label class="check-label full"><input type="checkbox" name="approved" required>위 원고와 이미지, 선택한 계정과 시각을 확인했습니다.</label>
   <div class="full"><button class="btn primary" type="submit" ${!accounts.length || !media ? 'disabled' : ''}>${post.status === 'paused' ? '다시 승인하고 예약' : '승인하고 예약'}</button></div>
   ${!accounts.length ? '<p class="caption full">설정에서 Instagram 계정을 연결하고 확인하세요.</p>' : ''}
   ${!media ? '<p class="caption full">원고에 공개 이미지 주소를 추가해야 승인할 수 있습니다.</p>' : ''}
  </form>`;
 }

 function contentControl(post) {
  return `<button class="btn" data-page="approval" data-approval-id="${esc(post.id)}">${post.status === 'scheduled' && post.approval ? '예약 관리' : '승인함에서 검토'}</button>`;
 }

 function card(post) {
  const account = data.accounts.find(a => a.id === post.account);
  const media = [post.media, ...(post.slides || [])].map(webLink).filter(Boolean);
  const status = post.status === 'scheduled' && !post.approval ? '재승인 필요' : statusLabels[post.status];
  const actions = session.readOnly ? '' : (post.status === 'scheduled' && post.approval ? button('일시정지', 'pause', post.id) : '')
   + (['paused', 'scheduled'].includes(post.status) ? button('예약 취소', 'cancel', post.id) : '')
   + (post.status !== 'publishing' ? button('원고 수정', 'content-edit', post.id) : '');
  const showForm = !session.readOnly && (waiting(post) || post.status === 'paused');
  return `<article class="approval-card" id="approval-${esc(post.id)}">
   <div class="approval-card-head">
    <div><span class="caption">Instagram${account ? ' · ' + esc(accountName(account)) : ''}</span><h3>${esc(post.title)}</h3></div>
    <span class="approval-state ${waiting(post) ? 'needs-review' : ''}">${esc(status)}</span>
   </div>
   <p class="caption">${post.status === 'publishing' ? 'Instagram 응답을 기다리는 중입니다.' : post.scheduledAt ? dt(post.scheduledAt) + ' KST' : '게시 계정과 일정을 선택해 주세요.'}${post.approval ? ' · 승인 ' + dt(post.approval.at) : ''}</p>
   ${post.error ? `<p class="warning">${esc(post.error)}</p>` : ''}
   <details class="approval-preview">
    <summary>원고와 이미지 보기</summary>
    <p class="approval-caption">${esc(post.body)}</p>
    ${media.length ? `<div class="approval-media">${media.map((url, i) => `<a class="approval-image" href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(url)}" loading="lazy" referrerpolicy="no-referrer" alt="게시 이미지 ${i + 1}">${i + 1}번 이미지 ↗</a>`).join('')}</div>` : ''}
    ${showForm ? scheduleForm(post) : ''}
   </details>
   ${actions ? `<div class="toolbar">${actions}</div>` : ''}
  </article>`;
 }

 function summary() {
  const pending = data.contents.filter(p => instagram(p) && waiting(p)).length;
  return `<section class="panel approval-summary" aria-label="게시 승인함">
   <div><p class="caption">Instagram 게시 승인</p><h2>검토할 원고 ${pending.toLocaleString('ko-KR')}건</h2></div>
   <button class="btn" data-page="approval">승인함 열기 ${icon('arrow')}</button>
  </section>`;
 }

 function render() {
  const posts = data.contents.filter(instagram);
  const titles = new Map(posts.map(p => [p.id, p.title]));
  const ongoing = posts.filter(p => ['scheduled', 'paused', 'publishing'].includes(p.status) && !waiting(p));
  const audit = data.audit.filter(event => titles.has(event.target) && auditLabels[event.action]).slice(0, 8);
  return `<div class="approval-layout"><section class="panel approval-section">
    <h2>검토 대기</h2>${posts.filter(waiting).map(card).join('') || empty('승인할 원고가 없습니다.')}
   </section><section class="panel approval-section">
    <h2>예약과 실행</h2>${ongoing.map(card).join('') || empty('진행 중인 예약이 없습니다.')}
   </section>${session.readOnly ? '' : `<section class="panel approval-section approval-history">
    <h2>최근 게시 활동</h2>${audit.length ? `<ol>${audit.map(event => `<li><time datetime="${esc(event.at)}">${dt(event.at)} KST</time><span><strong>${esc(titles.get(event.target))}</strong><span>${auditLabels[event.action]}</span></span></li>`).join('')}</ol>` : empty('기록된 게시 활동이 없습니다.')}
   </section>`}</div>`;
 }

 function reveal(id) {
  const article = document.getElementById('approval-' + id);
  if (!article) return;
  const details = article.querySelector('details');
  details.open = true;
  details.querySelector('summary').focus();
  article.scrollIntoView({block:'nearest'});
 }

 function pushPanel() {
  if (!session?.pushPublicKey || !('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) return '';
  return `<section class="panel panel-inner section-gap">
   <h2>이 기기의 게시 알림</h2>
   <p class="panel-desc">Instagram 승인함의 새 활동을 알림으로 받을 수 있습니다.</p>
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
   try {await api('push/subscription',{enabled:true,subscription:subscription.toJSON()});}
   catch (error) {if(!saved)await subscription.unsubscribe().catch(()=>{});throw error;}
   status.textContent='이 기기의 게시 알림을 켰습니다.';
  } catch (error) {
   status.textContent=error.message||'이 기기에서 알림을 설정하지 못했습니다.';
  } finally {button.disabled=false;}
 }

 function init() {
  const palette = document.getElementById('command-palette');
  const query = document.getElementById('command-query');
  const results = document.getElementById('command-results');
  const update = () => {
   const tokens = query.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
   const matches = pagesToOpen.filter(([, label, aliases]) => tokens.every(token => (label + ' ' + aliases).toLowerCase().includes(token)));
   results.innerHTML = matches.map(([page, label]) => `<li><button type="button" data-command="${page}">${label}${icon('arrow')}</button></li>`).join('')
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
   if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !document.getElementById('post-inspector').open) {
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

 return {render, summary, contentControl, reveal, init, pushPanel, disconnectPush};
})();
