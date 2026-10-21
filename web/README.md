# SparkleWash staff console

React + TypeScript + Vite. Staff use it on a tablet or phone at the wash:

| Screen | What it's for |
|---|---|
| **Live floor** | Today's numbers, the live ESP32 camera feed (each read marked *needs review*, *confirmed* or *on job*), equipment alerts |
| **Review** | Cars the entrance camera saw that have no job yet: compare the plate with the photo, fix misreads, pick class + package, open the job in one step |
| **Jobs** | Board from Arrived → Queued → Washing → Done, with live timers, assignments and one-tap advance |
| **Plates** | Plate tracker: every camera sighting and job step for a vehicle, visits and spend |
| **Bays** | Pressure and soap telemetry per bay |

## Languages

Spanish is the default. Staff can switch to English from the sidebar (or the top of the screen on phones,
and on the sign-in page). The choice is remembered on that device. The browser language is
deliberately ignored, so the console starts in Spanish everywhere.

* UI strings: `src/i18n/es.ts` (source of truth) and `src/i18n/en.ts`. A test fails if a key is missing.
  Placeholders use `{name}`; plurals use `{count, plural, one {…} other {…}}`.
* Dates, times, money and "5 min ago" use `Intl` with `es-SV` / `en-US`.
* Package and vehicle-class text comes from `contracts/v1/service-packages.json`. It is written in Spanish,
  and English sits under each entry's `translations.en`.
* To add a language, add `src/i18n/<code>.ts`, list it in `LOCALES` in `src/i18n/index.tsx`,
  and add `translations.<code>` to the catalog.

## Live updates

The console listens to `GET /api/events` (Server-Sent Events) and refetches the affected screen as soon as
an arrival or job changes. Polling every 15–20 s remains as a fallback. The sidebar shows *En vivo* or
*Reconectando…*.

## Run

```bash
npm install
npm run dev        # http://localhost:5173, proxies /api to the API on :5001
npm test
npm run build      # outputs build/ (deployed by the Azure Static Web Apps workflow)
```

Without sign-in, **Explore the demo** runs the whole flow in the browser with simulated cameras.

| Build variable | Purpose |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID; must match the API's `SPARKLEWASH_GOOGLE_CLIENT_ID` |
| `VITE_API_BASE_URL` | API origin when it is not served from the same origin (the API then needs CORS for the console's origin) |

The package catalog for the demo is read from `../contracts/v1`, the same file the API embeds.

## Design notes

Dark-first because the console runs next to the bays at night and in direct sun; light theme follows the
system or the toggle. Status is always icon + label, never colour alone. Touch targets are at least 44 px,
plates are drawn as plates in a monospace face so 0/O and 8/B are easy to compare, motion respects
`prefers-reduced-motion`, and on phones the sidebar becomes a bottom tab bar with the review count badge.
