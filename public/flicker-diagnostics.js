/* Opt-in, privacy-safe visual diagnostics. Enable with ?diagnose=flicker.
   Never records student names, school identity, credentials, URLs with queries,
   image contents, network responses, or personal data. */
(() => {
  'use strict';
  if (new URLSearchParams(location.search).get('diagnose') !== 'flicker') return;
  const key = 'attendigo.flickerDiagnostics';
  let existing = { loads: 0, events: [] };
  try {
    const prior = JSON.parse(sessionStorage.getItem(key) || '{}');
    if (Array.isArray(prior.events)) existing = prior;
  } catch { /* optional storage */ }
  const state = {
    loads: Number(existing.loads || 0) + 1,
    events: existing.events.slice(-90),
    startedAt: new Date().toISOString(),
    scriptVersion: 'flicker-diagnostics-1',
    navigationType: performance.getEntriesByType('navigation')[0]?.type || 'unknown'
  };
  let info = null;
  function record(type, detail) {
    state.events.push({
      time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
      type,
      detail: String(detail || '').slice(0, 90)
    });
    state.events = state.events.slice(-150);
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch {}
    if (info) info.textContent = 'Loads ' + state.loads + ' · Events ' + state.events.length +
      ' · Latest: ' + type;
  }
  record('page-script-start', state.navigationType);
  addEventListener('pageshow', event => record('pageshow', event.persisted ? 'history restore' : 'normal'));
  addEventListener('pagehide', event => record('pagehide', event.persisted ? 'history cache' : 'navigation'));
  document.addEventListener('visibilitychange', () => record('tab-visibility', document.visibilityState));
  document.addEventListener('attendigo:portal-ready', () => record('portal-ready'));
  navigator.serviceWorker?.addEventListener('controllerchange', () => record('service-worker-changed'));
  addEventListener('error', () => record('script-error', 'Check browser console; no message recorded'));
  addEventListener('unhandledrejection', () => record('script-rejection', 'Check browser console; no message recorded'));

  const root = document.documentElement;
  let oldVisibility = root.style.visibility;
  let oldRootClass = root.className;
  const rootObserver = new MutationObserver(() => {
    if (root.style.visibility !== oldVisibility) {
      oldVisibility = root.style.visibility;
      record('document-visibility-style', oldVisibility || 'default');
    }
    if (root.className !== oldRootClass) {
      oldRootClass = root.className;
      record('root-class-changed', 'layout or theme class');
    }
  });
  rootObserver.observe(root, { attributes: true, attributeFilter: ['style','class'] });

  function init() {
    if (document.getElementById('flickerDiagnosticPanel')) return;
    const panel = document.createElement('aside');
    panel.id = 'flickerDiagnosticPanel';
    panel.setAttribute('aria-label', 'Flicker diagnostics');
    panel.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147482000;' +
      'width:min(300px,calc(100vw - 24px));box-sizing:border-box;padding:12px 13px;' +
      'border-radius:12px;border:1px solid #4c74a3;background:#102844;color:#fff;' +
      'box-shadow:0 7px 22px #0005;font:12px/1.5 system-ui,sans-serif';
    const heading = document.createElement('strong');
    heading.textContent = 'Display diagnostics';
    heading.style.cssText = 'display:block;font-size:13px;margin-bottom:4px';
    info = document.createElement('div');
    info.style.cssText = 'margin-bottom:9px;overflow-wrap:anywhere';
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;gap:8px';
    const copy = document.createElement('button');
    copy.type='button';
    copy.textContent='Copy report';
    copy.style.cssText='border:0;border-radius:7px;padding:7px 10px;background:#d9f0ff;color:#143351;font:600 12px system-ui;cursor:pointer';
    copy.addEventListener('click', async () => {
      const report = JSON.stringify({
        description: 'Attendigo browser display diagnostics (no account data)',
        loadsThisTab: state.loads,
        navigationType: state.navigationType,
        startedAt: state.startedAt,
        events: state.events
      }, null, 2);
      try {
        await navigator.clipboard.writeText(report);
        copy.textContent='Copied — paste in chat';
      } catch {
        window.prompt('Copy this diagnostic report and paste it into ChatGPT:', report);
      }
    });
    const dismiss = document.createElement('button');
    dismiss.type='button';
    dismiss.textContent='Hide';
    dismiss.style.cssText='border:1px solid #7d9ab9;border-radius:7px;padding:7px 10px;background:transparent;color:#fff;cursor:pointer';
    dismiss.addEventListener('click', () => panel.remove());
    buttons.append(copy, dismiss);
    panel.append(heading, info, buttons);
    document.body.append(panel);
    info.textContent = 'Loads ' + state.loads + ' · Events ' + state.events.length;

    const sizes = new Map();
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(entries => {
        for (const entry of entries) {
          const id = entry.target.id || (entry.target.classList.contains('topbar') ? 'topbar' : 'school-heading');
          const w = Math.round(entry.contentRect.width);
          const h = Math.round(entry.contentRect.height);
          const size = w + 'x' + h;
          if (sizes.get(id) !== size) {
            sizes.set(id,size);
            record('header-size', id + ' ' + size);
          }
        }
      });
      for(const el of [document.querySelector('.portal-page .topbar'),document.querySelector('.school-heading')]){
        if(el) observer.observe(el);
      }
    }
    const nav = document.querySelector('.sidebar .side-nav');
    if (nav) new MutationObserver(mutations => {
      const structural = mutations.filter(m => m.type==='childList' && m.addedNodes.length+m.removedNodes.length>0);
      if (structural.length) record('navigation-rebuilt', structural.length + ' DOM moves');
    }).observe(nav, {subtree:true,childList:true});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
