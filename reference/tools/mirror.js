// Loads the reference page in Chromium, records every network response and
// saves same-origin + CDN assets under reference/source/ for offline analysis.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '../source');
const TARGET = process.argv[2] || 'https://a24.raviklaassens.com/';

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const log = [];
  page.on('response', async (res) => {
    try {
      const u = new URL(res.url());
      const type = res.request().resourceType();
      log.push({ url: res.url(), status: res.status(), type, ct: res.headers()['content-type'] });
      if (type === 'media') return; // skip video streams
      const buf = await res.body().catch(() => null);
      if (!buf) return;
      let p = u.pathname.endsWith('/') ? u.pathname + 'index.html' : u.pathname;
      const file = path.join(OUT, u.hostname, decodeURIComponent(p));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    } catch (e) {}
  });
  page.on('console', (m) => log.push({ console: m.type(), text: m.text() }));
  await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(6000);
  // scroll through to trigger lazy loads
  for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 600); await page.waitForTimeout(300); }
  await page.waitForTimeout(3000);
  fs.writeFileSync(path.join(OUT, 'network-log.json'), JSON.stringify(log, null, 1));
  await browser.close();
  console.log('responses:', log.filter((l) => l.url).length);
})();
