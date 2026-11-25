'use strict';

(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const names = {home:'오늘의 업무', tasks:'할 일', schedule:'일정', workbench:'업무 작업대', notes:'메모', links:'바로가기', search:'업무 검색', sites:'내 웹사이트', 'website-guide':'구매·연결 가이드', social:'내 SNS', mail:'메일 예약', files:'비공개 저장소', revenue:'수익 대시보드', 'getting-started':'가이드', 'guide-connections':'가이드', 'guide-help':'가이드', 'stock-program':'자동 주식 프로그램', 'connector-workflow':'서비스 연결 작업'};
  const guideViews = new Set(['getting-started','guide-connections','guide-help']);
  const guideTabs = [...document.querySelectorAll('[data-guide-link]')];
  const guidePanels = [...document.querySelectorAll('[data-guide-panel]')];
  const kinds = {tasks:'task', schedule:'schedule', notes:'note', links:'link'};
  const dayFormatter = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  const dateFormatter = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'});
  const day = () => dayFormatter.format(new Date());
  const timeFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let projects = [], items = [], agenda = [], view = '', currentItem = null, editorKind = null, accountId = null, ready = false, saving = false;
  let checkNumber = 0, activeCheck = null, suspendedEditor = false, editRevision = 0, openAssistant = new URLSearchParams(location.search).has('ai');
  const editor = el('personal-editor');
  const form = el('personal-form');
  const tabs = [...document.querySelectorAll('[data-personal-link]')];
  const sectionLinks = [...document.querySelectorAll('[data-personal-section]')];
  const contextMenus = [...document.querySelectorAll('[data-personal-context]')];
  const sectionByView = new Map(contextMenus.flatMap(menu =>
    [...menu.querySelectorAll('[data-personal-link]')].map(link => [link.dataset.personalLink, menu.dataset.personalContext])));
  const screens = [...document.querySelectorAll('[data-personal-view]')];
  const more = el('personal-more'), menu = el('personal-menu'), menuLinks = el('personal-menu-links');
  const taskFilters = el('personal-task-filters'), week = el('personal-week'), searchForm = el('personal-search-form');
  const scheduleModes = el('personal-schedule-modes');
  let taskState = 'all', scheduleMode = 'week', selectedDay = null, weekRead = null, weekAgenda = null;
  const quickSections = new Set(['home','tasks','workbench','connector-workflow']);

  more.addEventListener('click', () => {
    const groups = [...document.querySelectorAll('.personal-nav [data-menu-group]')].map(group => {
      const copy = group.cloneNode(true);
      for (const link of copy.querySelectorAll('[data-personal-section]')) {
        if (quickSections.has(link.dataset.personalSection)) link.remove();
      }
      return copy;
    });
    menuLinks.replaceChildren(...groups);
    menu.showModal();
    more.setAttribute('aria-expanded','true');
  });
  function dismissMenu() {
    menu.close();
    more.focus({preventScroll:true});
  }
  el('personal-menu-close').addEventListener('click',dismissMenu);
  menu.addEventListener('cancel',event=>{event.preventDefault();dismissMenu();});
  menu.addEventListener('close', () => more.setAttribute('aria-expanded',String(menu.open)));
  menuLinks.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    menu.close();
    if (link.hash === location.hash) el('personal-title').focus({preventScroll:true});
  });
  window.matchMedia?.('(max-width:680px)').addEventListener('change', event => {
    if (!event.matches && menu.open) menu.close();
  });

  const dateOrder = (a,b) => (a.dueOn||'9999').localeCompare(b.dueOn||'9999') ||
    (a.dueTime||'').localeCompare(b.dueTime||'') || a.createdAt.localeCompare(b.createdAt);
  const recent = (a,b) => b.updatedAt.localeCompare(a.updatedAt);
  const safeLink = value => {
    try {
      const url = new URL(value);
      return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';
    } catch {return '';}
  };

  async function api(body,signal) {
    const response = await fetch('/api/personal', body===undefined?{cache:'no-store',signal}:{
      method:'POST',headers:{'Content-Type':'application/json','X-Personal-Account':accountId},body:JSON.stringify(body),
    });
    signal?.throwIfAborted();
    if(response.status===401||response.status===403) {
      location.assign(response.status===401?'/login':'/access-pending');
      throw Error('로그인을 확인해 주세요.');
    }
    const result = await response.json();
    if(!response.ok) throw Error(result.error||'내 업무를 처리하지 못했습니다.');
    return result;
  }

  const projectName = id => projects.find(project=>project.id===id)?.name ?? '';
  function projectChoices(field,selected,empty,label) {
    const unknown=selected&&!projectName(selected);
    field.innerHTML='<option value="">'+empty+'</option>'+projects.map(project=>
      '<option value="'+esc(project.id)+'">'+esc(project.name)+'</option>').join('')+
      (unknown?'<option value="'+esc(selected)+'">삭제된 프로젝트</option>':'');
    field.value=selected||'';
    field.hidden=el(label).hidden=!projects.length&&!unknown;
  }
  function syncProjects(value) {
    if (!ready||!Array.isArray(value))return;
    projects=value;
    const filter=searchForm.elements?.projectId;
    if(filter)projectChoices(filter,projectName(filter.value)?filter.value:'','모든 프로젝트','personal-search-project-label');
    if(editor.open){
      const field=form.elements.projectId;
      projectChoices(field,field.value,'연결 안 함','personal-item-project-label');
    }
    if(view==='search')paintSearch();
  }

  const description = item => item.dueOn?
    '<time datetime="'+esc(item.dueOn)+'">'+esc(item.dueOn.replaceAll('-','.'))+'</time>'+
    (item.dueTime?' <span class="personal-time">'+esc(item.dueTime)+'</span>':'')
    :'';
  const button = (label,action,item) => '<button type="button" class="personal-action" data-personal-action="'+
    action+'" data-item="'+item.id+'">'+label+'</button>';

  function list(rows, blank, compact=false) {
    if(!rows.length) return '<p class="personal-empty">'+blank+'</p>';
    return '<ul class="personal-list">'+rows.map(item => {
      const isTask = item.kind==='task';
      const link = item.kind==='link'?safeLink(item.detail):'';
      const automation=item.kind==='mail'||item.kind==='social';
      const primary = automation?'<a href="#'+item.kind+'">'+esc(item.title)+'</a>':
        link?'<a href="'+esc(link)+'" target="_blank" rel="noopener noreferrer">'+esc(item.title)+'</a>':esc(item.title);
      const details = !compact&&item.kind!=='link'&&item.detail?'<p>'+esc(item.detail)+'</p>':'';
      const controls = compact?'':button('편집','edit',item)+button('삭제','remove',item);
      const toggle = isTask?
        '<button type="button" class="personal-checkbox" aria-pressed="'+item.done+'" aria-label="'+esc(item.title+' 완료')+
        '" data-personal-action="toggle" data-item="'+item.id+'"><span aria-hidden="true">'+(item.done?'✓':'')+'</span></button>':'';
      const late = !item.done&&item.dueOn&&item.dueOn<day()&&isTask?' <span class="personal-late">기한 지남</span>':'';
      return '<li class="personal-row'+(item.done?' is-done':'')+'">'+toggle+'<div class="personal-row-text"><strong>'+
        primary+'</strong>'+details+'<div class="personal-row-meta">'+description(item)+late+(projectName(item.projectId)?' <span>'+esc(projectName(item.projectId))+'</span>':'')+(item.focusOn?' <span>집중 '+esc(item.focusOn)+' '+esc(item.focusTime)+'</span>':'')+'</div></div>'+
        (controls?'<div class="personal-row-actions">'+controls+'</div>':'')+'</li>';
    }).join('')+'</ul>';
  }


  const labelDay = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'short',day:'numeric'});
  const weekDays = ['월','화','수','목','금','토','일'];
  const dateAt = date => new Date(date+'T00:00:00+09:00');
  const addDays = (date,offset) => dayFormatter.format(+dateAt(date)+offset*86400000);
  const monday = date => addDays(date,-((new Date(date+'T00:00:00Z').getUTCDay()+6)%7));
  const planLabel = {task:'마감',schedule:'일정',focus:'집중',social:'SNS 예약',mail:'메일 예약'};
  const itemLabel = {task:'할 일',schedule:'일정',note:'메모',link:'바로가기'};
  const weekParts = current => Array.from({length:7},(_,index)=>addDays(monday(current),index));

  function automatedEvents(events) {
    return events.filter(event=>['social','mail'].includes(event.kind)&&Number.isFinite(Date.parse(event.scheduledAt))).map(event=>({
      ...event,dueOn:dayFormatter.format(new Date(event.scheduledAt)),
      dueTime:timeFormatter.format(new Date(event.scheduledAt)),createdAt:event.scheduledAt,done:false,
    }));
  }

  function plannedItems(events) {
    const scheduled=items.filter(item=>item.kind==='schedule'||item.kind==='task'&&!item.done&&item.dueOn);
    const focus=items.filter(item=>item.kind==='task'&&!item.done&&item.focusOn).map(item=>({
      ...item,kind:'focus',dueOn:item.focusOn,dueTime:item.focusTime,
    }));
    return [...scheduled,...focus,...automatedEvents(events)].sort(dateOrder);
  }

  function recordTitle(item) {
    const title=esc(item.title);
    if(item.id&&['task','schedule','note','link','focus'].includes(item.kind))
      return '<button class="personal-action personal-record-open" type="button" data-open-record="'+esc(item.id)+'">'+title+'</button>';
    if(item.kind==='social'||item.kind==='mail')
      return '<a class="personal-link" href="#'+item.kind+'">'+title+'</a>';
    return title;
  }

  function paintWeek() {
    if(!ready||view!=='schedule'||scheduleMode!=='week')return;
    selectedDay??=day();
    const dates=weekParts(selectedDay), start=dates[0];
    const planned=plannedItems(weekAgenda?.start===start?weekAgenda.events:agenda);
    el('personal-week-title').textContent=labelDay.format(dateAt(start))+' – '+labelDay.format(dateAt(dates[6]));
    el('personal-day-heading').textContent=dateFormatter.format(dateAt(selectedDay));
    const days=el('personal-week-days');
    const focused=days.contains(document.activeElement)?document.activeElement.dataset.planDay:null;
    days.innerHTML=dates.map((date,index)=>{
      const count=planned.filter(row=>row.dueOn===date).length;
      return '<button class="btn" type="button" data-plan-day="'+date+'" aria-pressed="'+(selectedDay===date)+'"'+
        (date===day()?' aria-current="date"':'')+' aria-label="'+esc(dateFormatter.format(dateAt(date))+', '+count+'건')+'"><small>'+
        weekDays[index]+'</small><strong>'+Number(date.slice(-2))+'</strong><span>'+(count||'')+'</span></button>';
    }).join('');
    if(focused)Array.from(days.children).find(button=>button.dataset.planDay===focused)?.focus({preventScroll:true});
    const rows=planned.filter(row=>row.dueOn===selectedDay);
    el('personal-day-events').innerHTML=rows.length?'<ul class="personal-plan-results">'+rows.map(row=>
      '<li><span>'+esc(row.dueTime||planLabel[row.kind])+'</span><div>'+recordTitle(row)+(row.dueTime?
        '<small>'+esc(planLabel[row.kind])+'</small>':'')+
      (projectName(row.projectId)?'<small>'+esc(projectName(row.projectId))+'</small>':'')+
      (row.kind==='schedule'?calendarAction(row):'')+'</div></li>').join('')+'</ul>':
      '<p class="personal-empty">이날 예정된 업무가 없습니다.</p>';
    week.querySelector('[data-week-action="export"]').disabled=!items.some(item=>item.kind==='schedule'&&dates.includes(item.dueOn));
  }

  async function loadWeek() {
    if(!ready||view!=='schedule'||scheduleMode!=='week')return;
    const start=monday(selectedDay??day()), owner=accountId;
    if(weekRead?.start===start)return;
    weekRead?.controller.abort();
    weekRead=null;
    if(weekAgenda?.start===start)return;
    const request={start,controller:new AbortController()};
    weekRead=request;
    const note=el('personal-week-status');
    note.textContent='예약을 불러오는 중입니다.';
    try {
      const response=await fetch('/api/personal?week='+encodeURIComponent(start),{
        cache:'no-store',signal:request.controller.signal,headers:{'X-Personal-Account':owner},
      });
      if(!response.ok)throw Error();
      const result=await response.json();
      if(weekRead!==request||!ready||owner!==accountId)return;
      if(!Array.isArray(result.agenda))throw Error();
      weekAgenda={start,events:result.agenda};
      note.textContent='';
      paintWeek();
    } catch {
      if(weekRead===request)note.textContent='SNS·메일 예약을 조회하지 못했습니다. 이번 주 또는 다른 주를 선택해 다시 조회하세요.';
    } finally {
      if(weekRead===request)weekRead=null;
    }
  }

  const searchText = value => String(value??'').normalize('NFKC').toLocaleLowerCase('ko');
  function paintSearch() {
    if(!ready||view!=='search')return;
    const terms=searchText(searchForm.elements.query.value).trim().split(/\s+/).filter(Boolean);
    const kind=searchForm.elements.kind.value;
    const project=searchForm.elements.projectId.value;
    const available=items.filter(item=>(kind==='all'||item.kind===kind)&&(!project||item.projectId===project));
    const matches=available.filter(item=>{
      if(!terms.length)return true;
      const source=searchText(item.title+' '+item.detail+' '+projectName(item.projectId));
      return terms.every(term=>source.includes(term));
    }).sort(recent);
    el('personal-search-status').textContent=matches.length?
      (terms.length?'검색 결과 ':'저장한 항목 ')+matches.length+'건'+(matches.length>30?' · 최근 수정 30건 표시':''):
      terms.length?'일치하는 업무가 없습니다.':'저장한 항목이 없습니다.';
    el('personal-search-results').innerHTML=matches.length?'<ul class="personal-plan-results">'+
      matches.slice(0,30).map(item=>'<li><span>'+esc(itemLabel[item.kind])+'</span><div>'+recordTitle(item)+
        (item.dueOn||projectName(item.projectId)?'<small>'+description(item)+' '+esc(projectName(item.projectId))+'</small>':'')+'</div></li>').join('')+'</ul>':'';
  }

  const calendarText = value => String(value).replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n')
    .replaceAll(';','\\;').replaceAll(',','\\,');
  const calendarStamp = value => new Date(value).toISOString().replace(/[-:]|\.\d{3}/g,'');
  function calendarFold(line) {
    const bytes=new TextEncoder();
    let result='',size=0;
    for(const char of line){
      const count=bytes.encode(char).length;
      if(size+count>75){result+='\r\n ';size=1;}
      result+=char;size+=count;
    }
    return result;
  }
  function calendarAction(item) {
    const base = 'https://calendar.google.com/calendar/render';
    const start = item.dueTime ? calendarStamp(item.dueOn+'T'+item.dueTime+':00+09:00') : item.dueOn.replaceAll('-','');
    // The workspace stores a start time. Calendar drafts use a 30-minute default.
    const end = item.dueTime ? calendarStamp(Date.parse(item.dueOn+'T'+item.dueTime+':00+09:00')+30*60000) :
      addDays(item.dueOn,1).replaceAll('-','');
    const query = new URLSearchParams({action:'TEMPLATE',text:item.title,dates:start+'/'+end,ctz:'Asia/Seoul'});
    return '<a class="personal-calendar-link" href="'+esc(base+'?'+query)+
      '" target="_blank" rel="noopener noreferrer" aria-label="'+esc(item.title+' Google Calendar에 추가')+'">Google Calendar에 추가</a>';
  }
  // 캘린더 연동(Google 상태 · iPhone 읽기 전용 구독). 비밀번호는 생성 응답에서만 받아 입력란에 두고,
  // 화면을 떠나거나 닫거나 계정·가시성이 바뀌면 지운다. 주소(URL)에는 비밀이 없다.
  const feedPanel = el('personal-calendar-connect'), feedFields = ['personal-feed-url','personal-feed-user','personal-feed-password'];
  const feedState = {phase:'idle',active:null,busy:false};
  // 구독 상태(feedRevision/feedAbort)와 Google 연결 확인(googleRevision/googleAbort)은 소유권이 따로라
  // 한쪽이 느려도 다른 쪽이 기다리거나 취소되지 않는다. 닫기·로그아웃·계정 변경은 둘 다 취소한다.
  let feedRevision = 0, feedAbort = null, googleRevision = 0, googleAbort = null;
  const feedButton = name => document.querySelector('[data-feed-action='+name+']');
  function feedPaint(message) {
    const known = feedState.phase==='ready';
    el('personal-feed-state').textContent = message ?? (feedState.phase==='loading'?'구독 상태를 확인하는 중입니다.':
      feedState.phase==='error'?'구독 상태를 확인하지 못했습니다.':known?(feedState.active?'구독이 켜져 있습니다. 비밀번호는 다시 볼 수 없고, 새로 만들면 교체됩니다.':'구독이 꺼져 있습니다.'):'상태를 확인하기 전입니다.');
    const create = feedButton('create'), off = feedButton('disable'), again = feedButton('refresh');
    create.disabled = !known || feedState.busy;
    create.textContent = known && feedState.active ? '구독 정보 다시 만들기(기존 중지)' : '구독 정보 만들기';
    off.hidden = !(known && feedState.active); off.disabled = feedState.busy;
    again.hidden = feedState.phase!=='error'; again.disabled = feedState.busy;
  }
  function feedWipe() {
    for(const id of feedFields)el(id).value = '';
    el('personal-feed-link').hidden = true;
  }
  function feedClear() {
    feedRevision++; feedAbort?.abort(); feedAbort = null;
    googleRevision++; googleAbort?.abort(); googleAbort = null;
    feedWipe();
    Object.assign(feedState,{phase:'idle',active:null,busy:false});
    feedPanel.open = false;
    feedPaint();
    el('personal-feed-google').textContent = '확인 전입니다.';
  }
  async function feedFetch(url,options,revision,signal,google) {
    const owner = accountId;
    const response = await fetch(url,{cache:'no-store',signal,...options,headers:{'X-Personal-Account':owner,...(options?.headers??{})}});
    const result = await response.json().catch(()=>({}));
    if(revision!==(google?googleRevision:feedRevision)||owner!==accountId)throw new DOMException('stale','AbortError');
    if(!response.ok)throw new Error(result.error||'요청을 처리하지 못했습니다.');
    return result;
  }
  function googlePaint(connectors) {
    el('personal-feed-google').textContent = !connectors||typeof connectors.connected!=='boolean'?
      'Google Calendar 연결 상태를 확인하지 못했어요. 일정 옆 ‘Google Calendar에 추가’는 계속 쓸 수 있습니다.':
      connectors.connected?'Google Calendar가 연결돼 있습니다. 아래 연결 화면에서 요청을 승인하세요.':
      'Google Calendar가 아직 연결되지 않았어요. 연결하지 않아도 일정 옆 ‘Google Calendar에 추가’는 쓸 수 있습니다.';
  }
  async function feedRefresh() {
    if(!ready||!accountId||view!=='schedule')return;
    feedAbort?.abort(); googleAbort?.abort();
    const revision = ++feedRevision, controller = feedAbort = new AbortController();
    const gRevision = ++googleRevision, gController = googleAbort = new AbortController();
    feedWipe(); feedState.phase = 'loading'; feedState.active = null; feedState.busy = false; feedPaint();
    el('personal-feed-google').textContent = 'Google Calendar 연결 상태를 확인하는 중입니다.';
    // 두 요청은 각자 도착하는 즉시 결과를 그린다(느린 Google이 Apple 구독 버튼을 막지 않는다).
    const status = feedFetch('/api/personal/calendar-subscription',{},revision,controller.signal).then(value=>{
      if(revision!==feedRevision||!feedPanel.open)return;
      feedState.phase='ready';feedState.active=value.active===true;feedPaint();
    },error=>{
      if(error?.name==='AbortError'||revision!==feedRevision||!feedPanel.open)return;
      feedState.phase='error';feedState.active=null;feedPaint(error?.message||undefined);
    });
    const google = feedFetch('/api/personal/connectors?view=calendar-status',{},gRevision,gController.signal,true).then(value=>{
      if(gRevision!==googleRevision||!feedPanel.open)return;
      googlePaint(value);
    },error=>{
      if(error?.name==='AbortError'||gRevision!==googleRevision||!feedPanel.open)return;
      googlePaint(null);
    });
    await Promise.all([status,google]);
  }
  async function feedChange(action) {
    if(feedState.busy||feedState.phase!=='ready'||!['create','disable'].includes(action))return;
    if(action==='disable'&&feedState.active!==true)return;
    if(action==='create'&&feedState.active===true&&!confirm('새 정보를 만들면 기존 구독이 즉시 끊깁니다. 계속할까요?'))return;
    if(action==='disable'&&!confirm('구독을 끄면 iPhone 등에서 더 이상 일정을 읽지 못합니다. 끌까요?'))return;
    feedAbort?.abort();
    const revision = ++feedRevision, controller = feedAbort = new AbortController();
    feedState.busy = true; feedPaint('처리 중입니다.');
    try {
      const result = await feedFetch('/api/personal/calendar-subscription',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action})},revision,controller.signal);
      feedState.busy = false; feedState.active = result.active===true;
      if(action==='create'&&typeof result.password==='string'){
        el('personal-feed-url').value = result.url; el('personal-feed-user').value = result.username; el('personal-feed-password').value = result.password;
        el('personal-feed-link').hidden = false;
        feedPaint('새 구독 정보를 만들었습니다. 지금 복사해 두세요. 화면을 떠나면 지워집니다.');
      } else {feedWipe();feedPaint('구독을 껐습니다.');}
    } catch(error) {
      if(error?.name==='AbortError'||revision!==feedRevision)return;
      feedWipe(); feedState.busy = false; feedState.phase = 'error'; feedState.active = null;
      feedPaint((error.message||'요청을 처리하지 못했습니다.')+' 상태를 다시 확인해 주세요.');
    }
  }
  feedPanel.addEventListener('click',async event=>{
    const copy = event.target.closest('[data-feed-copy]');
    if(copy){
      const input = el(copy.dataset.feedCopy==='password'?'personal-feed-password':'personal-feed-url');
      input.select?.();
      try{await navigator.clipboard.writeText(input.value);feedPaint('복사했습니다.');}catch{feedPaint('복사하지 못했습니다. 입력란을 길게 눌러 직접 복사하세요.');}
      return;
    }
    const control = event.target.closest('[data-feed-action]');
    if(!control)return;
    if(control.dataset.feedAction==='refresh')void feedRefresh();
    else void feedChange(control.dataset.feedAction);
  });
  feedPanel.addEventListener('toggle',()=>{if(feedPanel.open)void feedRefresh();else feedClear();});

  function exportWeek() {
    const dates=weekParts(selectedDay??day());
    const selected=items.filter(item=>item.kind==='schedule'&&dates.includes(item.dueOn));
    if(!selected.length)return;
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//NH HOLDINGS//NURI ONE//KO','CALSCALE:GREGORIAN'];
    for(const item of selected){
      const dateField=item.dueTime?'DTSTART:'+calendarStamp(item.dueOn+'T'+item.dueTime+':00+09:00'):
        'DTSTART;VALUE=DATE:'+item.dueOn.replaceAll('-','');
      lines.push('BEGIN:VEVENT','UID:'+item.id+'@nhholdings.xyz','DTSTAMP:'+calendarStamp(item.updatedAt),dateField,
        'SUMMARY:'+calendarText(item.title),'END:VEVENT');
    }
    const href=URL.createObjectURL(new Blob([lines.map(calendarFold).join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=href;link.download='nuri-one-'+dates[0]+'.ics';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(href),1000);
    el('personal-week-status').textContent='개인 일정 '+selected.length+'건을 다운로드했습니다.';
  }

  function paintAgendaSummary(tasks,schedule,now) {
    const taskLine=el('personal-today-summary'), calendarLine=el('personal-upcoming-summary');
    taskLine.hidden=calendarLine.hidden=true;
    if(!ready)return;
    const overdue=tasks.filter(item=>item.dueOn&&item.dueOn<now).length;
    const dueToday=tasks.filter(item=>item.dueOn===now).length;
    taskLine.innerHTML=(overdue?'<strong class="personal-late">기한 지남 '+overdue+'건</strong> · ':'')+'오늘 마감 '+dueToday+'건';
    taskLine.hidden=false;
    const today=schedule.filter(item=>item.dueOn===now).length;
    calendarLine.textContent='오늘 개인 일정 '+today+'건';
    calendarLine.hidden=false;
  }

  function paintItems() {
    const now = day();
    const tasks = items.filter(item=>item.kind==='task'&&!item.done).sort(dateOrder);
    const schedule = items.filter(item=>item.kind==='schedule'&&item.dueOn>=now).sort(dateOrder);
    const links = items.filter(item=>item.kind==='link').sort(recent);
    el('personal-today').innerHTML = list(tasks.filter(item=>!item.dueOn||item.dueOn<=now).slice(0,6),'오늘 처리할 일이 없습니다.',true);
    const automated=automatedEvents(agenda).map(event=>({...event,title:planLabel[event.kind]+' · '+event.title}));
    const focus = tasks.filter(item=>item.focusOn>=now).map(item=>({
      ...item,title:'집중 · '+item.title,kind:'focus',dueOn:item.focusOn,dueTime:item.focusTime,
    })).sort(dateOrder);
    el('personal-upcoming').innerHTML = list([...schedule,...automated,...focus].sort(dateOrder).slice(0,4),'예정된 일정이 없습니다.',true);
    paintAgendaSummary(tasks,schedule,now);
    taskFilters.hidden=view!=='tasks';
    scheduleModes.hidden=view!=='schedule';
    week.hidden=view!=='schedule'||scheduleMode!=='week';
    feedPanel.hidden=view!=='schedule';
    el('personal-add').hidden=view==='schedule'&&scheduleMode==='week';
    el('personal-list').hidden=view==='schedule'&&scheduleMode==='week';
    el('personal-automation-agenda').hidden=view!=='schedule'||scheduleMode!=='all';
    paintSearch();
    paintWeek();
    if(view==='schedule')el('personal-automation-events').innerHTML=list([...focus,...automated].sort(dateOrder),'집중 시간이나 예약이 없습니다.',true);
    el('personal-pinned').innerHTML = list(links.slice(0,5),'바로가기를 추가할 수 있습니다.',true);
    const kind = kinds[view];
    if(kind) {
      const rows = items.filter(item=>item.kind===kind&&(kind!=='task'||taskState==='all'||
        (taskState==='done'?item.done:!item.done&&(taskState==='active'||!!item.dueOn&&item.dueOn<now))));
      rows.sort(kind==='task'?(a,b)=>Number(a.done)-Number(b.done)||dateOrder(a,b):kind==='schedule'?dateOrder:recent);
      el('personal-list-title').textContent = view==='schedule'&&scheduleMode==='week'?'주간 계획':names[view]+' '+rows.length+'건';
      el('personal-list').innerHTML = list(rows,'저장한 항목이 없습니다.');
    }
  }

  function route(focus=false) {
    const newView = location.hash.slice(1).split('?')[0];
    const target = Object.hasOwn(names,newView)?newView:'home';
    const changed = target!==view;
    view = target;
    if(view!=='schedule')feedClear();
    el('personal-title').textContent = names[view];
    const guide = view==='website-guide';
    const inGuide = guideViews.has(view);
    const active = inGuide ? 'getting-started' : guide ? 'sites' : view;
    if(inGuide){
      for(const tab of guideTabs)tab.setAttribute('aria-current',tab.dataset.guideLink===view?'page':'false');
      for(const panel of guidePanels)panel.hidden=panel.dataset.guidePanel!==view;
    }
    for(const nav of tabs) {
      const current = nav.dataset.personalLink === active;
      nav.setAttribute('aria-current',current?'page':'false');
    }
    const section = sectionByView.get(active) ?? active;
    for (const link of sectionLinks) {
      const selected = link.dataset.personalSection === section;
      link.setAttribute('aria-current',selected ? (view===section?'page':'location') : 'false');
    }
    for (const menu of contextMenus) menu.hidden = menu.dataset.personalContext !== section;
    more.setAttribute('aria-current',String(!quickSections.has(section)));
    if (changed && menu.open) menu.close();
    const visible = kinds[view]?'items':active;
    window.NuriPersonalSites?.select?.(guide);
    for(const section of screens) {
      section.hidden = section.dataset.personalView!==visible;
      if(!section.hidden&&changed) {
        section.classList.remove('personal-arrive');
        requestAnimationFrame(()=>{if(!section.hidden)section.classList.add('personal-arrive');});
      }
    }
    if(ready){
      paintItems();
      if(view==='schedule')void loadWeek();
    }
    if(view==='home'&&ready)void window.NuriWorkbench?.loadHome();
    if(view==='workbench'&&ready)void window.NuriWorkbench.mount();
    if(view==='connector-workflow'&&ready)void window.NuriConnectorWorkflow?.mount?.();
    if(view==='revenue'&&ready)void window.NuriPersonalRevenue?.mount?.();
    if(visible==='sites'&&ready)void window.NuriPersonalSites?.mount?.();
    if(view==='files'&&ready) void window.NuriPersonalFiles?.mount?.();
    if(ready&&(view==='social'||view==='mail'))void window.NuriPersonalAutomation?.mount?.(view);
    if(focus&&changed) {
      el('personal-title').focus({preventScroll:true});
      window.scrollTo({top:0,behavior:'instant'});
    }
  }

  function saveLocal(result,id) {
    editRevision++;
    items = result.item?[result.item,...items.filter(item=>item.id!==result.item.id)]:items.filter(item=>item.id!==id);
    el('personal-message').textContent = '';
    paintItems();
  }

  async function load() {
    activeCheck?.abort();
    const check = ++checkNumber, revision = editRevision;
    const validation = new AbortController();
    activeCheck = validation;
    ready=false;
    el('personal-today-summary').hidden=el('personal-upcoming-summary').hidden=true;
    el('personal-main').setAttribute('aria-busy','true');
    el('personal-reload').hidden = true;
    try {
      const result = await api(undefined,validation.signal);
      if(check!==checkNumber||document.visibilityState==='hidden')return;
      if(accountId&&accountId!==result.account.id){
        items=[];
        location.reload();
        return;
      }
      if(revision!==editRevision){void load();return;}
      accountId=result.account.id;
      window.NuriPersonalAccount=accountId;
      window.NuriPersonalAI?.mount?.();
      if(openAssistant){
        openAssistant=false;
        const url=new URL(location.href);
        url.searchParams.delete('ai');
        history.replaceState(history.state,'',url.href);
        el('personal-ai-open').click?.();
      }
      items = result.items;
      agenda = result.agenda||[];
      el('personal-account').textContent = result.account.email;
      el('personal-owner-links').hidden = !result.account.owner;
      if(!window.NuriWorkspace && result.account.owner){
        const bar=el('one-workspace-bar');
        bar.hidden=false;
        bar.querySelector('[href="/personal"]').setAttribute('aria-current','page');
      }
      ready = true;
      document.body.classList.remove('personal-revalidating');
      el('personal-message').textContent = '';
      syncProjects(result.projects||[]);
      route();
      if(suspendedEditor&&!saving){
        suspendedEditor=false;
        editor.showModal();
        form.elements.title.focus();
      }
    } catch(error) {
      if(check!==checkNumber)return;
      el('personal-message').textContent = error.message;
      el('personal-reload').hidden = false;
    } finally {
      if(check===checkNumber)el('personal-main').setAttribute('aria-busy','false');
    }
  }

  function openEditor(item,kind,draft=item) {
    currentItem = item;
    editorKind = kind;
    form.reset();
    form.elements.title.value = draft?.title||'';
    projectChoices(form.elements.projectId,draft?.projectId,'연결 안 함','personal-item-project-label');
    form.elements.dueOn.value = draft?.dueOn||(kind==='schedule'?day():'');
    form.elements.dueOn.required = kind==='schedule';
    form.elements.dueTime.value = draft?.dueTime||'';
    const isLink = kind==='link';
    form.elements.detail.value = isLink?'':draft?.detail||'';
    form.elements.url.value = isLink?item?.detail||'':'';
    form.elements.url.hidden = !isLink;
    form.elements.url.required = isLink;
    form.elements.detail.hidden = isLink;
    el('personal-detail-label').textContent = isLink?'HTTPS 주소':'내용';
    el('personal-detail-label').htmlFor = isLink?'personal-item-url':'personal-item-detail';
    el('personal-item-dates').hidden = !['task','schedule'].includes(kind);
    el('personal-item-hour').hidden = kind!=='schedule';
    el('personal-editor-title').textContent = names[view]+' '+(item?'편집':'추가');
    el('personal-editor-message').textContent = '';
    editor.showModal();
    form.elements.title.focus();
  }

  const lockControls = (target,locked) => target.querySelectorAll('button').forEach(button=>{button.disabled=locked;});
  el('personal-quick').addEventListener('submit',async event=>{
    event.preventDefault();
    if(saving||!ready) return;
    const quick = event.currentTarget;
    saving = true;
    lockControls(quick,true);
    try {
      saveLocal(await api({action:'create',id:crypto.randomUUID(),kind:event.submitter?.value==='note'?'note':'task',title:quick.elements.title.value}));
      quick.reset();
      quick.elements.title.focus();
    } catch(error) {el('personal-message').textContent = error.message;}
    finally {saving=false;lockControls(quick,false);}
  });

  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(saving||!ready) return;
    saving = true;
    lockControls(form,true);
    try {
      const values = new FormData(form);
      const kind = editorKind;
      const title = values.get('title');
      const detail = (kind==='link'?values.get('url'):values.get('detail'))||'';
      const dueOn = ['task','schedule'].includes(kind)?values.get('dueOn')||null:null;
      const dueTime = kind==='schedule'?values.get('dueTime')||null:null;
      const change = currentItem?{action:'update',id:currentItem.id,version:currentItem.version,done:currentItem.done}:
        {action:'create',id:crypto.randomUUID()};
      saveLocal(await api({...change,kind,title,detail,dueOn,dueTime,projectId:values.get('projectId')||null}));
      editor.close();
      (el('personal-add').hidden?week.querySelector('[data-week-action=add]'):el('personal-add')).focus();
    } catch(error) {el('personal-editor-message').textContent = error.message;}
    finally {saving=false;lockControls(form,false);}
  });

  document.addEventListener('click',async event=>{
    const control = event.target.closest('[data-personal-action]');
    if(!control||saving||!ready) return;
    const item = items.find(candidate=>candidate.id===control.dataset.item);
    if(!item) return;
    const action = control.dataset.personalAction;
    if(action==='edit') return openEditor(item,item.kind);
    if(action==='remove'&&!confirm('선택한 업무 기록을 삭제할까요?')) return;
    saving = true;
    const hadFocus = control===document.activeElement;
    control.disabled = true;
    try {
      saveLocal(await api({action:action==='remove'?'remove':'complete',id:item.id,version:item.version,done:!item.done}),item.id);
      if(hadFocus) {
        const same = document.querySelector('[data-item="'+item.id+'"][data-personal-action="'+action+'"]');
        (same||el(view==='home'?'personal-home-title':'personal-add'))?.focus({preventScroll:true});
        if(action==='toggle'&&same&&window.matchMedia('(prefers-reduced-motion: no-preference)').matches)
          same.animate([{transform:'scale(.94)'},{transform:'scale(1.08)',offset:.56},{transform:'scale(1)'}],{duration:220,easing:'ease-out'});
      }
    } catch(error) {el('personal-message').textContent = error.message;}
    finally {saving=false;control.disabled=false;}
  });

  taskFilters.addEventListener('click',event=>{
    const picked=event.target.closest('[data-task-state]');
    if(!ready||!picked)return;
    taskState=picked.dataset.taskState;
    for(const control of taskFilters.children)control.setAttribute('aria-pressed',String(control===picked));
    paintItems();
  });
  scheduleModes.addEventListener('click',event=>{
    const control=event.target.closest('[data-schedule-mode]');
    if(!ready||!control)return;
    scheduleMode=control.dataset.scheduleMode;
    for(const button of scheduleModes.children)button.setAttribute('aria-pressed',String(button===control));
    paintItems();void loadWeek();
  });
  week.addEventListener('click',event=>{
    const control=event.target.closest('[data-plan-day],[data-week-action]');
    if(!control||!ready||saving)return;
    const {planDay,weekAction}=control.dataset;
    if(weekAction==='add')return openEditor(null,'schedule',{dueOn:selectedDay??day()});
    if(weekAction==='export')return exportWeek();
    el('personal-week-status').textContent='';
    selectedDay=planDay??(weekAction==='current'?day():addDays(selectedDay??day(),weekAction==='previous'?-7:7));
    paintWeek();void loadWeek();
  });
  searchForm.addEventListener('input',paintSearch);
  searchForm.addEventListener('submit',event=>{event.preventDefault();paintSearch();});
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-open-record]');
    if(!target||!ready||saving||editor.open)return;
    const item=items.find(row=>row.id===target.dataset.openRecord);
    if(!item)return;
    const destination=Object.keys(kinds).find(key=>kinds[key]===item.kind);
    if(location.hash!=='#'+destination)history.pushState(null,'','#'+destination);
    route();
    openEditor(item,item.kind);
  });

  el('personal-reload').addEventListener('click',load);
  el('personal-add').addEventListener('click',()=>{if(ready)openEditor(null,kinds[view]);});
  el('personal-editor-close').addEventListener('click',()=>editor.close());
  editor.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  el('personal-logout').addEventListener('click',async()=>{
    try {
      const result = await fetch('/api/auth',{method:'DELETE'});
      const response=await result.json().catch(()=>null);
      if(!result.ok&&!response?.localCleared) throw Error('로그아웃을 다시 시도해 주세요.');
      searchForm.reset();
      suspendedEditor=false;
      mask();
      items=[];
      agenda=[];
      projects=[];
      window.NuriPersonalAccount=null;
      paintItems();
      location.assign('/login');
    } catch(error) {el('personal-message').textContent = error.message;}
  });
  const date = el('personal-date');
  date.dateTime = day();
  date.textContent = dateFormatter.format(new Date());
  el('personal-start-ai')?.addEventListener('click',()=>{if(ready)el('personal-ai-open').click();});
  window.addEventListener('hashchange',()=>{if(location.pathname==='/personal')route(true);});
  // 같은 출처·같은 경로(/personal)의 링크는 문서를 다시 불러오지 않고 route()로 처리한다.
  // 해시만 바뀌는 링크는 브라우저의 조각 탐색(hashchange → route)에 맡기고, 검색 문자열이 바뀌거나 해시가 없어
  // 전체 문서가 다시 열릴 링크(?workbench=·?review= 딥링크, 브랜드 홈 등)만 가로챈다. 보조키·가운데 버튼·target·download·
  // 다른 출처나 /dashboard 등 다른 경로는 그대로 둔다. pane·review 매개변수의 해석은 NuriWorkbench.mount가 맡는다.
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href]');
    if(!link||event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    if(link.target||link.hasAttribute('download')||location.pathname!=='/personal')return;
    let url;
    try{url=new URL(link.href,location.href);}catch{return;}
    if(url.origin!==location.origin||url.pathname!=='/personal'||url.hash&&url.search===location.search)return;
    event.preventDefault();
    const same=url.href===location.href;
    if(!same)history.pushState(null,'',url.href);
    if(menu.open)menu.close();
    route(true);
    if(same)el('personal-title').focus({preventScroll:true});
  });
  window.addEventListener('personal-automation-changed',()=>{
    if(ready&&location.pathname==='/personal'){
      weekRead?.controller.abort();weekRead=null;weekAgenda=null;
      void load();
    }
  });
  document.querySelector('.personal-skip').addEventListener('click',event=>{
    event.preventDefault();
    el('personal-main').focus();
  });
  function mask(){
    checkNumber++;
    activeCheck?.abort();
    weekRead?.controller.abort();weekRead=null;weekAgenda=null;
    feedClear();
    el('personal-week-status').textContent='';
    el('personal-search-results').replaceChildren();
    el('personal-search-status').textContent='';
    document.body.classList.add('personal-revalidating');
    ready=false;
    window.NuriPersonalAccount=null;
    window.NuriPersonalAutomation?.suspend?.();
    window.NuriPersonalSites?.suspend?.();
    window.NuriPersonalRevenue?.suspend?.();
    window.NuriConnectorWorkflow?.suspend?.();
    window.NuriPersonalAI?.suspend?.();
    window.NuriWorkbench?.suspend();
    if(editor.open){suspendedEditor=!saving;editor.close();}
  }
  function checkAccount(){mask();route();void load();}
  function reviewDraft(kind,draft){
    if(!ready||saving||editor.open||!['task','schedule','note'].includes(kind))return false;
    const destination=Object.keys(kinds).find(key=>kinds[key]===kind);
    if(location.hash!=='#'+destination)history.pushState(null,'','#'+destination);
    route();
    openEditor(null,kind,draft);
    return true;
  }
  function openProjectRecords(id){
    if(!ready||!projectName(id))return false;
    if(location.hash!=='#search')history.pushState(null,'','#search');
    searchForm.elements.query.value='';
    searchForm.elements.kind.value='all';
    searchForm.elements.projectId.value=id;
    route(true);
    return true;
  }
  window.NuriPersonalWorkspace={syncProjects,openProjectRecords,tasks(){
    return ready?items.filter(item=>item.kind==='task'&&!item.done).sort(dateOrder).map(({id,title})=>({id,title})):[];
  },activate(){
    openAssistant=new URLSearchParams(location.search).has('ai');
    checkAccount();
  },reviewDraft,deactivate(){
    mask();
    for(const dialog of el('one-personal-view').querySelectorAll('dialog[open]'))dialog.close();
    document.body.classList.remove('personal-revalidating');
  }};
  document.addEventListener('visibilitychange',()=>{
    if(location.pathname!=='/personal')return;
    if(document.visibilityState==='hidden')mask();
    else checkAccount();
  });
  window.addEventListener('pagehide',mask);
  window.addEventListener('pageshow',event=>{if(event.persisted&&location.pathname==='/personal')checkAccount();});
  if(location.pathname==='/personal')checkAccount();
})();
