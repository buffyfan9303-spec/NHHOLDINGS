(() => {
  'use strict';
  const endpoint = '/api/personal/files';
  const uploadOrigins = ['https://www.googleapis.com', 'https://upload.drive.google.com'];
  const downloadOrigins = ['https://drive.google.com', 'https://drive.usercontent.google.com', 'https://docs.google.com'];
  const number = new Intl.NumberFormat('ko-KR', {maximumFractionDigits: 1});
  const date = new Intl.DateTimeFormat('ko-KR', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Seoul'});

  function formatSize(bytes) {
    if (!Number.isSafeInteger(bytes) || bytes < 0) return '—';
    if (bytes >= 999_950_000) return `${number.format(bytes / 1_000_000_000)} GB`;
    if (bytes >= 999_950) return `${number.format(bytes / 1_000_000)} MB`;
    if (bytes >= 1_000) return `${number.format(bytes / 1_000)} KB`;
    return `${number.format(bytes)} B`;
  }

  function configuredCallback(value) {
    try {
      const url = new URL(value);
      const local = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol === 'https:' || local) && !url.username && !url.password && !url.search && !url.hash &&
          url.pathname === endpoint + '/oauth') return url;
    } catch {}
    return null;
  }

  function render() {
    return `<section id="files" class="personal-file-panel" aria-labelledby="personal-files-title">
      <header class="personal-file-heading">
        <div><h2 id="personal-files-title">Google Drive</h2><p>내 계정에 파일을 올리고 다시 열 수 있어요.</p></div>
        <div class="personal-file-actions">
          <button type="button" class="btn" data-files-refresh>새로고침</button>
          <button type="button" class="btn primary" data-files-connect hidden>Google Drive 연결</button>
          <a class="personal-link" data-files-canonical hidden>운영 사이트에서 연결</a>
        </div>
      </header>
      <details class="personal-file-setup" data-files-setup hidden>
        <summary>Google Drive 연결 설정</summary>
        <p>Google 웹 애플리케이션에서 Drive API를 활성화한 뒤 승인된 리디렉션 주소를 등록하세요.</p>
        <div class="personal-file-callback">
          <label for="personal-drive-callback">승인된 리디렉션 주소</label>
          <input type="text" id="personal-drive-callback" readonly>
          <div class="personal-file-actions"><button type="button" class="btn" data-files-copy disabled>주소 복사</button></div>
          <p role="status" data-files-copy-status hidden></p>
        </div>
        <form data-files-config>
          <div class="personal-file-credentials">
            <label>OAuth Client ID <input name="clientId" type="text" maxlength="500" required autocomplete="off" spellcheck="false"></label>
            <label>Client Secret <input name="clientSecret" type="password" maxlength="1024" autocomplete="new-password" placeholder="비워두면 기존 값 유지"></label>
          </div>
          <div class="personal-file-actions">
            <button type="submit" class="btn">설정 저장</button>
            <button type="button" class="btn" data-files-disconnect hidden>연결 끊기</button>
          </div>
        </form>
      </details>
      <form class="personal-file-form" data-files-form hidden>
        <label for="personal-file-input">올릴 파일</label>
        <p class="personal-file-limit" id="personal-file-limit" data-files-limit></p>
        <div class="personal-file-controls">
          <input id="personal-file-input" type="file" aria-describedby="personal-file-limit" required>
          <button type="submit" class="btn primary" disabled>업로드</button>
        </div>
        <progress aria-label="파일 업로드 진행률" max="100" data-files-progress hidden></progress>
      </form>
      <p class="personal-file-status" role="status" aria-live="polite" data-files-status>저장소 상태를 확인하고 있어요.</p>
      <ul class="personal-file-list" aria-label="내 파일 목록" data-files-list></ul>
      <button type="button" class="btn personal-file-more" data-files-more hidden>더 보기</button>
    </section>`;
  }

  async function request(accountId, search = '', options) {
    const response = await fetch(endpoint + search, {cache: 'no-store', ...options, headers: {...options?.headers, 'X-Personal-Account': accountId}});
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) {
      const error = new Error(data?.error || '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.');
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function sendFile(upload, file, progress) {
    const url = new URL(upload.url);
    if (!uploadOrigins.includes(url.origin) || url.pathname !== '/upload/drive/v3/files') throw new Error('Google Drive 업로드 주소를 확인하지 못했습니다.');
    return new Promise((resolve, reject) => {
      const transfer = new XMLHttpRequest();
      const fail = () => reject(new Error('업로드 결과를 확인하지 못했습니다. 다시 시도하세요.'));
      transfer.upload.addEventListener('progress', e => {
        if (e.lengthComputable) progress.value = 100 * e.loaded / e.total;
      });
      transfer.addEventListener('load', () => {
        if (transfer.status >= 200 && transfer.status < 300) {resolve(); return;}
        const error = new Error('업로드 결과를 확인하지 못했습니다. 다시 시도하세요.');
        error.status = transfer.status;
        reject(error);
      });
      transfer.addEventListener('error', fail);
      transfer.addEventListener('abort', fail);
      transfer.addEventListener('timeout', fail);
      transfer.open('PUT', url.href);
      transfer.timeout = 10 * 60_000;
      Object.entries(upload.headers).forEach(([name, value]) => transfer.setRequestHeader(name, value));
      transfer.send(file);
    });
  }

  function mount() {
    const root = document.getElementById('personal-files-root');
    const accountId = window.NuriPersonalAccount;
    if (!root || !accountId || root.dataset.filesMounted === accountId) return;
    root.dataset.filesMounted = accountId;
    root.innerHTML = render();
    const fileRequest = (search, options) => request(accountId, search, {
      ...options, headers: {...options?.headers, 'X-Drive-Connection': connectionId ?? ''},
    });
    const form = root.querySelector('[data-files-form]');
    const input = form.querySelector('input');
    const button = form.querySelector('button');
    const status = root.querySelector('[data-files-status]');
    const list = root.querySelector('[data-files-list]');
    const refresh = root.querySelector('[data-files-refresh]');
    const connect = root.querySelector('[data-files-connect]');
    const canonical = root.querySelector('[data-files-canonical]');
    const setup = root.querySelector('[data-files-setup]');
    const setupForm = root.querySelector('[data-files-config]');
    const disconnect = root.querySelector('[data-files-disconnect]');
    const callback = root.querySelector('#personal-drive-callback');
    const copy = root.querySelector('[data-files-copy]');
    const copyStatus = root.querySelector('[data-files-copy-status]');
    const more = root.querySelector('[data-files-more]');
    const progress = root.querySelector('[data-files-progress]');
    const rows = new Map();
    let nextPage = null;
    let connectionId = null;
    let maxBytes = 0;
    let pending = null;
    let loading = false;
    let busy = false;
    let accessVersion = 0;
    const pageUrl = new URL(location.href);
    const oauthStatus = pageUrl.searchParams.get('drive');
    if (oauthStatus === 'connected' || oauthStatus === 'failed') {
      pageUrl.searchParams.delete('drive');
      history.replaceState(history.state, '', pageUrl.href);
    }
    const hasCurrentAccess = version => version === accessVersion && window.NuriPersonalAccount === accountId && root.dataset.filesMounted === accountId;

    function message(value, error = false) {
      status.textContent = value;
      status.classList.toggle('is-error', error);
    }

    function clearAfterAccessError(error) {
      if (error.status !== 403 && error.status !== 409) return;
      accessVersion += 1;
      rows.clear();
      list.replaceChildren();
      input.value = '';
      pending = null;
      nextPage = null;
      connectionId = null;
      form.hidden = true;
      more.hidden = true;
      connect.hidden = true;
      canonical.hidden = true;
      canonical.removeAttribute('href');
      setup.hidden = true;
      setupForm.reset();
      callback.value = '';
      copyStatus.textContent = '';
      copyStatus.hidden = true;
    }

    function controls() {
      refresh.disabled = loading || busy;
      connect.disabled = loading || busy;
      copy.disabled = loading || busy || !callback.value;
      more.disabled = loading || busy;
      button.disabled = loading || busy || !input.files.length || input.files[0].size > maxBytes;
      input.disabled = busy;
      for (const field of setupForm.elements) field.disabled = busy || loading;
    }

    function addFile(file, recentId) {
      if (rows.has(file.id)) return;
      const row = document.createElement('li');
      const detail = document.createElement('div');
      const name = document.createElement('strong');
      const attributes = document.createElement('span');
      const download = document.createElement('button');
      const created = new Date(file.createdAt);
      name.textContent = file.name;
      attributes.textContent = Number.isFinite(created.getTime()) ? `${formatSize(file.bytes)} · ${date.format(created)}` : formatSize(file.bytes);
      download.className = 'btn';
      download.type = 'button';
      download.textContent = '다운로드';
      download.setAttribute('aria-label', `${file.name} 다운로드`);
      download.addEventListener('click', async () => {
        const version = accessVersion;
        download.disabled = true;
        try {
          const data = await fileRequest(`?download=${encodeURIComponent(file.id)}`);
          if (!hasCurrentAccess(version)) return;
          const url = new URL(data.url);
          if (!downloadOrigins.includes(url.origin)) throw new Error('Google Drive 다운로드 주소를 확인하지 못했습니다.');
          const link = document.createElement('a');
          link.href = url.href;
          link.referrerPolicy = 'no-referrer';
          link.download = '';
          link.click();
        } catch (error) {
          if (!hasCurrentAccess(version)) return;
          clearAfterAccessError(error);
          if (error.status === 412) await load();
          message(error.message, true);
        } finally {download.disabled = false;}
      });
      if (file.id === recentId) row.classList.add('just-uploaded');
      detail.append(name, attributes);
      row.append(detail, download);
      rows.set(file.id, row);
      list.append(row);
    }

    async function load(append = false, recentId = '', connectionResult = '') {
      if (loading) return;
      const version = accessVersion;
      loading = true;
      controls();
      try {
        const data = await fileRequest(append && nextPage ? `?page=${encodeURIComponent(nextPage)}` : '');
        if (!hasCurrentAccess(version)) return;
        if (!append) {rows.clear(); list.replaceChildren();}
        maxBytes = data.maxBytes;
        nextPage = data.nextPage;
        if (connectionId !== (data.connectionId ?? null)) {
          pending = null;
          input.value = '';
          connectionId = data.connectionId ?? null;
        }
        const firstLoad = setup.hidden;
        setup.hidden = false;
        if (firstLoad && !data.configured) setup.open = true;
        if (!append) setupForm.elements.clientId.value = data.clientId ?? '';
        const redirect = configuredCallback(data.redirectUri);
        const otherOrigin = redirect && redirect.origin !== location.origin;
        callback.value = redirect?.href ?? '';
        copyStatus.textContent = '';
        copyStatus.hidden = true;
        canonical.hidden = !data.configured || !otherOrigin;
        if (canonical.hidden) canonical.removeAttribute('href');
        else canonical.href = new URL('/personal#files', redirect).href;
        disconnect.hidden = !data.connected;
        form.hidden = !data.connected;
        connect.hidden = !data.configured || !redirect || !!otherOrigin;
        connect.textContent = data.connected ? 'Drive 다시 연결' : 'Google Drive 연결';
        connect.classList.toggle('primary', !data.connected);
        more.hidden = !nextPage;
        if (!data.configured) {
          message('Google Drive 앱 정보를 저장한 뒤 계정을 연결하세요.');
          return;
        }
        if (!data.connected) {
          const hint = otherOrigin ? 'Google Drive 계정 동의는 운영 사이트에서 시작해 주세요.' :
            redirect ? 'Google Drive를 연결해 주세요.' : '등록 주소를 불러오지 못했습니다. 목록을 다시 조회해 주세요.';
          message(connectionResult === 'failed' ? 'Google Drive 연결을 완료하지 못했습니다. 다시 시도하세요.' : hint, connectionResult === 'failed');
          return;
        }
        root.querySelector('[data-files-limit]').textContent = `파일당 최대 ${formatSize(maxBytes)}`;
        data.files.forEach(file => addFile(file, recentId));
        if (connectionResult === 'failed') message('Google Drive 연결을 완료하지 못했습니다. 다시 시도하세요.', true);
        else if (connectionResult === 'connected') message('Google Drive를 연결했습니다.');
        else message(recentId ? '파일을 저장했습니다.' : rows.size || nextPage ? '' : '아직 올린 파일이 없어요.');
      } catch (error) {
        if (!hasCurrentAccess(version)) return;
        clearAfterAccessError(error);
        message(recentId ? `파일을 저장했습니다. ${error.message}` : error.message, true);
      } finally {
        loading = false;
        controls();
      }
    }

    async function checkUpload(id) {
      try {return (await fileRequest(`?status=${encodeURIComponent(id)}`)).file;}
      catch (error) {if (error.status === 404) return null; throw error;}
    }

    async function complete(file) {
      pending = null;
      input.value = '';
      progress.value = 100;
      await load(false, file.id);
    }

    input.addEventListener('change', () => {
      pending = null;
      const file = input.files[0];
      if (file) message(file.size > maxBytes ? `파일은 ${formatSize(maxBytes)}까지 올릴 수 있어요.` : `선택한 파일 ${formatSize(file.size)}`, file.size > maxBytes);
      controls();
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const file = input.files[0];
      if (!file || file.size > maxBytes || busy || loading) return;
      const version = accessVersion;
      busy = true;
      controls();
      message('Google Drive에 파일을 업로드하고 있어요.');
      progress.removeAttribute('value');
      progress.hidden = false;
      try {
        if (pending) {
          const saved = await checkUpload(pending.id);
          if (!hasCurrentAccess(version)) return;
          if (saved) {await complete(saved); return;}
        }
        if (!pending || pending.expiresAt <= Date.now()) {
          const issued = await fileRequest('', {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'upload', name: file.name, bytes: file.size}),
          });
          if (!hasCurrentAccess(version)) return;
          pending = issued;
        }
        const upload = pending;
        try {await sendFile(upload, file, progress);}
        catch (error) {
          if (!hasCurrentAccess(version)) return;
          const saved = await checkUpload(upload.id);
          if (!hasCurrentAccess(version)) return;
          if (!saved) {
            if (error.status === 308 || (error.status >= 400 && error.status < 500)) pending = null;
            throw error;
          }
          await complete(saved);
          return;
        }
        if (!hasCurrentAccess(version)) return;
        const saved = await checkUpload(upload.id);
        if (!hasCurrentAccess(version)) return;
        if (!saved) throw new Error('저장 상태를 확인하지 못했습니다. 다시 시도하세요.');
        await complete(saved);
      } catch (error) {
        if (!hasCurrentAccess(version)) return;
        clearAfterAccessError(error);
        if (error.status === 412) await load();
        message(error.message, true);
      }
      finally {
        busy = false;
        progress.hidden = true;
        controls();
      }
    });
    connect.addEventListener('click', async () => {
      const version = accessVersion;
      if (!hasCurrentAccess(version) || connect.hidden || busy || loading) return;
      busy = true;
      controls();
      try {
        const data = await fileRequest('', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action: 'connect'})});
        if (!hasCurrentAccess(version)) return;
        const url = new URL(data.url);
        if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('Google Drive 연결 주소를 확인하지 못했습니다.');
        location.assign(url.href);
      } catch (error) {
        if (!hasCurrentAccess(version)) return;
        clearAfterAccessError(error);
        message(error.message, true);
      } finally {
        busy = false;
        controls();
      }
    });
    copy.addEventListener('click', async () => {
      const version = accessVersion;
      const value = callback.value;
      if (!hasCurrentAccess(version) || !value) return;
      try {
        await navigator.clipboard.writeText(value);
        if (!hasCurrentAccess(version) || callback.value !== value) return;
        copyStatus.textContent = '등록 주소를 복사했습니다.';
      } catch {
        if (!hasCurrentAccess(version) || callback.value !== value) return;
        callback.focus();
        callback.select();
        copyStatus.textContent = '선택된 등록 주소를 복사해 주세요.';
      }
      copyStatus.hidden = false;
    });
    async function updateConnection(action, data = {}) {
      const version = accessVersion;
      busy = true;
      controls();
      try {
        await fileRequest('', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, ...data})});
        if (!hasCurrentAccess(version)) return;
        setupForm.elements.clientSecret.value = '';
        await load();
        if (hasCurrentAccess(version)) message(action === 'configure' ? 'Google Drive 연결 설정을 저장했습니다.' : 'Google Drive 연결을 끊었습니다.');
      } catch (error) {
        if (!hasCurrentAccess(version)) return;
        clearAfterAccessError(error);
        message(error.message, true);
      } finally {
        busy = false;
        controls();
      }
    }
    setupForm.addEventListener('submit', event => {
      event.preventDefault();
      if (busy || loading) return;
      void updateConnection('configure', {clientId: setupForm.elements.clientId.value, clientSecret: setupForm.elements.clientSecret.value});
    });
    disconnect.addEventListener('click', () => {
      if (!busy && !loading) void updateConnection('disconnect');
    });
    refresh.addEventListener('click', () => void load());
    more.addEventListener('click', () => void load(true));
    void load(false, '', oauthStatus);
  }

  window.NuriPersonalFiles = {render, mount, formatSize};
})();
