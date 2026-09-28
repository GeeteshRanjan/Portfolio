// Nav notch screenshots: starts its own Vite dev server (port 5194) and captures, day and night,
// the gallery, a detail page at the top and scrolled (content passing behind the notch), the
// About page, and the Index panel open, into validation/.
// node reference/tools/notch.mjs [prefix] [width] [height] [slug]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'validation');
mkdirSync(OUT, { recursive: true });
const [prefix = 'notch', w = 1440, h = 900, slug = 'gys-marketing'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, server: { port: 5194, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${prefix}-${name}.png`), scale: 'css' });
try {
  for (const mode of ['day', 'night']) {
    const ctx = await browser.newContext({ viewport: { width: +w, height: +h } });
    await ctx.addInitScript((n) => { if (n) localStorage.setItem('night', '1'); else localStorage.removeItem('night'); }, mode === 'night');
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('pageerror', e.message));

    await page.goto('http://localhost:5194/', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    await shot(page, `${mode}-preload`);
    await page.waitForTimeout(11000);
    await shot(page, `${mode}-gallery`);
    await page.click('.nav__toggle');
    await page.waitForTimeout(900);
    await shot(page, `${mode}-index`);
    await page.keyboard.press('Escape');

    await page.goto(`http://localhost:5194/work/${slug}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    await shot(page, `${mode}-detail-top`);
    for (const [i, y] of [[1, 0.35], [2, 1.2]]) {
      await page.mouse.move(+w / 2, +h / 2);
      await page.mouse.wheel(0, +h * y);
      await page.waitForTimeout(2200);
      await shot(page, `${mode}-detail-${i}`);
    }

    await page.goto('http://localhost:5194/about', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.mouse.move(+w / 2, +h / 2);
    await page.mouse.wheel(0, +h * 0.5);
    await page.waitForTimeout(2200);
    await shot(page, `${mode}-about`);
    await ctx.close();
  }
} finally {
  await browser.close();
  await server.close();
}
