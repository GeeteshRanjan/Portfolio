import { gsap, SplitText, EASE, DUR, STAGGER } from './tokens';

/**
 * Line-masked text swap for content tied to the active object.
 *
 * hidden ──reveal──▶ revealing ──▶ visible ──change──▶ hiding ──▶ hidden
 *              ▲                 │ change mid-reveal: reverse at 1.6×
 *              └─────────────────┘
 *
 * Content is only written while hidden, after the source has settled for
 * `settleDelay` ms (longer while dragging), so rapid scrubbing never flashes
 * intermediate content. Lines slide ±120% inside overflow masks; rules draw
 * from the left and retract to the right (REFERENCE_ANALYSIS.md §5).
 */

interface Entry {
  el: HTMLElement;
  kind: 'text' | 'rule';
  group: number;
  mask: HTMLElement | null;
  split: SplitText | null;
  lines: HTMLElement[];
  restHeight: number;
}

export interface TextTransitionOptions {
  write: () => void;
  isDragging: () => boolean;
  canReveal: () => boolean;
  reduced: boolean;
  settleDelay?: number;
  dragRevealCap?: number;
}

export class TextTransition {
  private entries: Entry[] = [];
  private state: 'hidden' | 'revealing' | 'visible' | 'hiding' = 'hidden';
  private outTl: gsap.core.Timeline | null = null;
  private inTl: gsap.core.Timeline | null = null;
  private lastChange = 0;
  private poll = 0;
  private dirty = true;
  private disposed = false;

  constructor(root: HTMLElement, private o: TextTransitionOptions) {
    root.querySelectorAll<HTMLElement>('[data-tt], [data-tt-rule]').forEach((el) => {
      const group = Number(el.closest('[data-tt-group]')?.getAttribute('data-tt-group') ?? 0);
      const kind = el.hasAttribute('data-tt-rule') ? 'rule' : 'text';
      this.entries.push({ el, kind, group, mask: kind === 'text' ? (el.closest('[data-tt-mask]') as HTMLElement) : null, split: null, lines: [], restHeight: 0 });
    });
    this.entries.sort((a, b) => a.group - b.group);
    if (o.reduced) {
      o.write();
      this.state = 'visible';
      this.dirty = false;
      return;
    }
    this.entries.forEach((e) => (e.kind === 'rule' ? gsap.set(e.el, { scaleX: 0, transformOrigin: 'left center' }) : gsap.set(e.el, { autoAlpha: 0 })));
    this.lastChange = performance.now();
    this.schedule(o.settleDelay ?? 100);
  }

  /** The source changed (new active item). */
  change() {
    if (this.disposed) return;
    this.dirty = true;
    this.lastChange = performance.now();
    if (this.o.reduced) { this.o.write(); this.dirty = false; return; }
    this.hide();
    this.schedule();
  }

  /** Re-check reveal eligibility (e.g. intro finished). */
  nudge() {
    this.schedule(0);
  }

  private schedule(ms = 40) {
    clearTimeout(this.poll);
    this.poll = window.setTimeout(() => this.tick(), ms);
  }

  private tick() {
    if (this.disposed) return;
    if (this.state === 'hidden' && !this.outTl && this.o.canReveal()) {
      const wait = this.o.isDragging() ? this.o.dragRevealCap ?? 500 : this.o.settleDelay ?? 100;
      if (performance.now() - this.lastChange >= wait && !this.o.isDragging()) { this.reveal(); return; }
      if (this.o.isDragging() && performance.now() - this.lastChange >= (this.o.dragRevealCap ?? 500) && this.dirty) { this.reveal(); return; }
    }
    if (this.state !== 'visible') this.schedule();
  }

  private splitLines(e: Entry) {
    this.unsplit(e);
    if (!e.el.textContent?.trim()) { e.lines = [e.el]; return; }
    try {
      const s = new SplitText(e.el, { type: 'lines', linesClass: 'tt-line', mask: 'lines' });
      e.split = s;
      e.lines = s.lines as HTMLElement[];
      if (!e.lines.length) { s.revert(); e.split = null; e.lines = [e.el]; }
    } catch {
      e.lines = [e.el];
    }
  }

  private unsplit(e: Entry) {
    if (e.split) { try { e.split.revert(); } catch { /* ignore */ } }
    e.split = null;
    e.lines = [];
  }

  private masks() {
    return this.entries.filter((e) => e.mask) as (Entry & { mask: HTMLElement })[];
  }

  private hide() {
    if (this.state === 'hidden' || this.state === 'hiding') return;
    if (this.state === 'revealing' && this.inTl) {
      // Reverse the in-flight reveal rather than stacking a second animation.
      const tl = this.inTl;
      this.inTl = null;
      this.outTl = tl;
      this.state = 'hiding';
      tl.eventCallback('onComplete', null);
      tl.eventCallback('onReverseComplete', () => this.hidden());
      tl.timeScale(1.6).reverse();
      return;
    }
    this.state = 'hiding';
    this.masks().forEach((e) => { if (!e.mask.style.height) e.mask.style.height = `${e.restHeight || e.mask.offsetHeight}px`; });
    const tl = gsap.timeline({ onComplete: () => this.hidden() });
    this.entries.forEach((e, i) => {
      const at = i * STAGGER.itemOut;
      if (e.kind === 'rule') {
        tl.to(e.el, { scaleX: 0, transformOrigin: 'right center', duration: DUR.textOut, ease: EASE.glide, overwrite: 'auto' }, at);
        return;
      }
      if (!e.lines.length) this.splitLines(e);
      gsap.set(e.el, { autoAlpha: 1 });
      tl.to(e.lines, { yPercent: -120, duration: DUR.textOut, ease: EASE.glide, stagger: STAGGER.lineOut, overwrite: 'auto' }, at);
    });
    this.outTl = tl;
  }

  private hidden() {
    this.outTl?.kill();
    this.outTl = null;
    this.entries.forEach((e) => {
      if (e.kind === 'rule') return;
      gsap.set(e.el, { autoAlpha: 0 });
      this.unsplit(e);
    });
    this.state = 'hidden';
    this.schedule();
  }

  private reveal() {
    this.state = 'revealing';
    this.dirty = false;
    // Freeze mask heights so new content can animate from the old height.
    this.masks().forEach((e) => { if (!e.mask.style.height) e.mask.style.height = `${e.restHeight || e.mask.offsetHeight}px`; });
    this.o.write();
    this.entries.forEach((e) => {
      if (e.kind === 'rule') { gsap.set(e.el, { scaleX: 0, transformOrigin: 'left center' }); return; }
      this.splitLines(e);
      gsap.set(e.lines, { yPercent: 120 });
      gsap.set(e.el, { autoAlpha: 1 });
    });
    const masks = this.masks();
    const frozen = masks.map((e) => e.mask.style.height);
    masks.forEach((e) => (e.mask.style.height = 'auto'));
    const natural = masks.map((e) => e.mask.offsetHeight);
    masks.forEach((e, i) => (e.mask.style.height = frozen[i]));

    const tl = gsap.timeline({ onComplete: () => this.visible() });
    masks.forEach((e, i) => {
      const from = parseFloat(e.mask.style.height);
      if (!Number.isFinite(from) || Math.abs(from - natural[i]) < 0.5) { e.mask.style.height = ''; return; }
      tl.to(e.mask, { height: natural[i], duration: DUR.mask, ease: EASE.glide, overwrite: 'auto' }, 0);
    });
    let at = 0;
    let group = this.entries[0]?.group ?? 0;
    this.entries.forEach((e) => {
      if (e.group !== group) { group = e.group; at += STAGGER.groupGap; }
      if (e.kind === 'rule') tl.to(e.el, { scaleX: 1, duration: DUR.textIn, ease: EASE.glide, overwrite: 'auto' }, at);
      else tl.to(e.lines, { yPercent: 0, duration: DUR.textIn, ease: EASE.glide, stagger: STAGGER.lineIn, overwrite: 'auto' }, at);
      at += STAGGER.itemIn;
    });
    this.inTl = tl;
  }

  private visible() {
    this.inTl?.kill();
    this.inTl = null;
    this.entries.forEach((e) => {
      if (e.kind !== 'rule') this.unsplit(e);
      gsap.set(e.el, { clearProps: 'opacity,visibility,transform' });
    });
    this.masks().forEach((e) => { e.mask.style.height = ''; e.restHeight = e.mask.offsetHeight; });
    this.state = 'visible';
    if (this.dirty) this.change();
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.poll);
    this.outTl?.kill();
    this.inTl?.kill();
    this.entries.forEach((e) => { this.unsplit(e); gsap.set(e.el, { clearProps: 'all' }); if (e.mask) e.mask.style.height = ''; });
  }
}
