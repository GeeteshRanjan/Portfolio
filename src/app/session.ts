/**
 * Cross-page session state (kept outside React so engines can read it
 * synchronously during mount).
 */
export const session = {
  /** Last active gallery index, restored when returning to the gallery. */
  galleryIndex: 0,
  /** True once the first-visit preloader has run (or been skipped). */
  introDone: false,
  /** How the current page was entered. */
  arrival: 'load' as 'load' | 'from-detail' | 'from-gallery' | 'from-next',
};

type Listener = (i: number) => void;
const navListeners = new Set<Listener>();

/** Gallery "go to index" requests from the nav index. */
export const galleryNav = {
  request(i: number) {
    navListeners.forEach((l) => l(i));
  },
  subscribe(l: Listener) {
    navListeners.add(l);
    return () => navListeners.delete(l);
  },
};

/** Site-wide night mode, remembered across visits. Toggled from the nav; src/app/room.ts and the gallery's lamp listen. */
const nightListeners = new Set<() => void>();
const NIGHT_KEY = 'night';
export const night = {
  on: (() => { try { return localStorage.getItem(NIGHT_KEY) === '1'; } catch { return false; } })(),
  set(on: boolean) {
    night.on = on;
    try { localStorage.setItem(NIGHT_KEY, on ? '1' : '0'); } catch { /* storage blocked: this visit only */ }
    nightListeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    nightListeners.add(l);
    return () => { nightListeners.delete(l); };
  },
};
