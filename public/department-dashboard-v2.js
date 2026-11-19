'use strict';
/* Presentation-only enhancement. Never changes role checks, APIs or attendance records. */
(() => {
  const $ = id => document.getElementById(id);
  function init(user) {
    if (user?.role !== 'DEPARTMENT_HEAD') return;
    const overview = $('departmentHeadOverview');
    if (!overview || overview.dataset.dhV2Ready === 'true') return;
    overview.dataset.dhV2Ready = 'true';
    document.documentElement.classList.add('attendigo-dh-v2');
    const planner = $('plannerDashboardWidget');
    const monitoring = overview.querySelector('.dh-insights:not([aria-label="Manage department subjects"])');
    const sardo = $('sardoCard');
    const header = overview.querySelector('.dh-command-intro');
    const metrics = overview.querySelector('.dh-command-metrics');
    const columns = overview.querySelector('.dh-command-columns');
    if (header) {
      const title = header.querySelector('h3');
      if (title) title.textContent = 'Department Overview';
      const desc = header.querySelector('p');
      if (desc) desc.textContent = 'Your department team, coverage, and daily priorities at a glance.';
    }
    if (metrics) {
      const labels = metrics.querySelectorAll('.dh-command-metric > span:not(.dh-metric-icon)');
      if (labels[0]) labels[0].textContent = 'Teachers';
      if (labels[1]) labels[1].textContent = 'Active Teachers';
      if (labels[2]) labels[2].textContent = 'Temporary Covers';
      if (labels[3]) labels[3].textContent = 'Classes Needing Coverage';
      // Use one local outline-SVG vocabulary instead of platform-dependent glyphs.
      const iconPaths = [
        '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v1"/>',
        '<circle cx="10" cy="8" r="3"/><path d="M4 20v-2a6 6 0 0 1 10-4.5m2 3 2 2 4-4"/>',
        '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m5 5h8m-3-3 3 3-3 3"/>',
        '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18"/><circle cx="12" cy="16" r="3"/><path d="M12 14.5V16l1 1"/>'
      ];
      metrics.querySelectorAll('.dh-command-metric .dh-metric-icon').forEach((node, index) => {
        if (!iconPaths[index]) return;
        node.innerHTML = '<svg class="ui-icon dh-v2-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + iconPaths[index] + '</svg>';
      });
      const teachers = metrics.querySelectorAll('.dh-command-metric');
      function makeAction(card, source, name) {
        if (!card || !source) return;
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.setAttribute('aria-label', name);
        card.classList.add('dh-actionable-metric');
        const activate = () => {
          if (source.hidden || source.disabled) return;
          source.click(); // Existing role-checked navigation / coverage action
        };
        card.addEventListener('click', activate);
        card.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); activate();
          }
        });
      }
      const teacherNav = overview.querySelector('[data-dh-go="teachers"]');
      makeAction(teachers[0], teacherNav, 'Open authorized department teacher records');
      makeAction(teachers[1], teacherNav, 'Open active department teacher records');
      makeAction(teachers[2], overview.querySelector('[data-dh-coverage]'), 'Open teacher coverage monitor');
      makeAction(teachers[3], overview.querySelector('[data-dh-coverage]'), 'Review classes needing coverage');
    }
    // Reuse original cards, values, and handlers. No duplicate SARDO or planner data.
    function addToggle(container, heading, targets, label, defaultOpen = true) {
      if (!container || !heading || !targets.length) return;
      const button = document.createElement('button');
      const targetId = 'dh-v2-' + label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      button.type = 'button'; button.className = 'dh-v2-collapse outline-button';
      button.setAttribute('aria-label', 'Collapse or expand ' + label);
      button.setAttribute('aria-expanded', String(defaultOpen));
      button.setAttribute('aria-controls', targetId);
      button.textContent = defaultOpen ? '⌃' : '⌄';
      const content = document.createElement('div');
      content.id = targetId; content.className = 'dh-v2-collapsible';
      // Insert at the first original target to preserve section order and listeners.
      const firstTarget = targets.find(el => el && el.parentNode === container);
      if (firstTarget) container.insertBefore(content, firstTarget);
      else container.append(content);
      targets.forEach(el => { if (el) content.append(el); });
      content.hidden = !defaultOpen;
      button.addEventListener('click', () => {
        const expanded = button.getAttribute('aria-expanded') !== 'true';
        button.setAttribute('aria-expanded', String(expanded));
        content.hidden = !expanded;
        button.textContent = expanded ? '⌃' : '⌄';
      });
      heading.append(button);
    }
    if (header && columns) addToggle(overview, header, [columns, overview.querySelector('.dh-scope-note')], 'Department Overview');
    if (planner) {
      const intro = planner.querySelector('.planner-dashboard-intro');
      const metricsEl = planner.querySelector('.planner-dashboard-metrics');
      const preview = planner.querySelector('.planner-dashboard-preview');
      if (intro && metricsEl) {
        const title = intro.querySelector('h3'); if (title) title.textContent = 'My Planner';
        addToggle(planner, intro, [metricsEl, preview], 'My Planner');
      }
    }
    if (monitoring) {
      const monitorHeader = monitoring.querySelector('.dh-monitor-heading');
      const monitorMetrics = monitoring.querySelector('.dh-insights-metrics');
      const monitorColumns = monitoring.querySelector('.dh-monitor-columns');
      const monitorFeedback = monitoring.querySelector('.dh-monitor-feedback');
      if (monitorHeader && monitorMetrics) {
        const gateLabel = monitoring.querySelector('.dh-kpi-gate span:not(.dh-kpi-icon)');
        if (gateLabel) gateLabel.textContent = 'Department Gate Arrivals Today';
        addToggle(monitoring, monitorHeader, [monitorMetrics, monitorColumns, monitorFeedback], 'Department Monitoring');
      }
    }
    if (sardo) {
      const heading = sardo.querySelector('.card-heading');
      const children = [...sardo.children].filter(el => el !== heading);
      if (heading && children.length) addToggle(sardo, heading, children, 'SARDO Monitoring');
    }
  }
  if (window.attendigoStaffIdentity?.then) {
    window.attendigoStaffIdentity.then(init).catch(() => {});
  }
})();
