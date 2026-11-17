'use strict';

/* Register and update the offline worker without reloading an active dashboard.
   A controllerchange can occur while a teacher is using the portal; a forced
   location.reload() makes the header and whole screen flash and can interrupt
   offline attendance entry. Fresh HTML/assets load on the next navigation. */
(() => {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
    .then(registration => {
      registration.update().catch(error => {
        console.warn('Could not check for an attendance app update:', error);
      });
    })
    .catch(error => {
      console.warn('Could not register the attendance app service worker:', error);
    });
})();
