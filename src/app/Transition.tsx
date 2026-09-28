import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { gsap, DUR, EASE, LIGHTS, prefersReducedMotion } from '../motion/tokens';
import { scrollToTop, stopScroll, resumeScroll } from '../motion/SmoothScroll';
import { ScrollTrigger } from '../motion/tokens';
import { night, session } from './session';

/**
 * Page transition orchestrator (Barba-style, on top of react-router).
 * A page registers a `leave` handler that plays its own exit (e.g. the disc
 * press/shrink). `go()` awaits it, fades the page container, swaps routes,
 * then the new page fades in and runs its own entrance.
 */

type Leave = (to: string) => Promise<void> | void;

interface Ctx {
  go: (to: string, arrival?: typeof session.arrival) => void;
  setLeave: (fn: Leave | null) => void;
  busy: () => boolean;
}

const TransitionCtx = createContext<Ctx | null>(null);

export function TransitionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const leaveRef = useRef<Leave | null>(null);
  const busyRef = useRef(false);
  const lightsRef = useRef<HTMLDivElement>(null);
  const lightsOut = useRef(false);

  const setLeave = useCallback((fn: Leave | null) => { leaveRef.current = fn; }, []);

  const go = useCallback(async (to: string, arrival: typeof session.arrival = 'from-gallery') => {
    if (busyRef.current || to === location.pathname) return;
    busyRef.current = true;
    stopScroll();
    try {
      await leaveRef.current?.(to);
      const main = document.querySelector('main');
      if (main && !prefersReducedMotion()) {
        const fade = gsap.to(main, { autoAlpha: 0, duration: DUR.pageFade, ease: 'main' });
        // At night the whole room (nav included) goes dark with the page; it comes back on after the swap.
        const lights = lightsRef.current;
        if (night.on && lights) {
          lightsOut.current = true;
          gsap.killTweensOf(lights);
          gsap.fromTo(lights, { autoAlpha: 0, backgroundColor: LIGHTS.off }, { autoAlpha: 1, duration: DUR.pageFade, ease: EASE.exit });
        }
        await fade;
      }
    } catch (e) {
      console.warn(e);
    }
    leaveRef.current = null;
    session.arrival = arrival;
    navigate(to);
  }, [location.pathname, navigate]);

  // After each route swap: reset scroll, refresh triggers, release the lock.
  useEffect(() => {
    scrollToTop();
    resumeScroll();
    // Lights back on: a beat of dark, then an ember glow that warms and clears, like the lamp's filament.
    const lights = lightsRef.current;
    if (lightsOut.current && lights) {
      lightsOut.current = false;
      gsap.timeline({ delay: LIGHTS.hold })
        .to(lights, { backgroundColor: LIGHTS.ember, autoAlpha: 0.72, duration: 0.22, ease: 'power1.in' })
        .to(lights, { backgroundColor: LIGHTS.warm, autoAlpha: 0, duration: 0.7, ease: EASE.settle });
    }
    requestAnimationFrame(() => {
      ScrollTrigger.refresh();
      busyRef.current = false;
    });
  }, [location.pathname]);

  return (
    <TransitionCtx.Provider value={{ go, setLeave, busy: () => busyRef.current }}>
      {children}
      <div ref={lightsRef} className="lights" aria-hidden="true" />
    </TransitionCtx.Provider>
  );
}

export function useTransition() {
  const v = useContext(TransitionCtx);
  if (!v) throw new Error('useTransition outside provider');
  return v;
}

/** Fade the page's <main> in on mount. */
export function usePageEnter(ref: React.RefObject<HTMLElement | null>, delay = 0) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) { gsap.set(el, { autoAlpha: 1 }); return; }
    const t = gsap.fromTo(el, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.6, delay, ease: 'main' });
    return () => { t.kill(); };
  }, [ref, delay]);
}
