import { gsap, ScrollTrigger, finePointer } from './tokens';

/**
 * Organic, living bottom edge for a section, revealing the section beneath.
 *
 * The edge is a noise height-field applied as `clip-path: path()`:
 * - baseline rises with scroll (ScrollTrigger scrub on the next section),
 * - shape breathes over time and agitates with scroll velocity,
 * - a centre-weighted dome + amplitude window keeps the sides calmer,
 * - pointer passes near the edge drop "bites" that spread and relax.
 *
 * Deviation from reference: the reference traces a 2D noise iso-contour
 * (marching squares) which can form islands; this uses a 1D height field
 * with the same parameters. See REFERENCE_ANALYSIS.md §5 (Detail hero).
 */

const P = {
  reach: 0.4, peek: 0.19, wander: 0.13, intro: 1.5, center: 0.13, centerX: 0.5, edge: 0.5, below: 0.4,
  life: 0.85, lifeSpeed: 0.15, surge: 0.55, agitate: 2.2, velocityRef: 2600, velocityEase: 0.13,
  scale: 230, warp: 1.25, step: 12,
  cursorBite: 0.5, cursorDrop: 90, cursorSpread: 2.6, cursorRelax: 1.1, cursorBand: 120, cursorSpeed: 900, cursorTurn: 0.3, drops: 28,
};

// Smooth value noise.
function makeNoise(seed: number) {
  const perm = new Float32Array(512);
  let s = seed;
  for (let i = 0; i < 512; i++) { s = (s * 16807) % 2147483647; perm[i] = (s / 2147483647) * 2 - 1; }
  return (x: number) => {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return perm[i & 511] * (1 - u) + perm[(i + 1) & 511] * u;
  };
}
const fbm = (n: (x: number) => number, x: number) => n(x) * 0.6 + n(x * 2.07 + 11.3) * 0.28 + n(x * 4.13 + 37.1) * 0.12;
const smooth = (t: number) => t * t * (3 - 2 * t);

interface Drop { x: number; y: number; amp: number; r0: number; r1: number; born: number }

export class Dissolve {
  private st: ScrollTrigger;
  private progress = 0;
  private vel = 0;
  private phase = 0;
  private intro = 0;
  private n0 = makeNoise(17);
  private n1 = makeNoise(91);
  private w = makeNoise(53);
  private drops: Drop[] = [];
  private lastPointer = { x: NaN, y: NaN, t: 0 };
  private running = false;
  private lastEdge = 0;

  constructor(private el: HTMLElement, trigger: HTMLElement, private reduced: boolean) {
    this.st = ScrollTrigger.create({
      trigger,
      start: 'clamp(top bottom)',
      end: () => `top top-=${Math.ceil(this.el.offsetHeight * (P.wander + P.center))}`,
      scrub: true,
      invalidateOnRefresh: true,
      onUpdate: (s) => { this.progress = s.progress; if (this.reduced) this.draw(true); else this.start(); },
      onRefresh: (s) => { this.progress = s.progress; this.draw(true); },
    });
    if (reduced) { this.intro = 1; this.draw(true); return; }
    if (finePointer()) window.addEventListener('pointermove', this.onPointer, { passive: true });
    this.start();
  }

  private onPointer = (e: PointerEvent) => {
    const r = this.el.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    const t = e.timeStamp / 1000;
    const lp = this.lastPointer;
    const dt = Math.min(0.1, t - lp.t);
    const vy = dt > 0.001 && Number.isFinite(lp.y) ? (y - lp.y) / dt : 0;
    const vx = dt > 0.001 && Number.isFinite(lp.x) ? (x - lp.x) / dt : 0;
    const moved = Number.isFinite(lp.x) ? Math.hypot(x - lp.x, y - lp.y) : Infinity;
    if (moved < P.cursorDrop * 0.3) return;
    this.lastPointer = { x, y, t };
    // Only near the edge band.
    const edge = this.lastEdge;
    const proximity = 1 - Math.min(1, Math.abs(y - edge) / P.cursorBand);
    if (proximity <= 0) return;
    const speed = Math.min(1, (Math.abs(vy) + Math.abs(vx) * 0.3) / P.cursorSpeed);
    const turn = Math.max(-1, Math.min(1, -vy / (P.cursorSpeed * P.cursorTurn)));
    const H = this.el.offsetHeight;
    const amp = H * (P.wander + P.center) * P.cursorBite * speed * proximity * turn;
    if (Math.abs(amp) < 2) return;
    const r0 = P.cursorDrop * (0.75 + Math.random() * 0.5);
    this.drops.push({ x, y, amp, r0, r1: r0 * P.cursorSpread, born: gsap.ticker.time });
    if (this.drops.length > P.drops) this.drops.shift();
    this.start();
  };

  private start() {
    if (this.running) return;
    this.running = true;
    gsap.ticker.add(this.tick);
  }

  private stop() {
    if (!this.running) return;
    this.running = false;
    gsap.ticker.remove(this.tick);
  }

  private tick = (_t: number, deltaMs: number) => {
    const dt = Math.min(0.1, deltaMs / 1000);
    const v = Math.max(-1, Math.min(1, this.st.getVelocity() / P.velocityRef));
    this.vel += (v - this.vel) * P.velocityEase;
    if (this.intro < 1) this.intro = Math.min(1, this.intro + dt / P.intro);
    this.phase += dt * P.lifeSpeed * (1 + Math.abs(this.vel) * P.agitate) * Math.PI * 2;
    const now = gsap.ticker.time;
    this.drops = this.drops.filter((d) => now - d.born < P.cursorRelax);
    this.draw();
    // Keep breathing while on screen; sleep when the hero is scrolled away.
    const r = this.el.getBoundingClientRect();
    if (r.bottom < -50 || r.top > innerHeight + 50) this.stop();
  };

  private draw(force = false) {
    const W = this.el.offsetWidth, H = this.el.offsetHeight;
    if (!W || !H) return;
    const n = smooth(this.intro);
    const wander = P.wander * H;
    const peek = P.peek * H;
    const from = H - peek;
    const to = H - Math.max(P.reach * H, peek + wander);
    const base = from + (to - from) * Math.min(1, this.progress);
    // Baseline starts at the section bottom and grows in over the intro.
    const r = H - n * (H - base) - this.vel * P.surge * wander * n;
    this.lastEdge = r;
    const now = gsap.ticker.time;
    const c = Math.cos(this.phase), s = Math.sin(this.phase);
    let d = `M0 0H${W}`;
    const pts: string[] = [];
    for (let x = W; x >= -0.5; x -= P.step) {
      const xx = Math.max(0, x);
      const cx = W ? xx / W - P.centerX : 0;
      const win = Math.max(0, Math.cos(Math.PI * Math.max(-0.5, Math.min(0.5, cx))));
      const amp = wander * (P.edge + (1 - P.edge) * win);
      const dome = P.center * H * win * win;
      const u = xx / P.scale + fbm(this.w, xx / (P.scale * 2)) * P.warp;
      const a = fbm(this.n0, u), b = fbm(this.n1, u + 5.2);
      let shape = (a + P.life * (a * c - a + b * s)) * 1.6;
      shape = shape >= 0 ? shape : shape * P.below;
      let bite = 0;
      for (const dp of this.drops) {
        const age = (now - dp.born) / P.cursorRelax;
        const rad = dp.r0 + (dp.r1 - dp.r0) * (1 - (1 - age) * (1 - age));
        const q = Math.abs(xx - dp.x) / rad;
        if (q >= 1) continue;
        const f = 1 - q * q;
        bite += dp.amp * (dp.r0 / rad) * smooth(1 - age) * f * f * f;
      }
      const y = r - n * (dome + amp * shape + bite);
      pts.push(`L${xx.toFixed(1)} ${Math.min(H, Math.max(0, y)).toFixed(1)}`);
    }
    d += `V${pts.length ? pts[0].split(' ')[1] : H}${pts.join('')}Z`;
    if (force || d.indexOf('NaN') < 0) this.el.style.clipPath = `path(evenodd, "${d}")`;
  }

  dispose() {
    this.stop();
    this.st.kill();
    window.removeEventListener('pointermove', this.onPointer);
    this.el.style.clipPath = '';
  }
}
