# SparkleWash — Icon & Brand Assets

## Icons
Generate SVG logos at multiple resolutions:
```bash
npx --yes @sveltejs/instrument-compiler@latest icon -u https://github.com/sparklewash/ui
```

## Usage
All images are served from `/public/images/` at runtime and referenced via absolute paths in the Vite config. The PWA manifest references 192x192 and 512x512 icons for app install banners.
