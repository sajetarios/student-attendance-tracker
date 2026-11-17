/* Mobile header and navigation: stable height, no scroll-triggered layout changes.
   Previous scroll-direction switching changed height and hid actions repeatedly
   during small scroll/bounce events, which made the header flash. */
(() => {
  'use strict';

  const bar = document.querySelector('.portal-page .topbar');
  if (!bar) return;

  // Keep the independent close control accessible when the mobile drawer opens.
  const drawer = document.getElementById('sidebar');
  const toggle = document.getElementById('sidebarToggle');
  if (drawer && toggle && !document.getElementById('mobileDrawerClose')) {
    const close = document.createElement('button');
    close.id = 'mobileDrawerClose';
    close.className = 'mobile-drawer-close';
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close navigation menu');
    close.addEventListener('click', () => {
      if (drawer.classList.contains('open')) toggle.click();
    });
    drawer.insertBefore(close, drawer.firstChild);
  }

  // Do not shrink, expand, or hide topbar controls as the user scrolls.
  // The existing fixed 60px mobile topbar remains visible and accessible.
  document.body.classList.remove('smart-header-compact');
  bar.dataset.smartHeader = 'full';
})();
