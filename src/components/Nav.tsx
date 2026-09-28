import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { projects, projectUrl } from '../content/projects';
import { useTransition } from '../app/Transition';
import { galleryNav, night, session } from '../app/session';
import { HoverText } from './HoverText';
import { AskDialog } from './AskChat';
import { ui } from '../content/ui';

export function Nav() {
  const { go } = useTransition();
  const { pathname } = useLocation();
  const onGallery = pathname === '/';
  const onAbout = pathname === '/about';
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(session.galleryIndex);
  const nightOn = useSyncExternalStore(night.subscribe, () => night.on);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const onChange = (e: Event) => setActive((e as CustomEvent<number>).detail);
    window.addEventListener('gallerychange', onChange);
    return () => window.removeEventListener('gallerychange', onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  const detailSlug = pathname.startsWith('/work/') ? pathname.slice(6) : '';

  const pick = (i: number) => {
    setOpen(false);
    if (onGallery) galleryNav.request(i);
    else go(projectUrl(projects[i]), 'from-next');
  };

  return (
    <nav className="nav" ref={ref} data-open={open} data-notch={!onGallery} aria-label="Primary">
      <ul className="nav__list">
        <li>
          <a href="/" className="nav__link" data-current={onGallery} aria-current={onGallery ? 'page' : undefined} onClick={(e) => { e.preventDefault(); if (!onGallery) go('/', 'from-detail'); }} data-hover="">
            <HoverText text={ui.nav.work} />
          </a>
        </li>
        <li>
          <a href="/about" className="nav__link" data-current={onAbout} aria-current={onAbout ? 'page' : undefined} onClick={(e) => { e.preventDefault(); if (!onAbout) go('/about', 'from-detail'); }} data-hover="">
            <HoverText text={ui.nav.about} />
          </a>
        </li>
        <li>
          <button className="nav__toggle" aria-expanded={open} aria-controls="nav-index" onClick={() => setOpen((v) => !v)} data-hover="">
            <HoverText text={ui.nav.index} />
            <svg className="nav__chev" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" stroke="currentColor" strokeWidth="1.2" /></svg>
          </button>
          <div className="nav__panel" id="nav-index" role="menu" aria-hidden={!open}>
            {projects.map((p, i) => {
              const isActive = onGallery ? i === active : p.slug === detailSlug;
              return (
                <button key={p.slug} role="menuitem" tabIndex={open ? 0 : -1} className="nav__item" data-active={isActive} onClick={() => pick(i)}>
                  <span>{p.title}</span>
                  <span className="eyebrow">{p.year}</span>
                </button>
              );
            })}
          </div>
        </li>
        <li>
          <AskDialog />
        </li>
        <li>
          <button className="nav__link" aria-pressed={nightOn} onClick={() => night.set(!nightOn)} data-hover="">
            <HoverText text={ui.nav.night} />
          </button>
        </li>
      </ul>
    </nav>
  );
}
