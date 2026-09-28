// Numeric comparison of carousel physics: reference debug API vs implementation debug API.
const { chromium } = require('playwright');
const runs = [
  ['reference', 'https://a24.raviklaassens.com/', () => document.querySelector('[data-disc-gallery]').discGalleryDebug.state()],
  ['impl', 'http://localhost:5199/?debug', () => document.querySelector('.gallery').galleryDebug.state()],
];
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [name, url, fn] of runs) {
    const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(7000);
    const st = () => page.evaluate(fn);
    // Drag on empty space, release, sample decay.
    await page.mouse.move(1100, 820); await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(1100 - i * 22, 820); await page.waitForTimeout(16); }
    await page.mouse.up();
    const t0 = Date.now();
    const s = [];
    for (let i = 0; i < 45; i++) { const v = await st(); s.push([Date.now() - t0, v.activeIndex, v.dragVelocity, v.springVelocity, v.flowVelocity]); await page.waitForTimeout(25); }
    const firstSpring = s.find((r) => r[3] !== 0);
    const settle = s.find((r, i) => i > 3 && r[2] === 0 && Math.abs(r[3]) < 0.005 && Math.abs(r[4]) < 0.05);
    console.log(name, 'drag release: v0', s[0][2], 'active', s[s.length - 1][1], 'springStart ms', firstSpring?.[0], 'settle ms', settle?.[0]);
    // Wheel step: time until tween done.
    await page.waitForTimeout(800);
    await page.mouse.wheel(0, 100);
    const w0 = Date.now();
    const ws = [];
    for (let i = 0; i < 20; i++) { const v = await st(); ws.push([Date.now() - w0, v.activeIndex, v.flowVelocity]); await page.waitForTimeout(30); }
    const peak = ws.reduce((a, r) => (Math.abs(r[2]) > Math.abs(a[2]) ? r : a));
    console.log(name, 'wheel: peak flow', peak[2], 'at', peak[0], 'ms; active after', ws[ws.length - 1][1]);
    await page.waitForTimeout(2500);
    const idle = await st();
    console.log(name, 'idle running:', idle.running);
    await page.close();
  }
  await b.close();
})();
