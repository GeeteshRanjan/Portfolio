import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Project } from '../content/types';
import { ui, fill } from '../content/ui';
import { gsap, EASE, prefersReducedMotion } from '../motion/tokens';
import { stopScroll, resumeScroll } from '../motion/SmoothScroll';

type Game = NonNullable<Project['game']>;

/**
 * Width (CSS px) the game should believe its screen is, in the rail and enlarged.
 * The game sizes its text/HUD as a share of its own width with px minimums, so a
 * 700px frame renders it like a 700px screen: tiny type. CSS `zoom` on the iframe
 * propagates into the game like browser zoom (smaller viewport, higher
 * devicePixelRatio), so the game lays out for this width and still renders sharp.
 * Below ~580 the game switches to its narrow layout (full-width buttons, oversized
 * type), so stay above that. Enlarged uses the same width, so Enlarge magnifies the
 * same layout (text and all) instead of re-laying it out for a bigger screen.
 */
const RAIL_VIEWPORT = 600;
/** Smallest zoom a `viewport`-sized web app is shown at before it gets its own mobile layout. */
const MIN_ZOOM = 0.6;
const canZoom = typeof CSS !== 'undefined' && CSS.supports('zoom', '2');

/**
 * A playable iframe in the same late-90s browser window as the website previews.
 *
 * Play: a click-to-play cover keeps wheel/touch scrolling on the page until the visitor
 * opts in; clicking it focuses the frame so the game's keyboard listeners (on its own
 * window) get the keys. When focus comes back to this page the cover returns.
 *
 * Enlarge: the window itself goes `position: fixed` (never re-parented, which would
 * reload the iframe) and FLIPs from its slot to the centre of the screen over a
 * fading backdrop; shrinking plays the same move backwards. The slot keeps its height
 * so the page doesn't jump underneath.
 */
export function GameEmbed({ game, bg }: { game: Game; bg: string }) {
  const slot = useRef<HTMLDivElement>(null);
  const win = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const sizeBtn = useRef<HTMLButtonElement>(null);
  const first = useRef<DOMRect | null>(null);
  const [state, setState] = useState<'idle' | 'playing' | 'paused'>('idle');
  const [big, setBig] = useState(false);
  // The iframe only exists after the visitor asks for it. The game focuses its own
  // Start button on load, which scrolls the page to the frame and takes the keyboard,
  // so loading it with the page opened the page halfway down.
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (state !== 'playing') return;
    // The game focusing its own buttons bounces focus through this window (focus, then
    // straight back to the frame), so only pause if focus actually stayed out here.
    let t = 0;
    const back = () => {
      clearTimeout(t);
      t = window.setTimeout(() => { if (document.activeElement !== frame.current) setState('paused'); }, 60);
    };
    window.addEventListener('focus', back);
    return () => { clearTimeout(t); window.removeEventListener('focus', back); };
  }, [state]);

  const play = () => {
    setState('playing');
    if (frame.current) frame.current.focus();
    else setLoaded(true); // focused in onLoad
  };

  // Scrolled out of view (and not enlarged): unload back to the poster, so the running
  // game can't pull the page back to itself when it focuses its next card.
  useEffect(() => {
    if (!loaded || big) return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) return;
      setLoaded(false);
      setState('idle');
    });
    io.observe(slot.current!);
    return () => io.disconnect();
  }, [loaded, big]);

  const toggle = (next: boolean) => {
    if (next === big) return;
    const el = win.current!, view = el.querySelector<HTMLElement>('.game__view')!;
    first.current = el.getBoundingClientRect();
    // Window chrome around the 16:9 view, so CSS can fit the enlarged window to the screen.
    el.style.setProperty('--chrome', `${el.offsetHeight - view.offsetHeight}px`);
    el.style.setProperty('--chrome-x', `${el.offsetWidth - view.offsetWidth}px`);
    // Hold the slot open while the window is lifted out of the flow.
    if (next) slot.current!.style.height = `${slot.current!.offsetHeight}px`;
    setBig(next);
  };

  // FLIP between the slot and the centred, enlarged window.
  useLayoutEffect(() => {
    const from = first.current;
    if (!from) return;
    first.current = null;
    const el = win.current!, root = document.documentElement;
    const done = () => {
      gsap.set(el, { clearProps: 'transform,zIndex' });
      if (!big) { slot.current!.style.height = ''; root.removeAttribute('data-game-big'); }
      else play();
    };
    if (big) { root.setAttribute('data-game-big', ''); stopScroll(); } else resumeScroll();
    if (prefersReducedMotion()) {
      gsap.set(backdrop.current, { autoAlpha: big ? 1 : 0 });
      done();
      return;
    }
    const to = el.getBoundingClientRect();
    gsap.killTweensOf([el, backdrop.current]);
    // Above the backdrop for the whole move, including the way back into the slot.
    gsap.set(el, { zIndex: 3 });
    gsap.fromTo(el,
      { x: from.left - to.left, y: from.top - to.top, scaleX: from.width / to.width, scaleY: from.height / to.height, transformOrigin: '0 0' },
      { x: 0, y: 0, scaleX: 1, scaleY: 1, duration: big ? 0.85 : 0.7, ease: EASE.glide, onComplete: done });
    gsap.to(backdrop.current, { autoAlpha: big ? 1 : 0, duration: big ? 0.5 : 0.45, ease: big ? EASE.settle : EASE.exit });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big]);

  // Escape (while focus is on this page, not inside the game) and leaving the page both shrink it.
  useEffect(() => {
    if (!big) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { toggle(false); sizeBtn.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [big]);
  useEffect(() => () => { document.documentElement.removeAttribute('data-game-big'); resumeScroll(); }, []);

  // Zoom the frame so the game always lays out for RAIL_VIEWPORT (never below zoom 1).
  // Zoom scales the element's box and offsets too, so size and inset are divided by it.
  useLayoutEffect(() => {
    const f = frame.current;
    if (!f) return;
    const view = f.parentElement!;
    const fit = () => {
      const w = view.clientWidth - 4, h = view.clientHeight - 4;
      if (w <= 0 || h <= 0) return;
      // A web app (`viewport` set) may be zoomed down to show its desktop layout, but not
      // below MIN_ZOOM: on phones it gets zoom 1 and its own narrow layout instead.
      const vp = game.viewport ?? RAIL_VIEWPORT, z0 = w / vp;
      const z = !canZoom ? 1 : z0 >= (game.viewport ? MIN_ZOOM : 1) ? z0 : 1;
      Object.assign(f.style, { zoom: String(z), left: `${2 / z}px`, top: `${2 / z}px`, width: `${w / z}px`, height: `${h / z}px` });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(view);
    return () => ro.disconnect();
  }, [big, loaded, game.viewport]);

  return (
    <div className="game" data-state={state} style={{ ['--game-bg' as string]: bg }}>
      <div ref={backdrop} className="game__backdrop" onClick={() => toggle(false)} aria-hidden="true" />
      <div ref={slot} className="game__slot">
        {/* Night: the screen lights the desk behind the window (CSS .screen-glow). */}
        <span className="screen-glow" aria-hidden="true" style={{ ['--glow-bg' as string]: game.poster ? `url(${JSON.stringify(game.poster)})` : bg }} />
        <div
          ref={win}
          className="game__win"
          data-big={big ? '' : undefined}
          role={big ? 'dialog' : undefined}
          aria-modal={big ? true : undefined}
          aria-label={big ? game.title : undefined}
        >
          <div className="site__toolbar">
            <span className="site__label" aria-hidden="true">{ui.detail.address}</span>
            <span className="site__field" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.25" stroke="currentColor" /><path d="M1.75 8h12.5M8 1.75c2 2 2 10.5 0 12.5M8 1.75c-2 2-2 10.5 0 12.5" stroke="currentColor" /></svg>
              <span className="site__href">{game.src}</span>
            </span>
            <button ref={sizeBtn} type="button" className="site__btn game__btn" onClick={() => toggle(!big)} aria-pressed={big}>
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true">
                {big
                  ? <path d="M5 1v4H1M7 11V7h4M5 5L1.5 1.5M7 7l3.5 3.5" stroke="currentColor" strokeWidth="1.2" />
                  : <path d="M1 5V1h4M11 7v4H7M1 1l3.5 3.5M11 11L7.5 7.5" stroke="currentColor" strokeWidth="1.2" />}
              </svg>
              {big ? ui.detail.shrink : ui.detail.enlarge}
            </button>
            <a className="site__btn game__btn" href={game.src} target="_blank" rel="noopener noreferrer" aria-label={fill(ui.detail.newTabLabel, { title: game.title })}>
              {ui.detail.newTab}
              <svg viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M3 9l6-6M4 3h5v5" stroke="currentColor" strokeWidth="1.2" /></svg>
            </a>
          </div>
          <div className="site__view game__view">
            {game.poster && !loaded ? <img className="game__poster" src={game.poster} alt="" loading="lazy" decoding="async" /> : null}
            {loaded ? (
              <iframe
                ref={frame}
                src={game.src}
                title={game.title}
                allow="autoplay; fullscreen; gamepad"
                referrerPolicy="strict-origin-when-cross-origin"
                // Reached through the cover button, so Tab can't land in a covered frame.
                tabIndex={state === 'playing' ? 0 : -1}
                onLoad={() => { if (stateRef.current === 'playing') frame.current?.focus(); }}
              />
            ) : null}
            {state !== 'playing' ? (
              <button type="button" className="game__cover" onClick={play} aria-label={game.prompt ? `${game.prompt}: ${game.title}` : fill(ui.detail.playLabel, { title: game.title })}>
                <span className="game__prompt body-s">{state === 'paused' ? ui.detail.resume : game.prompt ?? ui.detail.play}</span>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {game.keys?.length ? (
        <dl className="game__keys">
          {game.keys.map((row) => {
            const m = /^([^:]+):\s*(.+)$/.exec(row);
            return (
              <div key={row}>
                <span className="rule" />
                <dt className="eyebrow">{m ? m[1] : ''}</dt>
                <dd className="body-s">{m ? m[2] : row}</dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}
