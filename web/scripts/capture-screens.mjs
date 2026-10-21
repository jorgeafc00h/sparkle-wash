// Captures real console screens (Spanish, demo data) for the landing page and the explainer video.
// Usage: npm run build && npx vite preview --port 4173 & node scripts/capture-screens.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

const BASE = process.env.CONSOLE_URL ?? "http://localhost:4173/app/?demo=1";
const OUT = fileURLToPath(new URL("../public/landing/screens/", import.meta.url));
const SHOTS = [
  { name: "en-vivo", hash: "#/floor", width: 1280, height: 800 },
  { name: "revision", hash: "#/review", width: 1280, height: 860 },
  { name: "tablero", hash: "#/board", width: 1280, height: 640 },
  { name: "placas", hash: "#/plates/P118450", width: 1280, height: 760 },
  { name: "bahias", hash: "#/bays", width: 1280, height: 520 },
  { name: "revision-movil", hash: "#/review", width: 390, height: 844 },
  { name: "tablero-movil", hash: "#/board", width: 390, height: 760 },
];

const browser = await chromium.launch();
for (const shot of SHOTS) {
  const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 2, colorScheme: "dark", locale: "es-SV", timezoneId: "America/El_Salvador" });
  await page.goto(BASE + shot.hash);
  // Marketing captures: hide the "you're in the demo" banner and the toast region.
  await page.addStyleTag({ content: ".banner, .toast-region { display: none !important; }" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}${shot.name}.jpg`, type: "jpeg", quality: 82 });
  await page.close();
  console.log("captured", shot.name);
}
await browser.close();
