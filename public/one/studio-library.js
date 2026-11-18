'use strict';

window.NuriStudioLibrary = (() => {
  const brands = {one: 'NURI ONE', market: 'NURI MARKET', mind: 'NURI MIND', holdem: 'NURI HOLDEM', crm: 'NURI CRM', common: '공용'};
  const kinds = {logo: '로고', image: '이미지', jpeg: 'JPEG 이미지', link: '링크'};
  const draftsRoute = 'studio/work-drafts';
  const assetsRoute = 'studio/assets';
  const timeFormat = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short'});
  const versions = new Map();
  let editor = null;
  let newKey = '';
  let drafts = null;
  let assets = null;
  let loadedDraftList = false;
  let openedDrafts = false;
  let openedAssets = false;
  let conflict = null;
  let draftBusy = false;
  let assetBusy = false;
  let draftNote = '';
  let assetNote = '';

  const options = values => Object.entries(values).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
  const action = (label, name, id = '', extra = '') =>
    `<button class="btn" type="button" data-library-action="${name}" data-key="${esc(id)}" ${extra}>${label}</button>`;
  const currentKey = () => editor?.source ? `post:${editor.source.id}` : newKey;
  const makeKey = () => `new:${crypto.randomUUID()}`;
  const time = value => timeFormat.format(new Date(value));
  const title = draft => esc(draft.title.trim() || '제목 없는 초안');

  function draftRows() {
    if (!drafts) return '<p class="caption">저장된 작업 초안을 조회하세요.</p>';
    if (!drafts.length) return '<p class="caption">이 계정에 저장된 작업 초안이 없습니다.</p>';
    return `<ul class="studio-library-records">${drafts.map(draft => `<li><div><strong>${title(draft)}</strong>
      <small>${esc(labels[draft.channel] || draft.channel)} · ${draft.sourceId ? '원고 연결' : '독립 초안'} · ${time(draft.updatedAt)} · v${draft.version}</small></div>
      <div class="studio-library-actions">${action('불러오기', 'draft-open', draft.key)}
      ${draft.sourceId ? action('새 편집본으로 열기', 'draft-open-copy', draft.key) : ''}</div></li>`).join('')}</ul>`;
  }

  function conflictPanel() {
    if (!conflict || conflict.local.key !== currentKey()) return '';
    const remote = conflict.remote;
    return `<div class="studio-library-conflict"><strong>다른 기기에서 변경한 작업 초안이 있습니다.</strong>
      ${remote ? `<p class="caption">저장본 v${remote.version} · ${time(remote.updatedAt)} · ${title(remote)}</p>` : ''}
      <div class="studio-library-actions">
      ${remote ? action('저장본 불러오기', 'conflict-open') : ''}
      ${remote?.sourceId ? action('저장본을 새 편집본으로 열기', 'conflict-open-copy') : ''}
      ${action('내 편집본을 사본으로 저장', 'conflict-copy')}
      ${remote ? action('내 편집본으로 교체', 'conflict-replace') : ''}
      </div></div>`;
  }

  function officialImage(asset) {
    if (!asset.official || !/^\/brand\/nuri-(?:(?:one|market)(?:-light)?|holdem-logo)\.svg$/.test(asset.path)) return '';
    return `<img class="studio-library-logo${asset.id.endsWith('-light') ? ' on-light' : ''}" src="${asset.path}" alt="" loading="lazy" decoding="async">`;
  }

  function assetRows() {
    if (!assets) return '<p class="caption">승인된 브랜드 자산을 조회하세요.</p>';
    return `<ul class="studio-library-records">${assets.map(asset => `<li><div>
      ${officialImage(asset)}<strong>${esc(asset.name)}</strong>
      <small>${esc(brands[asset.brand])} · ${esc(kinds[asset.kind])}${asset.approvedAt ? ` · ${time(asset.approvedAt)} 승인` : ''}</small>
      ${asset.lastUsedAt ? `<small>최근 편집기에 사용 · ${time(asset.lastUsedAt)}</small>` : ''}
      <small>${esc(asset.usage)}</small><small>출처 · ${esc(asset.source)}</small></div>
      <div class="studio-library-actions">
      ${editor?.writable && editor.source?.status !== 'scheduled' ? action('편집기에 사용', 'asset-use', asset.id) : ''}
      ${!asset.official ? action('승인 철회', 'asset-withdraw', asset.id) : ''}</div></li>`).join('')}</ul>`;
  }

  function render(optionsForEditor) {
    editor = optionsForEditor.owner ? optionsForEditor : null;
    if (!editor) return '';
    return `<section class="panel studio-tools studio-work-library" id="studio-work-library" aria-label="작업 초안과 브랜드 자산">
      <div class="studio-library-heading"><div><h2>기기 간 작업 초안</h2><p class="caption">저장한 작업 초안을 같은 운영자 계정의 다른 기기에서 이어 쓸 수 있습니다.</p></div>
      ${editor.writable ? action('작업 초안 저장', 'draft-save') : ''}</div>
      <p class="caption studio-library-status" id="studio-library-draft-note" role="status">${esc(draftNote)}</p>
      <div id="studio-library-conflict">${conflictPanel()}</div>
      <details class="studio-library-detail" id="studio-library-drafts" ${openedDrafts ? 'open' : ''}>
      <summary>저장된 작업 초안</summary>
      <div class="studio-library-actions">${action('목록 새로고침', 'draft-list')}</div>
      <div id="studio-library-draft-rows">${draftRows()}</div></details>
      <details class="studio-library-detail" id="studio-library-assets" ${openedAssets ? 'open' : ''}>
      <summary>승인된 브랜드 자산</summary>
      <div class="studio-library-actions">${action('목록 새로고침', 'asset-list')}</div>
      <p class="caption studio-library-status" id="studio-library-asset-note" role="status">${esc(assetNote)}</p>
      <div id="studio-library-asset-rows">${assetRows()}</div>
      <details class="studio-library-add"><summary>승인 자산 등록</summary>
      <form id="studio-library-asset-form" class="form-grid">
      <label class="field">브랜드<select name="brand">${options(brands)}</select></label>
      <label class="field">유형<select name="kind">${options(kinds)}</select></label>
      <label class="field full">이름<input name="name" required maxlength="120"></label>
      <label class="field full">공개 HTTPS 주소<input name="url" required type="url" maxlength="2000" placeholder="https://"></label>
      <label class="field full">출처·권리 근거<input name="source" required maxlength="500"></label>
      <label class="field full">사용 범위<input name="usage" required maxlength="500"></label>
      <label class="field full">대체 텍스트 또는 링크 이름<input name="alt" required maxlength="300"></label>
      <label class="check-label full"><input name="approved" type="checkbox" required>브랜드 사용 권리와 승인 범위를 확인했습니다.</label>
      <div class="full"><button class="btn" type="submit">승인 자산 등록</button></div></form>
      </details></details></section>`;
  }

  function repaint(id, contents) {
    const node = document.getElementById(id);
    if (node) node.innerHTML = contents();
  }

  function note(group, message) {
    if (group === 'draft') draftNote = message;
    else assetNote = message;
    const node = document.getElementById(`studio-library-${group}-note`);
    if (node) node.textContent = message;
  }

  function rememberDraft(draft) {
    const {snapshot, ...summary} = draft;
    drafts = [summary, ...(drafts || []).filter(item => item.key !== draft.key)]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function saveStatus(draft) {
    versions.set(draft.key, draft.version);
    rememberDraft(draft);
    if (draft.key === currentKey()) note('draft', `작업 초안 저장됨 · ${time(draft.updatedAt)} · v${draft.version}`);
  }

  function editorSnapshot() {
    const snapshot = editor?.writable && editor.read();
    if (!snapshot) throw Error('편집할 글을 선택하세요.');
    if (!snapshot.title.trim() && !snapshot.body.trim()) throw Error('제목이나 본문을 먼저 입력하세요.');
    return snapshot;
  }

  function copySnapshot(snapshot) {
    return {...snapshot, id: '', version: '1', campaignId: '', youtubeVideoId: '', youtubeCheckAccount: ''};
  }

  async function persist(local) {
    try {
      const {draft} = await api(draftsRoute, local);
      if (conflict?.local.key === local.key) conflict = null;
      saveStatus(draft);
    } catch (error) {
      if (error.status !== 409 || !error.response) throw error;
      conflict = {local, remote: error.response.draft};
      if (conflict.remote) rememberDraft(conflict.remote);
      if (local.key === currentKey()) note('draft', '동시에 저장됐습니다. 아래에서 계속할 방법을 선택하세요.');
    }
  }

  async function openDraft(key, asNew) {
    const previousEditor = editor;
    const {draft} = await api(`${draftsRoute}?key=${encodeURIComponent(key)}`);
    rememberDraft(draft);
    if (editor !== previousEditor || !document.getElementById('studio-work-library')) return;
    if (!editor.apply(asNew ? copySnapshot(draft.snapshot) : draft.snapshot, asNew)) return;
    if (asNew) newKey = '';
    else {
      if (!draft.sourceId) newKey = draft.key;
      versions.set(draft.key, draft.version);
    }
    conflict = null;
    note('draft', asNew ? '새 편집본으로 열었습니다.' : `작업 초안을 불러왔습니다 · v${draft.version}`);
    document.getElementById('studio-body')?.focus();
  }

  async function draftAction(name, key) {
    if (name === 'draft-list') {
      drafts = (await api(draftsRoute)).drafts;
      loadedDraftList = true;
    } else if (name === 'draft-save') {
      const snapshot = editorSnapshot();
      const activeKey = snapshot.id ? `post:${snapshot.id}` : newKey || (newKey = makeKey());
      await persist({key: activeKey, version: versions.get(activeKey) || 0, snapshot});
    } else if (name === 'draft-open' || name === 'draft-open-copy') {
      await openDraft(key, name.endsWith('-copy'));
    } else if (['conflict-open', 'conflict-open-copy'].includes(name) && conflict?.remote) {
      await openDraft(conflict.remote.key, name.endsWith('-copy'));
    } else if (name === 'conflict-copy' && conflict) {
      const original = conflict;
      const snapshot = copySnapshot(editorSnapshot());
      const {draft} = await api(draftsRoute, {key: makeKey(), version: 0, snapshot});
      if (conflict === original) conflict = null;
      saveStatus(draft);
      if (currentKey() === original.local.key && !editor?.source) newKey = draft.key;
      openedDrafts = true;
      const list = document.getElementById('studio-library-drafts');
      if (list) list.open = true;
      note('draft', '내 편집본을 별도 작업 초안으로 저장했습니다.');
    } else if (name === 'conflict-replace' && conflict?.remote && currentKey() === conflict.local.key) {
      const {key: activeKey, version} = conflict.remote;
      if (confirm(`확인한 작업 초안 v${version}을 지금 편집 중인 내용으로 교체할까요?`)) {
        await persist({key: activeKey, version, snapshot: editorSnapshot()});
      }
    }
  }

  function embedAsset(asset) {
    const form = document.getElementById('studio-content-form');
    if (!editor?.writable || editor.source?.status === 'scheduled' || !form) throw Error('편집할 새 작업 초안을 먼저 여세요.');
    const fields = form.elements;
    if (fields.channel.value === 'instagram') {
      if (asset.kind !== 'jpeg') throw Error('Instagram 미디어에 넣을 JPEG 자산을 선택하세요.');
      if (fields.videoUrl.value) throw Error('릴스 원고에 이미지를 함께 넣을 수 없습니다.');
      if (fields.media.value && fields.media.value !== asset.url && !confirm('첫 이미지 주소를 이 자산으로 바꿀까요?')) return false;
      fields.media.value = asset.url;
      if (!fields.slides.value.trim()) fields.altText.value = asset.alt;
      fields.media.dispatchEvent(new Event('input', {bubbles: true}));
      fields.media.focus();
    } else {
      const body = fields.body;
      const url = asset.url.replace(/[<>\\()\s]/g, value => `%${value.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
      const alt = (asset.alt || asset.name).replace(/[\\[\]*_`]/g, '\\$&');
      const markdown = fields.channel.value === 'blog' ? `${asset.kind === 'link' ? '' : '!'}[${alt}](<${url}>)` : url;
      const start = body.selectionStart;
      const end = body.selectionEnd;
      const inserted = `${start > 0 && body.value[start - 1] !== '\n' ? '\n\n' : ''}${markdown}${end < body.value.length && body.value[end] !== '\n' ? '\n\n' : ''}`;
      if (body.value.length - (end - start) + inserted.length > body.maxLength) throw Error('본문에 자산을 넣을 공간이 부족합니다.');
      body.setRangeText(inserted, start, end, 'end');
      body.dispatchEvent(new Event('input', {bubbles: true}));
      body.focus();
    }
    note('asset', '선택한 자산을 편집기에 넣었습니다.');
    return true;
  }

  async function assetAction(name, key) {
    if (name === 'asset-list') {
      assets = (await api(assetsRoute)).assets;
      note('asset', '');
      return;
    }
    const asset = assets?.find(item => item.id === key);
    if (!asset) throw Error('브랜드 자산을 다시 선택하세요.');
    if (name === 'asset-use') {
      if (!embedAsset(asset)) return;
      const {used} = await api(assetsRoute, {action: 'used', id: key});
      assets = [{...asset, lastUsedAt: used.lastUsedAt}, ...assets.filter(item => item.id !== key)];
    } else if (name === 'asset-withdraw' && confirm(`‘${asset.name}’의 재사용 승인을 철회할까요?`)) {
      await api(assetsRoute, {action: 'withdraw', id: key, version: asset.version});
      assets = assets.filter(item => item.id !== key);
      note('asset', '승인을 철회했습니다.');
    }
  }

  async function runAction(name, key = '', button = null) {
    const isAsset = name.startsWith('asset-');
    const group = isAsset ? 'asset' : 'draft';
    const before = {drafts, assets, conflict};
    if (!editor || (isAsset ? assetBusy : draftBusy)) return;
    if (isAsset) assetBusy = true;
    else draftBusy = true;
    if (button) button.disabled = true;
    try {
      await (isAsset ? assetAction(name, key) : draftAction(name, key));
    } catch (error) {
      note(group, error.message);
    } finally {
      if (isAsset) assetBusy = false;
      else draftBusy = false;
      if (button?.isConnected) button.disabled = false;
      if (drafts !== before.drafts) repaint('studio-library-draft-rows', draftRows);
      if (assets !== before.assets) repaint('studio-library-asset-rows', assetRows);
      if (conflict !== before.conflict) {
        repaint('studio-library-conflict', conflictPanel);
        if (conflict) document.querySelector('#studio-library-conflict button')?.focus();
      }
    }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('#studio-work-library [data-library-action]');
    if (button) void runAction(button.dataset.libraryAction, button.dataset.key, button);
  });

  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!details.isConnected) return;
    if (details.id === 'studio-library-drafts') {
      openedDrafts = details.open;
      if (openedDrafts && !loadedDraftList) void runAction('draft-list');
    }
    if (details.id === 'studio-library-assets') {
      openedAssets = details.open;
      if (openedAssets && !assets) void runAction('asset-list');
    }
  }, true);

  document.addEventListener('change', event => {
    const field = event.target;
    if (field.name === 'kind' && field.form?.id === 'studio-library-asset-form') {
      field.form.elements.alt.required = field.value !== 'link';
    }
  });

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id !== 'studio-library-asset-form') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!editor || assetBusy) return;
    assetBusy = true;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(form));
      values.approved = form.elements.approved.checked;
      const {asset} = await api(assetsRoute, values);
      if (assets) assets = [...assets, asset];
      else assets = (await api(assetsRoute)).assets;
      form.reset();
      form.elements.alt.required = true;
      note('asset', '승인된 브랜드 자산에 추가했습니다.');
    } catch (error) {
      note('asset', error.message);
    } finally {
      assetBusy = false;
      if (submit.isConnected) submit.disabled = false;
      repaint('studio-library-asset-rows', assetRows);
    }
  });

  return {render, resetNew: () => {newKey = ''; draftNote = '';}};
})();
