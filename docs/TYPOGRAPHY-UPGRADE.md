# Attendigo typography baseline — 2026-11-18

## Verified source and deployment baseline
- Render web service: attendigo, branch `fix/render-login-landing`.
- Live deployment before work: commit `7d5b434c39bb5846d7c3324b99c5f376ac71f9ba`.
- Default GitHub branch `main` is older and is **not** the Render source.
- Screen CSS previously specified Inter without bundling it; smaller declarations reached 9–12px in roster, folio, planner, notifications and account components.

## Standard implementation
- Self-hosted official Inter variable upright and italic WOFF2 + SIL OFL license in `public/fonts/`.
- `public/typography.css` owns relative font sizes, fallback stack, numeric formatting and mobile input minimum.
- Linked from all 13 HTML entrypoints; staff dashboard (`portal.html`) encompasses Super Admin, School Admin, Department Head, Teacher, while parent and student and auxiliary pages use their own entrypoints.
- Token-based source styles updated in learner rosters, manual attendance, planner, notifications, student accounts, synchronization center, scheduling, user management, SMS and sign-in.
- Narrow screens default to existing Planner **Agenda** mode; the calendar remains selectable.
- Dense manual attendance table retains horizontal scrolling instead of shrinking essential cells.
- Service worker cache version v162 precaches the Inter fonts and new CSS. Existing offline attendance behavior remains unchanged.
- Printed official SF2 spreadsheet / export templates are not changed. Screen-only manual folio scrolling stays within `@media screen`.

## Validation boundaries
- `npm test` and existing CI/Postgres checks should be run on the feature branch PR before production deploy.
- Static tests verify inclusion, font signatures, licensing, token usage and cache entries.
- Static CSS assertions and successful CI do not establish visual verification. A browser review still needs to cover each authenticated role, realistic data, light/dark, desktop/tablet/mobile widths, keyboard, offline refresh and 200% zoom.
- No student records, permissions, enrollment, QR routes, approval handlers, or SF2 generation logic are modified.
