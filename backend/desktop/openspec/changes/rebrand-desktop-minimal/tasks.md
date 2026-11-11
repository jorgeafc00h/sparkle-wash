# Tasks — SparkleWash Desktop minimal rebrand + 1.0.0 channel

## 1. Brand
- [x] 1.1 Brand source of truth: landing `web/src/landing/landing.css` + iOS `Components.swift` → teal `#0f766e`, ink `#13213a`, sky drop
- [x] 1.2 `--color-accent-*` → teal scale (600 = `#0f766e`)
- [x] 1.3 `BrandMark` (inline SVG drop) in Sidebar + Welcome; `AppLogo.png` removed
- [x] 1.4 Welcome/Onboarding gradient (ink → deep teal), sky orb, Plex wordmark (no script font)

## 2. Art (ComfyUI `192.168.1.14:8000`, local Krea-2 Turbo)
- [x] 2.1 `scripts/brand/generate.py` + `prompts.json` (fixed seeds, style suffix, birefnet transparency)
- [x] 2.2 20 candidates (5 slides × 4) → picks recorded in `prompts.json` (`picked`); text-free only
- [x] 2.3 Masters in `design/brand/masters/`, 768 px copies in `src/assets/` (same filenames)
- [x] 2.4 Delete 7 unreferenced images (12 MB)

## 3. Release channel 1.0.0
- [x] 3.1 Container `sticongen/sparklewash-installer` (public access: blob)
- [x] 3.2 `builder.config.json` `publish` (generic → container) → baked `app-update.yml`
- [x] 3.3 `main.cjs`: macOS manual-download link from the baked feed
- [ ] 3.4 Build mac (dmg + zip, universal) + Windows (nsis + zip, x64); `verify-packaged-app.cjs`
- [ ] 3.5 Upload versioned files, `latest*.yml`, stable aliases; verify sha512 + download URLs

## 4. Verify
- [x] 4.1 `tsc --noEmit`, Jest
- [ ] 4.2 Coverage review (all screens, all DTE types to MH) + new specs
- [ ] 4.3 Web Playwright (full) + Electron Playwright (full, real MH)
- [ ] 4.4 Code review vs the SparkleWash project
