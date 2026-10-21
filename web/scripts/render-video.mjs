// Renders video/explainer.html to an MP4 (H.264) + poster, frame by frame.
// Needs: playwright (Chromium) and ffmpeg on PATH. Usage: node scripts/render-video.mjs [--fps 30] [--preview]
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(ROOT, "public/landing/video");
const fps = Number(process.argv[process.argv.indexOf("--fps") + 1]) || 30;
const preview = process.argv.includes("--preview");
const TYPES = { ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".js": "text/javascript" };

// Tiny static server over web/ so the page can load fonts from node_modules and screens from public/.
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const url = `http://127.0.0.1:${port}/video/explainer.html`;
async function openPage(scale) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const seek = (page, ms) => page.evaluate((t) => window.__seek(t), ms);

if (preview) {
  // Contact sheet: a few stills, for a quick look without encoding.
  const page = await openPage(1);
  for (const second of [2, 5, 9, 12, 18, 21, 27, 30, 36, 39, 45, 48, 54, 61]) {
    await seek(page, second * 1000);
    await page.screenshot({ path: join(OUT, `preview-${String(second).padStart(2, "0")}.jpg`), type: "jpeg", quality: 80 });
  }
} else {
  // Frames are independent (the page is seeked, not played), so several pages render in parallel.
  const workers = Number(process.env.WORKERS) || 4;
  const frameDir = await mkdtemp(join(tmpdir(), "sparklewash-frames-"));
  const pages = await Promise.all(Array.from({ length: workers }, () => openPage(1.5)));
  const duration = await pages[0].evaluate(() => window.__DURATION);
  const frames = Math.round((duration / 1000) * fps);
  let next = 0;
  let done = 0;
  await Promise.all(pages.map(async (page) => {
    while (next < frames) {
      const frame = next++;
      await seek(page, (frame * 1000) / fps);
      await writeFile(join(frameDir, `${String(frame).padStart(5, "0")}.jpg`), await page.screenshot({ type: "jpeg", quality: 92 }));
      if (++done % (fps * 5) === 0) console.log(`frame ${done}/${frames}`);
    }
  }));
  await new Promise((resolve, reject) => spawn("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", join(frameDir, "%05d.jpg"),
    "-c:v", "libx264", "-preset", "slow", "-crf", "25", "-pix_fmt", "yuv420p", "-movflags", "+faststart", join(OUT, "como-funciona.mp4")],
  { stdio: "inherit" }).on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  await seek(pages[0], 3500);
  await pages[0].screenshot({ path: join(OUT, "poster.jpg"), type: "jpeg", quality: 82 });
  await rm(frameDir, { recursive: true, force: true });
}
await browser.close();
server.close();
console.log("done");
