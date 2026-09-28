// Site-wide night screenshots: own Vite dev server (port 5197), night saved, then the detail
// hero (reading light), website cards + game (screen glow), About portrait + contact hover (sign),
// and a Work → About page change mid-flight (lights out / warm-up). Output in validation/.
// node reference/tools/night-pages.mjs [prefix] [width] [height] [day]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'validation');
mkdirSync(OUT, { recursive: true });
const [prefix = 'npages', w = 1440, h = 900, mode = 'night'] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, server: { port: 5197, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'] });
const base = 'http://localhost:5197';
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(OUT, `${prefix}-${name}.png`), scale: 'css', ...opts });
try {
  const touch = +w < 768;
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript((m) => localStorage.setItem('night', m === 'night' ? '1' : '0'), mode);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });

  const scrollTo = async (sel, block = 'center') => {
    await page.evaluate(([s, b]) => document.querySelector(s)?.scrollIntoView({ block: b }), [sel, block]);
    await page.waitForTimeout(1600);
  };

  // Detail with website cards.
  await page.goto(`${base}/work/gys-marketing`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  console.log('data-night', await page.evaluate(() => document.documentElement.hasAttribute('data-night')),
    'theme', await page.evaluate(() => document.querySelector('meta[name="theme-color"]')?.content));
  await shot(page, 'hero');
  await scrollTo('.about__grid', 'start');
  await shot(page, 'desc');
  await scrollTo('.sites');
  await shot(page, 'sites');
  if (!touch) {
    await page.hover('.site');
    await page.waitForTimeout(700);
    await shot(page, 'sites-hover');
  }
  await scrollTo('.next__frame', 'start');
  await page.waitForTimeout(1500);
  await shot(page, 'next');

  // Detail with the game in the rail.
  await page.goto(`${base}/work/ansrcade`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await scrollTo('.game__slot');
  await shot(page, 'game');

  // Detail with a detour (muted text).
  await page.goto(`${base}/work/wizar-gtm`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await scrollTo('.about__grid', 'start');
  await shot(page, 'detour');

  // About: portrait, contact (rest + hover).
  await page.goto(`${base}/about`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot(page, 'about');
  await scrollTo('.profile__portrait');
  await shot(page, 'portrait');
  await scrollTo('.profile__prompt');
  await shot(page, 'contact');
  if (!touch) {
    await page.hover('.profile__prompt');
    await page.waitForTimeout(350);
    await shot(page, 'contact-heating');
    await page.waitForTimeout(1200);
    await shot(page, 'contact-hot');
  }

  // Page change: About → Work (gallery) via the nav, sampled through the lights-out/warm-up.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await page.click('.nav__link[href="/"]');
  for (const t of [250, 520, 700, 1000]) {
    await page.waitForTimeout(t - (t === 250 ? 0 : [250, 520, 700, 1000][[250, 520, 700, 1000].indexOf(t) - 1]));
    const op = await page.evaluate(() => { const l = document.querySelector('.lights'); const s = getComputedStyle(l); return `${s.opacity} ${s.backgroundColor} ${s.visibility}`; });
    console.log('lights @', t, op);
    await shot(page, `trans-${t}`);
  }
  await page.waitForTimeout(3000);
  console.log('gallery data-night', await page.evaluate(() => document.documentElement.hasAttribute('data-night')));
  await shot(page, 'gallery');
} finally {
  await browser.close();
  await server.close();
}
