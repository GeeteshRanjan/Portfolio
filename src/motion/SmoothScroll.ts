import Lenis from 'lenis';
import { gsap, ScrollTrigger, prefersReducedMotion } from './tokens';

/**
 * Lenis smooth scrolling wired into the GSAP ticker so ScrollTrigger scrubs
 * stay in lockstep with the eased scroll position (reference: lerp .165,
 * wheelMultiplier 1.25, disabled easing on coarse pointers).
 */
let lenis: Lenis | null = null;
let tick: ((t: number) => void) | null = null;

export function startSmoothScroll() {
  if (lenis) return lenis;
  const coarse = matchMedia('(pointer: coarse)').matches;
  lenis = new Lenis({
    lerp: coarse || prefersReducedMotion() ? 1 : 0.165,
    wheelMultiplier: coarse ? 1 : 1.25,
    touchMultiplier: 1,
    allowNestedScroll: true,
  });
  lenis.on('scroll', ScrollTrigger.update);
  tick = (t) => lenis?.raf(t * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

export function getLenis() {
  return lenis;
}

export function scrollToTop() {
  window.scrollTo(0, 0);
  lenis?.scrollTo(0, { immediate: true, force: true });
}

export function stopScroll() {
  lenis?.stop();
}
export function resumeScroll() {
  lenis?.start();
}

/** True when the (eased) scroll position has reached the bottom. */
export function atScrollEnd(tolerance = 2) {
  if (lenis && typeof lenis.limit === 'number') {
    const target = typeof lenis.targetScroll === 'number' ? lenis.targetScroll : lenis.scroll;
    return target >= lenis.limit - tolerance;
  }
  return window.scrollY >= document.documentElement.scrollHeight - innerHeight - tolerance;
}
