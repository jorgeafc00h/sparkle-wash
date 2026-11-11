# Design — SparkleWash Desktop minimal rebrand

## 1. Asset generation: ComfyUI + Krea-2 Turbo (local, no credits)

Server `http://192.168.1.14:8000` (override with `COMFYUI_HOST`). `scripts/brand/generate.py`
(stdlib only) posts an API-format graph that mirrors ComfyUI's own `image_krea2_turbo_t2i`
workflow and downloads the results:

| Node | Settings |
|---|---|
| `UNETLoader` | `krea2_turbo_fp8_scaled.safetensors` |
| `CLIPLoader` | `qwen3vl_4b_fp8_scaled.safetensors`, type `krea2` |
| `VAELoader` | `qwen_image_vae.safetensors` |
| `CLIPTextEncode` → positive, `ConditioningZeroOut` → negative | turbo is distilled (no negative prompt) |
| `KSampler` | 8 steps, cfg 1.0, euler / simple, fixed seed, batch 4, 1024² |
| transparent copy | `LoadBackgroundRemovalModel` (`birefnet`) → `RemoveBackground` → `InvertMask` → `JoinImageWithAlpha` |

Never the `Krea2ImageNode` / `Krea3ImageNode` partner nodes (paid API).

Prompt rules (learned): end with "no text, no letters, no numbers, no logos"; **describe colors in
words** — hex codes in the prompt are painted onto signs as text. Shared style suffix keeps the
set consistent: isometric miniature diorama, soft 3D clay render, teal + sky accents, black
background (removed afterwards).

Process: `python3 -I scripts/brand/generate.py [asset…]` → candidates in `design/brand/candidates/`
→ contact sheet on the real gradient → pick (recorded in `prompts.json` `picked`) → copy the
`_alpha` master to `design/brand/masters/` → `magick -resize 768x768 -strip` into `src/assets/`
(displayed at ≤ 384 px CSS, so 768 covers 2× screens).

## 2. Tokens

`--color-accent-*` = teal scale shifted so 600 is the brand teal:
`#f0fdfa #ccfbf1 #99f6e4 #5eead4 #2dd4bf #0d9488 #0f766e #115e59 #134e4a #042f2e` (50…900).
Usage check: 600 is used as text (60×) and button bg (25×) → 5.5:1 with white; 500 is mostly focus
rings/borders; 50/100 tints.

## 3. Release channel

- Channel: the SparkleWash repo's **GitHub Releases** (`desktop-v<version>`), read through
  `https://github.com/jorgeafc00h/sparkle-wash/releases/latest/download/<file>` by both the generic
  updater feed and the landing page button. (The first plan used the `sticongen/sparklewash-installer`
  blob container; the SparkleWash repo has no storage credentials, so releases replaced it.)
  Facturas Simples' `installer` container is never written.
- Files per release: `SparkleWash-Setup-<v>.exe` (+ blockmap), `SparkleWash-<v>-win.zip`,
  `SparkleWash-<v>-universal.dmg` / `-mac.zip` (+ blockmaps), `latest.yml`, `latest-mac.yml`,
  stable aliases `SparkleWash-Setup-latest.exe`, `SparkleWash-latest-mac.dmg` (no-cache).
- macOS builds are ad-hoc signed (no Developer ID on this machine) → Squirrel.Mac can't
  self-install; `main.cjs` already falls back to the "Actualización disponible" dialog, which now
  links `<baked feed>/SparkleWash-latest-mac.dmg`.
