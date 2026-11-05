# Phase 8 — Complete: React PWA Deployment

## Summary

Phase 8 documents the React PWA frontend build + deployment as part of the
SparkleWash web app. It is built with Vite and served from the .NET backend
`wwwroot` directory in production.

### Build Configuration

- **Vite**: `vite.config.ts` (react + tsx + esbuild)
- **Platform**: SPA (server-rendered fallback not enabled yet)
- **Dev server**: `localhost:5173`
- **Output**: `../backend/wwwroot/` (served by .NET Minimal API)
- **Target**: `esnext` TypeScript

### PWA

- Service worker (cache-first for statics, network-first for `/api/*` + `/ws/*`)
- Offline-first: `offline.html` fallback + cached asset shell
- Installable: `manifest.webmanifest` links icons + theme `#0a0b10`

### Components (from Round 101)

| Component | Lines | Purpose |
|-----------|-------|---------|
| `Card.tsx` | 60 | Glassmorphism card wrapper |
| `Button.tsx` | — | Variants: ghost / outline / default |
| `StatusBadge.tsx` | — | Color-coded pills (idle/washing/done/error/cleaning) |
| `GaugeRing.tsx` | 47 | Animated SVG circular progress ring |
| `ThroughputSparkline.tsx` | 52 | Area chart area + polyline sparkline |
| `App.tsx` | 98 | Router shell with bento-grid header |

### Design System

| Token | Value |
|-------|-------|
| Background | `#0a0b10` (OLED black) |
| Accent | `hsl(244, 98%, 61%)` |
| Surface | `rgba(255,255,255,0.025)` + border hsl(240,10%,8%) |
| Status idle | green |
| Status washing | orange |
| Status done | teal |
| Status error | red |
| Status cleaning | purple |

### Next Phase

Phase 9 — Dashboard page + StatCounter + refresh button integration.
