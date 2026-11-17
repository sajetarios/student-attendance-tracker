/* Keep the school header dimensionally stable while scrolling.
 * Scroll-triggered shrinking previously caused repeated layout shifts near its threshold.
 * The header remains sticky through the stylesheet and is responsive on all screen sizes.
 */
(() => {
  const header = document.querySelector('.content-wrap > .school-heading');
  if (header) header.classList.remove('is-compact');
})();
