import * as THREE from 'three';
import { gsap, ScrollTrigger, EASE, finePointer } from './tokens';
import { atScrollEnd } from './SmoothScroll';
import type { Project } from '../content/types';
import { NextDisc } from '../three/NextDisc';
import { ScribbleSvg } from '../three/ScribbleSvg';

/**
 * End-of-page hand-off to the next project.
 *
 * Scroll progress through the section (ScrollTrigger, top-bottom → bottom-bottom)
 * draws rules, lifts and slides the next title along them and flies the next
 * disc in (tilt, drop, pop). Scroll velocity spins the disc on its axis.
 * At the page end, continued wheel / touch / keys "push" 0→1: the disc lifts,
 * grows and spins faster while a hand-drawn ring sweeps around it. At 1 the
 * section exits and navigation fires. (REFERENCE_ANALYSIS.md §5, Scroll-next.)
 */

const Y = {
  restTiltX: -30, restTiltY: -30, arriveTiltX: -52, arriveTiltY: 10, pushTiltX: -16, pushTiltY: -10,
  touchRestTiltY: -14,
  arriveStart: 0.3, arriveEnd: 0.97, arriveDrop: 0.9,
  popScale: 0.35, popIn: 1.05, popOut: 0.45,
  slideRestShare: 0.6, scatterMin: 0.18, scatterMax: 0.38,
  ruleDuration: 0.9, revealDuration: 0.8, revealStagger: 0.09, revealRise: 120,
  spinGain: 0.0032, spinMax: 7, spinFollow: 9, spinFriction: 2.4,
  idleSpin: -0.14, idleAmount: 0.022, idleRate: 0.5,
  pushWheel: 620, pushTouch: 380, pushKey: 0.34, pushHold: 180, pushDrain: 0.9, pushSettle: 350,
  pushLift: 0.1, pushGrow: 1.04, pushSpin: -6, pushEase: 10,
  exitDuration: 0.7, exitSpin: -16, exitLift: 0.35, exitCopy: 0.45, exitRule: 0.5, exitGo: 0.48,
};

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const cubicOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 3;
const rad = THREE.MathUtils.degToRad;

export interface ScrollNextElements {
  section: HTMLElement;
  frame: HTMLElement;
  stage: HTMLElement;
  svg: SVGSVGElement;
  rules: HTMLElement[];
  words: HTMLElement[]; // each contains a single inner span that rises
  copy: HTMLElement[]; // other copy that rises in / out
  hint: HTMLElement;
}

export class ScrollNext {
  private disc: NextDisc;
  private ring: ScribbleSvg;
  private st: ScrollTrigger | null = null;
  private progress = 0;
  private vel = 0;
  private spinRate = 0;
  private spinAngle = 0;
  private idleT = 0;
  private push = 0;
  private pushSmooth = 0;
  private lastPushInput = 0;
  private endReachedAt = 0;
  private pop = { scale: Y.popScale };
  private exitState = { spin: 0, lift: 0, grow: 1 };
  private popped = false;
  private leaving = false;
  private raf = 0;
  private last = 0;
  private offsets: number[] = [];
  private shownRules = new Set<number>();
  private shownWords = new Set<number>();
  private cleanups: (() => void)[] = [];
  private visible = false;
  private io: IntersectionObserver;
  private lastRingFrame = 0;
  private disposed = false;

  constructor(private el: ScrollNextElements, project: Project, private reduced: boolean, private onGo: () => void) {
    this.disc = new NextDisc(el.stage, project);
    // Push ring grows from the visible top of the disc (+Y in the disc plane).
    this.ring = new ScribbleSvg(el.svg, { loops: 1, padding: 0.09, width: 0.02, jitter: 0.018, points: 40, anchorAngle: Math.PI / 2 });
    // Deterministic scatter per word so layout is stable.
    this.offsets = el.words.map((_, i) => (i % 2 ? 1 : -1) * (Y.scatterMin + ((i * 0.37) % 1) * (Y.scatterMax - Y.scatterMin)));
    gsap.set(el.rules, { scaleX: 0, transformOrigin: 'left center' });
    gsap.set(el.words, { xPercent: -50 });
    gsap.set(el.words.map((w) => w.firstElementChild), { yPercent: Y.revealRise });
    gsap.set(el.copy, { yPercent: Y.revealRise });
    gsap.set(el.hint, { autoAlpha: 0 });
    this.io = new IntersectionObserver((e) => {
      this.visible = e.some((x) => x.isIntersecting);
      if (this.visible) this.loop(); else this.stopLoop();
    }, { rootMargin: '150% 0px' });
    this.io.observe(el.section);
    this.bindInput();
  }

  async init() {
    await this.disc.init();
    if (this.disposed) return;
    this.st = ScrollTrigger.create({
      trigger: this.el.section,
      start: 'top bottom',
      end: 'bottom bottom',
      onUpdate: (s) => this.onProgress(s.progress, s.getVelocity()),
      onRefresh: (s) => this.onProgress(s.progress, 0),
    });
    if (this.reduced) this.onProgress(1, 0);
    this.loop();
  }

  private onProgress(p: number, v: number) {
    this.progress = p;
    this.vel = v;
    // Rules draw and words rise at staggered thresholds.
    this.el.rules.forEach((r, i) => {
      if (p >= i * 0.06 && !this.shownRules.has(i)) {
        this.shownRules.add(i);
        gsap.to(r, { scaleX: 1, duration: this.reduced ? 0 : Y.ruleDuration, ease: EASE.glide, overwrite: 'auto' });
      }
    });
    const thresholds = this.el.words.map((_, i) => 0.12 + i * 0.1);
    this.el.words.forEach((w, i) => {
      if (p >= thresholds[i] && !this.shownWords.has(i)) {
        this.shownWords.add(i);
        gsap.to(w.firstElementChild, { yPercent: 0, duration: this.reduced ? 0 : Y.revealDuration, ease: EASE.glide, overwrite: 'auto' });
      }
    });
    if (p >= 0.1 && !this.shownWords.has(-1)) {
      this.shownWords.add(-1);
      gsap.to(this.el.copy, { yPercent: 0, duration: this.reduced ? 0 : Y.revealDuration, ease: EASE.glide, stagger: Y.revealStagger, overwrite: 'auto' });
    }
    // Horizontal slide scrubbed with scroll.
    const slide = this.reduced ? 1 : cubicOut(p / Y.slideRestShare);
    this.el.words.forEach((w, i) => gsap.set(w, { xPercent: -50, x: (1 - slide) * this.offsets[i] * innerWidth }));
    if (!this.popped && this.disc.ready && (this.reduced || p >= Y.arriveStart)) this.popIn();
    if (!atScrollEnd()) { this.endReachedAt = 0; if (this.push > 0) this.push = 0; }
    else if (!this.endReachedAt) this.endReachedAt = performance.now();
    gsap.to(this.el.hint, { autoAlpha: atScrollEnd() && !this.leaving ? 1 : 0, duration: 0.4, overwrite: 'auto' });
    this.loop();
  }

  private popIn() {
    this.popped = true;
    if (this.reduced) { this.pop.scale = 1; return; }
    gsap.to(this.pop, { scale: 1, duration: Y.popIn, ease: EASE.glide, overwrite: true, onUpdate: () => this.loop() });
  }

  private addPush(amount: number) {
    if (this.leaving || !atScrollEnd()) return;
    if (!this.endReachedAt || performance.now() - this.endReachedAt < Y.pushHold) return;
    this.push = clamp(this.push + amount, 0, 1);
    this.lastPushInput = performance.now();
    if (this.push >= 1) this.leave();
    this.loop();
  }

  private bindInput() {
    const on = <T extends Event>(t: EventTarget, type: string, fn: (e: T) => void, o?: AddEventListenerOptions) => {
      t.addEventListener(type, fn as EventListener, o);
      this.cleanups.push(() => t.removeEventListener(type, fn as EventListener, o));
    };
    on<WheelEvent>(window, 'wheel', (e) => {
      if (e.deltaY > 0) this.addPush(clamp(e.deltaY, -140, 140) / Y.pushWheel);
    }, { passive: true });
    let ty: number | null = null;
    on<TouchEvent>(window, 'touchstart', (e) => { ty = e.touches[0]?.clientY ?? null; }, { passive: true });
    on<TouchEvent>(window, 'touchmove', (e) => {
      const y = e.touches[0]?.clientY;
      if (ty == null || y == null) return;
      const d = ty - y;
      ty = y;
      if (d > 0) this.addPush(d / Y.pushTouch);
    }, { passive: true });
    on<TouchEvent>(window, 'touchend', () => { ty = null; }, { passive: true });
    on<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.defaultPrevented) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') this.addPush(Y.pushKey);
    });
    if (finePointer()) {
      on<PointerEvent>(this.el.section, 'pointermove', (e) => {
        const r = this.el.stage.getBoundingClientRect();
        if (this.disc.hit(e.clientX - r.left, e.clientY - r.top)) this.el.section.setAttribute('data-over', '');
        else this.el.section.removeAttribute('data-over');
      });
      on<PointerEvent>(this.el.section, 'pointerleave', () => this.el.section.removeAttribute('data-over'));
    }
    on<MouseEvent>(this.el.section, 'click', (e) => {
      const r = this.el.stage.getBoundingClientRect();
      if (this.disc.hit(e.clientX - r.left, e.clientY - r.top)) { e.preventDefault(); this.push = 1; this.leave(); }
    });
  }

  /** Exit: spin up, lift, scale out, copy rises away, rules retract, then navigate. */
  private leave() {
    if (this.leaving) return;
    this.leaving = true;
    this.push = 1;
    gsap.to(this.el.hint, { autoAlpha: 0, duration: 0.3 });
    if (this.reduced) { this.onGo(); return; }
    const tl = gsap.timeline({ onUpdate: () => this.loop() });
    tl.to(this.exitState, { spin: Y.exitSpin, lift: Y.exitLift, duration: Y.exitDuration, ease: 'power2.in' }, 0);
    tl.to(this.pop, { scale: Y.popScale, duration: Y.popOut, ease: 'power2.in', onComplete: () => { this.pop.scale = 0; } }, 0);
    tl.to([...this.el.words.map((w) => w.firstElementChild), ...this.el.copy], { yPercent: -Y.revealRise, duration: Y.exitCopy, ease: EASE.glide, stagger: 0.03 }, 0);
    tl.to(this.el.rules, { scaleX: 0, transformOrigin: 'right center', duration: Y.exitRule, ease: EASE.glide, stagger: { each: 0.04, from: 'end' } }, 0.05);
    tl.call(() => this.onGo(), undefined, Y.exitGo);
  }

  private loop() {
    if (this.raf || !this.disc.ready || !this.visible) return;
    this.last = -1;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stopLoop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private layoutDisc() {
    const H = this.disc.height, W = this.disc.width;
    const ruleY = this.el.rules[3] ? this.el.rules[3].getBoundingClientRect().top - this.el.stage.getBoundingClientRect().top : H * 0.87;
    const gap = this.el.rules[1] && this.el.rules[0] ? this.el.rules[1].offsetTop - this.el.rules[0].offsetTop : H * 0.24;
    const small = W < 768;
    const r = small ? W * 0.54 : Math.min(H * 0.6, W * 0.33);
    const top = ruleY - gap * (small ? 0.35 : 0.55);
    return { cx: W * (small ? 0.5 : 0.44), cy: top + r, r };
  }

  private frame = (t: number) => {
    // `raf` stays set while the loop runs, so loop() calls during a frame can't fork a second loop.
    const dt = this.last < 0 ? 1 / 60 : clamp((t - this.last) / 1000, 1 / 240, 0.05);
    this.last = t;
    const d = this.disc;
    const a = this.reduced ? 1 : cubicOut((this.progress - Y.arriveStart) / (Y.arriveEnd - Y.arriveStart));

    // Push drains when input stops.
    if (!this.leaving && this.push > 0 && t - this.lastPushInput > Y.pushSettle) this.push = Math.max(0, this.push - Y.pushDrain * dt);
    this.pushSmooth += (this.push - this.pushSmooth) * Math.min(1, dt * Y.pushEase);
    if (Math.abs(this.push - this.pushSmooth) < 0.0015) this.pushSmooth = this.push;
    const o = cubicOut(this.pushSmooth);

    // Scroll velocity drives spin; friction when input stops.
    this.vel *= Math.exp(-dt * 6);
    if (!this.reduced) {
      const target = clamp(-this.vel * Y.spinGain, -Y.spinMax, Y.spinMax);
      if (Math.abs(target) > Math.abs(this.spinRate) * 0.5) this.spinRate += (target - this.spinRate) * Math.min(1, dt * Y.spinFollow);
      else this.spinRate *= Math.exp(-dt * Y.spinFriction);
      this.spinAngle = (this.spinAngle + (this.spinRate + Y.idleSpin * a + Y.pushSpin * o + this.exitState.spin) * dt) % (Math.PI * 2);
    }
    this.idleT += dt;
    const idle = this.reduced ? 0 : Y.idleAmount * a;
    const restY = d.width < 768 ? Y.touchRestTiltY : Y.restTiltY;

    d.tilt.rotation.x = rad(Y.arriveTiltX) * (1 - a) + rad(Y.restTiltX) * a * (1 - o) + rad(Y.pushTiltX) * a * o;
    d.tilt.rotation.y = rad(Y.arriveTiltY) * (1 - a) + rad(restY) * a * (1 - o) + rad(Y.pushTiltY) * a * o;
    d.disc.group.rotation.x = Math.sin(this.idleT * Y.idleRate * Math.PI) * idle;
    d.disc.group.rotation.y = Math.cos(this.idleT * Y.idleRate * Math.PI * 0.7) * idle;
    d.disc.spin.rotation.z = this.spinAngle;

    const L = this.layoutDisc();
    const scale = L.r * Math.max(1e-4, this.pop.scale) * (1 + (Y.pushGrow - 1) * o);
    const cy = L.cy + Y.arriveDrop * L.r * (1 - a) - Y.pushLift * L.r * o - this.exitState.lift * L.r;
    d.tilt.visible = this.pop.scale >= Y.popScale - 0.001;
    d.place(L.cx, cy, scale);

    // Push ring: redrawn at 10 fps for the hand-drawn boil.
    if (this.pushSmooth > 0.003 || this.leaving) {
      if (!this.ring.visible || t - this.lastRingFrame >= 100) { this.ring.setSweep(this.leaving ? 1 : this.pushSmooth); this.lastRingFrame = t; this.ring.show(true); }
      d.tilt.updateMatrixWorld(true);
      this.ring.project(new THREE.Matrix4(), d.camera, d.width, d.height, d.tilt.matrixWorld);
    } else if (this.ring.visible) this.ring.show(false);

    d.render();
    const busy = this.visible && (Math.abs(this.spinRate) > 1e-3 || this.pushSmooth > 0 || this.push > 0 || a < 1 || !this.reduced || gsap.isTweening(this.pop));
    this.raf = busy ? requestAnimationFrame(this.frame) : 0;
  };

  dispose() {
    this.disposed = true;
    this.stopLoop();
    this.io.disconnect();
    this.st?.kill();
    this.cleanups.forEach((f) => f());
    gsap.killTweensOf([this.pop, this.exitState, this.el.hint, ...this.el.rules, ...this.el.copy]);
    this.ring.dispose();
    this.disc.dispose();
  }
}
