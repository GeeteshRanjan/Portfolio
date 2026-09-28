import * as THREE from 'three';
import { GALLERY as C } from './config';

/**
 * Hand-drawn loop(s) around a disc, rendered as SVG.
 *
 * Geometry is generated in the disc plane (unit radius) with per-point radial
 * jitter, a partial sweep and tapered ends, then projected through the 3D
 * camera every frame so the loop sits in perspective around the disc.
 * The shape is regenerated at a low frame rate (10 fps) so the line "boils"
 * like frame-by-frame hand drawing. Draw-in / draw-out step through partial
 * sweeps (REFERENCE_ANALYSIS.md §5, Scribble).
 */

export type ScribblePhase = 'hidden' | 'in' | 'on' | 'out';

interface LoopShape {
  // Interleaved [innerX, innerY, outerX, outerY] per sample, disc-plane units.
  pts: Float32Array;
  count: number;
}

const tmp = new THREE.Vector3();

export class ScribbleSvg {
  private paths: SVGPathElement[] = [];
  private loops: LoopShape[] = [];
  private samples = C.scribblePoints * 3;
  phase: ScribblePhase = 'hidden';
  private frame = 0;
  private lastFrameAt = 0;
  /** Smoothed transform that follows the target disc with lag. */
  readonly follow = new THREE.Object3D();
  private target = -1;
  /** Disc-plane → world transform used by the last project(). */
  private matrix = new THREE.Matrix4();

  constructor(
    private svg: SVGSVGElement,
    private opts: {
      loops?: number; padding?: number; width?: number; jitter?: number; points?: number; color?: string;
      /** Progress-ring mode: sweep equals the given fraction, grown symmetrically around this disc-plane angle. */
      anchorAngle?: number;
    } = {},
  ) {
    const loops = opts.loops ?? C.scribbleLoops;
    if (opts.points) this.samples = opts.points * 3;
    for (let i = 0; i < loops; i++) {
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('fill', opts.color ?? C.scribbleColor);
      p.setAttribute('fill-rule', 'nonzero');
      svg.appendChild(p);
      this.paths.push(p);
      this.loops.push({ pts: new Float32Array((this.samples + 1) * 4), count: 0 });
    }
    svg.style.visibility = 'hidden';
  }

  /** Regenerate every loop at a given sweep fraction (0..1) with fresh randomness. */
  regenerate(sweep: number) {
    const points = this.opts.points ?? C.scribblePoints;
    const jitterAmt = this.opts.jitter ?? C.scribbleJitter;
    const pad = this.opts.padding ?? C.scribblePadding;
    const half = (this.opts.width ?? C.scribbleWidth) * 0.5;
    this.loops.forEach((loop, li) => {
      const radius = 1 + pad + li * C.scribbleLoopGap;
      const ring = this.opts.anchorAngle !== undefined;
      const frac = ring ? Math.max(0.001, sweep) : THREE.MathUtils.clamp(C.scribbleSweep * (1 + (Math.random() - 0.5) * C.scribbleSweepJitter), 0.12, 1) * sweep;
      const span = Math.PI * 2 * frac;
      const start = ring ? this.opts.anchorAngle! - span / 2 + (Math.random() - 0.5) * 0.06 : Math.random() * Math.PI * 2;
      const jitter: number[] = [];
      for (let i = 0; i <= points; i++) jitter.push(1 + (Math.random() - 0.5) * 2 * jitterAmt);
      const N = this.samples;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const a = start + t * span;
        const u = t * points * frac;
        const k = Math.floor(u);
        const k2 = Math.min(points, k + 1);
        const f = u - k;
        const s = f * f * (3 - 2 * f);
        const r = jitter[k] * (1 - s) + jitter[k2] * s;
        const taper = Math.min(1, Math.min(t, 1 - t) * 14 + 0.15);
        const inner = radius * r - half * taper;
        const outer = radius * r + half * taper;
        const cx = Math.cos(a), sy = Math.sin(a);
        loop.pts[i * 4] = cx * inner;
        loop.pts[i * 4 + 1] = sy * inner;
        loop.pts[i * 4 + 2] = cx * outer;
        loop.pts[i * 4 + 3] = sy * outer;
      }
      loop.count = N + 1;
    });
  }

  /** Full sweep for external progress indicators (scroll-next push ring). */
  setSweep(sweep: number) {
    this.regenerate(sweep);
  }

  /**
   * Advance the phase machine. `want` = index that should carry the scribble
   * (-1 for none). `source` returns the target disc's local transform holder.
   * Returns true while animating (needs another tick).
   */
  step(now: number, want: number, source: (i: number) => THREE.Object3D | null, snap: boolean, dt: number, reduced: boolean) {
    const interval = 1000 / C.scribbleFps;
    if (want < 0) {
      if (this.phase === 'hidden') return false;
      if (this.phase !== 'out') { this.phase = 'out'; this.frame = 0; this.lastFrameAt = now; }
      const o = source(this.target);
      if (o) this.track(o, snap, dt);
      if (now - this.lastFrameAt < interval) return true;
      this.lastFrameAt = now;
      if (this.frame >= C.scribbleOut.length || !o) {
        this.phase = 'hidden';
        this.target = -1;
        this.svg.style.visibility = 'hidden';
        return false;
      }
      this.regenerate(C.scribbleOut[this.frame++]);
      return true;
    }
    const o = source(want);
    if (!o) return false;
    if (this.phase === 'hidden' || this.target !== want) {
      this.phase = 'in';
      this.frame = 0;
      this.target = want;
      this.lastFrameAt = now;
      this.track(o, true, dt);
      this.regenerate(reduced ? 1 : C.scribbleIn[0]);
      this.frame = 1;
      this.svg.style.visibility = 'visible';
      if (reduced) this.phase = 'on';
      return true;
    }
    this.track(o, snap, dt);
    if (reduced || now - this.lastFrameAt < interval) return !reduced;
    this.lastFrameAt = now;
    if (this.phase === 'in' && this.frame < C.scribbleIn.length) this.regenerate(C.scribbleIn[this.frame++]);
    else { this.phase = 'on'; this.regenerate(1); }
    return true;
  }

  private track(o: THREE.Object3D, snap: boolean, dt: number) {
    if (snap) {
      this.follow.position.copy(o.position);
      this.follow.quaternion.copy(o.quaternion);
      this.follow.scale.copy(o.scale);
    } else {
      const k = 1 - Math.exp(-C.scribbleLag * Math.max(dt, 0.001));
      this.follow.position.lerp(o.position, k);
      this.follow.quaternion.slerp(o.quaternion, k);
      this.follow.scale.lerp(o.scale, k);
    }
  }

  /** Project the loops to screen space and write SVG paths. */
  project(parentWorld: THREE.Matrix4, camera: THREE.Camera, width: number, height: number, matrixOverride?: THREE.Matrix4) {
    if (this.svg.style.visibility === 'hidden') return;
    const m = this.matrix;
    if (matrixOverride) m.copy(matrixOverride);
    else {
      this.follow.updateMatrix();
      m.multiplyMatrices(parentWorld, this.follow.matrix);
    }
    this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.loops.forEach((loop, li) => {
      if (!loop.count) { this.paths[li].setAttribute('d', ''); return; }
      let outer = '';
      let inner = '';
      for (let i = 0; i < loop.count; i++) {
        tmp.set(loop.pts[i * 4 + 2], loop.pts[i * 4 + 3], 0).applyMatrix4(m).project(camera);
        const ox = ((tmp.x + 1) * 0.5 * width).toFixed(1);
        const oy = ((1 - tmp.y) * 0.5 * height).toFixed(1);
        outer += `${i ? 'L' : 'M'}${ox} ${oy}`;
        const j = loop.count - 1 - i;
        tmp.set(loop.pts[j * 4], loop.pts[j * 4 + 1], 0).applyMatrix4(m).project(camera);
        inner += `L${((tmp.x + 1) * 0.5 * width).toFixed(1)} ${((1 - tmp.y) * 0.5 * height).toFixed(1)}`;
      }
      this.paths[li].setAttribute('d', `${outer}${inner}Z`);
    });
  }

  /** Screen position (px) of a disc-plane point, through the last project() transform. */
  toScreen(x: number, y: number, camera: THREE.Camera, width: number, height: number): [number, number] {
    tmp.set(x, y, 0).applyMatrix4(this.matrix).project(camera);
    return [(tmp.x + 1) * 0.5 * width, (1 - tmp.y) * 0.5 * height];
  }

  show(v: boolean) {
    this.svg.style.visibility = v ? 'visible' : 'hidden';
  }

  get visible() {
    return this.svg.style.visibility !== 'hidden';
  }

  dispose() {
    this.paths.forEach((p) => p.remove());
  }
}
