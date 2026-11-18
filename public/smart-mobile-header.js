/* Mobile header and navigation: stable height, no scroll-triggered layout changes.
   Previous scroll-direction switching changed height and hid actions repeatedly
   during small scroll/bounce events, which made the header flash. */
(() => {
  'use strict';

  const bar = document.querySelector('.portal-page .topbar');
  if (!bar) return;

  // The sidebar's dedicated close button is provided by portal.html.
  // Do not inject a second button before the Attendigo logo.

  // Do not shrink, expand, or hide topbar controls as the user scrolls.
  // The existing fixed 60px mobile topbar remains visible and accessible.
  document.body.classList.remove('smart-header-compact');
  bar.dataset.smartHeader = 'full';
})();
