import { gsap } from './tokens';
import type { PreloaderApi } from '../three/DiscGallery';
import type { SiteContent } from '../content/types';

/**
 * First-visit intro. An odometer counter orbits the lead disc along an arc
 * while the disc rises and turns face-on. Progress runs continuously on an
 * eased `minDuration` clock (held back only while textures are still
 * loading) and drives the counter, orbit and disc pose. At 100 the disc grows
 * into the counter (pushing the glyphs up) and the other discs fan out.
 * (REFERENCE_ANALYSIS.md §5, Initial load.)
 */

const CFG = {
  minDuration: 2.85,
  /** Counter starts once the "0" has risen in. */
  countDelay: 0.7,
  /** While covers are still loading, progress may run ahead of them by this much. */
  loadLead: 0.2,
  /** While waiting on loads the cap drifts towards this, with this time constant (s). */
  waitCeil: 0.97,
  waitDrift: 3,
  /** Smoothing on the progress value (per second); only noticeable when loading holds it back. */
  chase: 10,
  /** Top progress speed (per second); the clock's own peak is ~0.73. */
  maxRate: 0.9,
  riseAfter: 0.03,
  turnBy: 0.8,
  letter: 0.6,
  discGap: 0.35,
  pushBy: 0.7,
  pushStagger: 0.14,
  yearRoll: 0.4,
  /** Counter drum roll per digit change. */
  digitRoll: 0.18,
  setOff: 0.45,
  exit: 0.5,
  navAfter: 0.15,
  copyAfter: 0.3,
};
const DRUM = '0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n0\n1\n2\n3\n4\n5\n6\n7\n8\n9';
const STEP = 5; // yPercent per digit (20 rows)

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const turnEase = (t: number) => 1 - (1 - t) ** 2.4;
const riseEase = (t: number) => 1 - (1 - t) ** 3;

interface Cell { cell: HTMLElement; shell: HTMLElement; inner: HTMLElement; width: string; shown: boolean; pos: number }

export function runPreloader(api: PreloaderApi, canvasEl: HTMLElement, site: SiteContent, onNav: () => void, onCopy: () => void): Promise<void> {
  const root = document.createElement('div');
  root.className = 'preloader';
  root.setAttribute('aria-hidden', 'true');
  const count = document.createElement('div');
  count.className = 'preloader__count display-l';
  root.appendChild(count);
  document.body.appendChild(root);

  const mkCell = (container: HTMLElement): Cell => {
    const cell = document.createElement('span');
    cell.className = 'preloader__cell';
    const shell = document.createElement('span');
    shell.className = 'preloader__shell';
    const inner = document.createElement('span');
    inner.className = 'preloader__drum';
    inner.textContent = DRUM;
    shell.appendChild(inner);
    cell.appendChild(shell);
    container.appendChild(cell);
    return { cell, shell, inner, width: '', shown: false, pos: 0 };
  };
  const drums = [mkCell(count), mkCell(count), mkCell(count)];
  const fontPx = () => parseFloat(getComputedStyle(count).fontSize) || 16;
  drums.forEach((d) => (d.width = `${d.cell.getBoundingClientRect().width / fontPx()}em`));
  // Each digit's own advance (the display serif's figures aren't tabular, so a
  // "1" in a "0"-wide cell left a gap before the next digit).
  const DIGIT_W = Array.from({ length: 10 }, (_, n) => {
    const s = document.createElement('span');
    s.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    s.textContent = String(n);
    count.appendChild(s);
    const w = `${s.getBoundingClientRect().width / fontPx()}em`;
    s.remove();
    return w;
  });
  gsap.set([drums[0].cell, drums[1].cell], { width: 0 });
  gsap.set(drums[2].inner, { yPercent: STEP });
  drums[2].shown = true;
  gsap.to(drums[2].inner, { yPercent: 0, duration: 0.38, ease: 'power4.out', delay: 0.3 });

  // Side labels.
  const side = (kind: 'left' | 'right') => {
    const s = document.createElement('div');
    s.className = `preloader__side preloader__side--${kind} body-m`;
    root.appendChild(s);
    return s;
  };
  const left = side('left');
  const right = side('right');
  const line = (host: HTMLElement, content: string | HTMLElement) => {
    const l = document.createElement('div');
    l.className = 'preloader__line';
    const i = document.createElement('div');
    i.className = 'preloader__inner';
    if (typeof content === 'string') i.textContent = content; else i.appendChild(content);
    l.appendChild(i);
    host.appendChild(l);
    gsap.set(i, { yPercent: 120 });
    return i;
  };
  const years = document.createElement('span');
  years.className = 'preloader__years';
  const yearDrums = String(site.sinceYear).split('').map((ch) => {
    const c = mkCell(years);
    c.shown = true;
    c.pos = Number(ch);
    gsap.set(c.inner, { yPercent: -c.pos * STEP });
    return c;
  });
  // Name only: the section label is long and shown on the gallery once the intro ends.
  const sideInners = [line(left, site.name), line(right, years)];
  gsap.to(sideInners, { yPercent: 0, duration: 0.7, ease: 'power3.out', stagger: 0.07, delay: 0.2 });

  const roll = (d: Cell, digit: number, delay = 0, dur = 0.6) => {
    if (d.pos >= 10) { d.pos -= 10; gsap.set(d.inner, { yPercent: -d.pos * STEP }); }
    const to = digit > d.pos % 10 ? digit : 10 + digit;
    d.pos = to;
    gsap.to(d.inner, { yPercent: -to * STEP, duration: dur, ease: 'power3.out', delay, overwrite: true });
  };
  const showCell = (d: Cell) => { if (!d.shown) { d.shown = true; gsap.to(d.cell, { width: d.width, duration: CFG.letter, ease: 'power3.out', overwrite: true }); } };
  const fitCell = (d: Cell, w: string) => {
    if (d.width === w) return;
    d.width = w;
    if (d.shown) gsap.to(d.cell, { width: w, duration: CFG.digitRoll, ease: 'power3.out', overwrite: true });
  };
  const hideCell = (d: Cell) => { if (d.shown) { d.shown = false; gsap.to(d.cell, { width: 0, duration: CFG.letter, ease: 'power3.inOut', overwrite: true }); } };
  // Odometer: every drum rolls forward to its digit of floor(v) the moment it
  // changes, so a carry (…9 → …0) rolls the higher drum together with the ones.
  // Higher drums must not roll ahead of the ones: an early carry read as 108, 109 before 100.
  const PLACES = [100, 10, 1];
  const rollTo = (d: Cell, digit: number) => {
    // Start from where the drum actually is (a roll may still be in flight) and
    // fold back into the first 0–9 of the 20-row drum once it has passed 10.
    let cur = -Number(gsap.getProperty(d.inner, 'yPercent')) / STEP;
    if (cur >= 10 && d.pos >= 10) { cur -= 10; d.pos -= 10; gsap.set(d.inner, { yPercent: -cur * STEP }); }
    const to = d.pos + ((digit - (d.pos % 10) + 10) % 10);
    if (to === d.pos) return;
    d.pos = to;
    if (to > 19) { d.pos = digit; gsap.set(d.inner, { yPercent: -digit * STEP }); return; }
    gsap.to(d.inner, { yPercent: -to * STEP, duration: CFG.digitRoll, ease: 'power3.out', overwrite: true });
  };
  const setCounter = (v: number) => {
    const n = Math.floor(v + 1e-6);
    drums.forEach((d, i) => {
      const p = PLACES[i];
      if (p > 1 && n < p) { hideCell(d); return; }
      const digit = Math.floor(n / p) % 10;
      // Higher drums fit their digit; the ones cell stays at full width so the
      // centred counter doesn't jitter sideways while it counts.
      if (p > 1) fitCell(d, DIGIT_W[digit]);
      showCell(d);
      rollTo(d, digit);
    });
  };
  let yearValue = site.sinceYear;
  const toYear = new Date().getFullYear();
  const setYear = (y: number) => {
    const v = clamp(Math.round(y), site.sinceYear, toYear);
    if (v <= yearValue) return;
    yearValue = v;
    const s = String(v).padStart(yearDrums.length, '0');
    yearDrums.forEach((d, i) => { const n = Number(s[i]); if (n !== d.pos % 10) roll(d, n, 0, CFG.yearRoll); });
  };

  // Orbit of the counter around the disc.
  const orbit = { theta: 0 };
  let counterW = 0;
  const measure = () => { counterW = Math.max(drums.reduce((a, d) => a + d.cell.getBoundingClientRect().width, 0), fontPx() * 1.6); };
  measure();
  const h = count.offsetHeight;
  const top = count.offsetTop;
  let disc = { x: innerWidth / 2, y: innerHeight * 2, r: 0, live: 0, rest: 0 };
  const place = () => {
    const minX = top + counterW / 2;
    const maxX = innerWidth - top - counterW / 2;
    const minY = top + h + h / 2;
    const maxY = innerHeight - h;
    const cos = Math.cos(orbit.theta);
    // Shrink the ellipse to fit the room on the side it's on, rather than
    // clamping, so the arc stays curved into its apex (a clamp flattened the top).
    const ex = Math.max(0, Math.min(disc.r + counterW / 2 + h * CFG.discGap, disc.x - minX));
    const ey = Math.max(0, Math.min(disc.r + h / 2 + h * CFG.discGap, cos < 0 ? disc.y - minY : maxY - disc.y));
    // The clamp is only a backstop now (e.g. while the disc is still below the fold).
    const x = clamp(disc.x - Math.sin(orbit.theta) * ex, minX, maxX);
    const y = clamp(disc.y + cos * ey, minY, maxY);
    gsap.set(count, { x: x - innerWidth / 2, y: y - top - h / 2 });
  };

  const canvasTop = () => canvasEl.getBoundingClientRect().top;
  try { api.floor(innerHeight - h - h * CFG.discGap - canvasTop()); } catch { /* ignore */ }

  // Progress follows an eased minimum-duration clock, held back (smoothly) only
  // if cover textures are still loading.
  const covers = api.covers.slice();
  let loaded = 0;
  covers.forEach((i) => api.load(i).catch(() => undefined).then(() => (loaded += 1)));
  const start = performance.now();
  let last = start;
  let P = 0;
  let driving = false;
  let cap = CFG.loadLead;
  let finished = false;
  let raf = 0;
  const riseFrom = CFG.riseAfter;

  return new Promise<void>((resolve) => {
    const finish = () => {
      if (finished) return;
      finished = true;
      const pushEls = drums.map((d) => d.shell);
      gsap.delayedCall(CFG.setOff, () => {
        // The growing disc pushes the counter glyphs up and out.
        const visible = drums.filter((d) => d.shown);
        visible.forEach((d, i) => gsap.to(d.shell, { yPercent: -110, duration: 0.7, ease: 'power3.in', delay: (CFG.pushStagger * i) / Math.max(1, visible.length - 1) }));
        setYear(toYear);
        api.fan().then(() => {
          gsap.set(pushEls, { yPercent: -110 });
          cancelAnimationFrame(raf);
          root.remove();
          resolve();
        });
      });
      gsap.to(sideInners, { yPercent: -120, duration: CFG.exit, ease: 'power3.in', delay: CFG.setOff, stagger: 0.04 });
      gsap.to([left, right], { y: '-0.18em', duration: CFG.exit + 0.2, ease: 'power2.out', delay: CFG.setOff });
      gsap.delayedCall(CFG.setOff + CFG.navAfter, onNav);
      gsap.delayedCall(CFG.setOff + CFG.copyAfter, () => { api.revealCopy(); onCopy(); });
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const dt = clamp((t - last) / 1000, 0, 0.1);
      last = t;
      const elapsed = (t - start) / 1000;
      const clockT = clamp((elapsed - CFG.countDelay) / (CFG.minDuration - CFG.countDelay), 0, 1);
      const clock = 0.5 - 0.5 * Math.cos(Math.PI * clockT);
      const done = !covers.length || loaded >= covers.length;
      // Soft cap: while loading, the cap keeps drifting towards `waitCeil` so the
      // counter slows down instead of freezing, and never reaches 100 early.
      if (done) cap = 1;
      else {
        if (elapsed >= CFG.countDelay) cap += (CFG.waitCeil - cap) * (1 - Math.exp(-dt / CFG.waitDrift));
        cap = Math.max(cap, loaded / covers.length + CFG.loadLead);
      }
      const target = Math.min(cap, clock);
      // Rate-limited so a late load finishing doesn't make the counter sprint.
      P += Math.min((target - P) * (1 - Math.exp(-CFG.chase * dt)), CFG.maxRate * dt);
      if (target >= 1 && P > 0.998) P = 1;
      if (elapsed >= CFG.countDelay && !finished) {
        if (!driving) { driving = true; gsap.killTweensOf(drums[2].inner); }
        setCounter(P * 100);
      }
      orbit.theta = Math.PI * P;
      const rise = clamp((P - riseFrom) / (1 - riseFrom), 0, 1);
      const turn = clamp((P - riseFrom) / (CFG.turnBy - riseFrom), 0, 1);
      api.pose({ turn: turnEase(turn), rise: riseEase(rise) });
      try {
        const a = api.anchor();
        const rect = canvasEl.getBoundingClientRect();
        disc = { x: rect.left + a.x, y: rect.top + a.y, r: a.r, live: a.live, rest: a.rest };
      } catch { /* ignore */ }
      measure(); // cells widen as digits appear
      place();
      setYear(site.sinceYear + Math.floor(easeInOut(P) * (toYear - site.sinceYear - 1) + 1e-6));
      if (P >= 1) finish();
    };
    raf = requestAnimationFrame(tick);
  });
}
