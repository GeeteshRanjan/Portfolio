// Focused check of the scroll-next section: scroll to end slowly, then push.
const { chromium } = require('playwright');
const path = require('path');
const OUT = path.resolve(__dirname, '../../validation');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.goto(process.argv[2] || 'http://localhost:5199/work/halflight', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const h = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  let y = 0, i = 0;
  while (y < h - 5 && i < 80) { await page.mouse.wheel(0, 200); await page.waitForTimeout(120); y = await page.evaluate(() => scrollY); i++; }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'next-end.png') });
  await page.waitForTimeout(400);
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, 90); await page.waitForTimeout(70); }
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(OUT, 'next-push-partial.png') });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(OUT, 'next-push-drained.png') });
  for (let k = 0; k < 10; k++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(50); }
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, 'next-exit.png') });
  await page.waitForTimeout(1800);
  console.log('url', page.url(), errs.join('\n'));
  await b.close();
})();
