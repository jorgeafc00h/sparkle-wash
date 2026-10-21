# SparkleWash staff console

React + TypeScript + Vite. Staff use it on a tablet or phone at the wash:

| Screen | What it's for |
|---|---|
| **Live floor** | Today's numbers, the live ESP32 camera feed (each read marked *needs review*, *confirmed* or *on job*), equipment alerts |
| **Review** | Cars the entrance camera saw that have no job yet: compare the plate with the photo, fix misreads, pick class + package, open the job in one step |
| **Jobs** | Board from Arrived → Queued → Washing → Done, with live timers, assignments and one-tap advance |
| **Plates** | Plate tracker: every camera sighting and job step for a vehicle, visits and spend |
| **Bays** | Pressure and soap telemetry per bay |

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
