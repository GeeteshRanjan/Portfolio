// Night-mode lamp screenshots: starts its own Vite dev server (port 5198), loads / with night
// saved, and captures the settled first disc (+ the next one) into validation/.
// node reference/tools/night-shot.mjs [prefix] [width] [height]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'validation');
mkdirSync(OUT, { recursive: true });
const [prefix = 'night', w = 1440, h = 900] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, server: { port: 5198, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'] });
try {
  const touch = +w < 768;
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => localStorage.setItem('night', '1'));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.goto('http://localhost:5198/?debug', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(14000);
  await page.screenshot({ path: path.join(OUT, `${prefix}-0.png`), scale: 'css' });
  // Close-up of the lamp head (DPR 1, so it stays small).
  if (!touch) await page.screenshot({ path: path.join(OUT, `${prefix}-lamp.png`), clip: { x: 200, y: 0, width: 420, height: 380 } });
  if (!touch) {
    // Pointer over an empty part of the gallery, nothing focused: arrow keys drive it.
    await page.mouse.move(+w * 0.2, +h * 0.5);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(2500);
    // Clicking the active disc opens it; if that happened, skip the second shot.
    if (new URL(page.url()).pathname === '/') await page.screenshot({ path: path.join(OUT, `${prefix}-1.png`), scale: 'css' });
  }
} finally {
  await browser.close();
  await server.close();
}
