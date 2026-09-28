import { GALLERY as C } from './config';

/**
 * Converts raw wheel/trackpad streams into discrete "step" intents.
 * One physical gesture yields one step; trackpad momentum tails are absorbed.
 * A new step inside an ongoing gesture needs a pause, a distinct tick, a
 * rising flick or sustained pressure (REFERENCE_ANALYSIS.md §5, Wheel).
 */
export class WheelIntent {
  private armed = true; // ready to emit on this gesture
  private rising = false; // armed by a flick: count only the excess over the envelope
  private accum = 0;
  private dir = 0;
  private envelope = 0;
  private peak = 0;
  private sinceStepEvents = 0;
  private lastStepAt = 0;
  private lastEventAt = 0;
  private hasLast = false;
  private idleTimer = 0;

  constructor(private onStep: (dir: 1 | -1) => void) {}

  reset() {
    clearTimeout(this.idleTimer);
    this.idleTimer = 0;
    this.armed = true;
    this.rising = false;
    this.accum = 0;
    this.dir = 0;
    this.envelope = 0;
    this.peak = 0;
    this.sinceStepEvents = 0;
    this.lastStepAt = 0;
    this.hasLast = false;
  }

  /** Normalised dominant-axis delta in px. */
  static delta(e: WheelEvent) {
    let x = e.deltaX, y = e.deltaY;
    if (e.deltaMode === 1) { x *= 16; y *= 16; } else if (e.deltaMode === 2) { x *= innerWidth; y *= innerHeight; }
    return Math.abs(x) > Math.abs(y) * 1.25 ? x : y;
  }

  push(e: WheelEvent) {
    const d = WheelIntent.delta(e);
    const mag = Math.abs(d);
    const now = performance.now();
    const gap = this.hasLast ? now - this.lastEventAt : Infinity;
    this.lastEventAt = now;
    this.hasLast = true;
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.reset(), C.wheelIdleReset);

    const decay = gap === Infinity ? 0 : Math.exp(-gap / C.wheelEnvelopeTau);
    const env = this.envelope * decay;
    if (mag < C.wheelNoiseFloor) { this.envelope = env; return; }
    const risingNow = mag > env * C.wheelRiseFactor;
    this.envelope = Math.max(mag, env);

    if (!this.armed) {
      this.sinceStepEvents += 1;
      this.peak = Math.max(this.peak, mag);
      const sinceStep = now - this.lastStepAt;
      const paused = gap >= C.wheelPauseGap;
      const tick = gap >= C.wheelTickGap && this.sinceStepEvents <= 2 && sinceStep >= C.wheelMinStepTick && mag >= this.peak * C.wheelTickRatio;
      const flick = risingNow && sinceStep >= C.wheelMinStepFlick;
      const sustain = sinceStep >= C.wheelSustainDelay && this.envelope >= this.peak * C.wheelSustainRatio;
      if (!(paused || tick || flick || sustain)) return;
      this.armed = true;
      this.accum = 0;
      this.dir = 0;
      this.rising = !(paused || tick || sustain);
    }
    const dir = d > 0 ? 1 : -1;
    if (dir !== this.dir) { this.accum = 0; this.dir = dir; }
    const contribution = this.rising ? Math.max(0, mag - env) : mag;
    this.accum += Math.min(contribution, C.wheelEventCap);
    if (this.accum < C.wheelStepThreshold) return;
    // Emit and disarm until the gesture qualifies for another step.
    this.armed = false;
    this.rising = false;
    this.accum = 0;
    this.lastStepAt = now;
    this.sinceStepEvents = 0;
    this.peak = mag;
    this.onStep(dir as 1 | -1);
  }

  dispose() {
    clearTimeout(this.idleTimer);
  }
}
