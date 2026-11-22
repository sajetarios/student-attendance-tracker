# Attendigo Guide — staff in-app help

## What teachers see
The floating **✦ Ask Attendigo** button is available after a staff member
authenticates in the main portal. The responsive chat guides staff through
class attendance, QR scanning, Form 48 DTR, leave, Official Business,
SF1/SF2, rosters, sections and timetables.

- Questions may be typed in English or Filipino.
- In browsers supporting SpeechRecognition, the user may press the microphone
  and grant browser permission to ask aloud. Browser/OS support varies.
- **Read answer** uses built-in text-to-speech if the browser supports it.
- Suggested questions and guided steps work without AI or a network call.
- **Open menu** buttons activate only navigation currently visible/authorized
  for the signed-in user. No permissions are added or changed.
- Neither chat nor the assistant calls an attendance, DTR, OB, leave or student
  mutation endpoint. No conversation history is persisted to the database.
- The help assistant must never be used to enter student names, LRNs, phone
  numbers, passwords, recovery codes or private QR tokens.

## Optional generative AI

The guide is useful with **no paid AI dependency**. To enable additional
natural-language answers, set Render's server-side secret environment variable:

`ATTENDIGO_HELP_AI_API_KEY` = a valid provider API key

Optional: `ATTENDIGO_HELP_AI_MODEL` = an available Responses API model, default
`gpt-4.1-mini`.

Never put the API key in a client JS file, HTML or public repository.
The server exposes `GET /api/help/config` and `POST /api/help/ask` only to
authenticated school staff. The server sends only the user's question,
their role and role-scoped written guide material to the AI provider. It
does not send the teacher profile, school roster or attendance records.
Requests are size limited, rate limited per user, and time limited.
Model output is always plain text and never executes operations.
Responses use `store:false`. Costs apply when enabled; set a usage limit
in the API billing dashboard and review data privacy requirements.

When the secret is missing, the config reports AI disabled, the client does
not make requests to the AI endpoint, and all built-in guidance still works.
If the provider fails, the guide falls back automatically.

## Test coverage

`node --test tests/attendigo-help.test.js`

Smoke test using accounts for TEACHER, DEPARTMENT_HEAD, SCHOOL_ADMIN and
GATE_KEEPER. Confirm different suggested questions, hidden unauthorized
menus, transcript keyboard input, mobile viewport, voice permission failure,
dark theme, and that a session expiry never produces a privileged answer.
Check DTR and attendance remain unchanged after help interaction.
