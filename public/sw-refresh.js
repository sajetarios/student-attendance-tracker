'use strict';

(() => {
  if (!('serviceWorker' in navigator)) return;

  let reloadAfterControllerChange = false;

  // Reload once when a new worker takes control so the signed-in portal
  // starts using the freshly deployed HTML and versioned assets.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadAfterControllerChange) return;
    reloadAfterControllerChange = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then(registration => registration.update().catch(error => {
      console.warn('Could not check for an attendance app update:', error);
    }))
    .catch(error => {
      console.warn('Could not register the attendance app service worker:', error);
    });
})();
