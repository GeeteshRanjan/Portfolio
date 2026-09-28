// Quick screenshot helper: node shot.js <url> <out.png> [waitMs] [width] [height]
const { chromium } = require('playwright');
(async () => {
  const [url, out, wait = 7000, w = 1440, h = 900] = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu'] });
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(+wait);
  await page.screenshot({ path: out });
  await browser.close();
})();
