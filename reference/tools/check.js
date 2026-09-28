// Quick validation harness for the implementation: screenshots over time + console errors.
// node check.js <url> <prefix> [scenario]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const [url, prefix = 'impl', scenario = 'load', vw = '1440', vh = '900'] = process.argv.slice(2);
const OUT = path.resolve(__dirname, '../../validation');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const touch = scenario.startsWith('mobile');
  const ctx = await b.newContext({ viewport: { width: +vw, height: +vh }, hasTouch: touch, isMobile: touch, reducedMotion: scenario === 'reduced' ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'networkidle' });
  const shot = (n) => page.screenshot({ path: path.join(OUT, `${prefix}-${n}.png`) });
  const S = require(`./scenarios.js`);
  await S[scenario](page, shot);
  console.log(errors.slice(0, 30).join('\n') || 'no console errors');
  await b.close();
})();
