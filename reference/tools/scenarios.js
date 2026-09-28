// Interaction scenarios shared between reference and implementation checks.
const wait = (p, ms) => p.waitForTimeout(ms);

module.exports = {
  async load(page, shot) {
    for (let i = 0; i < 8; i++) { await shot(`intro-${i}`); await wait(page, 450); }
    await wait(page, 2500);
    await shot('settled');
  },
  async hover(page, shot) {
    await wait(page, 6500);
    const c = await page.evaluate(() => {
      const r = document.querySelector('.gallery__canvas').getBoundingClientRect();
      return { x: r.width / 2, y: r.height / 2 };
    });
    await page.mouse.move(200, 600);
    await wait(page, 300);
    await page.mouse.move(c.x, c.y, { steps: 20 });
    for (let i = 0; i < 5; i++) { await wait(page, 100); await shot(`hover-scribble-${i}`); }
    await page.mouse.move(c.x - 180, c.y - 150, { steps: 25 }); await wait(page, 500); await shot('hover-tilt-topleft');
    await page.mouse.move(c.x + 200, c.y + 180, { steps: 25 }); await wait(page, 500); await shot('hover-tilt-bottomright');
    await page.mouse.move(120, 820, { steps: 10 });
    for (let i = 0; i < 4; i++) { await wait(page, 100); await shot(`hover-out-${i}`); }
  },
  async drag(page, shot) {
    await wait(page, 6500);
    await page.mouse.move(720, 450); await wait(page, 200);
    await page.mouse.down();
    for (let i = 1; i <= 30; i++) { await page.mouse.move(720 + i * 12, 450 + i * 3); await wait(page, 16); }
    await shot('drag-disc-held');
    await page.mouse.up();
    await wait(page, 400); await shot('drag-disc-release-400');
    await wait(page, 1200); await shot('drag-disc-release-1600');
    await page.mouse.move(1100, 820); await page.mouse.down();
    for (let i = 1; i <= 20; i++) { await page.mouse.move(1100 - i * 22, 820); await wait(page, 16); }
    await shot('drag-carousel-held');
    await page.mouse.up();
    await wait(page, 120); await shot('drag-carousel-inertia');
    await wait(page, 1500); await shot('drag-carousel-settled');
  },
  async wheel(page, shot) {
    await wait(page, 6500);
    await page.mouse.move(720, 800);
    await page.mouse.wheel(0, 100);
    await wait(page, 150); await shot('wheel-step-mid');
    await wait(page, 800); await shot('wheel-step-1');
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 60); await wait(page, 16); }
    await wait(page, 1200); await shot('wheel-burst');
    await page.keyboard.press('ArrowRight'); await wait(page, 90); await shot('key-right-mid');
    await wait(page, 1000); await shot('key-right-done');
    await page.keyboard.press(' '); await wait(page, 700); await shot('space-flip');
    await page.keyboard.press(' '); await wait(page, 900);
  },
  async detail(page, shot) {
    await wait(page, 6500);
    await page.mouse.move(720, 450, { steps: 6 }); await wait(page, 400);
    await page.mouse.click(720, 450);
    for (let i = 0; i < 10; i++) { await wait(page, 120); await shot(`detail-transition-${i}`); }
    await wait(page, 1500);
    await shot('detail-top');
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let i = 1; i <= Math.ceil(h / 300) + 2; i++) { await page.mouse.wheel(0, 300); await wait(page, 260); if (i % 2 === 0) await shot(`detail-scroll-${String(i).padStart(2, '0')}`); }
    await wait(page, 800); await shot('detail-end');
    for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, 90); await wait(page, 60); if (i === 5) await shot('detail-push'); }
    await wait(page, 1500); await shot('detail-next');
    console.log('url', page.url());
  },
  async mobile(page, shot) {
    await wait(page, 6500);
    await shot('mobile-initial');
    const cdp = await page.context().newCDPSession(page);
    const t = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await t('touchStart', 300, 600);
    for (let i = 1; i <= 10; i++) { await t('touchMove', 300 - i * 20, 600); await wait(page, 16); }
    await shot('mobile-drag');
    await t('touchEnd');
    await wait(page, 900); await shot('mobile-after-flick');
  },
  async reduced(page, shot) {
    await wait(page, 3000); await shot('reduced-initial');
    await page.keyboard.press('ArrowRight'); await wait(page, 150); await shot('reduced-step');
  },
};
