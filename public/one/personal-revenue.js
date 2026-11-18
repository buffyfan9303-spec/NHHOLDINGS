(() => {
  'use strict';
  const el = id => document.getElementById('personal-revenue-' + id);
  const period = el('period'), dialog = el('editor'), editor = el('editor-form');
  const list = el('list'), status = el('status'), editorStatus = el('editor-status');
  const monthFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'});
  const amount = new Intl.NumberFormat('ko-KR');
  const won = number => amount.format(number) + '원';
  let context, rows, record, saving = false;
  const saveControls = [editor.querySelector('button[type="submit"]'), el('remove-confirm')];

  function currentMonth() {
    const parts = Object.fromEntries(monthFormat.formatToParts(new Date()).map(({type,value}) => [type,value]));
    return parts.year + '-' + parts.month;
  }

  function node(tag, text, className) {
    const item = document.createElement(tag);
    item.textContent = text;
    if (className) item.className = className;
    return item;
  }

  function render() {
    list.replaceChildren();
    el('add').disabled = !rows;
    let income = 0n, expense = 0n;
    for (const entry of rows ?? []) {
      income += BigInt(entry.income);
      expense += BigInt(entry.expense);
      const row = node('article', '', 'personal-site-row');
      row.dataset.revenueId = entry.id;
      row.append(node('h3', entry.name), node('p',
        entry.category + ' · 수익 ' + won(entry.income) + ' · 비용 ' + won(entry.expense)));
      const actions = node('div', '', 'personal-site-actions');
      const manage = node('button', '관리', 'btn');
      manage.type = 'button';
      manage.addEventListener('click', () => open(entry));
      actions.append(manage);
      row.append(actions);
      list.append(row);
    }
    if (rows && !rows.length) list.append(node('p','이달에 기록한 수익이나 비용이 없습니다.','personal-site-empty'));
    const figures = {income, expense, net:income - expense};
    for (const [name,total] of Object.entries(figures)) el(name).textContent = rows?.length ? won(total) : '—';
  }

  async function api(request, input) {
    const response = await fetch('/api/personal/revenue?month=' + encodeURIComponent(request.month), {
      cache:'no-store', signal:request.abort.signal, headers:{
        'X-Personal-Account':request.account, ...(input ? {'Content-Type':'application/json'} : {}),
      }, ...(input ? {method:'POST', body:JSON.stringify(input)} : {}),
    });
    const data = await response.json().catch(() => null);
    if (context !== request || request.account !== window.NuriPersonalAccount) throw new DOMException('', 'AbortError');
    if (!response.ok || !data) {
      const error = Error(data?.error || '수익 기록을 불러오지 못했습니다.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function load() {
    const account = window.NuriPersonalAccount;
    if (!account || saving) return;
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(period.value)) {
      status.textContent = '정산 월을 YYYY-MM 형식으로 입력해 주세요.';
      return;
    }
    context?.abort.abort();
    const request = {account, month:period.value, abort:new AbortController()};
    context = request;
    rows = null;
    render();
    status.textContent = '수익 기록을 불러오는 중입니다.';
    try {
      rows = (await api(request)).entries;
      status.textContent = '';
      render();
    } catch (error) {
      if (context !== request || error.name === 'AbortError') return;
      status.textContent = error.message + ' 조회를 눌러 다시 시도해 주세요.';
    }
  }

  function mount() {
    if (!period.value) period.value = currentMonth();
    if (!context) void load();
  }

  function suspend() {
    context?.abort.abort();
    context = null;
    rows = null;
    record = null;
    saving = false;
    if (dialog.open) dialog.close();
    editor.reset();
    period.value = currentMonth();
    for (const control of saveControls) control.disabled = false;
    status.textContent = '';
    editorStatus.textContent = '';
    render();
  }

  function open(entry) {
    if (!rows || saving) return;
    record = entry || {id:crypto.randomUUID()};
    editor.reset();
    el('editor-title').textContent = entry ? '수익 기록 관리' : '수익 기록 추가';
    el('remove').hidden = !entry;
    el('delete-prompt').hidden = true;
    editorStatus.textContent = '';
    if (entry) {
      for (const name of ['name','category','income','expense']) editor.elements[name].value = entry[name];
    }
    dialog.showModal();
    el('name').focus();
  }

  async function save(action) {
    if (saving || !context || !record) return;
    saving = true;
    for (const button of saveControls) button.disabled = true;
    const request = context;
    const {id, version} = record;
    const fields = Object.fromEntries(new FormData(editor));
    const payload = action === 'remove' ? {action,id,version} : {
      ...fields, action, id, version, period:request.month,
      income:editor.elements.income.valueAsNumber, expense:editor.elements.expense.valueAsNumber,
    };
    editorStatus.textContent = '처리 중입니다.';
    try {
      const result = await api(request, payload);
      rows = rows.filter(row => row.id !== id);
      if (result.entry) rows.unshift(result.entry);
      dialog.close();
      render();
      status.textContent = action === 'remove' ? '수익 기록을 삭제했습니다.' : '수익 기록을 저장했습니다.';
      const saved = [...list.children].find(row => row.dataset.revenueId === id);
      (saved?.querySelector('button') || el('add')).focus({preventScroll:true});
    } catch (error) {
      if (context !== request || error.name === 'AbortError') return;
      editorStatus.textContent = error.message;
      if (!dialog.open) status.textContent = error.message;
    } finally {
      if (context === request) {
        saving = false;
        for (const button of saveControls) button.disabled = false;
      }
    }
  }

  el('period-form').addEventListener('submit', event => {event.preventDefault(); void load();});
  el('add').addEventListener('click', () => open(null));
  el('close').addEventListener('click', () => dialog.close());
  el('remove').addEventListener('click', () => {
    el('delete-prompt').hidden = false;
    el('remove-confirm').focus();
  });
  el('remove-confirm').addEventListener('click', () => void save('remove'));
  editor.addEventListener('submit', event => {event.preventDefault(); void save(record?.version ? 'update' : 'create');});
  window.NuriPersonalRevenue = {mount, suspend};
})();
