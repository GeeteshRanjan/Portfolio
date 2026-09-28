import * as THREE from 'three';
import { gsap, EASE, finePointer } from '../motion/tokens';
import type { Project } from '../content/types';
import { GALLERY as C, LOOK, NIGHT } from './config';
import { acquireRenderer, addLights, createDisc, environmentFor, getDiscAssets, labelTexture, releaseRenderer, warmUp, whenIdle, type DiscAssets, type DiscObject } from './discAssets';
import { WheelIntent } from './WheelIntent';
import { ScribbleSvg } from './ScribbleSvg';
import { Lamp } from './Lamp';

/**
 * DiscGallery — the 3D carousel engine.
 *
 * Owns scene, camera, lights, disc pool, render-on-demand loop and all
 * physical interaction (hover tilt, wipe impulses, spin drag, scrub drag with
 * inertia + spring settle, wheel intent, keyboard, click/press, flights).
 * React only mounts it and listens to events. Behaviour constants live in
 * ./config.ts; the maths follows REFERENCE_ANALYSIS.md §4–§6.
 */

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const rad = THREE.MathUtils.degToRad;
const glide = gsap.parseEase(EASE.glide) as (t: number) => number;

type StepSource = 'wheel' | 'key' | 'click' | 'flick' | 'snap';

interface Slot {
  obj: DiscObject;
  index: number;
  hover: number;
  spinX: number;
  spinY: number;
  resetTween: gsap.core.Tween | null;
  justAssigned: boolean;
  spawnFrom: number;
  px: number; py: number; pz: number; pvx: number; pvy: number; pvz: number;
  prx: number; pry: number; prvx: number; prvy: number;
}

export interface GalleryCallbacks {
  onChange?: (index: number) => void;
  onOpen?: (index: number, e?: MouseEvent | KeyboardEvent) => void;
  onDragChange?: (dragging: boolean) => void;
  onReady?: () => void;
  /**
   * Every frame the scribble is on screen, and when its target changes: the disc it
   * circles (-1 = none) and the screen position (px) of `noteAnchor` on that disc.
   */
  onScribble?: (index: number, x: number, y: number) => void;
}

export interface PreloaderApi {
  pose(p: { turn?: number; rise?: number }): void;
  /** Disc centre/radius in canvas px (for orbiting the counter). */
  anchor(): { x: number; y: number; r: number; live: number; rest: number };
  /** Constrain rise start so the disc starts below `floorPx`. */
  floor(floorPx: number): void;
  fan(): Promise<void>;
  revealCopy(): void;
  abort(): void;
  covers: number[];
  load(i: number): Promise<unknown>;
}

export class DiscGallery {
  // Rendering
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(LOOK.cameraFOV, 1, 0.1, 100);
  private gallery = new THREE.Group();
  private assets!: DiscAssets;
  private raf = 0;
  private lastT = 0;
  private forceFrames = 3;
  private disposed = false;
  private ready = false;
  private scribbleTimer = 0;
  private scribbleWant = -1;
  private resizeObs?: ResizeObserver;
  private width = 1;
  private height = 1;
  private renderScaleIdx = 0;
  private readonly renderScales = [1, 0.85, 0.7, 0.55];
  private perfFrames = 0;
  private perfTime = 0;
  private busyFrames = 0;
  private baseScale: number = C.galleryScale;
  private galleryScale: number = C.galleryScale;
  private touchSpan = 0;

  // Carousel state
  private L = 0;
  private lastL = 0;
  private dragV = 0;
  private springV = 0;
  private flowV = 0;
  private active = -1;
  private stepToken = 0;
  private stepTarget = -1;
  private pinned = -1;
  private tweenState = { value: 0 };
  private slots: Slot[] = [];
  private free: Slot[] = [];
  private visible = new Map<number, Slot>();
  private rangeLo = -1;
  private rangeHi = -1;
  private picks: THREE.Object3D[] = [];
  private textures = new Map<number, THREE.Texture | null>();
  private loading = new Map<number, Promise<unknown>>();

  // Flights (intro / exit / preloader)
  private flight = { others: 1, active: 1, inbound: false };
  private flightLock = false;
  private preload = { active: false, turn: 0, rise: 0, riseFrom: C.preloadRiseFrom as number, growing: false, tween: null as gsap.core.Timeline | null };

  // Pointer
  private hovered = -1;
  private ndc = new THREE.Vector2();
  private hitUV = { x: 0, y: 0 };
  private raycaster = new THREE.Raycaster();
  private needsPick = false;
  private pointerInside = false;
  private pointerDown = false;
  private pointerId = -1;
  private isTouch = false;
  private dragging = false;
  private spinTarget = -1; // disc under pointer when drag started (only the active one)
  private spinCandidate = -1;
  private downX = 0; private downY = 0;
  private lastX = 0; private lastY = 0; private lastMoveT = 0;
  private hoverLastT = 0; private hoverX = 0; private hoverY = 0; private hoverVX = 0; private hoverVY = 0;
  private suppressClickUntil = 0;
  private keyboardNav = false;

  private wheel: WheelIntent;
  private scribble: ScribbleSvg;
  private cleanups: (() => void)[] = [];
  private reduced: boolean;
  private touchQuery = window.matchMedia('(max-width: 991px)');
  private lamp!: Lamp;
  private night: boolean;

  constructor(
    private host: HTMLElement,
    private mount: HTMLElement,
    svg: SVGSVGElement,
    private items: Project[],
    private cb: GalleryCallbacks = {},
    opts: { reducedMotion: boolean; startIndex?: number; night?: boolean } = { reducedMotion: false },
  ) {
    this.reduced = opts.reducedMotion;
    this.night = !!opts.night;
    this.L = this.lastL = clamp(opts.startIndex ?? 0, 0, items.length - 1);
    this.tweenState.value = this.L;
    this.wheel = new WheelIntent((dir) => {
      const from = this.currentTarget();
      const to = clamp(from + dir, 0, this.items.length - 1);
      this.stepTarget = to;
      if (to !== from) this.goTo(to, 'wheel');
    });
    // Inherits the page ink, so it follows night mode.
    this.scribble = new ScribbleSvg(svg, { color: 'currentColor' });
    if (/[?&]debug\b/.test(location.search)) (host as unknown as { galleryDebug: DiscGallery }).galleryDebug = this;
  }

  /** Debug snapshot (enabled with ?debug), mirrors the reference's debug API fields. */
  state() {
    return {
      running: this.raf !== 0, activeIndex: this.active, L: +this.L.toFixed(4), renderScale: this.renderScales[this.renderScaleIdx],
      flowVelocity: +this.flowV.toFixed(3), dragVelocity: +this.dragV.toFixed(4), springVelocity: +this.springV.toFixed(4),
      scribblePhase: this.scribble.phase, flightLock: this.flightLock, frames: this.renderer.info.render.frame,
    };
  }

  // ------------------------------------------------------------------ setup
  async init(opts: { intro: 'preloader' | 'fan' | 'none' }) {
    this.renderer = acquireRenderer(innerWidth <= 767);
    this.mount.replaceChildren(this.renderer.domElement);
    this.scene.fog = new THREE.Fog(LOOK.fogColor, 7, 14);
    this.camera.position.set(0, 0, LOOK.cameraDistance);
    this.camera.lookAt(0, 0, 0);
    this.gallery.rotation.set(rad(C.galleryRotX), rad(C.galleryRotY), 0);
    this.gallery.scale.setScalar(C.galleryScale);
    this.scene.add(this.gallery);
    // Added before warm-up so its programs compile with the discs. The spot light stays in the
    // scene at zero intensity by day: removing it would change the light count and recompile everything.
    this.lamp = new Lamp(this.scene, addLights(this.scene), this.night);
    this.assets = await getDiscAssets();
    if (this.disposed) return;
    this.scene.environment = environmentFor(this.renderer);
    this.scene.environmentIntensity = LOOK.environmentIntensity;

    const poolSize = Math.min(this.items.length, C.renderRadius * 2 + 3);
    for (let i = 0; i < poolSize; i++) {
      const obj = createDisc(this.assets);
      obj.group.visible = false;
      this.gallery.add(obj.group);
      const s: Slot = {
        obj, index: -1, hover: 0, spinX: 0, spinY: 0, resetTween: null, justAssigned: false, spawnFrom: 0,
        px: 0, py: 0, pz: 0, pvx: 0, pvy: 0, pvz: 0, prx: 0, pry: 0, prvx: 0, prvy: 0,
      };
      this.slots.push(s);
      this.free.push(s);
    }
    this.bindEvents();
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(this.mount);

    const start = Math.round(this.L);
    if (opts.intro !== 'preloader') await Promise.race([this.loadAround(start, 2), new Promise((r) => setTimeout(r, 900))]);
    else this.loadAround(start, 2);
    if (this.disposed) return;
    await warmUp(this.renderer, this.scene, this.camera);
    if (this.disposed) return;

    if (opts.intro === 'fan' && !this.reduced) {
      this.flightLock = true;
      this.flight = { others: 0, active: 0.001, inbound: true };
    } else if (opts.intro === 'preloader' && !this.reduced) {
      this.flightLock = true;
      this.beginPreload();
    }
    this.layout(1, true);
    this.setActive(start, true);
    this.renderer.render(this.scene, this.camera);
    this.ready = true;
    this.request(3);
    this.cb.onReady?.();
    if (opts.intro === 'fan' && !this.reduced) this.intro();
  }

  private bindEvents() {
    const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, type: K | string, fn: (e: never) => void, o?: AddEventListenerOptions | boolean) => {
      el.addEventListener(type, fn as EventListener, o);
      this.cleanups.push(() => el.removeEventListener(type, fn as EventListener, o));
    };
    const h = this.host;
    h.style.cursor = 'grab';
    h.style.touchAction = 'none';
    on(h, 'pointerdown', (e: PointerEvent) => this.onPointerDown(e), { capture: true });
    on(h, 'pointermove', (e: PointerEvent) => this.onHoverMove(e), { passive: true });
    on(h, 'pointerenter', () => (this.pointerInside = true));
    on(h, 'pointerleave', () => {
      this.pointerInside = false;
      if (!this.pointerDown) { this.hovered = -1; this.needsPick = false; this.request(); }
    });
    on(h, 'click', (e: MouseEvent) => this.onClick(e), { capture: true });
    on(h, 'wheel', (e: WheelEvent) => this.onWheel(e), { passive: false, capture: true });
    on(window, 'keydown', (e: KeyboardEvent) => this.onKey(e));
    on(window, 'blur', () => { this.wheel.reset(); this.release(true); this.keyboardNav = false; this.request(); });
    on(document, 'visibilitychange', () => { if (document.hidden) this.stop(); else { this.wheel.reset(); this.request(3); } });
    on(this.renderer.domElement, 'webglcontextlost', (e: Event) => { e.preventDefault(); this.stop(); });
    on(this.renderer.domElement, 'webglcontextrestored', () => this.request(3));
    const tq = () => { this.fitTouch(); this.placeLamp(); this.request(2); };
    this.touchQuery.addEventListener('change', tq);
    this.cleanups.push(() => this.touchQuery.removeEventListener('change', tq));
  }

  // ---------------------------------------------------------------- sizing
  private pixelRatio(w: number, h: number) {
    let dpr = Math.min(devicePixelRatio || 1, w <= 767 ? 1.5 : 2);
    const budget = 12e6;
    if (w * h * dpr * dpr > budget) dpr = Math.sqrt(budget / (w * h));
    return dpr * this.renderScales[this.renderScaleIdx];
  }

  private resize() {
    const w = Math.max(1, this.mount.clientWidth);
    const h = Math.max(1, this.mount.clientHeight);
    if (Math.abs(w * h - this.width * this.height) > this.width * this.height * 0.2) this.renderScaleIdx = 0;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(this.pixelRatio(w, h));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fitTouch();
    this.placeLamp();
    this.request(3);
  }

  /** Hang the lamp over the stage (where the active disc settles), sized to the active disc. */
  private placeLamp() {
    const touch = this.isTouchLayout();
    this.gallery.scale.setScalar(this.galleryScale);
    this.gallery.updateMatrixWorld();
    const scale = touch ? Math.max(0.5, C.touchActiveScale) : 1;
    const stage = this.gallery.localToWorld(new THREE.Vector3(0, C.activeDiscY, 0));
    const [ax, ay] = touch ? NIGHT.aimTouch : NIGHT.aim;
    const aim = this.gallery.localToWorld(new THREE.Vector3(ax * scale, C.activeDiscY + ay * scale, 0));
    this.lamp.place(stage, aim, this.galleryScale * scale, this.camera, touch ? NIGHT.offsetTouch : NIGHT.offset);
  }

  setNight(on: boolean) {
    this.night = on;
    this.lamp?.set(on, this.reduced);
    this.request(3);
  }

  private isTouchLayout() {
    return this.touchQuery.matches;
  }

  /** Screen-space offset for the touch layout (discs step down/back to the right). */
  private touchOffset(m: number, out: THREE.Vector3) {
    const a = Math.min(Math.abs(m), 2.5);
    return out.set(m * C.touchGap, -a * C.touchDropY, -a * C.touchDepth);
  }

  private tmpV = new THREE.Vector3();
  private tmpQ = new THREE.Quaternion();

  private touchLocal(m: number) {
    this.touchOffset(m, this.tmpV);
    this.tmpQ.copy(this.gallery.quaternion).invert();
    return this.tmpV.applyQuaternion(this.tmpQ);
  }

  private projectX(scale: number, m: number) {
    const v = this.touchOffset(m, new THREE.Vector3()).multiplyScalar(scale);
    return v.project(this.camera).x;
  }

  /** Fit gallery scale on touch layouts so the neighbour peeks at the screen edge. */
  private fitTouch() {
    this.camera.updateMatrixWorld();
    if (!this.isTouchLayout()) { this.galleryScale = this.baseScale; this.touchSpan = 0; return; }
    const peek = Math.max(0.6, C.touchPeek);
    const reach = (s: number) => Math.max(Math.abs(this.projectX(s, 1)), Math.abs(this.projectX(s, -1)));
    let lo = this.baseScale * C.touchMinScale;
    let hi = this.baseScale * C.touchMaxScale;
    let s = this.baseScale;
    if (reach(lo) > peek) s = lo;
    else if (reach(hi) < peek) s = hi;
    else {
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (reach(mid) > peek) hi = mid; else lo = mid; }
      s = (lo + hi) / 2;
    }
    const lead = new THREE.Vector3(0, Math.max(0.5, C.touchActiveScale) * s, 0).project(this.camera);
    if (lead.y > C.touchLeadMaxHeight) s *= C.touchLeadMaxHeight / lead.y;
    this.galleryScale = s;
    const avg = (Math.abs(this.projectX(s, 1)) + Math.abs(this.projectX(s, -1))) / 2;
    this.touchSpan = avg > 0.05 ? clamp(2 / avg, 1, 4) : 0;
  }

  // ------------------------------------------------------------- textures
  private neighbours(center: number, radius: number) {
    const out: number[] = [];
    for (let d = 0; d <= radius; d++) {
      const a = center - d, b = center + d;
      if (a >= 0 && a < this.items.length) out.push(a);
      if (d && b >= 0 && b < this.items.length) out.push(b);
    }
    return out;
  }

  private loadTexture(i: number) {
    if (this.textures.has(i)) return Promise.resolve();
    let p = this.loading.get(i);
    if (!p) {
      p = labelTexture(this.items[i]).then((t) => {
        if (this.disposed) return;
        this.textures.set(i, t);
        // Upload in an idle slot so the GPU copy never lands mid-glide.
        if (t) return whenIdle(() => { if (!this.disposed) { this.renderer.initTexture(t); this.applyTexture(i); } });
        this.applyTexture(i);
      });
      this.loading.set(i, p);
    }
    return p;
  }

  private loadAround(i: number, radius: number) {
    return Promise.all(this.neighbours(i, radius).map((n) => this.loadTexture(n)));
  }

  private applyTexture(i: number) {
    const s = this.visible.get(i);
    if (!s) return;
    const t = this.textures.get(i) || this.assets.placeholder;
    if (s.obj.frontMaterial.map !== t) {
      s.obj.frontMaterial.map = t;
      s.obj.frontMaterial.needsUpdate = true;
      this.request();
    }
  }

  // ------------------------------------------------------------ pool/range
  private moving() {
    return this.dragging || this.dragV !== 0 || gsap.isTweening(this.tweenState) || Math.abs(this.L - Math.round(this.L)) > 0.0015;
  }

  private assign(i: number) {
    let s = this.visible.get(i);
    if (s) return s;
    s = this.free.pop();
    if (!s) return null;
    s.index = i;
    s.obj.group.visible = true;
    s.obj.pick.userData.index = i;
    s.justAssigned = true;
    s.spawnFrom = this.ready && !this.flightLock && this.moving() ? Math.sign(i - this.L) || 1 : 0;
    this.visible.set(i, s);
    s.obj.frontMaterial.map = this.textures.get(i) || this.assets.placeholder;
    this.loadTexture(i);
    return s;
  }

  private recycle(s: Slot) {
    this.visible.delete(s.index);
    s.resetTween?.kill();
    s.resetTween = null;
    s.obj.group.visible = false;
    s.obj.group.position.set(0, 0, 0);
    s.obj.group.rotation.set(0, 0, 0);
    s.obj.group.scale.setScalar(1);
    s.obj.spin.rotation.set(0, 0, 0);
    Object.assign(s, { spinX: 0, spinY: 0, hover: 0, spawnFrom: 0, px: 0, py: 0, pz: 0, pvx: 0, pvy: 0, pvz: 0, prx: 0, pry: 0, prvx: 0, prvy: 0 });
    s.index = -1;
    s.obj.pick.userData.index = -1;
    this.free.push(s);
  }

  private updateRange() {
    const r = C.renderRadius + 1;
    const lo = Math.max(0, Math.ceil(this.L - r));
    const hi = Math.min(this.items.length - 1, Math.floor(this.L + r));
    if (lo === this.rangeLo && hi === this.rangeHi) return;
    this.rangeLo = lo;
    this.rangeHi = hi;
    for (const s of Array.from(this.visible.values())) if (s.index < lo || s.index > hi) this.recycle(s);
    for (let i = lo; i <= hi; i++) this.assign(i);
    this.picks = Array.from(this.visible.values(), (s) => s.obj.pick);
    if (this.hovered >= 0 && !this.visible.has(this.hovered)) this.hovered = -1;
  }

  // --------------------------------------------------------------- active
  private roundedL() {
    return Math.round(clamp(this.L, 0, this.items.length - 1));
  }

  private setActive(i: number, force = false) {
    const n = clamp(i, 0, this.items.length - 1);
    if (n === this.active && !force) return;
    this.active = n;
    this.loadAround(n, C.renderRadius + 1);
    this.cb.onChange?.(n);
    this.request();
  }

  get index() {
    return this.active;
  }
  get isDragging() {
    return this.dragging;
  }
  get count() {
    return this.items.length;
  }

  private currentTarget() {
    if (this.stepTarget >= 0) return clamp(this.stepTarget, 0, this.items.length - 1);
    if (gsap.isTweening(this.tweenState)) return clamp(this.pinned, 0, this.items.length - 1);
    return this.roundedL();
  }

  private stepTiming(src: StepSource, dist: number) {
    const n = C.snapDuration;
    switch (src) {
      case 'wheel': return { duration: n + 0.05, ease: EASE.glide, kick: 2.5 };
      case 'key': return { duration: Math.min(0.6, n - 0.04 + dist * 0.05), ease: EASE.glide, kick: 4 };
      case 'click': return { duration: clamp(0.45 + dist * 0.11, n, 1.05), ease: EASE.glide, kick: Math.min(5, dist * 1.4) };
      case 'flick': return { duration: n + 0.1, ease: EASE.glide, kick: 0 };
      default: return { duration: n, ease: 'power3.out', kick: 0 };
    }
  }

  /** Glide to an index. Distant jumps preload textures first so discs never arrive blank. */
  async goTo(i: number, src: StepSource = 'snap', immediate = false) {
    const target = clamp(i, 0, this.items.length - 1);
    const token = ++this.stepToken;
    const dist = Math.abs(target - this.L);
    const t = this.stepTiming(src, dist);
    this.pinned = target;
    this.stepTarget = target;
    this.dragV = 0;
    this.springV = 0;
    gsap.killTweensOf(this.tweenState);
    if (!this.reduced && t.kick) {
      const dir = Math.sign(target - this.L);
      if (dir) this.flowV = clamp(this.flowV + dir * t.kick, -12, 12);
    }
    this.request();
    if (dist > C.renderRadius) {
      await this.loadAround(target, Math.min(3, C.renderRadius));
      if (this.disposed || token !== this.stepToken) return;
    } else this.loadAround(target, C.renderRadius + 1);
    this.tweenState.value = this.L;
    if (this.reduced || immediate) {
      this.L = this.lastL = target;
      this.tweenState.value = target;
      this.flowV = 0;
      this.updateRange();
      this.setActive(target);
      this.request(3);
      if (token === this.stepToken) { this.pinned = -1; this.stepTarget = -1; }
      return;
    }
    gsap.to(this.tweenState, {
      value: target,
      duration: t.duration,
      ease: t.ease,
      overwrite: true,
      onUpdate: () => { this.L = this.tweenState.value; },
      onComplete: () => {
        this.L = target;
        this.setActive(target);
        if (token === this.stepToken) { this.pinned = -1; this.stepTarget = -1; }
      },
    });
    this.request(3);
  }

  next() { this.wheel.reset(); this.goTo(this.currentTarget() + 1, 'key'); }
  prev() { this.wheel.reset(); this.goTo(this.currentTarget() - 1, 'key'); }

  /** Space: turn the active disc over to its iridescent data side and back. */
  flip() {
    const s = this.visible.get(this.active);
    if (!s) return;
    s.resetTween?.kill();
    const toBack = Math.abs(s.spinY) <= Math.PI / 2;
    s.resetTween = gsap.to(s, {
      spinY: toBack ? Math.PI : 0,
      spinX: 0,
      duration: this.reduced ? 0.15 : 0.75,
      ease: EASE.flip,
      overwrite: true,
      onUpdate: () => this.request(),
      onComplete: () => { s.resetTween = null; },
    });
    this.request();
  }

  // -------------------------------------------------------------- pointer
  private toNDC(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    this.ndc.set((x / r.width) * 2 - 1, -(y / r.height) * 2 + 1);
    return { x, y, rect: r };
  }

  private pick(): number {
    if (!this.picks.length) return -1;
    this.gallery.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.picks, false)[0];
    if (!hit) return -1;
    if (hit.uv) { this.hitUV.x = hit.uv.x * 2 - 1; this.hitUV.y = hit.uv.y * 2 - 1; } else { this.hitUV.x = 0; this.hitUV.y = 0; }
    return (hit.object.userData.index as number) ?? -1;
  }

  private isInteractiveTarget(t: EventTarget | null) {
    return t instanceof Element && !!t.closest('a, button, input, textarea, select, label, [data-no-drag]');
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.ready || this.flightLock || e.button !== 0 || !e.isPrimary || this.isInteractiveTarget(e.target)) return;
    const p = this.toNDC(e);
    this.pointerDown = true;
    this.pointerId = e.pointerId;
    this.keyboardNav = false;
    this.isTouch = e.pointerType !== 'mouse';
    this.downX = this.lastX = p.x;
    this.downY = this.lastY = p.y;
    this.lastMoveT = performance.now();
    this.spinCandidate = -1;
    const hit = this.pick();
    if (hit >= 0 && Math.abs(hit - this.L) < 0.6) this.spinCandidate = hit;
    this.hovered = hit;
    window.addEventListener('pointermove', this.onDragMove, { passive: false });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    this.request();
  }

  private startDrag(e: PointerEvent) {
    this.dragging = true;
    gsap.killTweensOf(this.tweenState);
    this.stepToken++;
    this.stepTarget = -1;
    this.pinned = -1;
    this.tweenState.value = this.L;
    this.wheel.reset();
    this.dragV = 0;
    this.springV = 0;
    this.spinTarget = this.spinCandidate;
    this.host.style.cursor = 'grabbing';
    this.host.setAttribute('data-dragging', 'true');
    window.getSelection()?.removeAllRanges();
    if (this.spinTarget >= 0) {
      const s = this.visible.get(this.spinTarget);
      s?.resetTween?.kill();
      if (s) s.resetTween = null;
    }
    try { this.host.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.cb.onDragChange?.(true);
    this.request();
  }

  /** Soft limit so spin resists past ~80% of maxSpinAngle. */
  private softSpin(current: number, delta: number) {
    const max = rad(C.maxSpinAngle);
    const over = Math.max(0, Math.abs(current) - max * 0.8) / max;
    const k = 1 / (1 + over * over * 14);
    return current + delta * (Math.sign(delta) === Math.sign(current) || current === 0 ? k : 1);
  }

  private onDragMove = (e: PointerEvent) => {
    if (!this.pointerDown || e.pointerId !== this.pointerId) return;
    const p = this.toNDC(e);
    if (!this.dragging) {
      const dx = p.x - this.downX, dy = p.y - this.downY;
      if (Math.hypot(dx, dy) < C.dragStartDistance) return;
      // Horizontal touch swipes always scrub, even when started on the disc.
      if (this.isTouch && Math.abs(dx) >= Math.abs(dy)) this.spinCandidate = -1;
      this.startDrag(e);
    }
    if (e.cancelable) e.preventDefault();
    const now = performance.now();
    const dx = p.x - this.lastX, dy = p.y - this.lastY;
    const dt = Math.max(8, now - this.lastMoveT);
    this.lastX = p.x; this.lastY = p.y; this.lastMoveT = now;
    this.request();
    if (this.spinTarget >= 0) {
      const s = this.visible.get(this.spinTarget);
      if (!s) return;
      const k = C.dragSensitivity * 0.0045;
      s.spinY = this.softSpin(s.spinY, dx * k);
      s.spinX = this.softSpin(s.spinX, dy * k);
      return;
    }
    const span = this.isTouch ? this.touchSpan || 1.8 : 6 * C.dragSensitivity;
    const d = -(dx / p.rect.width) * span;
    this.L = clamp(this.L + d, 0, this.items.length - 1);
    const v = clamp((16.667 / dt) * d, -C.dragMaxVelocity, C.dragMaxVelocity);
    this.dragV += (v - this.dragV) * C.dragVelocitySmoothing;
  };

  private onUp = () => this.release(false);
  private onCancel = () => this.release(true);

  private release(cancelled: boolean) {
    if (!this.pointerDown) return;
    const wasDragging = this.dragging;
    const spun = this.spinTarget;
    this.pointerDown = false;
    this.pointerId = -1;
    this.dragging = false;
    this.spinTarget = -1;
    this.spinCandidate = -1;
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    this.host.removeAttribute('data-dragging');
    this.updateCursor();
    this.request();
    if (!wasDragging) return;
    this.cb.onDragChange?.(false);
    this.suppressClickUntil = performance.now() + 140;
    if (spun >= 0) { this.resetSpin(spun); this.dragV = 0; return; }
    if (cancelled) { this.dragV = 0; this.goTo(Math.round(this.L)); return; }
    if (this.isTouch) {
      const dir = Math.abs(this.dragV) >= C.touchFlickVelocity ? Math.sign(this.dragV) : 0;
      const t = dir > 0 ? Math.floor(this.L) + 1 : dir < 0 ? Math.ceil(this.L) - 1 : Math.round(this.L);
      this.dragV = 0;
      this.goTo(t, 'flick');
      return;
    }
    if (this.reduced) this.goTo(Math.round(this.L), 'snap', true);
    // Mouse: inertia + spring settle continue in the frame loop.
  }

  private resetSpin(i: number) {
    const s = this.visible.get(i);
    if (!s || (Math.abs(s.spinX) < 0.001 && Math.abs(s.spinY) < 0.001)) return;
    s.resetTween?.kill();
    s.resetTween = gsap.to(s, {
      spinX: 0, spinY: 0,
      duration: this.reduced ? 0.15 : C.resetDuration,
      ease: EASE.settle,
      overwrite: true,
      onUpdate: () => this.request(),
      onComplete: () => { s.resetTween = null; },
    });
  }

  private onHoverMove(e: PointerEvent) {
    this.pointerInside = true;
    this.keyboardNav = false;
    if (this.pointerDown || !finePointer()) return;
    this.toNDC(e);
    const t = performance.now();
    const dt = t - this.hoverLastT;
    this.hoverLastT = t;
    if (dt < 120) {
      const k = 16.7 / Math.max(8, dt);
      this.hoverVX = (e.clientX - this.hoverX) * k;
      this.hoverVY = (e.clientY - this.hoverY) * k;
    } else { this.hoverVX = 0; this.hoverVY = 0; }
    this.hoverX = e.clientX;
    this.hoverY = e.clientY;
    this.needsPick = true;
    this.request();
  }

  /** Fast pointer pass over a disc knocks it along the pointer's path. */
  private wipe(i: number) {
    if (this.reduced) return;
    const s = this.visible.get(i);
    if (!s || Math.hypot(this.hoverVX, this.hoverVY) < C.wipeMinSpeed) return;
    const pm = C.wipePushMax, rm = C.wipeSpinMax;
    s.pvx += clamp(this.hoverVX * C.wipePush, -pm, pm);
    s.pvy -= clamp(this.hoverVY * C.wipePush, -pm, pm);
    s.prvy += clamp(this.hoverVX * C.wipeSpin, -rm, rm);
    s.prvx += clamp(this.hoverVY * C.wipeSpin, -rm, rm);
  }

  /** Click impulse: disc is pushed back and tilted around the hit point. */
  private press(i: number) {
    if (this.reduced) return;
    const s = this.visible.get(i);
    if (!s) return;
    s.pvz -= C.pressDepth;
    s.prvy += this.hitUV.x * C.pressTilt;
    s.prvx -= this.hitUV.y * C.pressTilt;
    this.request();
  }

  private updateCursor() {
    if (!this.pointerDown) this.host.style.cursor = this.hovered >= 0 ? 'pointer' : 'grab';
  }

  private onClick(e: MouseEvent) {
    if (!this.ready || this.flightLock) return;
    if (performance.now() < this.suppressClickUntil) { e.preventDefault(); e.stopPropagation(); return; }
    if (this.isInteractiveTarget(e.target)) return;
    this.toNDC(e);
    const hit = this.pick();
    if (hit < 0) return;
    e.preventDefault();
    if (hit !== this.active) {
      this.wheel.reset();
      this.press(hit);
      this.goTo(hit, 'click');
      return;
    }
    this.press(hit);
    this.cb.onOpen?.(hit, e);
  }

  private onWheel(e: WheelEvent) {
    if (e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (!this.ready || this.flightLock) return;
    this.wheel.push(e);
  }

  private onKey(e: KeyboardEvent) {
    if (!this.ready || this.flightLock || e.defaultPrevented || e.altKey) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && (['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) || a.isContentEditable)) return;
    const inside = this.host.contains(a);
    // Keys work when the gallery is focused, or when the pointer is over it and nothing else has focus.
    if (!inside && (!this.pointerInside || (a && a !== document.body))) return;
    if (e.key === 'Enter') { if (inside) { e.preventDefault(); this.cb.onOpen?.(this.active, e); } return; }
    if (e.key === ' ') { if (inside || !a || a === document.body) { e.preventDefault(); this.flip(); } return; }
    let dir = 0, abs = -1;
    if (e.key === 'ArrowRight') dir = 1;
    else if (e.key === 'ArrowLeft') dir = -1;
    else if (e.key === 'Home') abs = 0;
    else if (e.key === 'End') abs = this.items.length - 1;
    else return;
    e.preventDefault();
    this.wheel.reset();
    this.keyboardNav = true;
    this.goTo(abs >= 0 ? abs : this.currentTarget() + dir, 'key');
  }

  // --------------------------------------------------------------- flights
  private beginPreload() {
    Object.assign(this.preload, { active: true, turn: 0, rise: 0, riseFrom: C.preloadRiseFrom, growing: C.preloadGrowBy > 0 });
    this.flight = { others: 0, active: this.preload.growing ? 0.001 : C.preloadBoost, inbound: true };
    const s = this.visible.get(Math.round(this.L)) || null;
    if (s) { s.resetTween?.kill(); s.resetTween = null; s.spinY = -Math.PI / 2; s.spinX = 0; }
  }

  private applyPreloadPose() {
    const s = this.visible.get(this.active);
    if (!s) return;
    const t = 1 - clamp(this.preload.turn, 0, 1);
    s.spinY = (-Math.PI / 2) * t;
    s.spinX = 0;
    s.obj.spin.rotation.z = C.preloadSpin * t * t;
    if (this.preload.growing) {
      const g = C.preloadGrowBy > 0 ? clamp(this.preload.rise / C.preloadGrowBy, 0, 1) : 1;
      this.flight.active = Math.max(0.001, C.preloadBoost * (1 - (1 - g) * (1 - g)));
      if (g >= 1) this.preload.growing = false;
    }
  }

  /** Offset of the rising lead disc, expressed in gallery-local space. */
  private riseOffset(rise: number) {
    const t = 1 - clamp(rise, 0, 1);
    const v = new THREE.Vector3(0, -this.preload.riseFrom * t, -C.preloadRiseDepth * t);
    if (t === 0) return v;
    v.applyQuaternion(this.gallery.quaternion.clone().invert());
    return v.divideScalar(this.gallery.scale.x || 1);
  }

  private endPreload() {
    this.preload.active = false;
    this.preload.tween?.kill();
    this.preload.tween = null;
    this.preload.growing = false;
    this.request(3);
  }

  private releaseFlight() {
    this.flightLock = false;
    this.host.removeAttribute('data-flight');
  }

  private anchor(rise: number) {
    const off = this.riseOffset(rise);
    const base = new THREE.Vector3(off.x, C.activeDiscY + off.y, off.z);
    const touchScale = this.isTouchLayout() ? Math.max(0.5, C.touchActiveScale) : 1;
    const a = C.preloadBoost * touchScale;
    const live = Math.max(C.preloadBoost, this.flight.active) * touchScale;
    this.gallery.updateMatrixWorld();
    const toPx = (v: THREE.Vector3) => {
      const p = this.gallery.localToWorld(v.clone()).project(this.camera);
      return { x: (p.x + 1) * 0.5 * this.width, y: (1 - p.y) * 0.5 * this.height };
    };
    const c = toPx(base);
    const r = toPx(base.clone().add(new THREE.Vector3(a, 0, 0)));
    const l = toPx(base.clone().add(new THREE.Vector3(live, 0, 0)));
    const rest = toPx(base.clone().add(new THREE.Vector3(touchScale, 0, 0)));
    return { x: c.x, y: c.y, r: Math.hypot(r.x - c.x, r.y - c.y), live: Math.hypot(l.x - c.x, l.y - c.y), rest: Math.hypot(rest.x - c.x, rest.y - c.y) };
  }

  preloader(): PreloaderApi {
    return {
      covers: this.neighbours(this.active, C.renderRadius + 1),
      load: (i) => this.loadTexture(i),
      anchor: () => this.anchor(this.preload.active ? this.preload.rise : 1),
      floor: (floorPx) => {
        if (!Number.isFinite(floorPx)) return;
        const bottom = (rf: number) => {
          const prev = this.preload.riseFrom;
          this.preload.riseFrom = rf;
          const a = this.anchor(0);
          this.preload.riseFrom = prev;
          return a.y + a.r;
        };
        let lo = 0, hi: number = C.preloadRiseFrom;
        if (bottom(hi) <= floorPx) { this.preload.riseFrom = hi; return; }
        for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (bottom(mid) > floorPx) hi = mid; else lo = mid; }
        this.preload.riseFrom = lo;
        this.request();
      },
      pose: ({ turn, rise }) => {
        if (!this.preload.active) return;
        if (Number.isFinite(turn)) this.preload.turn = clamp(turn!, 0, 1);
        if (Number.isFinite(rise)) this.preload.rise = clamp(rise!, 0, 1);
        this.applyPreloadPose();
        this.request();
      },
      fan: () => {
        if (!this.preload.active) return Promise.resolve();
        this.preload.turn = 1; this.preload.rise = 1; this.applyPreloadPose(); this.preload.growing = false;
        return new Promise<void>((resolve) => {
          const d = C.preloadFanDuration;
          const tl = gsap.timeline({
            onUpdate: () => this.request(),
            onComplete: () => { this.flight.others = 1; this.flight.active = 1; this.releaseFlight(); this.endPreload(); resolve(); },
          });
          this.preload.tween = tl;
          tl.call(() => resolve(), undefined, d * 0.8);
          tl.call(() => this.releaseFlight(), undefined, d * 0.85);
          tl.to(this.flight, { active: 1, duration: d, ease: EASE.glide }, 0);
          tl.to(this.flight, { others: 1, duration: d * 0.85, ease: 'none' }, d * 0.1);
          this.request(3);
        });
      },
      revealCopy: () => this.host.removeAttribute('data-flight'),
      abort: () => {
        if (!this.preload.active) return;
        this.preload.turn = 1; this.preload.rise = 1; this.applyPreloadPose();
        this.flight = { others: 1, active: 1, inbound: false };
        const s = this.visible.get(this.active);
        if (s) s.obj.spin.rotation.z = 0;
        this.endPreload();
        this.releaseFlight();
      },
    };
  }

  private lockForFlight() {
    this.release(true);
    this.stepToken++;
    this.stepTarget = -1;
    gsap.killTweensOf(this.tweenState);
    gsap.killTweensOf(this.flight);
    this.wheel.reset();
    this.dragV = 0; this.springV = 0; this.flowV = 0;
    this.flightLock = true;
    this.flight.inbound = false;
    this.host.setAttribute('data-flight', 'true');
    this.hovered = -1;
    this.needsPick = false;
    this.keyboardNav = false;
  }

  /** Detail open: press → spring → shrink while turning edge-on; others recede. Resolves at hand-over. */
  exitToDetail(): Promise<void> {
    this.lockForFlight();
    const target = this.roundedL();
    const from = clamp(this.L, -0.05, this.items.length - 0.95);
    const off = Math.abs(from - target);
    const settle = this.reduced || off < 0.002 ? 0 : clamp(0.12 + off * 0.25, 0.12, 0.4);
    this.tweenState.value = settle ? from : target;
    if (!settle) this.L = target;
    this.lastL = this.L;
    const s = this.visible.get(target);
    s?.resetTween?.kill();
    if (s) s.resetTween = null;
    if (this.reduced) {
      this.flight.others = 0; this.flight.active = 0.001;
      this.layout(1, true); this.renderer.render(this.scene, this.camera);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let handed = false;
      const hand = () => { if (!handed) { handed = true; resolve(); } };
      const tl = gsap.timeline({ onUpdate: () => this.request(), onComplete: hand });
      if (settle) tl.to(this.tweenState, { value: target, duration: settle, ease: 'power2.out', onUpdate: () => { this.L = this.tweenState.value; } }, 0);
      const t0 = settle * 0.6;
      const pressT = 0.12, springT = 0.16, out = 0.55;
      tl.to(this.flight, { active: 0.94, duration: pressT, ease: 'power2.out' }, t0);
      tl.to(this.flight, { active: 1.015, duration: springT, ease: 'power2.out' }, t0 + pressT);
      tl.to(this.flight, { others: 0, duration: out, ease: 'none' }, t0 + pressT);
      const shrinkAt = t0 + pressT + springT;
      tl.to(this.flight, { active: 0.001, duration: out, ease: 'power2.in' }, shrinkAt);
      if (s) {
        const turns = Math.ceil((s.spinY + Math.PI / 2 - Math.PI / 2) / Math.PI - 1e-6);
        tl.to(s, { spinY: Math.PI / 2 + turns * Math.PI, spinX: 0, duration: out, ease: 'power2.in' }, shrinkAt);
      }
      tl.call(hand, undefined, Math.min(t0 + pressT + out, shrinkAt + out));
      this.request(3);
    });
  }

  /** Return from a detail page: lead disc grows from nothing, others fan in by distance. */
  intro(duration = 1.05): Promise<void> {
    this.flightLock = true;
    this.flight = { others: 0, active: 0.001, inbound: true };
    this.host.setAttribute('data-flight', 'true');
    const s = this.visible.get(this.active);
    if (s) { s.spinX = 0; s.spinY = 0; }
    if (this.reduced) { this.flight = { others: 1, active: 1, inbound: false }; this.releaseFlight(); this.request(2); return Promise.resolve(); }
    return new Promise<void>((resolve) => {
      const tl = gsap.timeline({
        onUpdate: () => this.request(),
        onComplete: () => { this.flight.others = 1; this.flight.active = 1; this.releaseFlight(); this.request(2); resolve(); },
      });
      tl.call(() => this.releaseFlight(), undefined, duration * 0.9);
      tl.to(this.flight, { active: 1, duration, ease: EASE.glide }, 0);
      tl.to(this.flight, { others: 1, duration: duration * 0.85, ease: 'none' }, duration * 0.1);
      this.request(3);
    });
  }

  // ------------------------------------------------------------- layout
  private layout(dt: number, snap = false): number {
    const n = this.roundedL();
    this.gallery.scale.setScalar(this.galleryScale);
    this.updateRange();
    const live = !this.reduced && !this.flightLock;
    const lean = live ? clamp(Math.sign(this.flowV) * Math.sqrt(Math.abs(this.flowV)) * C.flowLean, -C.flowLeanMax, C.flowLeanMax) : 0;
    const dip = live ? Math.min(C.flowDipMax, Math.abs(this.flowV) * C.flowDip) : 0;
    const followBase = this.dragging ? C.followTight : C.followBase;
    const touch = this.isTouchLayout();
    const activeScale = touch ? Math.max(0.5, C.touchActiveScale) : 1;
    const inactive = touch ? clamp(C.touchInactiveScale, 0.2, 1) : C.inactiveScale;
    const depth = Math.max(LOOK.discThickness * 3, 0.12, C.depthGap);
    let residual = 0;

    this.visible.forEach((s, p) => {
      const m = p - this.L;
      const h = Math.abs(m);
      const isActive = p === n;
      const theta = m * 0.35;
      let x = Math.sin(theta) * C.hGap * 2.4;
      let y = (isActive ? C.activeDiscY : 0) - dip * (isActive ? 0.7 : 1);
      let z = -Math.cos(theta) * depth * 2.4 + depth * 2.4;
      if (touch) {
        const o = this.touchLocal(m);
        x = o.x; y += o.y; z = o.z;
      }
      let rx = 0;
      let ry = touch ? clamp(-m, 0, 1) * -2 * rad(C.galleryRotY) + lean * (isActive ? 1 : 1.12) : -theta + lean * (isActive ? 1 : 1.12);
      const rz = -lean * C.flowBank * (isActive ? 0.7 : 1);
      const baseScale = isActive ? activeScale : Math.max(inactive, 1 - h * (1 - inactive) * (touch ? 1 : 0.6));

      // Flight scaling: active by its own weight, others staggered by distance.
      let scale: number;
      let shown = true;
      if (isActive) scale = baseScale * this.flight.active;
      else {
        const e = clamp(this.flight.others, 0, 2);
        const inbound = this.flight.inbound;
        const st = clamp(inbound ? C.flightStaggerIn : C.flightStagger, 0, 0.9);
        const maxS = Math.max(1, Math.round(C.flightStaggerMax));
        const delay = (Math.min(h, maxS) / maxS) * st;
        const span = Math.max(0.1, 1 - st);
        const o = clamp((Math.min(1, e) - delay) / span, 0, 1);
        const k = (inbound ? glide(o) : o * (2 - o)) + Math.max(0, e - 1);
        shown = k > clamp(inbound ? C.flightPopScaleIn : C.flightPopScale, 0, 0.9);
        scale = baseScale * k;
        const recede = 1 - Math.min(1, k);
        if (recede > 1e-4) z -= recede * C.flightRecede;
      }
      s.obj.group.visible = shown;

      // Hover tilt toward pointer NDC.
      const wantHover = this.hovered === p && this.spinTarget < 0 ? 1 : 0;
      s.hover += (wantHover - s.hover) * Math.min(1, dt * 10);
      if (s.hover > 0.001) {
        rx += s.hover * C.hoverTiltStrength * this.ndc.y;
        ry += s.hover * C.hoverTiltStrength * this.ndc.x;
      }

      const k = clamp(followBase - h * C.followFalloff, C.followMin, C.followTight);
      const A = snap || this.reduced || this.flightLock ? 1 : Math.min(1, dt * k);

      // Impulse springs (wipe / press).
      if (this.flightLock) {
        s.px = s.py = s.pz = s.pvx = s.pvy = s.pvz = s.prx = s.pry = s.prvx = s.prvy = 0;
      } else {
        const energy = Math.abs(s.px) + Math.abs(s.py) + Math.abs(s.pz) + Math.abs(s.pvx) + Math.abs(s.pvy) + Math.abs(s.pvz) + Math.abs(s.prx) + Math.abs(s.pry) + Math.abs(s.prvx) + Math.abs(s.prvy);
        if (energy > 8e-4) {
          const damp = Math.exp(-C.pushDamping * dt);
          const ret = Math.min(1, dt * C.pushReturn);
          s.px += s.pvx * dt; s.pvx *= damp;
          s.py += s.pvy * dt; s.pvy *= damp;
          s.pz += s.pvz * dt; s.pvz *= damp;
          s.prx += s.prvx * dt; s.prvx *= damp;
          s.pry += s.prvy * dt; s.prvy *= damp;
          s.px -= s.px * ret; s.py -= s.py * ret; s.pz -= s.pz * ret; s.prx -= s.prx * ret; s.pry -= s.pry * ret;
          x += s.px; y += s.py; z += s.pz;
          residual += energy;
        } else if (energy > 0) {
          s.px = s.py = s.pz = s.pvx = s.pvy = s.pvz = s.prx = s.pry = s.prvx = s.prvy = 0;
        }
      }

      if (this.preload.active && isActive) {
        const o = this.riseOffset(this.preload.rise);
        x += o.x; y += o.y; z += o.z;
      }

      const g = s.obj.group;
      if (s.justAssigned) {
        g.position.set(x, y, z);
        g.rotation.set(rx, ry, rz);
        g.scale.setScalar(scale);
        if (s.spawnFrom && !snap && !this.reduced && !this.flightLock) {
          g.position.x += s.spawnFrom * C.spawnSlide;
          g.position.z -= 0.45;
          g.rotation.y -= s.spawnFrom * 0.3;
          g.scale.multiplyScalar(C.spawnShrink);
        }
        s.spawnFrom = 0;
        s.justAssigned = false;
      } else {
        residual += Math.abs(x - g.position.x) + Math.abs(y - g.position.y) + Math.abs(z - g.position.z) + Math.abs(scale - g.scale.x) +
          Math.abs(rx - g.rotation.x) + Math.abs(ry - g.rotation.y) + Math.abs(rz - g.rotation.z) + Math.abs(wantHover - s.hover);
        g.position.x += (x - g.position.x) * A;
        g.position.y += (y - g.position.y) * A;
        g.position.z += (z - g.position.z) * A;
        g.scale.setScalar(g.scale.x + (scale - g.scale.x) * A);
        g.rotation.x += (rx - g.rotation.x) * A;
        g.rotation.y += (ry - g.rotation.y) * A;
        g.rotation.z += (rz - g.rotation.z) * A;
      }
      if (this.spinTarget !== p && !s.resetTween && !this.preload.active) {
        s.spinX += (0 - s.spinX) * Math.min(1, dt * 2.5);
        residual += Math.abs(s.spinX);
      }
      s.obj.spin.rotation.x = s.spinX + s.prx;
      s.obj.spin.rotation.y = s.spinY + s.pry;
      if (!this.preload.active) s.obj.spin.rotation.z = 0;
      g.renderOrder = Math.round(500 + g.position.z * 10 - p * 0.01);
      if (s.resetTween) residual += 1;
    });
    return residual;
  }

  // ---------------------------------------------------------------- loop
  /**
   * Wake the render-on-demand loop. `raf` stays non-zero for the whole life of
   * a running loop (it is only cleared when the loop decides to stop), so calls
   * made from inside a frame never start a second, parallel loop.
   */
  request(frames = 2) {
    this.forceFrames = Math.max(this.forceFrames, frames);
    if (!this.ready || this.disposed || this.raf || document.hidden) return;
    this.lastT = -1; // first frame after waking uses a nominal dt
    this.busyFrames = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private adaptResolution(dt: number) {
    if (this.flightLock || this.busyFrames < 3 || dt > 0.08) return;
    this.perfTime += dt;
    this.perfFrames += 1;
    if (this.perfFrames < 30) return;
    const avg = this.perfTime / this.perfFrames;
    this.perfFrames = 0;
    this.perfTime = 0;
    if (avg > 0.0265 && this.renderScaleIdx < this.renderScales.length - 1) {
      this.renderScaleIdx = Math.min(this.renderScales.length - 1, this.renderScaleIdx + (avg > 0.045 ? 2 : 1));
      this.renderer.setPixelRatio(this.pixelRatio(this.width, this.height));
      this.renderer.setSize(this.width, this.height, false);
    }
  }

  private scribbleTarget() {
    const hoveringActive = this.hovered >= 0 && this.hovered === this.active;
    return hoveringActive || this.keyboardNav ? this.active : -1;
  }

  private frame = (t: number) => {
    if (this.disposed || document.hidden) { this.raf = 0; return; }
    const raw = this.lastT < 0 ? 1 / 60 : (t - this.lastT) / 1000;
    const dt = Math.min(0.05, Math.max(1 / 240, raw));
    this.lastT = t;
    this.adaptResolution(raw);
    const frames = Math.min(3, dt * 60);

    if (this.needsPick) {
      this.needsPick = false;
      const h = this.pick();
      if (h !== this.hovered) {
        if (h >= 0 && !this.pointerDown && !this.flightLock) this.wipe(h);
        this.hovered = h;
        this.updateCursor();
        this.forceFrames = Math.max(this.forceFrames, 2);
      }
    }

    // Inertia, then spring settle toward the nearest item.
    if (!this.dragging) {
      if (Math.abs(this.dragV) > 1e-5) {
        this.L += this.dragV * frames;
        this.dragV *= this.reduced ? 0 : C.friction ** frames;
        if (Math.abs(this.dragV) < 4e-4) this.dragV = 0;
      }
      if (this.dragV === 0 && !gsap.isTweening(this.tweenState) && !this.flightLock) {
        const target = Math.round(this.L);
        const d = target - this.L;
        if (this.reduced) {
          this.L += d * Math.min(1, dt * 20);
          this.springV = 0;
          if (Math.abs(target - this.L) < 0.001) this.L = target;
        } else if (d !== 0 || Math.abs(this.springV) > 1e-5) {
          this.springV += d * C.snapFreq * C.snapFreq * dt;
          this.springV *= Math.exp(-C.snapDamping * dt);
          this.L += this.springV * dt;
          if (Math.abs(target - this.L) < 8e-4 && Math.abs(this.springV) < 0.004) { this.L = target; this.springV = 0; }
        }
      }
    }
    this.L = clamp(this.L, -0.05, this.items.length - 0.95);

    // Flow velocity: fast attack, slow release.
    if (this.reduced || this.flightLock) { this.flowV = 0; this.lastL = this.L; }
    else {
      const v = clamp((this.L - this.lastL) / Math.max(dt, 0.001), -40, 40);
      this.lastL = this.L;
      this.flowV += (v - this.flowV) * Math.min(1, dt * (Math.abs(v) > Math.abs(this.flowV) ? 14 : 6));
      if (Math.abs(this.flowV) < 0.01) this.flowV = 0;
    }
    if (!this.preload.active) this.setActive(this.roundedL());
    const residual = this.layout(dt);

    // Scribble: tracks the active disc in the gallery plane, boils at 10 fps.
    const want = this.flightLock ? -1 : this.scribbleTarget();
    const scribbling = this.scribble.step(t, want, (i) => this.visible.get(i)?.obj.group ?? null, this.moving(), dt, this.reduced);
    this.gallery.updateMatrixWorld();
    this.scribble.project(this.gallery.matrixWorld, this.camera, this.width, this.height);
    if (want !== this.scribbleWant || this.scribble.visible) {
      this.scribbleWant = want;
      this.cb.onScribble?.(want, ...this.scribble.toScreen(C.noteAnchor[0], C.noteAnchor[1], this.camera, this.width, this.height));
    }
    const lampMoving = this.lamp.update(dt, this.reduced);

    const busy = this.dragging || this.pointerDown || this.dragV !== 0 || this.springV !== 0 || this.flowV !== 0 ||
      gsap.isTweening(this.tweenState) || residual > 0.001 || lampMoving || this.forceFrames > 0;
    if (busy) {
      if (this.forceFrames > 0) this.forceFrames--;
      this.busyFrames++;
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(this.frame);
      return;
    }
    this.renderer.render(this.scene, this.camera);
    this.busyFrames = 0;
    this.raf = 0; // loop stops here; request() may start a new one
    // Idle but the scribble still boils: wake at the scribble frame rate.
    if (scribbling) {
      clearTimeout(this.scribbleTimer);
      this.scribbleTimer = window.setTimeout(() => this.request(1), 1000 / C.scribbleFps);
    }
  };

  // -------------------------------------------------------------- teardown
  dispose() {
    this.disposed = true;
    this.stop();
    clearTimeout(this.scribbleTimer);
    this.release(true);
    this.wheel.dispose();
    this.resizeObs?.disconnect();
    this.cleanups.forEach((f) => f());
    gsap.killTweensOf(this.tweenState);
    gsap.killTweensOf(this.flight);
    this.preload.tween?.kill();
    this.slots.forEach((s) => { s.resetTween?.kill(); gsap.killTweensOf(s); s.obj.frontMaterial.dispose(); });
    this.scribble.dispose();
    this.lamp?.dispose();
    this.scene.clear();
    if (this.renderer) releaseRenderer(this.renderer);
    this.host.style.cursor = '';
    this.host.removeAttribute('data-flight');
    this.host.removeAttribute('data-dragging');
  }
}
