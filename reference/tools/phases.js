// Frame pacing per phase: keys → drag → keys → hover, plus the gallery debug state after each.
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:5199/?debug';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(6500);
  await page.evaluate(() => {
    window.__f = [];
    let last = performance.now();
    const f = (t) => { window.__f.push(t - last); last = t; requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const phase = async (name, fn) => {
    await page.evaluate(() => (window.__f.length = 0));
    await fn();
    const f = await page.evaluate(() => window.__f.slice());
    const busy = f.filter((d) => d > 8).sort((a, b) => a - b);
    const st = await page.evaluate(() => document.querySelector('.gallery')?.galleryDebug?.state?.() ?? null);
    const extra = await page.evaluate(() => ({ tickers: window.gsap?.ticker ? 'n/a' : 'n/a', tweens: 0 }));
    console.log(name.padEnd(8), 'n', busy.length, 'p50', busy[busy.length >> 1]?.toFixed(1), 'p95', busy[Math.floor(busy.length * 0.95)]?.toFixed(1), '>25', busy.filter((d) => d > 25).length, JSON.stringify(st), extra.tweens);
  };
  await page.mouse.move(100, 850);
  await phase('keys1', async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(550); } });
  await phase('drag', async () => {
    await page.mouse.move(1150, 820); await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(1150 - i * 18, 820); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(1500);
  });
  await phase('keys2', async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(550); } });
  await phase('idle', async () => { await page.waitForTimeout(1500); });
  await phase('hover', async () => { await page.mouse.move(700, 440, { steps: 30 }); await page.waitForTimeout(1000); });
  await b.close();
})();
