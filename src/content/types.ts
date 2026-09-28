/**
 * Content model. The interaction system only reads these fields; swapping the
 * content never requires touching motion/3D code.
 */

export interface MetaRow {
  /** Small-caps label, e.g. "Role". */
  label: string;
  /** One or more lines rendered right-aligned. */
  value: string | string[];
}

export interface ArtPalette {
  /** Label background. */
  base: string;
  /** Secondary field / gradient stop. */
  accent: string;
  /** Type colour on the label. */
  ink: string;
}

export interface Project {
  slug: string;
  /** In-app route opened from the gallery/nav instead of `/work/:slug` (e.g. "/about"). */
  href?: string;
  title: string;
  subtitle?: string;
  /** A few hand-written words shown beside the disc, with an arrow, while it is circled. Omit for none. */
  note?: string;
  /** Replaces `title` in the gallery's top-left panel only (e.g. the company name on work discs). */
  panelTitle?: string;
  category: string;
  year: string;
  /** First three rows are shown in the gallery info panel; all rows on the detail page. */
  metadata: MetaRow[];
  /**
   * Detail page body. Blank lines (`\n\n`) split paragraphs. A `## ` paragraph after
   * the lede starts a titled section (`'## The Idea\n\n…'`); a paragraph of `> ` lines
   * is a set of pull questions, set large.
   */
  description: string;
  /**
   * Optional side story shown before the description as a small, muted, ruled note
   * (e.g. "A Small Detour"), so it reads as context rather than the page's opening.
   */
  detour?: { label: string; paragraphs: string[] };
  /** Optional closing lines under the description, one line each (e.g. a two-line sign-off). */
  coda?: string[];
  links?: { label: string; href: string }[];
  /**
   * Website previews shown under the description as framed browser windows.
   * `image` is a 16:10 screenshot (e.g. 1440×900); the card opens `href` in a new tab.
   */
  previews?: { label: string; href: string; image: string; alt: string }[];
  /**
   * Live embed (a game or a web app) shown in the right rail (instead of Highlights).
   * `src` is loaded in an iframe only once the visitor clicks the cover (loading it
   * earlier let the game's own focus() scroll the page down to it); `poster` is shown
   * until then. `keys` rows are "Action: keys", e.g. "Jump: Space / ↑".
   * `viewport`: width (px) the embedded page lays out for; it is zoomed to fit the frame
   * (default 600, the game's rail layout; a web app wants its desktop width, e.g. 900).
   * `prompt`: cover text (default `ui.detail.play`, "Click to play").
   */
  game?: { label: string; src: string; title: string; poster?: string; keys?: string[]; viewport?: number; prompt?: string };
  /**
   * Disc label artwork (square image, centre hole is masked automatically).
   * When omitted a placeholder label is generated from `palette`.
   */
  image?: string;
  /** Full-bleed detail image. Placeholder generated when omitted. */
  heroImage?: string;
  palette: ArtPalette;
  /**
   * Logo printed on the disc label (generated or supplied art). `x`/`y`: its centre as a
   * fraction of the label (default 0.5, 0.78: below the hub); `width`: fraction of the label (default 0.3).
   */
  logo?: { src: string; x?: number; y?: number; width?: number };
  /** Optional per-item art adjustments (applied when drawing the label). */
  art?: {
    scale?: number; x?: number; y?: number; rotation?: number;
    /** Supplied `image` only: print metadata around the rim. Default true. */
    rim?: boolean;
    /** Supplied `image` only: print the title + category/year over the art. Default false. */
    title?: boolean;
    /** Title baseline as a fraction of label size (default 0.3) and tilt in radians (default -0.04). */
    titleY?: number;
    titleTilt?: number;
    /** Text printed on the disc instead of `title` (disc label only). */
    titleText?: string;
  };
}

export interface SiteContent {
  name: string;
  /** Short wordmark for nav/preloader. */
  mark: string;
  sectionLabel: string;
  /** Gallery intro, bottom-left: one line per sentence. Omit to hide. */
  tagline?: string;
  sinceYear: number;
  nextLabel: string;
  continueHint: string;
  /** Browser tab title and search/social description (injected into index.html). */
  meta: { title: string; description: string };
}

/** Small interface strings. `{token}` placeholders are filled in by the component. */
export interface UiContent {
  nav: { work: string; about: string; index: string; ask: string; night: string; homeLabel: string };
  gallery: { help: string; announce: string };
  detail: {
    sectionLabel: string; websiteOne: string; websiteMany: string;
    address: string; go: string; done: string; visitSite: string; visitLabel: string;
    play: string; resume: string; playLabel: string;
    enlarge: string; shrink: string; newTab: string; newTabLabel: string;
  };
  about: {
    basedIn: string; status: string; email: string; bioLabel: string;
    experience: string; skills: string; education: string; recognition: string; contact: string;
  };
}

/** "Ask about me" chat copy (About page) and the messages its server returns. */
export interface AssistantContent {
  label: string;
  greeting: string;
  placeholder: string;
  suggestions: string[];
  ui: {
    note: string; clear: string; close: string; thinking: string; ask: string; stop: string;
    inputLabel: string; sendLabel: string; stopLabel: string; youAsked: string; answer: string;
    suggestionsLabel: string; logLabel: string;
  };
  errors: {
    unavailable: string; empty: string; generic: string; notConfigured: string; tooMany: string;
    invalid: string; quota: string; busy: string; cutOff: string;
  };
}

/** Bot-only knowledge (never shown on the site). */
export interface KnowledgeContent {
  /** Extra facts, one per string. */
  notes: string[];
  /** System prompt rules. Tokens: {name}, {first}, {email}. The site knowledge is appended after it. */
  instructions: string;
}

export interface Link {
  label: string;
  href: string;
}

export interface ExperienceItem {
  role: string;
  company: string;
  /** Free text, e.g. "2023 — Present". */
  period: string;
  location?: string;
  /** One or two sentences on scope and impact. */
  summary?: string;
  href?: string;
}

export interface EducationItem {
  degree: string;
  school: string;
  period: string;
  note?: string;
}

export interface RecognitionItem {
  title: string;
  issuer: string;
  year: string;
}

export interface AboutContent {
  /** Short role line under the name, e.g. "Frontend Engineer". */
  headline: string;
  location?: string;
  /** e.g. "Open to full-time roles". Omit to hide. */
  availability?: string;
  /** One-sentence positioning statement, shown large. */
  intro: string;
  /** Bio paragraphs. */
  bio: string[];
  /** Portrait photo. Place the file in /public and reference it as "/images/…". */
  portrait?: { src: string; alt: string };
  experience: ExperienceItem[];
  skills: { group: string; items: string[] }[];
  education?: EducationItem[];
  recognition?: RecognitionItem[];
  contact: {
    email: string;
    /** Big call-to-action line above the email. */
    prompt: string;
    phone?: string;
    resume?: Link;
    socials: Link[];
  };
}
