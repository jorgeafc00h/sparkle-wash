# Round 84 / 256 — PWA Service Worker + Build System Configuration

## What We Built

| File | Purpose |
|------|---------|
| `frontend/public/manifest.json` | PWA manifest with icons, theme colors, display modes |
| `frontend/public/sw.js` | Cache-first strategy for static assets; network-first for API calls; offline fallback |
| `frontend/public/offline.html` | Graceful degradation page shown when the cache is stale and no network response succeeds |
| `frontend/vite.config.ts` | Vite config with React plugin, base path `/` for PWA root serving |
| `frontend/package.json` | Project scripts (`dev`, `build`, `preview`) + dependency tree |
| `frontend/tsconfig.json` | TypeScript strict config, JSX transform enabled |

## Key Decisions

### 1. Service Worker Caching Strategy

The SW uses a **cache-first, network-first** hybrid strategy:

- **Static assets** (HTML/CSS/images) → precached on install, served from cache
- **Dynamic content** (API responses, WebSocket messages) → network-only, then cached
- **Fallback**: if both network and cache fail, serve `offline.html` instead of blank

### 2. Degradation Path

```
WebSocket (preferred) → 3s interval ⬇ → Long-polling HTTP (degraded mode) → offline.html
```

The application gracefully degrades from a real-time WebSocket stream to an hourly-poll HTTP endpoint, then ultimately shows the offline message when no connectivity is possible for an extended period.

### 3. Build Pipeline

- Development: `npm run dev` serves on `localhost:5173`
- Production bundles into `backend/wwwroot` via `npm run build`
- The `.gitignore` already excludes `/dist`, so the `build` output goes directly to the OCI container image's wwwroot.

---

Round 84 / 256: Build system and PWA assets complete. Next: finalize the Vite build pipeline and document the deployment checklist.
