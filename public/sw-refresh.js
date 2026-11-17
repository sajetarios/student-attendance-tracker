'use strict';

(() => {
  if (!('serviceWorker' in navigator)) return;

  let reloadAfterControllerChange = false;
  const loadedAt = performance.now();

  // Reload once when a new worker takes control so the signed-in portal
  // starts using the freshly deployed HTML and versioned assets.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A newly signed-in page already has fresh, versioned assets. Reloading it
    // immediately can make role-specific dashboards appear to flash or loop.
    if (performance.now() - loadedAt < 20000) return;
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
