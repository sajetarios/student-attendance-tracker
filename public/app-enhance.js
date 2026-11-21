/* Shared reliability and usability helpers for every page. Safe to load on any page; never throws. */
(function () {
  'use strict';
  if (window.__appEnhanceLoaded) return;
  window.__appEnhanceLoaded = true;

  const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  /* ---------- Connection banner ---------- */
  let banner;
  function ensureBanner() {
    if (banner || !document.body) return banner;
    banner = document.createElement('div');
    banner.id = 'appConnectionBanner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.hidden = true;
    document.body.appendChild(banner);
    return banner;
  }
  function showBanner(text, kind) {
    const el = ensureBanner();
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind || 'warn';
    el.hidden = false;
  }
  function hideBanner() { if (banner) banner.hidden = true; }

  function onOffline() { showBanner('You are offline. Changes will not be saved until the connection returns.', 'warn'); }
  function onOnline() {
    showBanner('Back online.', 'ok');
    setTimeout(hideBanner, 2500);
  }
  window.addEventListener('offline', onOffline);
  window.addEventListener('online', onOnline);
  document.addEventListener('DOMContentLoaded', () => { if (navigator.onLine === false) onOffline(); });

  /* ---------- Friendlier network behaviour ---------- */
  // Read requests are retried once when the server is waking up (502/503/504) or the network blips.
  // Write requests are never retried, so nothing is saved twice.
  if (nativeFetch) {
    window.fetch = async function (input, init) {
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const canRetry = method === 'GET' || method === 'HEAD';
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const isApi = /^\/api\//.test(url) || url.includes('/api/');
      const attempts = canRetry && isApi ? 2 : 1;
      let lastError;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const response = await nativeFetch(input, init);
          if (attempt < attempts && [502, 503, 504].includes(response.status)) { await sleep(1500); continue; }
          if (isApi && [502, 503, 504].includes(response.status)) showBanner('The server is busy or restarting. Please try again in a moment.', 'warn');
          else if (banner && !banner.hidden && banner.dataset.kind === 'warn' && navigator.onLine !== false) hideBanner();
          return response;
        } catch (err) {
          lastError = err;
          if (attempt < attempts) await sleep(1200);
        }
      }
      const offline = navigator.onLine === false;
      const friendly = new Error(offline
        ? 'You are offline. Check your internet connection and try again.'
        : 'Cannot reach the server right now. Please check your connection and try again.');
      friendly.cause = lastError;
      friendly.isNetworkError = true;
      throw friendly;
    };
  }

  /* ---------- Safety net toast for unexpected errors ---------- */
  let toast;
  function showToast(text) {
    if (!document.body) return;
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appErrorToast';
      toast.setAttribute('role', 'alert');
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove('is-visible'), 6000);
  }
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    const message = reason && reason.message ? String(reason.message) : '';
    // Session-expiry redirects already explain themselves; do not stack a second message on top.
    if (/session has expired/i.test(message)) return;
    showToast(message && message.length < 200 ? message : 'Something went wrong. Please try again.');
  });

  /* ---------- Responsive tables ---------- */
  // Wide tables scroll sideways inside their own box instead of stretching the whole page on phones.
  function wrapTable(table) {
    if (!table || table.dataset.scrollWrapped || table.closest('.table-scroll, .table-wrap, .table-container')) return;
    const parent = table.parentElement;
    if (!parent) return;
    table.dataset.scrollWrapped = '1';
    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', table.getAttribute('aria-label') || 'Scrollable table');
    parent.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }
  function wrapAllTables(root) {
    (root || document).querySelectorAll && (root || document).querySelectorAll('table').forEach(wrapTable);
  }
  let pending = false;
  function scheduleWrap() {
    if (pending) return;
    pending = true;
    (window.requestAnimationFrame || setTimeout)(() => { pending = false; wrapAllTables(document); });
  }
  document.addEventListener('DOMContentLoaded', () => {
    wrapAllTables(document);
    if (window.MutationObserver) new MutationObserver(scheduleWrap).observe(document.body, { childList: true, subtree: true });
  });

  /* ---------- Small accessibility wins ---------- */
  // Escape closes the top-most open dialog overlay by clicking its cancel/close control when present.
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const overlays = Array.from(document.querySelectorAll('[class*="-overlay"]:not([hidden])'));
    const top = overlays[overlays.length - 1];
    if (!top) return;
    const close = top.querySelector('[data-close], .close-button, button[id*="ancel"], button[id*="lose"]');
    if (close) close.click();
  });
})();
