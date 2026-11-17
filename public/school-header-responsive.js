(() => {
  const header = document.querySelector('.content-wrap > .school-heading');
  if (!header) return;
  let compact = false;
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const next = window.scrollY > 180;
    if (next !== compact) {
      compact = next;
      header.classList.toggle('is-compact', compact);
    }
  };
  window.addEventListener('scroll', () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
})();
