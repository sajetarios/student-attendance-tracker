# Attendigo static welcome page — preparation only

This folder contains an independently hosted waiting page. It does **not** replace Render's cold start, modify application code, or change DNS. It must be hosted on a static origin that remains online while Render sleeps.

## Deployment plan (not yet performed)

1. Create a free Cloudflare Pages project connected to this repository. Set the build output directory to `welcome` and no build command. First deploy to the temporary `*.pages.dev` address.
2. Confirm the existing backend URL and `/assets/attendigo-favicon.png` asset are reachable when Render is awake. The readiness probe uses an image to avoid cross-origin API/CORS changes.
3. Test the temporary welcome URL in mobile and desktop browsers, including sleeping-backend startup, retry behavior, and accessibility.
4. **Before any custom-domain cutover**, audit all application URLs, QR badge/scan links, login redirects, cookies, service workers, PWA scope, cross-origin requests, and external integrations. Moving the app from `attendigo.tech` to a subdomain changes the origin: local/session storage and host-only cookies do not automatically transfer. Users may need to sign in again.
5. Configure a stable backend hostname such as `app.attendigo.tech` in Render, test HTTPS and authentication, and update `APP_ORIGIN` in the welcome HTML after verifying that hostname.
6. Only after acceptance tests, change the appropriate Z.com DNS records to point `attendigo.tech` to the static Pages site. Preserve rollback records and original Render domain settings.

## Limitations and security

- This static page does not collect credentials or school records.
- `next` supports only local relative paths and cannot be used to redirect to arbitrary external hosts.
- An image probe can confirm static asset readiness but does not guarantee database or authentication health. Full production rollout should include an application-specific readiness check.
- Direct links and QR routes cannot simply be replaced by the root welcome page. They need route-preserving handling at the static host or compatible backend entry points.
- **Do not point production DNS to this page until the cross-origin migration is validated.**
