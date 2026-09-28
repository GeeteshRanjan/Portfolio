// Scripted interaction session against the reference. Records video per scenario,
// takes screenshots at key moments and samples the gallery's exposed debug state.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const URL_ = process.argv[2] || 'https://a24.raviklaassens.com/';
const OUT = path.resolve(__dirname, process.argv[3] || '..');
const SHOTS = path.join(OUT, 'screenshots');
const REC = path.join(OUT, 'recordings');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(REC, { recursive: true });
const log = [];
const note = (k, v) => { log.push({ k, v }); console.log(k, JSON.stringify(v)); };

async function scenario(browser, name, fn, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1440, height: 900 },
    recordVideo: { dir: REC, size: opts.viewport || { width: 1440, height: 900 } },
    hasTouch: !!opts.touch, isMobile: !!opts.touch, deviceScaleFactor: 1,
    reducedMotion: opts.reduced ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 });
  try { await fn(page); } catch (e) { note(name + ':error', String(e)); }
  const v = page.video();
  await ctx.close();
  if (v) { const p = await v.path(); fs.renameSync(p, path.join(REC, name + '.webm')); }
}

const state = (page) => page.evaluate(() => {
  const g = document.querySelector('[data-disc-gallery]');
  return g?.discGalleryDebug?.state?.() || null;
});
const hover = (page) => page.evaluate(() => document.querySelector('[data-disc-gallery]')?.discGalleryHover?.read?.() || null);
const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

  // 1) Preloader / intro timeline
  await scenario(browser, 'intro', async (page) => {
    for (let i = 0; i < 8; i++) { await shot(page, `intro-${String(i).padStart(2, '0')}`); await page.waitForTimeout(450); }
    await page.waitForTimeout(2500);
    note('intro:state', await state(page));
  });

  // 2) Hover over active disc -> scribble; hover tilt with pointer sweep
  await scenario(browser, 'hover', async (page) => {
    await page.waitForTimeout(6000);
    await page.mouse.move(200, 600);
    await page.waitForTimeout(400);
    const h0 = await page.evaluate(() => {
      const g = document.querySelector('[data-disc-gallery]'); return null;
    });
    // centre of active disc from screenshot ~ (748, 458)
    await page.mouse.move(748, 458, { steps: 20 });
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(100); await shot(page, `hover-scribble-${i}`); }
    note('hover:read', await hover(page));
    note('hover:state', await state(page));
    // sweep inside the disc to observe tilt
    await page.mouse.move(560, 300, { steps: 25 }); await page.waitForTimeout(500); await shot(page, 'hover-tilt-topleft');
    await page.mouse.move(950, 650, { steps: 25 }); await page.waitForTimeout(500); await shot(page, 'hover-tilt-bottomright');
    // leave -> scribble out
    await page.mouse.move(120, 820, { steps: 10 });
    for (let i = 0; i < 4; i++) { await page.waitForTimeout(100); await shot(page, `hover-out-${i}`); }
    // fast wipe across the side disc (push)
    await page.mouse.move(1000, 150);
    await page.mouse.move(1430, 500, { steps: 4 });
    await page.waitForTimeout(60); await shot(page, 'wipe-push');
    await page.waitForTimeout(1200);
  });

  // 3) Drag the active disc (spin), release (reset tween)
  await scenario(browser, 'drag-disc', async (page) => {
    await page.waitForTimeout(6000);
    await page.mouse.move(748, 458); await page.waitForTimeout(300);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(748 + i * 12, 458 + i * 3); await page.waitForTimeout(16); }
    await shot(page, 'drag-disc-held');
    note('drag-disc:held', await state(page));
    await page.mouse.up();
    await page.waitForTimeout(60); await shot(page, 'drag-disc-release-0');
    await page.waitForTimeout(400); await shot(page, 'drag-disc-release-400');
    await page.waitForTimeout(900); await shot(page, 'drag-disc-release-1300');
  });

  // 4) Drag empty space -> carousel scrub, inertia, snap
  await scenario(browser, 'drag-carousel', async (page) => {
    await page.waitForTimeout(6000);
    await page.mouse.move(1100, 820); await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(1100 - i * 22, 820); await page.waitForTimeout(16); }
    await shot(page, 'drag-carousel-held');
    note('drag-carousel:held', await state(page));
    await page.mouse.up();
    const samples = [];
    for (let i = 0; i < 40; i++) { samples.push(await state(page)); await page.waitForTimeout(30); if (i === 3) await shot(page, 'drag-carousel-inertia'); }
    note('drag-carousel:after', samples.map((s) => s && { a: s.activeIndex, d: s.dragVelocity, sp: s.springVelocity, f: s.flowVelocity, ph: s.scribblePhase }));
    await shot(page, 'drag-carousel-settled');
  });

  // 5) Wheel stepping (slow, fast, reverse)
  await scenario(browser, 'wheel', async (page) => {
    await page.waitForTimeout(6000);
    await page.mouse.move(720, 800);
    const t = [];
    await page.mouse.wheel(0, 100); for (let i = 0; i < 12; i++) { t.push(await state(page)); await page.waitForTimeout(50); if (i === 3) await shot(page, 'wheel-step-mid'); }
    await page.waitForTimeout(600); await shot(page, 'wheel-step-1');
    // fast burst
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 60); await page.waitForTimeout(16); }
    await page.waitForTimeout(150); await shot(page, 'wheel-burst');
    await page.waitForTimeout(900);
    note('wheel:after-burst', await state(page));
    // reverse
    await page.mouse.wheel(0, -120); await page.waitForTimeout(900);
    note('wheel:after-reverse', await state(page));
    note('wheel:samples', t.map((s) => s && { a: s.activeIndex, f: s.flowVelocity, tw: s.busy.tween }));
    // document scroll?
    note('wheel:scrollY', await page.evaluate(() => [scrollY, document.documentElement.scrollHeight, innerHeight]));
  });

  // 6) Click side disc, keyboard nav, space flip
  await scenario(browser, 'click-key', async (page) => {
    await page.waitForTimeout(6000);
    await page.mouse.click(1250, 300);
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(90); await shot(page, `click-side-${i}`); }
    await page.waitForTimeout(1000);
    note('click:state', await state(page));
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(80); await shot(page, 'key-right-mid');
    await page.waitForTimeout(900); await shot(page, 'key-right-done');
    await page.keyboard.press(' '); for (let i = 0; i < 5; i++) { await page.waitForTimeout(160); await shot(page, `space-flip-${i}`); }
    await page.waitForTimeout(800);
    await page.keyboard.press(' '); await page.waitForTimeout(1000);
  });

  // 7) Text transition detail: capture panel DOM during a change
  await scenario(browser, 'text', async (page) => {
    await page.waitForTimeout(6000);
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(70);
      const d = await page.evaluate(() => {
        const t = document.querySelector('[data-film-target=title]');
        const line = t?.querySelector('.disc-line');
        return { text: t?.textContent, lineTf: line ? getComputedStyle(line).transform : getComputedStyle(t).transform, vis: getComputedStyle(t).visibility, rule: getComputedStyle(document.querySelector('.divider-horizontal')).transform };
      });
      log.push({ k: 'text:' + i, v: d });
      if (i % 2 === 0) await shot(page, `text-${i}`);
    }
  });

  // 8) Mobile touch
  await scenario(browser, 'mobile', async (page) => {
    await page.waitForTimeout(6000);
    await shot(page, 'mobile-initial');
    const cdp = await page.context().newCDPSession(page);
    const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', 300, 600);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', 300 - i * 20, 600); await page.waitForTimeout(16); }
    await shot(page, 'mobile-drag');
    await touch('touchEnd');
    await page.waitForTimeout(900); await shot(page, 'mobile-after-flick');
    note('mobile:state', await state(page));
  }, { viewport: { width: 390, height: 844 }, touch: true });

  // 9) Reduced motion
  await scenario(browser, 'reduced', async (page) => {
    await page.waitForTimeout(3000); await shot(page, 'reduced-initial');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100); await shot(page, 'reduced-step');
  }, { reduced: true });

  // 10) Resize
  await scenario(browser, 'resize', async (page) => {
    await page.waitForTimeout(6000);
    await page.setViewportSize({ width: 1000, height: 800 }); await page.waitForTimeout(800); await shot(page, 'resize-1000');
    await page.setViewportSize({ width: 800, height: 900 }); await page.waitForTimeout(800); await shot(page, 'resize-800-tablet');
  });

  fs.writeFileSync(path.join(OUT, 'interaction-log.json'), JSON.stringify(log, null, 1));
  await browser.close();
})();
