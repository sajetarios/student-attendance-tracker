/* Attendigo simplified role workspace.
   Presentation and navigation hierarchy only. Reuses original authorized links,
   their IDs, hrefs, event handlers and view controllers; never changes permissions. */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const menu = key => document.querySelector('#sidebar .nav-submenu[data-submenu="' + key + '"]');
  const group = key => document.querySelector('#sidebar .nav-group-toggle[data-nav-group="' + key + '"]')?.closest('.nav-group');
  const label = (key, value) => {
    const text = group(key)?.querySelector('.nav-group-toggle .nav-label');
    if (text) text.textContent = value;
  };
  const move = (item, destination, first = false) => {
    const link = typeof item === 'string' ? $(item) : item;
    const target = menu(destination);
    // Move the actual node; never clone or create a privileged shortcut.
    if (!link || !target || link.parentElement === target) return;
    if (first) target.prepend(link);
    else target.append(link);
  };
  const authorizedChildren = node =>
    [...(node?.querySelectorAll('.nav-submenu .nav-item') || [])].filter(link => !link.hidden);

  function arrangeSidebar(role) {
    const nav = document.querySelector('#sidebar .side-nav');
    if (!nav || role === 'GATE_KEEPER' || role === 'PARENT' || role === 'STUDENT') return;

    if (role === 'SCHOOL_ADMIN') {
      move('studentsNav', 'users', true);
      move('requestsApprovalsNav', 'settings');
      move(nav.querySelector('[data-staff-section="permissions"]'), 'settings');
      move(nav.querySelector('[data-staff-section="departments"]'), 'settings');
      move('offlineScanReviewsNav', 'operations');
      move('cloudSyncNav', 'settings');
      move('smsNav', 'settings');
      label('users', 'People');
      label('academics', 'Academics');
      label('operations', 'Attendance');
      label('settings', 'Administration');
      label('reports', 'Reports');
      const order = [$('dashboardNav'), $('staffNavWrapper'), group('academics'),
        group('operations'), group('reports'), group('settings')];
      order.forEach(el => { if (el && el.parentElement === nav) nav.append(el); });
    } else if (role === 'DEPARTMENT_HEAD') {
      move('myGateAttendanceNav', 'operations');
      label('people', 'People');
      label('academics', 'Academics');
      label('operations', 'Attendance & OB');
      label('reports', 'Reports');
    } else if (role === 'TEACHER') {
      label('people', 'My Classes');
      label('academics', 'Planning');
      label('personalAttendance', 'My Attendance');
      label('reports', 'Reports');
    }

    // Hide only genuinely empty structural containers. Existing role-based
    // hidden flags remain authoritative; never unhide a forbidden link or group.
    nav.querySelectorAll('.nav-group').forEach(wrapper => {
      if (!authorizedChildren(wrapper).length) wrapper.hidden = true;
    });
  }

  function collapseOtherGroups(except) {
    document.querySelectorAll('#sidebar .nav-group-toggle[data-nav-group]').forEach(toggle => {
      if (toggle === except || toggle.closest('.nav-group')?.hidden) return;
      toggle.setAttribute('aria-expanded', 'false');
      const children = menu(toggle.dataset.navGroup);
      if (children) children.hidden = true;
    });
  }
  function focusActiveGroup() {
    const nav = document.querySelector('#sidebar .side-nav');
    const activeLink = [...(nav?.querySelectorAll('.nav-item.active') || [])]
      .find(link => !link.hidden);
    const activeWrapper = activeLink?.closest('.nav-group');
    const currentToggle = activeWrapper?.querySelector('.nav-group-toggle[data-nav-group]');
    collapseOtherGroups(currentToggle);
    if (currentToggle && !activeWrapper.hidden) {
      currentToggle.setAttribute('aria-expanded', 'true');
      const children = menu(currentToggle.dataset.navGroup);
      if (children) children.hidden = false;
    }
  }

  function setUpNavigationSearch() {
    const sidebar = $('sidebar');
    const nav = sidebar?.querySelector('.side-nav');
    if (!sidebar || !nav || $('simpleNavSearch')) return;
    const searchLabel = document.createElement('label');
    searchLabel.className = 'simple-nav-search';
    searchLabel.htmlFor = 'simpleNavSearch';
    const caption = document.createElement('span');
    caption.className = 'simple-nav-search-caption';
    caption.textContent = 'Find a feature';
    const input = document.createElement('input');
    input.id = 'simpleNavSearch';
    input.type = 'search';
    input.autocomplete = 'off';
    input.placeholder = 'Search your menu…';
    input.setAttribute('aria-label', 'Find an available feature');
    searchLabel.append(caption, input);
    sidebar.insertBefore(searchLabel, nav);

    const before = new Map();
    const clear = () => {
      nav.querySelectorAll('.simple-nav-filtered').forEach(node =>
        node.classList.remove('simple-nav-filtered'));
      for (const [toggle, expanded] of before) {
        toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        const children = menu(toggle.dataset.navGroup);
        if (children) children.hidden = !expanded;
      }
      before.clear();
    };
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase();
      if (!query) { clear(); return; }
      if (!before.size) {
        nav.querySelectorAll('.nav-group-toggle[data-nav-group]').forEach(toggle => {
          before.set(toggle, toggle.getAttribute('aria-expanded') === 'true');
        });
      }
      for (const child of nav.children) {
        if (child.hidden) continue;
        if (!child.matches('.nav-group')) {
          const visible = child.matches('.nav-item') && !child.hidden &&
            (child.textContent || child.title || '').toLocaleLowerCase().includes(query);
          child.classList.toggle('simple-nav-filtered', !visible);
          continue;
        }
        const toggle = child.querySelector('.nav-group-toggle[data-nav-group]');
        const links = authorizedChildren(child);
        const headingMatches = (toggle?.querySelector('.nav-label')?.textContent || '')
          .toLocaleLowerCase().includes(query);
        let matches = 0;
        for (const link of links) {
          const ok = headingMatches || (link.textContent || link.title || '')
            .toLocaleLowerCase().includes(query);
          link.classList.toggle('simple-nav-filtered', !ok);
          if (ok) matches++;
        }
        child.classList.toggle('simple-nav-filtered', matches === 0);
        if (matches && toggle) {
          toggle.setAttribute('aria-expanded', 'true');
          const submenu = menu(toggle.dataset.navGroup);
          if (submenu) submenu.hidden = false;
        }
      }
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { input.value = ''; clear(); input.blur(); }
    });
    nav.addEventListener('click', event => {
      const toggle = event.target.closest('.nav-group-toggle[data-nav-group]');
      if (input.value.trim()) { input.value = ''; clear(); }
      if (toggle) {
        // The existing toggle handler runs before this delegated handler.
        if (toggle.getAttribute('aria-expanded') === 'true') collapseOtherGroups(toggle);
      } else if (event.target.closest('.nav-item')) {
        requestAnimationFrame(focusActiveGroup);
      }
    });
    window.addEventListener('popstate', () => requestAnimationFrame(focusActiveGroup));
  }

  function detailsBlock(id, summaryText, parent, contents) {
    if (!parent || !contents?.length || $(id)) return null;
    const details = document.createElement('details');
    details.id = id;
    details.className = 'simple-workspace-details';
    const summary = document.createElement('summary');
    summary.textContent = summaryText;
    const body = document.createElement('div');
    body.className = 'simple-workspace-details-body';
    details.append(summary, body);
    parent.append(details);
    contents.forEach(item => body.append(item));
    return details;
  }

  function simplifySchoolAdminDashboard() {
    const card = $('adminDashboardCard');
    if (!card || $('simpleAdminExtraShortcuts')) return;
    const shortcuts = card.querySelector('.admin-command-shortcuts');
    if (shortcuts) {
      const extras = [...shortcuts.children].filter(button => !(
        button.matches('[data-admin-view="students"]') ||
        button.matches('[data-admin-view="schedules"]') ||
        button.matches('[data-admin-go="accounts"]')
      ));
      detailsBlock('simpleAdminExtraShortcuts', 'More school tools', shortcuts.parentElement, extras);
    }
    const inbox = card.querySelector('.admin-command-action-list');
    if (inbox) {
      const details = detailsBlock('simpleAdminApprovalCategories',
        'Review approval categories', inbox.parentElement, [inbox]);
      const requests = $('adminOverviewRequests');
      if (details && requests) {
        const showIfNeeded = () => {
          const count = Number(String(requests.textContent || '').trim());
          if (Number.isFinite(count) && count > 0) details.open = true;
        };
        new MutationObserver(showIfNeeded).observe(requests, { childList: true, characterData: true, subtree: true });
        showIfNeeded();
      }
    }
  }

  function simplifyPlatformOverview() {
    const overview = document.querySelector('#platformWorkspace [data-platform-tab="overview"]');
    const storage = $('platformStorageCard');
    if (!overview || !storage || $('simplePlatformStorage')) return;
    detailsBlock('simplePlatformStorage', 'Database storage & technical details',
      overview, [storage]);
  }

  function init(user) {
    const role = user?.role;
    if (!['SCHOOL_ADMIN', 'DEPARTMENT_HEAD', 'TEACHER', 'SUPER_ADMIN'].includes(role)) return;
    document.documentElement.classList.add('attendigo-simple-workspace');
    document.documentElement.dataset.simpleWorkspaceRole = role;
    if (role === 'SUPER_ADMIN') {
      simplifyPlatformOverview();
      return;
    }
    arrangeSidebar(role);
    focusActiveGroup();
    setUpNavigationSearch();
    if (role === 'SCHOOL_ADMIN') simplifySchoolAdminDashboard();
  }

  let initialized = false;
  document.addEventListener('attendigo:portal-ready', () => {
    if (initialized || !window.attendigoStaffIdentity?.then) return;
    window.attendigoStaffIdentity.then(user => {
      if (initialized) return;
      initialized = true;
      init(user);
    }).catch(() => {});
  });
})();
