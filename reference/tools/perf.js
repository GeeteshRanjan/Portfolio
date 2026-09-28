// Frame-pacing comparison: records rAF intervals + long tasks during identical interactions.
// node perf.js <name> <url> [detailUrl]
const { chromium } = require('playwright');
const [name, url, detailUrl] = process.argv.slice(2);

const install = () => {
  window.__perf = { frames: [], long: [], marks: [] };
  let last = performance.now();
  const loop = (t) => { window.__perf.frames.push([t, t - last]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__perf.long.push([e.startTime, e.duration]))).observe({ type: 'longtask', buffered: false });
  } catch {}
  window.__mark = (m) => window.__perf.marks.push([performance.now(), m]);
};

function stats(perf) {
  const segs = {};
  const marks = perf.marks.concat([[Infinity, 'end']]);
  for (let i = 0; i < marks.length - 1; i++) {
    const [a, m] = marks[i], [b] = marks[i + 1];
    const f = perf.frames.filter(([t]) => t >= a && t < b).map(([, d]) => d);
    if (!f.length) continue;
    const s = f.slice().sort((x, y) => x - y);
    const long = perf.long.filter(([t]) => t >= a && t < b);
    segs[m] = {
      frames: f.length,
      p50: +s[Math.floor(s.length * 0.5)].toFixed(1),
      p95: +s[Math.floor(s.length * 0.95)].toFixed(1),
      max: +s[s.length - 1].toFixed(1),
      over25: f.filter((d) => d > 25).length,
      longTasks: long.length,
      longMs: Math.round(long.reduce((x, [, d]) => x + d, 0)),
    };
  }
  return segs;
}

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(install);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => window.__mark('load'));
  await page.waitForTimeout(7000);
  const mark = (m) => page.evaluate((m) => window.__mark(m), m);
  await mark('idle');
  await page.waitForTimeout(800);
  await page.mouse.move(720, 800);
  await mark('wheel');
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(700); }
  await mark('drag');
  await page.mouse.move(1150, 820); await page.mouse.down();
  for (let i = 1; i <= 30; i++) { await page.mouse.move(1150 - i * 18, 820); await page.waitForTimeout(16); }
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await mark('keys');
  for (let i = 0; i < 3; i++) { await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(600); }
  await mark('hover');
  await page.mouse.move(700, 440, { steps: 30 });
  await page.waitForTimeout(400);
  await page.mouse.move(560, 320, { steps: 30 });
  await page.mouse.move(860, 600, { steps: 30 });
  await page.waitForTimeout(800);
  await mark('open');
  await page.mouse.click(720, 450);
  await page.waitForTimeout(2500);
  await mark('detail-scroll');
  if (detailUrl) {
    for (let i = 0; i < 14; i++) { await page.mouse.wheel(0, 220); await page.waitForTimeout(90); }
    await page.waitForTimeout(1200);
  }
  await mark('end');
  const perf = await page.evaluate(() => window.__perf);
  console.log(name, JSON.stringify(stats(perf), null, 0).replace(/},/g, '},\n  '));
  await b.close();
})();
