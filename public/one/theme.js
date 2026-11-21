(() => {
  'use strict';

  const key = 'nuri-one-theme';
  const root = document.documentElement;
  const control = 'button[data-one-theme]';

  function apply(theme) {
    root.dataset.oneTheme = theme === 'light' ? 'light' : 'dark';
    const light = root.dataset.oneTheme === 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f5f1' : '#101315');
    const label = light ? '어두운 테마로 전환' : '밝은 테마로 전환';
    for (const button of document.querySelectorAll(control)) {
      button.textContent = light ? '어둡게' : '밝게';
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  let initial = 'dark';
  try { initial = localStorage.getItem(key) ?? initial; } catch {}
  apply(initial);
  document.addEventListener('DOMContentLoaded', () => apply(root.dataset.oneTheme), {once:true});
  document.addEventListener('nuri-workspace-change', () => apply(root.dataset.oneTheme));

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest(control)) return;
    const next = root.dataset.oneTheme === 'light' ? 'dark' : 'light';
    apply(next);
    try { localStorage.setItem(key, next); } catch {}
  });

  window.addEventListener('storage', event => {
    if (event.key === key || event.key === null) apply(event.newValue);
  });
})();
