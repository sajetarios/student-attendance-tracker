(function(){
  'use strict';
  const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18"></path><path d="M10.6 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a16 16 0 0 1-3.1 3.8M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7c1.5 0 2.8-.4 4-1"></path><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"></path></svg>';
  function setup(input){
    if (!input || input.dataset.passwordEyeReady === '1') return;
    input.dataset.passwordEyeReady = '1';
    let wrap = input.closest('.password-input-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'password-input-wrap';
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);
    }
    let button = wrap.querySelector('[data-password-toggle]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'password-visibility';
      button.setAttribute('data-password-toggle', input.id || 'password-field');
      button.setAttribute('aria-label', 'Show password');
      button.setAttribute('aria-pressed', 'false');
      button.title = 'Show password';
      wrap.appendChild(button);
    }
    function render(){
      const visible = input.type === 'text';
      button.innerHTML = visible ? eyeOff : eye;
      button.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      button.setAttribute('aria-pressed', visible ? 'true' : 'false');
      button.title = visible ? 'Hide password' : 'Show password';
    }
    button.addEventListener('click', function(){
      const wasVisible = input.type === 'text';
      input.type = wasVisible ? 'password' : 'text';
      render();
      input.focus({preventScroll:true});
    });
    render();
  }
  function init(){ document.querySelectorAll('input[type="password"]').forEach(setup); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  const observer = new MutationObserver(function(records){
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches && node.matches('input[type="password"]')) setup(node);
      if (node.querySelectorAll) node.querySelectorAll('input[type="password"]').forEach(setup);
    }
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
})();
