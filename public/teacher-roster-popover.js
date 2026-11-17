/* Keep teacher learner actions outside row layout while preserving original edit, photo and guardian handlers. */
(() => {
  'use strict';
  const selector = '#studentRosterTable.teacher-roster-compact details.student-actions-dropdown';
  const activeMenus = () => document.querySelectorAll(selector + '[open]');
  function closeMenus(except = null) {
    for (const details of activeMenus()) {
      if (details !== except) details.open = false;
    }
  }
  function positionMenu(details) {
    const summary = details.querySelector('summary');
    const menu = details.querySelector('.student-row-actions');
    if (!details.open || !summary || !menu) return;
    const rect = summary.getBoundingClientRect();
    const width = Math.min(238, Math.max(180, window.innerWidth - 24));
    const maxHeight = Math.min(430, Math.max(120, window.innerHeight * 0.7));
    const menuHeight = Math.min(menu.scrollHeight || 200, maxHeight);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    let top = rect.bottom + 6;
    if (top + menuHeight > window.innerHeight - 12) top = rect.top - menuHeight - 6;
    top = Math.max(12, Math.min(top, window.innerHeight - Math.min(menuHeight, window.innerHeight - 24) - 12));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!details.matches?.(selector) || !details.open) return;
    closeMenus(details);
    positionMenu(details);
  }, true);
  document.addEventListener('click', event => {
    const inside = event.target.closest?.(selector);
    if (!inside) {
      closeMenus();
      return;
    }
    if (event.target.closest('button[data-edit-student],button[data-guardian-open],.student-photo-upload')) {
      // Close after the original action receives its click.
      queueMicrotask(() => { if (inside.isConnected) inside.open = false; });
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const openMenu = activeMenus()[0];
    if (!openMenu) return;
    event.preventDefault();
    openMenu.open = false;
    openMenu.querySelector('summary')?.focus();
  });
  window.addEventListener('scroll', event => {
    if (event.target?.closest?.('.student-actions-dropdown .student-row-actions')) return;
    closeMenus();
  }, true);
  window.addEventListener('resize', () => closeMenus());
})();
