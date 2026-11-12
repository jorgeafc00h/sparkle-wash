# Car Spa web: landing page + staff console

Car Spa (formerly SparkleWash). React + TypeScript + Vite, deployed to Azure Static Web Apps:

| Path | What |
|---|---|
| `/` | Public landing page in Spanish ("showroom & signal": navy showroom sections, white work sections, orange as the signal): hero, how it works, ESP32-CAM hardware and installation, real console screens, iPhone/iPad app, Windows desktop download, FAQ. No price list. |
| `/app/` | Staff console. `/app/?demo=1` opens the in-browser demo directly (all the landing's demo buttons link here). |
| `/manual/` | Desktop user manual, linked from the landing's nav, desktop section and footer (its entry is added in `vite.config.ts` with the manual). |

## Design system

`src/design/tokens.css` is the single source of truth, imported by every entry point. Three layers:

* **Primitives** `--cs-*`: the logo's orange `#FB5A00`, royal blue `#0142A8`, teal `#3F838C`/`#03515B`, navy, grays.
* **Semantic** `--color-*`, `--font-*`, `--text-*`, `--space-1..10`, `--radius-*`, `--shadow-1`, `--dur-*`, `--ease-out`.
  Light by default; any element with `.cs-showroom` remaps them for a navy section. Never white text on orange
  (3.2:1): use `--color-on-accent` (navy, 5.6:1).
* **Components** `.cs-btn` (`--primary` orange, `--secondary` blue, `--ghost`), `.cs-chip` (`--live`, `--due`, `--offline`),
  `.cs-card`, `.cs-eyebrow`, `.cs-showroom`, `.cs-wrap`, and a 3 px focus ring in `--color-focus`.

Fonts are self-hosted with @fontsource: Saira (display), Inter (body), Montserrat 300/500 (eyebrows and the
"AUTOMOTIVE CARE" tagline), and JetBrains Mono for plates in the console. The logo files in `public/brand/` are
copies of `docs/brand/`; never redraw or recolour them. The console keeps its dark-first layout and maps its
colours onto these tokens (dark = navy showroom, light = white surfaces).

## Landing motion and scene slots

The landing animates only `transform` and `opacity`, with no library: staggered scroll reveals, card and button
lift, a sheen across the orange CTA, a draw-in of the header mark, a light hero parallax, floating frames that
pause offscreen, and an S-swoosh section divider. All of it is off under `prefers-reduced-motion`.

Larger CSS scenes (`src/motion/`) mount into `<div data-scene-slot="…">` elements whose children are a static,
accessible fallback: `hero`, `how-it-works`, `polish`, `mobile` and `desktop-ticket` (`SCENE_SLOTS` in
`src/landing/Landing.tsx`).

## Explainer video (archived)

The landing page no longer embeds the MP4 explainer. Its source stays here: `video/explainer.html` (a paper-cut
animation on one CSS timeline) and its captions `video/como-funciona.es.vtt`. To render it again, output goes to
`video/out/` (git-ignored, never deployed):

```bash
npm run build && npx vite preview --port 4173 &   # serves the console for the captures
node scripts/capture-screens.mjs                   # real console screens (Spanish, demo data) -> public/landing/screens
node scripts/render-video.mjs --preview            # a few stills to check timing -> video/out
node scripts/render-video.mjs                      # every frame -> ffmpeg -> MP4 + poster in video/out (needs ffmpeg)
```

## Staff console

Staff use it on a tablet or phone at the wash:

| Screen | What it's for |
|---|---|
| **Live floor** | Today's numbers, the live ESP32 camera feed (each read marked *needs review*, *confirmed* or *on job*), equipment alerts |
| **Review** | Cars the entrance camera saw that have no job yet: compare the plate with the photo, fix misreads, pick class + package, open the job in one step |
| **Jobs** | Board from Arrived → Queued → Washing → Done, with live timers, assignments and one-tap advance |
| **Plates** | Plate tracker: every camera sighting and job step for a vehicle, visits and spend |
| **Bays** | Pressure and soap telemetry per bay |
| **Administración** (admins) | Carwash details; link ESP32-CAM cameras (key shown once with the gateway command), rotate/disable keys, see online status; invite staff by email and set roles; wash employees |

New carwashes register at `/app/?registro=1` (the landing's *Registrar mi autolavado*), with the owner's Google
account. Without `VITE_GOOGLE_CLIENT_ID` the form runs the registration in the demo instead. Roles: *Solo lectura*
(viewer) sees everything but no actions, *Operador* confirms arrivals and moves jobs, *Administrador* also gets
Administración.

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

The console is dark-first because it runs next to the bays at night and in direct sun; light theme follows the
system or the toggle. Status is always icon + label, never colour alone. Touch targets are at least 44 px,
plates are drawn as plates in a monospace face so 0/O and 8/B are easy to compare, motion respects
`prefers-reduced-motion`, and on phones the sidebar becomes a bottom tab bar with the review count badge.
