# iPhone visual smoke — 2026-11-04

## Setup

- iPhone 17 Pro simulator, iOS 27.0, dark appearance, default text size.
- Local API at `http://0.0.0.0:8080`; health and package catalog returned successfully.
- No Google client ID or signed-in staff tenant was configured.

## Result

The public package screen rendered the four-package catalog with the expected USD
vehicle prices. The hero, package hierarchy, spacing and price alignment are
legible in dark appearance; no clipping was visible in the first two package
cards. See [the simulator capture](iphone-17-pro-dark.png).

This is a visual smoke check of the public screen only. It does not verify staff
operations, pinned headers, iPad layout, VoiceOver, larger Dynamic Type, light
appearance, or Reduce Motion. Those remain in the signed-in acceptance matrix.
