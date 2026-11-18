(() => {
  'use strict';
  const el = id => document.getElementById('personal-site-' + id);
  const status = document.getElementById('personal-sites-status');
  const editor = el('editor'), form = el('form'), share = el('share');
  const today = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'});
  const checked = new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});
  let session, state, editing, createId, guideSelected, busy = false;
  const saveButtons = [form.querySelector('button[type="submit"]'), el('remove-confirm'), share.querySelector('button[type="submit"]')];

  function element(tag, content, className) {
    const node = document.createElement(tag);
    if (content) node.textContent = content;
    if (className) node.className = className;
    return node;
  }
  function button(text, handler) {
    const node = element('button', text, 'btn');
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }
  function link(text, href, className) {
    const node = element('a', text, className);
    node.href = href;
    if (!href.startsWith('#')) {
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    }
    return node;
  }

  function select(guide) {
    if (guideSelected !== guide) status.replaceChildren();
    guideSelected = guide;
    el('list-panel').hidden = guide;
    el('guide-panel').hidden = !guide;
    for (const tab of document.querySelectorAll('.personal-site-tabs a')) {
      tab.setAttribute('aria-current', tab.hash === (guide ? '#website-guide' : '#sites') ? 'page' : 'false');
    }
  }

  async function api(current, input) {
    const response = await fetch('/api/personal/sites', {
      cache:'no-store',
      signal:current.abort.signal,
      headers:{'X-Personal-Account':current.account, ...(input ? {'Content-Type':'application/json'} : {})},
      ...(input ? {method:'POST', body:JSON.stringify(input)} : {}),
    });
    const result = await response.json().catch(() => null);
    if (session !== current || current.account !== window.NuriPersonalAccount) throw new DOMException('', 'AbortError');
    if (!response.ok || !result) {
      const error = new Error(result?.error || '웹사이트 목록을 불러오지 못했습니다.');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function dnsText(site) {
    if (!site.url) return '주소 등록 전';
    const result = site.dns;
    if (!result) return 'DNS 확인 전';
    const value = result.status === 'found' ? 'DNS 응답 있음 · ' + result.records.join(', ')
      : result.status === 'missing' ? 'DNS 응답 레코드 없음' : 'DNS 조회 일시 실패';
    return value + ' · ' + checked.format(new Date(result.checkedAt));
  }

  function renewText(date) {
    if (!date) return '';
    const days = Math.round((Date.parse(date) - Date.parse(today.format(new Date()))) / 86400000);
    const due = days < 0 ? ' · 날짜 지남' : days === 0 ? ' · 오늘' : days <= 30 ? ' · ' + days + '일 남음' : '';
    return '갱신 ' + date + due;
  }

  function render() {
    const list = el('list');
    list.replaceChildren();
    el('add').disabled = !state || busy;
    if (!state) return;
    if (!state.sites.length) {
      const empty = element('p', '아직 등록한 웹사이트가 없습니다. 주소가 없어도 이름부터 등록할 수 있어요.', 'personal-site-empty');
      empty.append(document.createElement('br'), link('가비아 구매부터 시작하기', '#website-guide', 'personal-link'));
      list.append(empty);
    }
    for (const site of state.sites) {
      const row = element('article', '', 'personal-site-row');
      row.dataset.siteId = site.id;
      const props = [site.registrar, site.host, renewText(site.renewOn)].filter(Boolean);
      row.append(element('h3', site.name));
      if (site.url) row.append(element('p', site.url));
      if (props.length) row.append(element('p', props.join(' · ')));
      row.append(element('small', dnsText(site)));
      const actions = element('div', '', 'personal-site-actions');
      if (site.url) {
        actions.append(link('사이트 열기', site.url, 'btn'));
        const dns = button('DNS 확인', () => void mutate({action:'dns', id:site.id, version:site.version}, status));
        dns.dataset.siteAction = 'dns';
        actions.append(dns);
      }
      const edit = button('관리', () => showEditor(site));
      edit.dataset.siteAction = 'edit';
      actions.append(edit);
      row.append(actions);
      list.append(row);
    }
    el('shared-note').textContent = state.guide.note || '아직 공유 메모가 없습니다.';
    el('share-open').hidden = !state.canShare || !share.hidden;
    el('share-open').disabled = busy;
  }

  async function mount() {
    if (session || !window.NuriPersonalAccount) return;
    const current = {account:window.NuriPersonalAccount, abort:new AbortController()};
    session = current;
    status.textContent = '웹사이트를 불러오는 중입니다.';
    try {
      state = await api(current);
      status.textContent = '';
      render();
    } catch (error) {
      if (session !== current || error.name === 'AbortError') return;
      status.textContent = error.message + ' ';
      status.append(button('다시 불러오기', () => void mount()));
      el('shared-note').textContent = '공유 메모를 불러오지 못했습니다.';
      session = null;
    }
  }

  function suspend() {
    session?.abort.abort();
    session = null;
    state = null;
    busy = false;
    editing = null;
    createId = '';
    for (const control of saveButtons) control.disabled = false;
    if (editor.open) editor.close();
    form.reset();
    share.reset();
    share.hidden = true;
    el('share-open').hidden = true;
    el('shared-note').textContent = '공유 메모를 불러오는 중입니다.';
    status.textContent = '';
    render();
  }

  function showEditor(site) {
    if (busy || !state) return;
    editing = site;
    createId = site ? '' : crypto.randomUUID();
    form.reset();
    for (const name of ['name','url','registrar','host','renewOn']) form.elements[name].value = site?.[name] || '';
    el('editor-title').textContent = site ? '웹사이트 관리' : '웹사이트 추가';
    el('editor-status').textContent = '';
    el('remove').hidden = !site;
    el('delete-prompt').hidden = true;
    editor.showModal();
    el('name').focus();
  }

  function closeShare() {
    share.hidden = true;
    share.reset();
    render();
  }

  async function mutate(input, message) {
    if (!session || !state || busy) return;
    const current = session;
    busy = true;
    for (const control of saveButtons) control.disabled = true;
    let completed = false;
    message.textContent = input.action === 'dns' ? 'DNS 응답을 확인하는 중입니다.' : '저장하는 중입니다.';
    try {
      const result = await api(current, input);
      if (result.site) state.sites = [result.site, ...state.sites.filter(site => site.id !== result.site.id)];
      if (result.id) state.sites = state.sites.filter(site => site.id !== result.id);
      if (result.guide) {
        state.guide = result.guide;
        closeShare();
      }
      if (message === el('editor-status') && editor.open) editor.close();
      completed = true;
      if (guideSelected === (input.action === 'share')) status.textContent = input.action === 'dns' ? 'DNS 확인을 마쳤습니다.' :
        input.action === 'remove' ? '목록에서 삭제했습니다.' :
        input.action === 'share' ? '승인된 개인 계정에 공유했습니다.' : '웹사이트를 저장했습니다.';
    } catch (error) {
      if (session !== current || error.name === 'AbortError') return;
      message.textContent = error.message;
      if (message !== status && !editor.open) status.textContent = error.message;
      if (error.status === 409) {
        const refresh = button('다시 불러오기', () => {
          suspend();
          void mount();
        });
        message.append(' ', refresh);
      }
    } finally {
      if (session === current) {
        busy = false;
        for (const control of saveButtons) control.disabled = false;
        const focus = document.activeElement;
        const nextFocus = completed && !editor.open && guideSelected === (input.action === 'share') &&
          (input.action === 'share' || focus === document.body ||
           (input.action === 'dns' && (focus?.dataset.siteAction === 'dns' || focus?.id === 'personal-main')));
        if (completed) render();
        if (nextFocus && input.action === 'share') el('share-open').focus();
        if (nextFocus && input.action !== 'share') {
          const row = [...el('list').children].find(child => child.dataset.siteId === input.id);
          (row?.querySelector('[data-site-action="' + (input.action === 'dns' ? 'dns' : 'edit') + '"]') || el('add')).focus({preventScroll:true});
        }
      }
    }
  }

  el('add').addEventListener('click', () => showEditor(null));
  el('close').addEventListener('click', () => editor.close());
  el('remove').addEventListener('click', () => {
    el('delete-prompt').hidden = false;
    el('remove-confirm').focus();
  });
  el('remove-confirm').addEventListener('click', () => {
    if (editing) void mutate({action:'remove', id:editing.id, version:editing.version}, el('editor-status'));
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void mutate({...Object.fromEntries(new FormData(form)), action:editing?'update':'create',
      id:editing?.id || createId, version:editing?.version}, el('editor-status'));
  });
  el('share-open').addEventListener('click', () => {
    if (busy || !state?.canShare) return;
    share.elements.note.value = state.guide.note;
    share.hidden = false;
    el('share-open').hidden = true;
    share.elements.note.focus();
  });
  el('share-close').addEventListener('click', closeShare);
  share.addEventListener('submit', event => {
    event.preventDefault();
    void mutate({action:'share', note:share.elements.note.value, version:state.guide.version}, status);
  });
  window.NuriPersonalSites = {select, mount, suspend};
})();
