import { gsap } from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

gsap.registerPlugin(CustomEase, ScrollTrigger, SplitText);

/**
 * Central motion vocabulary. Curves and durations are taken from the
 * reference (see reference/REFERENCE_ANALYSIS.md §8).
 */
export const EASE = {
  /** Carousel steps, text lines, masks: fast start, long settle. */
  glide: CustomEase.create('glide', '0.32, 0.72, 0, 1'),
  /** Default UI curve. */
  main: CustomEase.create('main', '0.625, 0.05, 0, 1'),
  pressIn: 'power2.out',
  exit: 'power2.in',
  settle: 'power3.out',
  flip: 'power3.inOut',
} as const;

export const DUR = {
  fast: 0.25,
  press: 0.12,
  spring: 0.16,
  textOut: 0.4,
  textIn: 0.7,
  mask: 0.5,
  step: 0.46,
  flip: 0.75,
  fan: 0.85,
  exit: 0.55,
  pop: 1.05,
  spinReset: 1.2,
  pageFade: 0.4,
} as const;

export const STAGGER = {
  lineIn: 0.05,
  lineOut: 0.016,
  itemIn: 0.035,
  itemOut: 0.016,
  groupGap: 0.06,
} as const;

/** Night page change (src/app/Transition.tsx): lights out with the page fade, then a filament-style warm-up. */
export const LIGHTS = {
  off: '#000000',
  ember: '#3a1605',
  warm: '#6b3c16',
  /** Seconds of dark before the warm-up starts. */
  hold: 0.12,
} as const;

gsap.defaults({ ease: EASE.main, duration: 0.6 });

export const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => reducedMotionQuery.matches;
export const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
export const touchLayoutQuery = window.matchMedia('(max-width: 991px)');

export { gsap, ScrollTrigger, SplitText, CustomEase };
