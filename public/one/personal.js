'use strict';

(() => {
  const el = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
  const names = {home:'오늘의 업무', tasks:'할 일', schedule:'일정', workbench:'업무 작업대', notes:'메모', links:'바로가기', sites:'내 웹사이트', 'website-guide':'구매·연결 가이드', social:'내 SNS', mail:'메일 예약', files:'비공개 저장소', revenue:'수익 대시보드', 'getting-started':'시작 가이드', 'stock-program':'자동 주식 프로그램'};
  const kinds = {tasks:'task', schedule:'schedule', notes:'note', links:'link'};
  const dayFormatter = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  const dateFormatter = new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'});
  const day = () => dayFormatter.format(new Date());
  const timeFormatter=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let items = [], agenda = [], view = '', currentItem = null, editorKind = null, accountId = null, ready = false, saving = false;
  let checkNumber = 0, activeCheck = null, suspendedEditor = false, editRevision = 0, openAssistant = new URLSearchParams(location.search).has('ai');
  const editor = el('personal-editor');
  const form = el('personal-form');
  const tabs = [...document.querySelectorAll('[data-personal-link]')];
  const screens = [...document.querySelectorAll('[data-personal-view]')];
  const more = el('personal-more'), menu = el('personal-menu'), menuLinks = el('personal-menu-links');
  const quickViews = new Set(['home','tasks','schedule']);

  more.addEventListener('click', () => {
    const groups = [...document.querySelectorAll('.personal-nav [data-menu-group]')].map(group => {
      const copy = group.cloneNode(true);
      copy.querySelector('#personal-owner-links')?.removeAttribute('id');
      for (const link of copy.querySelectorAll('[data-personal-link]')) {
        if (quickViews.has(link.dataset.personalLink)) link.remove();
      }
      return copy;
    });
    menuLinks.replaceChildren(...groups);
    menu.showModal();
    more.setAttribute('aria-expanded','true');
  });
  el('personal-menu-close').addEventListener('click', () => menu.close());
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
        primary+'</strong>'+details+'<div class="personal-row-meta">'+description(item)+late+(item.focusOn?' <span>집중 '+esc(item.focusOn)+' '+esc(item.focusTime)+'</span>':'')+'</div></div>'+
        (controls?'<div class="personal-row-actions">'+controls+'</div>':'')+'</li>';
    }).join('')+'</ul>';
  }

  function paintItems() {
    const now = day();
    const tasks = items.filter(item=>item.kind==='task'&&!item.done).sort(dateOrder);
    const schedule = items.filter(item=>item.kind==='schedule'&&item.dueOn>=now).sort(dateOrder);
    const links = items.filter(item=>item.kind==='link').sort(recent);
    el('personal-today').innerHTML = list(tasks.filter(item=>!item.dueOn||item.dueOn<=now).slice(0,6),'오늘 처리할 일이 없습니다.',true);
    const automated=agenda.filter(event=>Number.isFinite(Date.parse(event.scheduledAt))).map(event=>{
      const label=event.kind==='mail'?'메일 예약':'SNS 예약';
      return {...event,title:label+' · '+event.title,dueOn:dayFormatter.format(new Date(event.scheduledAt)),
        dueTime:timeFormatter.format(new Date(event.scheduledAt)),createdAt:event.scheduledAt,done:false};
    });
    const focus = tasks.filter(item=>item.focusOn>=now).map(item=>({
      ...item,title:'집중 · '+item.title,kind:'focus',dueOn:item.focusOn,dueTime:item.focusTime,
    })).sort(dateOrder);
    el('personal-upcoming').innerHTML = list([...schedule,...automated,...focus].sort(dateOrder).slice(0,4),'예정된 일정이 없습니다.',true);
    el('personal-automation-agenda').hidden=view!=='schedule';
    if(view==='schedule')el('personal-automation-events').innerHTML=list([...focus,...automated].sort(dateOrder),'집중 시간이나 예약이 없습니다.',true);
    el('personal-pinned').innerHTML = list(links.slice(0,5),'바로가기를 추가할 수 있습니다.',true);
    const kind = kinds[view];
    if(kind) {
      const rows = items.filter(item=>item.kind===kind);
      rows.sort(kind==='task'?(a,b)=>Number(a.done)-Number(b.done)||dateOrder(a,b):kind==='schedule'?dateOrder:recent);
      el('personal-list-title').textContent = names[view]+' '+rows.length+'건';
      el('personal-list').innerHTML = list(rows,'저장한 항목이 없습니다.');
    }
  }

  function route(focus=false) {
    const newView = location.hash.slice(1);
    const target = Object.hasOwn(names,newView)?newView:'home';
    const changed = target!==view;
    view = target;
    el('personal-title').textContent = names[view];
    const guide = view==='website-guide';
    const active = guide ? 'sites' : view;
    for(const nav of tabs) nav.setAttribute('aria-current',nav.dataset.personalLink===active?'page':'false');
    more.setAttribute('aria-current',String(!quickViews.has(active)));
    if (changed && menu.open) menu.close();
    const visible = kinds[view]?'items':guide?'sites':view;
    window.NuriPersonalSites?.select?.(guide);
    for(const section of screens) {
      section.hidden = section.dataset.personalView!==visible;
      if(!section.hidden&&changed) {
        section.classList.remove('personal-arrive');
        requestAnimationFrame(()=>{if(!section.hidden)section.classList.add('personal-arrive');});
      }
    }
    if(ready) paintItems();
    if(view==='home'&&ready)void window.NuriWorkbench?.loadHome();
    if(view==='workbench'&&ready)void window.NuriWorkbench.mount();
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
    form.elements.dueOn.value = item?.dueOn||(kind==='schedule'?day():'');
    form.elements.dueOn.required = kind==='schedule';
    form.elements.dueTime.value = item?.dueTime||'';
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
      saveLocal(await api({...change,kind,title,detail,dueOn,dueTime}));
      editor.close();
      el('personal-add').focus();
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

  el('personal-reload').addEventListener('click',load);
  el('personal-add').addEventListener('click',()=>{if(ready)openEditor(null,kinds[view]);});
  el('personal-editor-close').addEventListener('click',()=>editor.close());
  editor.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  el('personal-logout').addEventListener('click',async()=>{
    try {
      const result = await fetch('/api/auth',{method:'DELETE'});
      const response=await result.json().catch(()=>null);
      if(!result.ok&&!response?.localCleared) throw Error('로그아웃을 다시 시도해 주세요.');
      suspendedEditor=false;
      mask();
      items=[];
      agenda=[];
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
  window.addEventListener('personal-automation-changed',()=>{if(ready&&location.pathname==='/personal')void load();});
  document.querySelector('.personal-skip').addEventListener('click',event=>{
    event.preventDefault();
    el('personal-main').focus();
  });
  function mask(){
    checkNumber++;
    activeCheck?.abort();
    document.body.classList.add('personal-revalidating');
    ready=false;
    window.NuriPersonalAccount=null;
    window.NuriPersonalAutomation?.suspend?.();
    window.NuriPersonalSites?.suspend?.();
    window.NuriPersonalRevenue?.suspend?.();
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
  window.NuriPersonalWorkspace={activate(){
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
