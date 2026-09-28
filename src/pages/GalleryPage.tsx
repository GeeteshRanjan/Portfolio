import { useEffect, useRef, useState } from 'react';
import { projects, projectUrl, site } from '../content/projects';
import type { Project } from '../content/types';
import { DiscGallery } from '../three/DiscGallery';
import { TextTransition } from '../motion/TextTransition';
import { runPreloader } from '../motion/Preloader';
import { gsap, SplitText, EASE, prefersReducedMotion } from '../motion/tokens';
import { useTransition } from '../app/Transition';
import { galleryNav, night, session } from '../app/session';
import { ui, fill } from '../content/ui';

function setLines(el: Element | null, value: string | string[]) {
  if (!el) return;
  el.replaceChildren();
  (Array.isArray(value) ? value : [value]).forEach((v, i) => {
    if (i) el.append(document.createElement('br'));
    el.append(document.createTextNode(v));
  });
}

/** Writes the active project into the panel. Runs only while text is hidden. */
function writePanel(root: HTMLElement, p: Project) {
  const q = (f: string) => root.querySelector(`[data-field="${f}"]`);
  setLines(q('title'), p.panelTitle || p.title);
  for (let i = 0; i < 3; i++) {
    const row = p.metadata[i];
    setLines(q(`label-${i}`), row?.label ?? '');
    setLines(q(`value-${i}`), row?.value ?? '');
  }
}

/** Hover note arrow (shaft, head). The tip sits at the SVG origin, which is placed on the disc's note anchor. */
const ARROW = ['M64 70C68 44 48 16 2 2', 'M10 10L2 2L13 0'];
/** Noise seeds for the three "takes" of the note; CSS cycles them at 10 fps so it boils like the scribble. */
const TAKES = [1, 2, 3];
/** Matches the `.note` hide transition; a note replacing one still on screen waits this long. */
const NOTE_OUT = 200;
/** The carousel must be landing this long before the note is written, so gaps in a wheel burst don't flash it. */
const NOTE_SETTLE = 60;
/** Gallery intro (bottom-left): the tagline, one sentence per row. */
const taglineRows = (site.tagline ?? '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/**
 * Per-letter tilt, wandering (slightly rising) baseline and uneven spacing, so the font reads
 * as a real hand. Seeded by the text, so a note is always written the same way.
 */
function handwrite(text: string) {
  let seed = [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 2147483647, 11) || 1;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  let wander = 0;
  const letters = Array.from(text, () => {
    const next = wander * 0.7 + rand() * 2;
    const dy = next - wander - 0.3; // relative to the previous letter
    wander = next;
    return [rand() * 1.4, dy, rand() * 6];
  });
  const list = (k: number) => letters.map((l) => l[k].toFixed(1)).join(' ');
  return { dx: list(0), dy: list(1), rotate: list(2) };
}

export function GalleryPage() {
  const hostRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<SVGSVGElement>(null);
  const [announce, setAnnounce] = useState('');
  const { go, setLeave } = useTransition();

  useEffect(() => {
    const host = hostRef.current!, canvas = canvasRef.current!, svg = svgRef.current!, copy = copyRef.current!;
    const reduced = prefersReducedMotion();
    // The counter intro only plays when the gallery is the first page loaded.
    const firstVisit = !session.introDone && session.arrival === 'load';
    const intro: 'preloader' | 'fan' | 'none' = reduced ? 'none' : firstVisit ? 'preloader' : 'fan';
    let copyAllowed = intro === 'none';
    let cancelled = false;
    // Static intro (tagline lines): hidden until the copy is released, then the lines rise once, staggered.
    const introEls = Array.from(copy.querySelectorAll<HTMLElement>('[data-intro]'));
    let introSplit: SplitText | null = null;
    let introTween: gsap.core.Tween | null = null;
    if (!reduced) gsap.set(introEls, { autoAlpha: 0 });
    const release = () => {
      copyAllowed = true;
      text.nudge();
      if (!cancelled) setNote(noteAt);
      if (reduced || introSplit || cancelled || !introEls.length) return;
      introSplit = new SplitText(introEls, { type: 'lines', mask: 'lines', linesClass: 'rv-line' });
      gsap.set(introEls, { autoAlpha: 1 });
      introTween = gsap.fromTo(introSplit.lines, { yPercent: 120 }, { yPercent: 0, duration: 0.8, ease: EASE.glide, stagger: 0.1, delay: 0.25 });
    };
    let announceTimer = 0;
    // Gallery note: written next to the disc in focus, if it has one, once the carousel is at rest; erased while it moves.
    const note = noteRef.current!, noteTexts = note.querySelectorAll('text');
    let noteTimer = 0, noteAt = -1, noteX = 0, unit = 0, wordsW = 0, wordsX = NaN;
    // Near the right edge the words slide left under the arrow, so they stay on screen.
    // Follows the live position (the disc may still be flying in); rounded so it only writes on change.
    const placeWords = () => {
      const x = unit ? Math.round(Math.min(50, (host.clientWidth - noteX) / unit - 10 - wordsW)) : 50;
      if (x !== wordsX) noteTexts.forEach((t) => t.setAttribute('x', String((wordsX = x))));
    };
    const writeNote = (text: string) => {
      const hand = handwrite(text);
      noteTexts.forEach((t) => {
        t.textContent = text;
        for (const [k, v] of Object.entries(hand)) t.setAttribute(k, v);
      });
      unit = note.getBoundingClientRect().width / 100; // px per viewBox unit; 0 while display: none (small screens)
      wordsW = noteTexts[0].getBBox().width;
      placeWords();
    };
    const setNote = (i: number) => {
      // Not before the intro copy is released (release() re-applies the current target).
      const text = (copyAllowed && projects[i]?.note) || '';
      const on = 'on' in note.dataset;
      clearTimeout(noteTimer);
      if (on && text === noteTexts[0].textContent) return;
      delete note.dataset.on;
      if (text) noteTimer = window.setTimeout(() => {
        writeNote(text);
        note.dataset.on = '';
      }, on ? Math.max(NOTE_OUT, NOTE_SETTLE) : NOTE_SETTLE);
    };
    // Load the hand now, so the first note isn't written in the fallback font.
    void document.fonts.load('1em "Nanum Pen Script"');
    document.documentElement.style.overflow = 'hidden';

    let gallery: DiscGallery | null = null;
    // Route the last disc open targeted. The disc press/shrink plays for any disc open
    // (including one that routes to /about), but not for plain nav links like "About".
    let openedDisc = '';
    const text = new TextTransition(copy, {
      write: () => gallery && writePanel(copy, projects[gallery.index]),
      isDragging: () => !!gallery?.isDragging,
      canReveal: () => copyAllowed && !!gallery,
      reduced,
    });

    gallery = new DiscGallery(host, canvas, svg, projects, {
      onChange: (i) => {
        session.galleryIndex = i;
        text.change();
        window.dispatchEvent(new CustomEvent('gallerychange', { detail: i }));
        clearTimeout(announceTimer);
        announceTimer = window.setTimeout(() => setAnnounce(fill(ui.gallery.announce, { title: projects[i].title, n: i + 1, total: projects.length })), 350);
      },
      onOpen: (i, e) => {
        const url = projectUrl(projects[i]);
        if (e && (e.metaKey || e.ctrlKey)) { window.open(url, '_blank', 'noopener'); return; }
        openedDisc = url;
        go(url, 'from-gallery');
      },
      onNote: (i, x, y) => {
        // -1 carries no position: the note erases where it was.
        if (i >= 0) note.style.translate = `${(noteX = x)}px ${y}px`;
        if (i !== noteAt) setNote((noteAt = i));
        if (i >= 0) placeWords();
      },
    }, { reducedMotion: reduced, startIndex: session.galleryIndex, night: night.on });

    // Night is site-wide (src/app/room.ts owns html[data-night]); the gallery only switches its lamp.
    setLeave(async (to) => {
      if (to.startsWith('/work/') || to === openedDisc) await gallery?.exitToDetail();
    });

    const unsubNav = galleryNav.subscribe((i) => gallery?.goTo(i, 'click'));
    const unsubNight = night.subscribe(() => gallery?.setNight(night.on));

    gallery.init({ intro }).then(async () => {
      if (cancelled || !gallery) return;
      if (intro === 'preloader') {
        await runPreloader(gallery.preloader(), canvas, site,
          () => document.documentElement.removeAttribute('data-preload'),
          release);
        document.documentElement.removeAttribute('data-preload');
        session.introDone = true;
      } else {
        session.introDone = true;
        document.documentElement.removeAttribute('data-preload');
        // Copy is released when the flight lock lifts (90% of the 1.05 s fan-in), as in the reference.
        window.setTimeout(release, intro === 'fan' ? 950 : 0);
      }
      host.focus({ preventScroll: true });
    }).catch((e) => {
      console.error('Gallery failed to initialise', e);
      document.documentElement.removeAttribute('data-preload');
      release();
    });

    return () => {
      cancelled = true;
      clearTimeout(announceTimer);
      clearTimeout(noteTimer);
      unsubNav();
      unsubNight();
      setLeave(null);
      text.dispose();
      introTween?.kill();
      introSplit?.revert();
      gallery?.dispose();
      gallery = null;
      document.documentElement.style.overflow = '';
    };
  }, [go, setLeave]);

  return (
    <main>
      <section
        ref={hostRef}
        className="gallery"
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={`${site.sectionLabel} gallery`}
        aria-describedby="gallery-help"
        aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Space"
        data-lenis-prevent=""
      >
        <h1 className="sr-only">{site.name} — {site.sectionLabel}</h1>
        <p id="gallery-help" className="sr-only">{ui.gallery.help}</p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">{announce}</p>
        <div ref={canvasRef} className="gallery__canvas" />
        <svg ref={svgRef} className="gallery__scribble" aria-hidden="true" />
        <div ref={copyRef} className="gallery__copy">
          <div className="info" data-tt-group="0">
            <div data-tt-mask=""><p className="info__title display-s" data-tt="" data-field="title" /></div>
            <div className="info__rows">
              {[0, 1, 2].map((i) => (
                <div className="info__row" key={i}>
                  <span data-tt-rule="" />
                  <div className="info__label" data-tt-mask=""><p className="eyebrow" data-tt="" data-field={`label-${i}`} /></div>
                  <div className="info__value" data-tt-mask=""><p className="body-m" data-tt="" data-field={`value-${i}`} /></div>
                </div>
              ))}
            </div>
          </div>
          {taglineRows.length ? (
            // Bookend to the project title top-left: one sentence per line, same display size.
            <div className="gallery__intro">
              {taglineRows.map((line, i) => (
                <p className="display-s" data-intro="" key={i}>{line}</p>
              ))}
            </div>
          ) : null}
          <svg ref={noteRef} className="note" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              {TAKES.map((s) => (
                <filter key={s} id={`note-take-${s}`}>
                  {/* A gentle wobble, then a slight bleed so the ink edges stay soft. */}
                  <feTurbulence type="fractalNoise" baseFrequency="0.04" seed={s} />
                  <feDisplacementMap in="SourceGraphic" scale="1.8" />
                  <feGaussianBlur stdDeviation="0.35" />
                </filter>
              ))}
            </defs>
            {TAKES.map((s) => (
              <g key={s} filter={`url(#note-take-${s})`}>
                <path d={ARROW[0]} pathLength={1} />
                <path d={ARROW[1]} pathLength={1} />
                <text y="104" />
              </g>
            ))}
          </svg>
        </div>
      </section>
    </main>
  );
}
