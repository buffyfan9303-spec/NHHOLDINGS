'use strict';

// 서비스 연결 작업(#connector-workflow). 모든 화면 문자열은 textContent로만 넣는다.
// 서버는 키·토큰을 돌려주지 않으며, 이 모듈도 입력한 비밀값을 상태·DOM 속성·URL에 남기지 않는다.
(() => {
  const ENDPOINT = '/api/personal/connectors';
  const dayFormatter = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'});
  const stampFormatter = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const dateOnlyFormatter = new Intl.DateTimeFormat('ko-KR', {timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short'});

  const GOOGLE_APP = [
    'Google Cloud Console에서 프로젝트를 만들고 ‘OAuth 동의 화면’을 설정합니다. 테스트 상태라면 본인 Google 계정을 테스트 사용자로 추가하세요.',
    '아래 안내된 API를 ‘API 및 서비스 → 라이브러리’에서 사용 설정합니다.',
    '‘사용자 인증 정보 → OAuth 클라이언트 ID(웹 애플리케이션)’를 만들고, ‘승인된 리디렉션 URI’에 이 화면의 콜백 주소를 그대로 추가합니다.',
    '발급된 클라이언트 ID와 클라이언트 보안 비밀번호를 ‘앱 정보 저장’에 입력합니다. 저장 뒤에는 화면에 다시 표시되지 않습니다.',
    '‘계정 연결’을 누르고 Google 승인 화면에서 요청 권한을 확인한 뒤 허용합니다.',
  ];

  const PROVIDERS = [
    {
      id: 'gmail', name: 'Gmail', kind: 'oauth',
      summary: '‘누리원’ 라벨을 붙인 메일에서 할 일을 만들고, 답장은 승인 대기 초안으로만 만듭니다.',
      scope: ['요청 권한: 메일 제목·보낸 사람·미리보기 읽기(읽기 전용)', '누리원은 이 연결로 메일을 보내거나 삭제하지 않습니다. 답장 초안은 ‘메일 예약’의 초안으로 들어가며 직접 승인해야 발송됩니다.'],
      api: 'Gmail API', credentials: ['클라이언트 ID', '클라이언트 보안 비밀번호'], steps: GOOGLE_APP,
    },
    {
      id: 'calendar', name: 'Google Calendar', kind: 'oauth',
      summary: '할 일을 일정 제안으로 만들고, 승인한 제안만 내 Google 캘린더에 저장합니다.',
      scope: ['요청 권한: 내 캘린더의 빈 시간 확인 및 일정 만들기', '제안 단계에서는 캘린더에 아무것도 저장하지 않습니다. 별도의 ‘캘린더에 저장’ 클릭이 있어야 저장됩니다.'],
      api: 'Google Calendar API', credentials: ['클라이언트 ID', '클라이언트 보안 비밀번호'], steps: GOOGLE_APP,
    },
    {
      id: 'analytics', name: 'Google Analytics · YouTube', kind: 'oauth',
      summary: '사이트 세션·사용자와 내 YouTube 채널 조회수·시청 시간을 읽습니다.',
      scope: ['요청 권한: Google Analytics 데이터와 YouTube 채널 분석 읽기(읽기 전용)', '사이트 지표는 입력한 GA4 속성, 채널 지표는 승인한 Google 계정의 YouTube 채널 기준입니다.', 'GA4 속성 ID는 Analytics 관리 → 속성 설정에 있는 숫자입니다(측정 ID “G-…”가 아닙니다).'],
      api: 'Google Analytics Data API, YouTube Analytics API, YouTube Data API v3', credentials: ['클라이언트 ID', '클라이언트 보안 비밀번호'], steps: GOOGLE_APP,
    },
    {
      id: 'kakao', name: '카카오톡 나에게 보내기', kind: 'oauth',
      summary: '지금 열려 있는 할 일 요약을 내 카카오톡 ‘나와의 채팅’으로 보냅니다.',
      scope: ['요청 권한: 카카오톡 메시지 전송(talk_message) — 나에게 보내기만 사용합니다.', '친구에게는 보내지 않으며, 메시지는 ‘보내기’를 직접 누를 때만 전송됩니다.'],
      credentials: ['REST API 키', 'Client Secret'],
      steps: [
        'Kakao Developers에서 앱을 만들고 ‘카카오 로그인’을 활성화합니다.',
        '카카오 로그인의 ‘Redirect URI’에 이 화면의 콜백 주소를 그대로 등록합니다.',
        '‘동의항목’에서 ‘카카오톡 메시지 전송(talk_message)’을 설정합니다.',
        '‘보안’에서 Client Secret을 발급하고, 앱 키의 REST API 키와 함께 아래에 저장합니다.',
        '‘계정 연결’을 누르고 카카오 동의 화면에서 권한을 확인한 뒤 허용합니다.',
      ],
    },
    {
      id: 'notion', name: 'Notion', kind: 'token',
      summary: '지정한 페이지의 본문 블록을 읽어 화면에서 확인합니다.',
      scope: ['필요한 권한: 내부 통합의 ‘콘텐츠 읽기’ 하나', '통합을 연결한 페이지만 읽습니다. 쓰기·수정·삭제는 하지 않습니다.'],
      resourceLabel: 'Notion 페이지 ID', resourceHint: 'URL 끝의 32자리 ID 또는 UUID', tokenLabel: 'Notion 통합 토큰',
      steps: [
        'Notion ‘설정 → 연결(Integrations) → 내부 통합 만들기’에서 통합을 만들고 ‘콘텐츠 읽기’만 허용합니다.',
        '통합의 내부 통합 시크릿(토큰)을 복사합니다.',
        '읽을 페이지 오른쪽 위 ‘⋯ → 연결’에서 방금 만든 통합을 추가합니다.',
        '페이지 주소 끝의 32자리 ID(또는 UUID)와 토큰을 입력해 연결합니다.',
      ],
    },
    {
      id: 'github', name: 'GitHub', kind: 'token',
      summary: '저장소 하나의 최근 워크플로 실행과 열린 풀 리퀘스트를 읽습니다.',
      scope: ['필요한 권한: 저장소 하나에 대한 Actions 읽기, Pull requests 읽기(메타데이터 읽기는 자동 포함)', '코드 쓰기·이슈 수정·병합은 하지 않습니다. 토큰은 저장소를 하나만 선택한 세분화된 토큰을 권장합니다.'],
      resourceLabel: 'GitHub 저장소', resourceHint: '소유자/저장소 형식. 예: octocat/hello-world', tokenLabel: 'GitHub 세분화된 개인 액세스 토큰',
      steps: [
        'GitHub ‘Settings → Developer settings → Fine-grained personal access tokens’에서 새 토큰을 만듭니다.',
        '‘Only select repositories’에서 읽을 저장소 하나만 고르고 Actions: Read-only, Pull requests: Read-only만 허용합니다.',
        '만료일을 짧게 정하고 토큰을 복사합니다. 한 번만 보이므로 바로 입력하세요.',
        '‘소유자/저장소’와 토큰을 입력해 연결합니다.',
      ],
    },
  ];

  const root = document.getElementById('connector-workflow-root');
  let owner = null, controller = null, services = new Map(), callback = '', serverTasks = [], projects = [], loaded = false, loadError = '';
  let busy = false, notice = null;
  const cards = new Map();
  const results = new Map();
  const proposals = new Map();

  function h(tag, props, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else if (key === 'data') for (const [name, item] of Object.entries(value)) node.dataset[name] = item;
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) if (child !== undefined && child !== null && child !== false) node.append(child);
    return node;
  }
  const p = (text, cls) => h('p', {text, class: cls});
  const today = () => dayFormatter.format(new Date());
  const alive = () => !!controller && !controller.signal.aborted && window.NuriPersonalAccount === owner && owner !== null;
  const safeHttps = value => {
    try {
      const url = new URL(String(value));
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  };
  const clip = (value, max) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  };
  const show = (value, max) => clip(value, max) || '(내용 없음)';
  const number = value => Number.isFinite(Number(value)) ? new Intl.NumberFormat('ko-KR').format(Number(value)) : '-';

  function openTasks() {
    const own = window.NuriPersonalWorkspace?.tasks?.();
    const rows = Array.isArray(own) && own.length ? own : serverTasks;
    return rows.filter(row => row && typeof row.id === 'string' && row.id);
  }
  function when(value) {
    const text = String(value ?? '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dateOnlyFormatter.format(new Date(text + 'T00:00:00+09:00')) + ' (종일)';
    const date = new Date(text);
    return Number.isNaN(+date) ? clip(text, 40) : stampFormatter.format(date);
  }

  // ---- 요청 ---------------------------------------------------------------
  async function call(body, timeout = 30000) {
    if (!alive()) throw new DOMException('stale', 'AbortError');
    const parent = controller.signal;
    const signal = AbortSignal.any && AbortSignal.timeout ? AbortSignal.any([parent, AbortSignal.timeout(timeout)]) : parent;
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', signal,
        headers: body ? {'Content-Type': 'application/json', 'X-Personal-Account': owner} : {'X-Personal-Account': owner},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (parent.aborted) throw error;
      throw Error(error?.name === 'TimeoutError' ? '응답 시간이 지났습니다. 잠시 뒤 다시 시도해 주세요.' : '네트워크 연결을 확인해 주세요.');
    }
    if (!alive()) throw new DOMException('stale', 'AbortError');
    if (response.status === 401) { location.assign('/login'); throw Error('로그인을 확인해 주세요.'); }
    const result = await response.json().catch(() => null);
    if (!alive()) throw new DOMException('stale', 'AbortError');
    if (!response.ok) {
      const reason = response.status === 403 || response.status === 409 ? '계정 확인이 필요합니다. 화면을 다시 불러온 뒤 시도해 주세요.' : '요청을 처리하지 못했습니다.';
      throw Error(clip(typeof result?.error === 'string' && result.error ? result.error : reason, 240));
    }
    if (!result || typeof result !== 'object') throw Error('서버 응답을 읽지 못했습니다.');
    return result;
  }

  // 요청 중에는 모든 입력·버튼을 잠그고, 끝나면 원래 비활성 상태로 되돌린다.
  function lock(on) {
    busy = on;
    root.setAttribute('aria-busy', String(on));
    for (const control of root.querySelectorAll('button, input, select, textarea')) {
      if (on) {
        control.dataset.wasDisabled = control.disabled ? '1' : '';
        control.disabled = true;
      } else if (control.dataset.wasDisabled !== undefined) {
        control.disabled = control.dataset.wasDisabled === '1';
        delete control.dataset.wasDisabled;
      }
    }
  }
  async function run(card, pending, task) {
    if (busy || !alive()) return;
    const focused = root.contains(document.activeElement) ? document.activeElement : null;
    lock(true);
    say(card, pending);
    try {
      await task();
    } catch (error) {
      if (!alive() || error?.name === 'AbortError') return;
      say(card, error.message || '요청을 처리하지 못했습니다.', true);
    } finally {
      if (alive()) {
        lock(false);
        if (focused?.isConnected && !focused.disabled && document.activeElement === document.body) focused.focus({preventScroll: true});
      }
    }
  }
  function say(card, text, error = false) {
    const target = cards.get(card)?.status;
    if (!target) return;
    target.textContent = text;
    target.classList.toggle('is-error', error);
    target.setAttribute('role', error ? 'alert' : 'status');
  }
  const wipe = form => { for (const input of form.querySelectorAll('input[type=password]')) input.value = ''; };

  // ---- 화면 ---------------------------------------------------------------
  function state(provider) {
    const found = services.get(provider.id);
    if (!found) return {known: false, connected: false, configured: false};
    const config = String(found.config ?? '').trim().toLowerCase();
    return {
      known: true, connected: found.connected === true,
      configured: provider.kind === 'oauth' ? config !== '' && !['missing', 'none', 'unconfigured', 'false', '0'].includes(config) : true,
    };
  }

  function badge(text, tone) { return h('span', {class: 'cw-badge cw-' + tone, text}); }

  function statusOf(provider) {
    const s = state(provider);
    if (!s.known) return badge('상태 확인 불가', 'warn');
    if (s.connected) return badge('연결됨', 'ok');
    if (provider.kind === 'oauth' && !s.configured) return badge('앱 설정 필요', 'warn');
    if (provider.kind === 'oauth') return badge('계정 연결 필요', 'idle');
    return badge('연결 필요', 'idle');
  }

  function guide(provider) {
    return h('details', {class: 'cw-guide'},
      h('summary', {text: '설정 방법과 권한 범위'}),
      provider.api ? p('사용 설정할 API: ' + provider.api) : null,
      h('ol', null, provider.steps.map(step => h('li', {text: step}))),
      h('ul', {class: 'cw-scope'}, provider.scope.map(line => h('li', {text: line}))),
    );
  }

  function field(id, label, props) {
    return h('div', {class: 'cw-field'}, h('label', {for: id, text: label}), h('input', {id, ...props}));
  }

  function callbackRow(provider) {
    const id = 'cw-' + provider.id + '-callback';
    const input = h('input', {id, readonly: true, value: callback || '', placeholder: callback ? '' : '서버에서 콜백 주소를 받지 못했습니다'});
    input.value = callback || '';
    const status = h('span', {class: 'cw-copy-status', role: 'status'});
    const copy = h('button', {type: 'button', class: 'btn', text: '주소 복사', disabled: !callback});
    copy.addEventListener('click', async () => {
      if (!callback) return;
      try {
        await navigator.clipboard.writeText(callback);
        status.textContent = '복사했습니다.';
      } catch {
        input.focus(); input.select();
        status.textContent = '직접 선택해 복사해 주세요.';
      }
    });
    return h('div', {class: 'cw-field cw-callback'},
      h('label', {for: id, text: '콜백(리디렉션) 주소 — 제공 서비스 앱 설정에 그대로 등록'}),
      h('div', {class: 'cw-inline'}, input, copy), status);
  }

  function configureForm(provider, open) {
    const form = h('form', {class: 'cw-form', autocomplete: 'off', novalidate: true});
    const [idLabel, secretLabel] = provider.credentials;
    form.append(
      callbackRow(provider),
      field('cw-' + provider.id + '-client', idLabel, {name: 'clientId', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true, maxlength: 300}),
      field('cw-' + provider.id + '-secret', secretLabel, {name: 'clientSecret', type: 'password', autocomplete: 'new-password', required: true, maxlength: 600}),
      h('div', {class: 'cw-actions'}, h('button', {type: 'submit', class: 'btn primary', text: '앱 정보 저장'})),
    );
    form.addEventListener('submit', event => {
      event.preventDefault();
      const clientId = form.elements.clientId.value.trim(), clientSecret = form.elements.clientSecret.value.trim();
      if (!clientId || !clientSecret) { say(provider.id, idLabel + '와 ' + secretLabel + '를 모두 입력해 주세요.', true); return; }
      void run(provider.id, '앱 정보를 저장하는 중입니다…', async () => {
        try {
          await call({action: 'configure', provider: provider.id, clientId, clientSecret});
        } finally {
          if (alive()) wipe(form);
        }
        await reload('앱 정보를 저장했습니다. 이제 ‘계정 연결’을 눌러 승인하세요.', provider.id);
      });
    });
    return open ? form : h('details', {class: 'cw-guide'}, h('summary', {text: '앱 정보 다시 입력'}), form);
  }

  function tokenForm(provider) {
    const form = h('form', {class: 'cw-form', autocomplete: 'off', novalidate: true});
    const resourceId = 'cw-' + provider.id + '-resource';
    form.append(
      h('div', {class: 'cw-field'}, h('label', {for: resourceId, text: provider.resourceLabel}),
        h('input', {id: resourceId, name: 'resource', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', required: true, maxlength: 140, 'aria-describedby': resourceId + '-hint'}),
        h('small', {id: resourceId + '-hint', text: provider.resourceHint})),
      field('cw-' + provider.id + '-token', provider.tokenLabel, {name: 'token', type: 'password', autocomplete: 'new-password', required: true, maxlength: 600}),
      h('div', {class: 'cw-actions'}, h('button', {type: 'submit', class: 'btn primary', text: '연결'})),
    );
    form.addEventListener('submit', event => {
      event.preventDefault();
      const resource = form.elements.resource.value.trim().replace(/^https:\/\/github\.com\//i, '').replace(/\/+$/, '');
      const token = form.elements.token.value.trim();
      const valid = provider.id === 'notion'
        ? /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(resource)
        : /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(resource);
      if (!valid) { say(provider.id, provider.id === 'notion' ? 'Notion 페이지 ID는 32자리 영문·숫자(또는 UUID)여야 합니다.' : '저장소는 ‘소유자/저장소’ 형식으로 입력해 주세요.', true); form.elements.resource.focus(); return; }
      if (!token) { say(provider.id, '토큰을 입력해 주세요.', true); form.elements.token.focus(); return; }
      void run(provider.id, '연결을 확인하는 중입니다…', async () => {
        try {
          await call({action: 'connect', provider: provider.id, token, resource});
        } finally {
          if (alive()) wipe(form);
        }
        results.delete(provider.id);
        await reload(provider.name + ' 연결을 저장했습니다.', provider.id);
      });
    });
    return form;
  }

  function authorizeButton(provider) {
    const button = h('button', {type: 'button', class: 'btn primary', text: '계정 연결'});
    button.addEventListener('click', () => void run(provider.id, '승인 주소를 받는 중입니다…', async () => {
      const result = await call({action: 'authorize', provider: provider.id});
      const url = safeHttps(result.url);
      if (!url) throw Error('승인 주소가 올바르지 않아 이동하지 않았습니다.');
      say(provider.id, '승인 화면으로 이동합니다…');
      location.assign(url);
    }));
    return button;
  }

  function disconnectControl(provider) {
    const box = h('div', {class: 'cw-disconnect'});
    const ask = h('button', {type: 'button', class: 'btn', text: '연결 해제'});
    const confirm = h('div', {class: 'cw-confirm', hidden: true},
      p(provider.name + ' 연결을 해제하면 저장된 인증이 사라지고 이 화면의 읽은 내용도 지워집니다.'));
    const yes = h('button', {type: 'button', class: 'btn cw-danger', text: '해제하기'});
    const no = h('button', {type: 'button', class: 'btn', text: '취소'});
    confirm.append(h('div', {class: 'cw-actions'}, yes, no));
    ask.addEventListener('click', () => { confirm.hidden = false; ask.hidden = true; no.focus(); });
    no.addEventListener('click', () => { confirm.hidden = true; ask.hidden = false; ask.focus(); });
    yes.addEventListener('click', () => void run(provider.id, '연결을 해제하는 중입니다…', async () => {
      await call({action: 'disconnect', provider: provider.id});
      results.delete(provider.id); proposals.delete(provider.id);
      await reload(provider.name + ' 연결을 해제했습니다.', provider.id);
    }));
    box.append(ask, confirm);
    return box;
  }

  // ---- 연결된 서비스별 작업 ------------------------------------------------
  function taskSelect(id, label) {
    const select = h('select', {id, name: 'taskId', required: true, data: {taskSelect: '1'}});
    fillTasks(select);
    return h('div', {class: 'cw-field'}, h('label', {for: id, text: label}), select,
      h('small', {text: '‘할 일’ 화면의 미완료 항목에서 고릅니다.'}));
  }
  function fillTasks(select) {
    const rows = openTasks(), keep = select.value;
    const signature = rows.map(row => row.id + '\n' + row.title).join('\u0000');
    if (select.dataset.signature === signature) return;
    select.dataset.signature = signature;
    select.replaceChildren(h('option', {value: '', text: rows.length ? '할 일을 선택하세요' : '선택할 미완료 할 일이 없습니다'}),
      ...rows.map(row => h('option', {value: row.id, text: clip(row.title, 80) || '(제목 없음)'})));
    select.value = rows.some(row => row.id === keep) ? keep : '';
  }

  function calendarPanel(provider) {
    const wrap = h('div', {class: 'cw-work'});
    const form = h('form', {class: 'cw-form', novalidate: true});
    form.append(
      h('div', {class: 'cw-field'}, h('label', {for: 'cw-calendar-date', text: '일정 날짜'}),
        h('input', {id: 'cw-calendar-date', name: 'date', type: 'date', value: today(), required: true})),
      taskSelect('cw-calendar-task', '일정으로 만들 할 일'),
      h('div', {class: 'cw-actions'}, h('button', {type: 'submit', class: 'btn primary', text: '일정 제안 만들기'})),
    );
    const slot = h('div', {class: 'cw-proposal', 'aria-live': 'polite'});
    const paint = () => {
      const proposal = proposals.get(provider.id);
      slot.replaceChildren();
      if (!proposal) return;
      const approve = h('button', {type: 'button', class: 'btn primary', text: '이 일정을 Google Calendar에 저장'});
      approve.addEventListener('click', () => void run(provider.id, '캘린더에 저장하는 중입니다…', async () => {
        const result = await call({action: 'approve', provider: 'calendar', proposalId: proposal.id});
        if (result.saved !== true) throw Error('저장 결과를 확인하지 못했습니다. 캘린더를 직접 확인해 주세요.');
        proposals.delete(provider.id); paint();
        say(provider.id, '‘' + clip(proposal.title, 60) + '’ 일정을 Google Calendar와 누리원에 저장했습니다.');
        window.dispatchEvent(new Event('personal-automation-changed'));
      }));
      slot.append(h('div', {class: 'cw-card-inner'},
        h('strong', {text: '저장 전 제안 — 아직 캘린더에 없습니다'}),
        h('dl', null, h('dt', {text: '제목'}), h('dd', {text: show(proposal.title, 160)}),
          h('dt', {text: '시작'}), h('dd', {text: when(proposal.start)}), h('dt', {text: '종료'}), h('dd', {text: when(proposal.end)})),
        h('div', {class: 'cw-actions'}, approve)));
    };
    const invalidate = () => { if (proposals.delete(provider.id)) { paint(); say(provider.id, '조건이 바뀌어 이전 제안을 지웠습니다. 다시 제안을 만들어 주세요.'); } };
    form.elements.date.addEventListener('change', invalidate);
    form.elements.taskId.addEventListener('change', invalidate);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const date = form.elements.date.value, taskId = form.elements.taskId.value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { say(provider.id, '날짜를 선택해 주세요.', true); return; }
      if (!taskId) { say(provider.id, '일정으로 만들 할 일을 선택해 주세요.', true); return; }
      void run(provider.id, '일정 제안을 만드는 중입니다…', async () => {
        const result = await call({action: 'propose', provider: 'calendar', date, taskId});
        const row = result.proposal;
        if (!row || typeof row.id !== 'string' || !row.id) throw Error('일정 제안을 받지 못했습니다.');
        proposals.set(provider.id, {id: row.id, title: row.title, start: row.start, end: row.end});
        paint();
        say(provider.id, '제안을 확인한 뒤, 맞으면 저장 버튼을 눌러 주세요.');
      });
    });
    paint();
    wrap.append(form, slot);
    return wrap;
  }

  function resultList(items, render) {
    return h('ul', {class: 'cw-list'}, items.map(render));
  }

  function readButton(provider, label, apply, extra) {
    const button = h('button', {type: 'button', class: 'btn', text: label});
    button.addEventListener('click', () => {
      const more = extra ? extra() : {};
      if (more === null) return;
      const body = {action: 'read', provider: provider.id, ...more};
      void run(provider.id, '불러오는 중입니다…', async () => {
        const result = await call(body);
        if (!result.data) throw Error('불러온 내용이 없습니다.');
        results.set(provider.id, result.data);
        apply();
        say(provider.id, '최신 내용을 불러왔습니다.');
      });
    });
    return button;
  }

  function gmailPanel(provider) {
    const out = h('div', {class: 'cw-out', 'aria-live': 'polite'});
    const draft = gmailDraft(provider);
    const paint = () => {
      const data = results.get(provider.id);
      out.replaceChildren();
      if (!Array.isArray(data)) return;
      if (!data.length) { out.append(p('표시할 메일이 없습니다.', 'cw-empty')); return; }
      out.append(resultList(data.slice(0, 20), mail => {
        const task = h('button', {type: 'button', class: 'btn', text: '할 일로 추가', 'aria-label': '‘' + clip(mail.title, 40) + '’ 메일을 할 일로 추가'});
        task.addEventListener('click', () => void run(provider.id, '할 일로 추가하는 중입니다…', async () => {
          if (typeof mail.id !== 'string' || !mail.id) throw Error('메일 ID가 없어 추가하지 못했습니다.');
          const result = await call({action: 'task', provider: 'gmail', messageId: mail.id});
          task.textContent = '추가됨';
          task.dataset.wasDisabled = '1';
          say(provider.id, '‘' + clip(result.task?.title || mail.title, 60) + '’ 할 일을 만들었습니다. 같은 메일은 중복해서 만들지 않습니다.');
          window.dispatchEvent(new Event('personal-automation-changed'));
        }));
        const reply = h('button', {type: 'button', class: 'btn', text: '답장 초안 쓰기', 'aria-label': '‘' + clip(mail.title, 40) + '’ 메일 답장 초안 쓰기'});
        reply.addEventListener('click', () => {
          const form = draft.querySelector('form');
          const match = String(mail.from ?? '').match(/<([^<>\s@]+@[^<>\s@]+)>/) || String(mail.from ?? '').match(/^([^<>\s@]+@[^<>\s@]+)$/);
          form.elements.to.value = match ? match[1] : '';
          form.elements.subject.value = /^re:/i.test(mail.title ?? '') ? clip(mail.title, 160) : 'Re: ' + clip(mail.title, 150);
          draft.open = true;
          form.elements[match ? 'body' : 'to'].focus();
        });
        return h('li', null, h('div', {class: 'cw-row-text'}, h('strong', {text: show(mail.title, 120)}),
          h('small', {text: show(mail.from, 100)}), p(clip(mail.snippet, 200), 'cw-snippet')),
          h('div', {class: 'cw-row-actions'}, task, reply));
      }));
    };
    paint();
    return h('div', {class: 'cw-work'},
      h('div', {class: 'cw-actions'}, readButton(provider, '받은 메일 불러오기', paint)), out, draft);
  }

  function gmailDraft(provider) {
    const details = h('details', {class: 'cw-guide cw-draft'}, h('summary', {text: '답장 초안 만들기(승인 전에는 발송되지 않음)'}));
    const form = h('form', {class: 'cw-form', novalidate: true});
    const done = h('p', {class: 'cw-note', hidden: true});
    form.append(
      field('cw-gmail-to', '받는 사람 이메일', {name: 'to', type: 'email', autocomplete: 'off', required: true, maxlength: 254}),
      field('cw-gmail-subject', '제목', {name: 'subject', type: 'text', required: true, maxlength: 160}),
      h('div', {class: 'cw-field'}, h('label', {for: 'cw-gmail-body', text: '본문'}), h('textarea', {id: 'cw-gmail-body', name: 'body', rows: 5, required: true, maxlength: 5000})),
      h('div', {class: 'cw-actions'}, h('button', {type: 'submit', class: 'btn primary', text: '메일 예약 초안으로 보내기'})), done);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const to = form.elements.to.value.trim(), subject = form.elements.subject.value.trim(), body = form.elements.body.value.trim();
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) { say(provider.id, '받는 사람 이메일 형식을 확인해 주세요.', true); form.elements.to.focus(); return; }
      if (!subject || !body) { say(provider.id, '제목과 본문을 입력해 주세요.', true); return; }
      void run(provider.id, '초안을 만드는 중입니다…', async () => {
        const result = await call({action: 'draft', provider: 'gmail', to, subject, body});
        if (!result.draft) throw Error('초안 생성 결과를 확인하지 못했습니다.');
        form.reset();
        done.hidden = false;
        done.replaceChildren('초안을 만들었습니다. 아직 발송되지 않았습니다. ',
          h('a', {href: '#mail', class: 'personal-link', text: '메일 예약에서 확인하고 승인하기'}));
        say(provider.id, '초안을 메일 예약에 넣었습니다. 승인 전에는 발송되지 않습니다.');
        window.dispatchEvent(new Event('personal-automation-changed'));
      });
    });
    details.append(form);
    return details;
  }

  function projectPicker(id,label) {
    const select=h('select',{id},h('option',{value:'',text:'프로젝트 선택'}),
      projects.map(project=>h('option',{value:project.id,text:clip(project.name,100)})));
    return h('div',{class:'cw-field'},h('label',{for:id,text:label}),select);
  }

  function analyticsPanel(provider) {
    const out = h('div', {class: 'cw-out', 'aria-live': 'polite'});
    const prop = h('div', {class: 'cw-field'}, h('label', {for: 'cw-analytics-property', text: 'GA4 속성 ID(숫자)'}),
      h('input', {id: 'cw-analytics-property', name: 'property', type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: 20, pattern: '[0-9]*'}),
      h('small', {text: 'Analytics 관리 → 속성 설정의 숫자입니다. 비워 두면 채널 지표만 요청합니다.'}));
    const input = prop.querySelector('input');
    const project = projectPicker('cw-analytics-project','주간 리뷰에 저장할 프로젝트');
    const paint = () => {
      const data = results.get(provider.id);
      out.replaceChildren();
      if (!data || typeof data !== 'object') return;
      const channel = Array.isArray(data.channel) ? data.channel : [], site = Array.isArray(data.site) ? data.site : [];
      if(data.period)out.append(p(data.period.start+' ~ '+data.period.end,'cw-note'));
      if(data.unavailable?.length)out.append(p(data.unavailable.join(', ')+' 지표의 연결 권한을 확인해 주세요.','cw-note'));
      out.append(h('h4', {text: 'YouTube 채널'}), channel.length ? table(['조회수', '시청 시간(분)'], channel.map(row => [number(row.views), number(row.minutes)])) : p('채널 지표가 없습니다.', 'cw-empty'),
        h('h4', {text: '사이트(GA4)'}), site.length ? table(['세션', '사용자'], site.map(row => [number(row.sessions), number(row.users)])) : p('사이트 지표가 없습니다.', 'cw-empty'));
    };
    const button = readButton(provider, '지표 불러오기', paint, () => {
      const value = input.value.trim();
      if (value && !/^\d{1,20}$/.test(value)) { say(provider.id, 'GA4 속성 ID는 숫자만 입력해 주세요.', true); input.focus(); return null; }
      return {property:value,projectId:project.querySelector('select').value};
    });
    paint();
    return h('div', {class: 'cw-work'}, prop, project, h('div', {class: 'cw-actions'}, button,
      h('a',{class:'personal-link',href:'/personal?workbench=weekly#workbench',text:'프로젝트 주간 리뷰'})), out);
  }

  function table(headers, rows) {
    return h('div', {class: 'cw-table'}, h('table', null,
      h('thead', null, h('tr', null, headers.map(text => h('th', {scope: 'col', text})))),
      h('tbody', null, rows.slice(0, 20).map(row => h('tr', null, row.map(cell => h('td', {text: cell})))))));
  }

  function notionPanel(provider) {
    const out = h('div', {class: 'cw-out', 'aria-live': 'polite'});
    const paint = () => {
      const data = results.get(provider.id);
      out.replaceChildren();
      if (!data || !Array.isArray(data.blocks)) return;
      out.append(data.blocks.length ? h('ul', {class: 'cw-list cw-blocks'}, data.blocks.slice(0, 60).map(block => h('li', null, p(clip(block, 400))))) : p('표시할 블록이 없습니다.', 'cw-empty'));
    };
    const project=projectPicker('cw-notion-project','참고 자료를 저장할 프로젝트');
    const save=h('button',{type:'button',class:'btn',text:'프로젝트 메모에 저장'});
    save.addEventListener('click',()=>{
      const projectId=project.querySelector('select').value;
      if(!projectId){say(provider.id,'프로젝트를 선택해 주세요.',true);return;}
      void run(provider.id,'참고 자료를 저장하는 중입니다…',async()=>{
        await call({action:'save-reference',provider:'notion',projectId});
        say(provider.id,'선택한 프로젝트에 Notion 참고 자료를 저장했습니다.');
        window.dispatchEvent(new Event('personal-automation-changed'));
      });
    });
    paint();
    return h('div', {class: 'cw-work'}, h('div', {class: 'cw-actions'}, readButton(provider, '페이지 내용 불러오기', paint)), out, project, save);
  }

  function githubPanel(provider) {
    const out = h('div', {class: 'cw-out', 'aria-live': 'polite'});
    const entry = (title, status, url) => {
      const href = safeHttps(url);
      return h('li', null, h('div', {class: 'cw-row-text'},
        href ? h('a', {href, target: '_blank', rel: 'noopener noreferrer', text: show(title, 140)}) : h('strong', {text: show(title, 140)}),
        status ? h('small', {text: clip(status, 40)}) : null));
    };
    const paint = () => {
      const data = results.get(provider.id);
      out.replaceChildren();
      if (!data || typeof data !== 'object') return;
      const runs = Array.isArray(data.runs) ? data.runs : [], pulls = Array.isArray(data.pulls) ? data.pulls : [];
      out.append(h('h4', {text: '최근 워크플로 실행'}), runs.length ? h('ul', {class: 'cw-list'}, runs.slice(0, 15).map(row => entry(row.name, row.status, row.url))) : p('실행 기록이 없습니다.', 'cw-empty'),
        h('h4', {text: '열린 풀 리퀘스트'}), pulls.length ? h('ul', {class: 'cw-list'}, pulls.slice(0, 15).map(row => entry(row.title, '', row.url))) : p('열린 풀 리퀘스트가 없습니다.', 'cw-empty'));
    };
    paint();
    return h('div', {class: 'cw-work'}, h('div', {class: 'cw-actions'}, readButton(provider, '저장소 상태 불러오기', paint)), out);
  }

  function kakaoPanel(provider) {
    const tasks = openTasks();
    const send = h('button', {type: 'button', class: 'btn primary', text: '내 카카오톡으로 지금 보내기'});
    send.addEventListener('click', () => void run(provider.id, '카카오톡으로 보내는 중입니다…', async () => {
      await call({action: 'deliver', provider: 'kakao'});
      say(provider.id, '내 카카오톡 ‘나와의 채팅’으로 요약을 보냈습니다.');
    }));
    return h('div', {class: 'cw-work'},
      p('버튼을 누르면 그 시점의 미완료 할 일 요약을 내 카카오톡 ‘나와의 채팅’으로 한 번 보냅니다. 자동으로 반복 발송하지 않습니다.'),
      p('이 화면 기준 미완료 할 일: ' + tasks.length + '건', 'cw-note'),
      h('div', {class: 'cw-actions'}, send));
  }

  const PANELS = {calendar: calendarPanel, gmail: gmailPanel, analytics: analyticsPanel, notion: notionPanel, github: githubPanel, kakao: kakaoPanel};

  function card(provider) {
    const s = state(provider);
    const title = h('h3', {id: 'cw-' + provider.id + '-title', tabindex: '-1', text: provider.name});
    const status = h('p', {class: 'cw-status', role: 'status'});
    const body = h('div', {class: 'cw-body'});
    body.append(p(provider.summary, 'cw-summary'));
    if (!s.known) {
      body.append(p('서버에서 이 서비스의 연결 상태를 받지 못했습니다. 아래 ‘다시 불러오기’로 확인해 주세요.', 'cw-note'));
    } else if (s.connected) {
      body.append(PANELS[provider.id](provider));
      if (provider.kind === 'oauth') body.append(configureForm(provider, false));
      body.append(guide(provider), disconnectControl(provider));
    } else if (provider.kind === 'oauth' && !s.configured) {
      body.append(h('div', {class: 'cw-callout'}, h('strong', {text: '먼저 앱 설정이 필요합니다'}),
        p(provider.name + ' 연결에 쓸 클라이언트 정보가 아직 저장되지 않았습니다. 아래 안내대로 앱을 만들고 정보를 저장하면 ‘계정 연결’이 열립니다.')),
        guide(provider), configureForm(provider, true));
    } else if (provider.kind === 'oauth') {
      body.append(h('div', {class: 'cw-actions'}, authorizeButton(provider)), configureForm(provider, false), guide(provider));
    } else {
      body.append(guide(provider), tokenForm(provider));
    }
    const node = h('article', {class: 'cw-card', 'aria-labelledby': title.id, data: {provider: provider.id}},
      h('header', null, title, statusOf(provider)), body, status);
    cards.set(provider.id, {node, status});
    return node;
  }

  function paintAll() {
    cards.clear();
    const head = h('div', {class: 'cw-head'},
      h('div', {class: 'cw-title', 'aria-hidden': 'true'}, h('span', {text: 'nuri@one'}), h('span', {text: ' ~ connectors $ '}), h('span', {class: 'cw-cursor', text: '_'})),
      h('div', {class: 'cw-intro'},
        p('Google·카카오·Notion·GitHub 6개 서비스를 연결해 읽고, 만들고, 승인한 것만 실행합니다. 키와 토큰은 입력 직후 서버에만 저장되며 이 화면에는 다시 표시되지 않습니다.'),
        h('div', {class: 'cw-actions'}, h('button', {type: 'button', class: 'btn', text: '다시 불러오기', data: {cwReload: '1'}}),
          h('a', {class: 'personal-link', href: '#guide-connections', text: '서비스 연결 가이드'}),
          h('a', {class: 'personal-link', href: '/personal?workbench=connect#workbench', text: '연결 관리'}))));
    const message = h('p', {class: 'cw-global', role: 'status', data: {cwGlobal: '1'}});
    if (notice) { message.textContent = notice.text; message.classList.toggle('is-error', notice.error); message.setAttribute('role', notice.error ? 'alert' : 'status'); }
    const flow=h('nav',{class:'cw-actions cw-steps','aria-label':'메일에서 성과까지'},
      [['gmail','메일에서 할 일'],['calendar','빈 시간 찾기'],['analytics','성과 보기']].map(([id,text],index)=>{
        const button=h('button',{class:'btn',type:'button',text:String(index+1)+'. '+text});
        button.addEventListener('click',()=>cards.get(id)?.node.querySelector('h3')?.focus());
        return button;
      }));
    const panel = h('div', {class: 'cw-panel'}, head, message, loaded ? flow : null);
    if (loadError) panel.append(p(loadError, 'cw-status is-error'));
    else if (!loaded) panel.append(p('연결 상태를 불러오는 중입니다…', 'cw-empty'));
    else panel.append(h('div', {class: 'cw-grid'}, PROVIDERS.map(card)));
    root.replaceChildren(panel);
  }

  // ---- 수명 주기 -----------------------------------------------------------
  async function reload(done, focusId) {
    const result = await call();
    if (!Array.isArray(result.services)) throw Error('서버 응답 형식이 올바르지 않습니다.');
    services = new Map(result.services.filter(row => row && typeof row.id === 'string').map(row => [row.id, row]));
    callback = typeof result.callback === 'string' ? result.callback : '';
    serverTasks = Array.isArray(result.tasks) ? result.tasks.filter(row => row && typeof row.id === 'string').map(row => ({id: row.id, title: String(row.title ?? '')})) : [];
    projects = Array.isArray(result.projects) ? result.projects : [];
    loaded = true; loadError = '';
    for (const provider of PROVIDERS) if (!state(provider).connected) { results.delete(provider.id); proposals.delete(provider.id); }
    paintAll();
    if (busy) lock(true);
    const target = focusId ? cards.get(focusId) : null;
    if (target) {
      target.node.querySelector('h3')?.focus();
      if (done) say(focusId, done);
    }
  }

  function readReturn() {
    const url = new URL(location.href);
    const [hashName, hashQuery = ''] = url.hash.slice(1).split('?');
    const params = [url.searchParams, new URLSearchParams(hashQuery)];
    const value = params.map(item => item.get('connect')).find(Boolean);
    const id = params.map(item => item.get('provider')).find(Boolean);
    const touched = params.some(item => item.has('connect') || item.has('provider'));
    if (touched) {
      url.searchParams.delete('connect'); url.searchParams.delete('provider');
      url.hash = hashName ? '#' + hashName : '';
      history.replaceState(history.state, '', url.href);
    }
    if (value !== 'connected' && value !== 'failed') return null;
    const name = PROVIDERS.find(item => item.id === id)?.name;
    return value === 'connected'
      ? {text: (name ? name + ' ' : '') + '연결을 마쳤습니다. 아래에서 연결 상태를 확인해 주세요.', error: false}
      : {text: (name ? name + ' ' : '') + '연결에 실패했습니다. 승인 화면에서 취소했거나, 앱 정보(클라이언트 ID·비밀번호)나 콜백 주소가 서비스 앱 설정과 다른지 확인한 뒤 다시 시도해 주세요.', error: true};
  }

  async function mount() {
    const account = window.NuriPersonalAccount;
    if (!root || !account) return;
    if (controller && owner === account) {
      for (const select of root.querySelectorAll('[data-task-select]')) fillTasks(select);
      return;
    }
    suspend();
    owner = account;
    controller = new AbortController();
    notice = readReturn();
    loaded = false; loadError = '';
    paintAll();
    lock(true);
    try {
      await reload();
    } catch (error) {
      if (!alive() || error?.name === 'AbortError') return;
      loadError = error.message || '연결 상태를 불러오지 못했습니다.';
      paintAll();
    } finally {
      if (alive()) lock(false);
    }
  }

  function suspend() {
    controller?.abort();
    controller = null; owner = null; busy = false; loaded = false; loadError = ''; notice = null;
    services = new Map(); callback = ''; serverTasks = []; projects = [];
    cards.clear(); results.clear(); proposals.clear();
    if (root) { root.removeAttribute('aria-busy'); root.replaceChildren(); }
  }

  if (root) {
    root.addEventListener('click', event => {
      if (!event.target.closest('[data-cw-reload]') || busy || !alive()) return;
      loadError = ''; notice = null;
      lock(true);
      reload().then(() => {
        notice = {text: '연결 상태를 다시 불러왔습니다.', error: false};
        const global = root.querySelector('[data-cw-global]');
        if (global) global.textContent = notice.text;
      }).catch(error => {
        if (!alive() || error?.name === 'AbortError') return;
        loadError = error.message || '연결 상태를 불러오지 못했습니다.';
        paintAll();
      }).finally(() => { if (alive()) lock(false); });
    });
    root.addEventListener('focusin', event => {
      if (event.target.matches?.('[data-task-select]') && !busy) fillTasks(event.target);
    });
  }

  window.NuriConnectorWorkflow = {mount, suspend};
})();
