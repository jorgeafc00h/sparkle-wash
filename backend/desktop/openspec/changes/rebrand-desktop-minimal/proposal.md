# Rebrand the SparkleWash Desktop UI — minimal visual change + 1.0.0 release channel

## Why

SparkleWash Desktop is a copy of Facturas Simples Desktop 1.4.6 plus the carwash workflow. The
name was already rebranded (UI text, app name, data isolation, icons = the SparkleWash drop of the
iOS app). The look was still Facturas Simples:

| Surface | Before |
|---|---|
| UI accent (`@theme --color-accent-*`, 277 usages) | Facturas Simples blue `#2563eb` |
| Welcome + Onboarding background | Facturas Simples navy/purple gradient (`#0b1438 → #1a2560`) + purple orb |
| Welcome title | `"Marker Felt"` script font (rest of the app: IBM Plex Sans) |
| Sidebar / Welcome logo | the 1024 px app-icon PNG (`AppLogo.png`) scaled to 32/64 px |
| Welcome hero + 5 onboarding slides | Facturas Simples isometric office/desk scenes |
| Bundle | 7 unreferenced FS images (12 MB: `OnboardingImage1.png` alone 7.6 MB) |
| Updates / deploy | no feed (updater off), no installer location |

SparkleWash's own brand (landing `web/src/landing/landing.css`, iOS `Components.swift`):
**teal `#0f766e`** primary, **ink `#13213a`** navy, **sky** drop (`#38bdf8` on the icon), coral.

## What Changes

1. **Accent → SparkleWash teal.** Only the 10 `--color-accent-*` values in `src/index.css` change
   (600 = `#0f766e`, 5.5:1 with white). Slate neutrals and semantic colors (status, info, plan
   tiers) are untouched.
2. **`BrandMark`** (`src/components/common/BrandMark.tsx`): the icon's drop as inline SVG, used by
   the Sidebar header and the Welcome page instead of the 1024 px PNG.
3. **Welcome / Onboarding:** ink-navy → deep-teal gradient, sky orb instead of purple, the title
   set as `Sparkle<sky>Wash</sky>` in Plex bold (same wordmark as the Sidebar).
4. **Art:** the Welcome hero and the 5 onboarding slides are regenerated as carwash scenes in the
   SparkleWash palette with the local Krea-2 Turbo model on ComfyUI (`scripts/brand/`), same
   isometric-diorama style as before, transparent backgrounds. Filenames kept → no code change.
5. **Housekeeping:** delete the 7 unreferenced images and `AppLogo.png`.
6. **Release channel:** new public-read container `sticongen/sparklewash-installer`;
   `builder.config.json` gains a `publish` block so `app-update.yml` is baked and the updater
   reads that feed; the macOS manual-download dialog now derives its DMG link from the baked feed
   (it only worked with `SPARKLEWASH_UPDATE_URL`). Version stays **1.0.0**.

## Non-goals
- Facturas Simples (`~/github/FACTURAS SIMPLES/App.Desktop`) is the read-only upstream: untouched.
- The free-tier PDF keeps the Facturas Simples logo + footer (CLAUDE.md rule: the invoicing service
  and plans are Facturas Simples). Revisit if SparkleWash sells its own plans.
- No layout, copy or feature change.

## Impact
- Code: `src/index.css`, `src/components/common/BrandMark.tsx` (new), `Sidebar.tsx`,
  `WelcomePage.tsx`, `OnboardingPage.tsx`, `electron/main.cjs` (feed URL), `electron/builder.config.json`.
- Assets: `src/assets/ob-0{1,2,3,6}-*.png`, `ob-15-export.png` replaced; 8 files deleted.
- Tooling: `scripts/brand/generate.py`, `prompts.json`; `design/brand/candidates/` git-ignored,
  picked masters in `design/brand/masters/`.
