// Detail-page titled sections + live embeds: own Vite dev server (port 5196), day mode.
// Shots of the opening (lede + rail) and each `.about__sec` for GCC Atlas, ANSRcade and
// ABM Email Automation, then GCC Atlas's embed played and enlarged. gcc-landscape only
// allows framing by ansr.com, so its CSP header is stripped here to see the embed working.
// node reference/tools/sections.mjs [prefix] [width] [height]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = path.join(root, 'validation');
mkdirSync(OUT, { recursive: true });
const [prefix = 'sections', w = 1440, h = 900] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)('playwright');
const { createServer } = await import(path.join(root, 'node_modules/vite/dist/node/index.js'));
const server = await createServer({ root, server: { port: 5196, strictPort: true }, logLevel: 'warn' });
await server.listen();
const browser = await chromium.launch();
const base = 'http://localhost:5196';
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${prefix}-${name}.png`), scale: 'css' });
try {
  const touch = +w < 768;
  const ctx = await browser.newContext({ viewport: { width: +w, height: +h }, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => localStorage.setItem('night', '0'));
  await ctx.route('https://gcc-landscape.vercel.app/**', async (route) => {
    const res = await route.fetch();
    const headers = { ...res.headers() };
    delete headers['content-security-policy'];
    await route.fulfill({ response: res, headers });
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  const scrollTo = async (el) => {
    await el.evaluate((n) => n.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -40));
    await page.waitForTimeout(1400);
  };
  for (const slug of ['gcc-atlas', 'ansrcade', 'abm-email-automation']) {
    await page.goto(`${base}/work/${slug}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1800);
    await scrollTo(await page.$('.about__grid'));
    await shot(page, `${slug}-open`);
    const secs = await page.$$('.about__sec');
    for (let i = 0; i < secs.length; i++) {
      await scrollTo(secs[i]);
      await shot(page, `${slug}-sec${i + 1}`);
    }
    console.log(slug, 'sections', secs.length, 'titles', await page.$$eval('.about__sec-title', (n) => n.map((x) => x.textContent)));
  }
  // GCC Atlas embed: play, then enlarge.
  await page.goto(`${base}/work/gcc-atlas`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.$eval('.game__slot', (n) => n.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1200);
  await page.click('.game__cover');
  await page.waitForTimeout(4000);
  console.log('zoom', await page.$eval('.game__view iframe', (f) => f.style.zoom), 'scrollY', await page.evaluate(() => Math.round(scrollY)));
  await shot(page, 'gcc-embed');
  await page.click('.game__btn');
  await page.waitForTimeout(1500);
  console.log('zoom big', await page.$eval('.game__view iframe', (f) => f.style.zoom));
  await shot(page, 'gcc-embed-big');
} finally {
  await browser.close();
  await server.close();
}
