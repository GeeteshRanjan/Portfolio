// Detail-page exploration: transition from gallery -> detail, then scroll behaviour.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const OUT = path.resolve(__dirname, '..');
const SHOTS = path.join(OUT, 'screenshots');
const REC = path.join(OUT, 'recordings');
const log = [];

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: REC, size: { width: 1440, height: 900 } } });
  const page = await ctx.newPage();
  await page.goto('https://a24.raviklaassens.com/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  await page.mouse.move(748, 458, { steps: 8 });
  await page.waitForTimeout(500);
  await page.mouse.click(748, 458);
  for (let i = 0; i < 12; i++) { await page.waitForTimeout(120); await page.screenshot({ path: path.join(SHOTS, `detail-transition-${String(i).padStart(2, '0')}`) + '.png' }); }
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    url: location.href, h: document.documentElement.scrollHeight, vh: innerHeight,
    sections: [...document.querySelectorAll('main section, main [data-parallax], main [data-dissolve], main [data-scroll-next], main [data-production-hero]')].map((s) => ({ tag: s.tagName, cls: s.className, attrs: [...s.attributes].map((a) => a.name).filter((n) => n.startsWith('data-')), top: s.getBoundingClientRect().top + scrollY, h: s.offsetHeight })),
  }));
  log.push(info);
  await page.screenshot({ path: path.join(SHOTS, 'detail-00-top.png') });
  const steps = Math.ceil(info.h / 300);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(260);
    if (i % 2 === 0) await page.screenshot({ path: path.join(SHOTS, `detail-scroll-${String(i).padStart(2, '0')}.png`) });
  }
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'detail-end.png') });
  log.push({ endUrl: page.url(), scrollY: await page.evaluate(() => scrollY) });
  const v = page.video();
  await ctx.close();
  fs.renameSync(await v.path(), path.join(REC, 'detail-scroll.webm'));
  fs.writeFileSync(path.join(OUT, 'detail-log.json'), JSON.stringify(log, null, 1));
  console.log(JSON.stringify(log, null, 1).slice(0, 5000));
  await browser.close();
})();
