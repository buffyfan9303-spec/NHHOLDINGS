(() => {
  'use strict';

  const bar = document.getElementById('one-workspace-bar');
  const dashboard = document.getElementById('one-dashboard-view');
  const dashboardStyles = [...document.querySelectorAll('link[rel="stylesheet"]')]
    .filter(link => !link.href.endsWith('/fonts/pretendard.css') && !link.href.endsWith('/workspace.css'));
  const menus = [...bar.querySelectorAll('a')];
  const styles = ['personal', 'personal-files', 'personal-automation', 'personal-ai', 'personal-sites', 'workbench'];
  const scripts = ['personal-revenue', 'personal-sites', 'personal-files', 'personal-automation', 'personal-ai', 'workbench', 'personal'];
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const title = document.title;
  const remembered = {'/dashboard': location.href, '/personal': '/personal#home'};
  let options, prepared, personal, personalTitle, personalStyles, scriptLoad, active = '/dashboard', revision = 0, entrance;

  function preparePersonal() {
    prepared ||= (async () => {
      const response = await fetch('/personal', {cache:'no-store', redirect:'error'});
      if (!response.ok) throw Error('Personal workspace unavailable');
      const markup = new DOMParser().parseFromString(await response.text(), 'text/html');
      const view = markup.getElementById('one-personal-view');
      if (!view || view.querySelector('script')) throw Error('Personal workspace unavailable');
      personalTitle = markup.title;
      personal = document.importNode(view, true);
      personal.hidden = true;
      dashboard.after(personal);
      personalStyles = styles.map(name => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/one/'+name+'.css';
        link.media = 'not all';
        return link;
      });
      await Promise.all(personalStyles.map(link => new Promise((resolve, reject) => {
        link.onload = resolve;
        link.onerror = reject;
        document.head.append(link);
      })));
    })().catch(error => {
      personal?.remove();
      for (const link of personalStyles || []) link.remove();
      prepared = undefined;
      throw error;
    });
    return prepared;
  }

  function loadPersonalScripts() {
    scriptLoad ||= Promise.all(scripts.map(name => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/one/'+name+'.js';
      script.async = false;
      script.onload = resolve;
      script.onerror = reject;
      document.body.append(script);
    })));
    return scriptLoad;
  }

  function show(path, focus) {
    const isPersonal = path === '/personal';
    const changed = active !== path;
    if (changed && !isPersonal) window.NuriPersonalWorkspace?.deactivate();
    active = path;
    dashboard.hidden = isPersonal;
    if (personal) personal.hidden = !isPersonal;
    for (const link of dashboardStyles) link.disabled = isPersonal;
    for (const link of personalStyles || []) link.media = isPersonal ? 'all' : 'not all';
    document.body.classList.toggle('personal-app', isPersonal);
    document.title = isPersonal ? personalTitle : title;
    document.dispatchEvent(new Event('nuri-workspace-change'));
    for (const link of menus) {
      if (link.pathname === path) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    }
    if (changed) {
      entrance?.cancel();
      window.scrollTo({top:0,behavior:'instant'});
      if (!reduced.matches) entrance = (isPersonal ? personal : dashboard).animate(
        [{opacity:.68,transform:'translateY(5px)'},{opacity:1,transform:'none'}],
        {duration:190,easing:'cubic-bezier(.22,1,.36,1)'}
      );
    }
    if (focus) (isPersonal ? document.getElementById('personal-title') : document.getElementById('page-title'))?.focus({preventScroll:true});
    if (isPersonal) {
      if (window.NuriPersonalWorkspace) window.NuriPersonalWorkspace.activate();
      else void loadPersonalScripts().catch(() => location.reload());
    }
  }

  async function visit(url, push) {
    const request = ++revision;
    const leavingDashboard = active === '/dashboard' && url.pathname === '/personal';
    if (leavingDashboard && push && !options.canLeave()) return;
    const openingPersonal = url.pathname === '/personal' && !window.NuriPersonalWorkspace;
    const returning = active === '/personal' && url.pathname === '/dashboard';
    if (openingPersonal || returning) {
      bar.setAttribute('aria-busy','true');
      try {
        if (openingPersonal) await preparePersonal();
        else if (!await options.canReturn()) throw Error('Dashboard session changed');
      } catch {
        if (request !== revision) return;
        if (!push) location.reload();
        else if (openingPersonal && !navigator.onLine) options.report('연결을 복구한 뒤 내 업무를 다시 열어주세요.');
        else location.assign(url.href);
        return;
      } finally {
        if (request === revision) bar.removeAttribute('aria-busy');
      }
    }
    if (request !== revision) return;
    bar.removeAttribute('aria-busy');
    if (leavingDashboard) options.leaveDashboard();
    if (push) history.pushState(null,'',url.href);
    remembered[url.pathname] = url.href;
    show(url.pathname, true);
    if (url.pathname === '/dashboard') window.dispatchEvent(new HashChangeEvent('hashchange'));
  }

  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!options?.owner || event.defaultPrevented || event.button !== 0 ||
        event.ctrlKey || event.metaKey || event.shiftKey || event.altKey ||
        !link || link.target || link.hasAttribute('download') || link.origin !== location.origin ||
        !Object.hasOwn(remembered,link.pathname) ||
        (link.search && !(link.pathname==='/personal' && link.search==='?ai=1'))) return;
    const primary = menus.includes(link);
    if (!primary && link.pathname === active) return;
    event.preventDefault();
    if (primary && link.pathname === active) {
      revision++;
      bar.removeAttribute('aria-busy');
      return;
    }
    remembered[active] = location.href;
    void visit(new URL(primary ? remembered[link.pathname] : link.href, location.origin),true);
  });

  window.addEventListener('popstate', () => {
    if (!options?.owner || !Object.hasOwn(remembered,location.pathname)) return;
    if (location.pathname !== active || bar.hasAttribute('aria-busy')) void visit(new URL(location.href),false);
  });

  window.NuriWorkspace = {
    enable(settings) {
      options = settings;
      bar.hidden = !settings.owner;
      if (settings.owner && !bar.querySelector('[aria-current]')) menus[0].setAttribute('aria-current','page');
    }
  };
})();
