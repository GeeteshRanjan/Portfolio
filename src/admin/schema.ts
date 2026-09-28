/**
 * Admin content schema: one spec per editable document. The admin UI renders its
 * forms from these specs and server/admin.ts validates saves against them, so a
 * save can't leave the site with a field of the wrong type.
 * Pure data + functions (no DOM, no Node): imported by both the browser and the server.
 */

type Base = { key: string; label: string; help?: string; optional?: boolean };

export type Field =
  /** `long`: textarea (true, or a row count). `pattern`: regex source the value must match. */
  | (Base & { kind: 'text'; long?: boolean | number; pattern?: string; placeholder?: string })
  | (Base & { kind: 'number'; step?: number })
  | (Base & { kind: 'bool' })
  | (Base & { kind: 'color' })
  /** Path under /public, e.g. "/images/x.jpg". Rendered with a picker + preview. */
  | (Base & { kind: 'image' })
  /** string[]; `long` makes each item a textarea. */
  | (Base & { kind: 'strings'; long?: boolean; itemLabel?: string })
  /** string or string[]: one line = string, several lines = list. */
  | (Base & { kind: 'lines' })
  | (Base & { kind: 'object'; fields: Field[] })
  /** Array of objects. `summary`: key shown on the collapsed card. `unique`: key that must not repeat. */
  | (Base & { kind: 'list'; fields: Field[]; summary?: string; unique?: string; itemLabel?: string; newItem: () => Record<string, unknown> });

export type DocId = 'site' | 'ui' | 'projects' | 'about' | 'assistant' | 'knowledge' | 'questionnaire';

export interface DocSpec {
  id: DocId;
  title: string;
  blurb: string;
  /** Path relative to the project root. */
  file: string;
  /** JSON docs have a root field (object or list); text docs are edited as one plain text field. */
  root?: Field;
}

const text = (key: string, label: string, more: Partial<Extract<Field, { kind: 'text' }>> = {}): Field => ({ kind: 'text', key, label, ...more });
const long = (key: string, label: string, more: Partial<Extract<Field, { kind: 'text' }>> = {}): Field => text(key, label, { long: true, ...more });
const opt = (key: string, label: string, more: Partial<Extract<Field, { kind: 'text' }>> = {}): Field => text(key, label, { optional: true, ...more });
const link = (label: string, help?: string): Field[] => [text('label', label), text('href', 'Link (URL, mailto: or /path)', { help })];

const DESCRIPTION_HELP =
  'Blank line = new paragraph. With 2+ paragraphs the first becomes the large lede; (text in parentheses) inside it is set smaller. ' +
  'A "## Heading" paragraph followed by a paragraph of "- " lines becomes the right-hand rail (e.g. Highlights); rail rows written "Group: a · b" get a small group label. ' +
  'A "## Heading" as the very first paragraph becomes a small kicker above the lede. ' +
  'Any other "## Heading" starts a titled section (heading + its paragraphs). A paragraph of "> " lines is a set of pull questions, set large.';

const project: Field[] = [
  text('title', 'Title', { help: 'Disc label, gallery panel, big detail-page heading and nav index.' }),
  opt('panelTitle', 'Gallery panel title', { help: 'Shown instead of the title in the home page top-left panel only, e.g. the company name on work discs. Leave empty to use the title.' }),
  opt('subtitle', 'Subtitle', { help: 'Used by the chat bot; not shown on the page.' }),
  opt('note', 'Gallery note', { help: 'A few hand-written words shown with an arrow beside the disc while it is hovered, e.g. "SquadStack Workex". Leave empty for none.' }),
  text('category', 'Category', { help: 'Small caps under the title and on the disc.' }),
  text('year', 'Year', { help: 'Free text, e.g. "2023–24".' }),
  text('slug', 'URL slug', { pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$', help: 'Page address /work/<slug>. Lowercase letters, digits and dashes. Changing it breaks old links.' }),
  opt('href', 'Open this route instead', { help: 'e.g. "/about". Leave empty to open the project page.' }),
  {
    kind: 'list', key: 'metadata', label: 'Facts table', summary: 'label', itemLabel: 'row',
    help: 'First three rows show in the gallery panel; all rows on the detail page; all values are printed around the disc rim (keep them short).',
    fields: [text('label', 'Label'), { kind: 'lines', key: 'value', label: 'Value', help: 'One line per value. Several lines are joined with commas on the page.' }],
    newItem: () => ({ label: '', value: '' }),
  },
  long('description', 'Write-up', { long: 18, help: DESCRIPTION_HELP }),
  {
    kind: 'object', key: 'detour', label: 'Side note before the write-up', optional: true,
    help: 'Small, muted, ruled-off note above the lede (e.g. "A Small Detour").',
    fields: [text('label', 'Label'), { kind: 'strings', key: 'paragraphs', label: 'Paragraphs', long: true, itemLabel: 'paragraph' }],
  },
  { kind: 'strings', key: 'coda', label: 'Closing lines', optional: true, itemLabel: 'line', help: 'Serif sign-off under the write-up, one line each.' },
  { kind: 'list', key: 'links', label: 'Buttons', optional: true, summary: 'label', itemLabel: 'button', help: 'Shown under the facts table. http links open in a new tab.', fields: link('Label'), newItem: () => ({ label: '', href: '' }) },
  {
    kind: 'list', key: 'previews', label: 'Website previews', optional: true, summary: 'label', itemLabel: 'website',
    help: 'Browser-window cards at the end of the page. Screenshot 16:10 (e.g. 1440×900).',
    fields: [text('label', 'Name'), text('href', 'URL'), { kind: 'image', key: 'image', label: 'Screenshot' }, text('alt', 'Screenshot description (alt text)')],
    newItem: () => ({ label: '', href: 'https://', image: '', alt: '' }),
  },
  {
    kind: 'object', key: 'game', label: 'Live embed (game or app)', optional: true,
    help: 'Embedded in the right-hand rail (replaces Highlights). The page loads the URL in a frame once the visitor clicks it.',
    fields: [
      text('label', 'Rail heading', { help: 'e.g. "Play" or "Try it".' }),
      text('src', 'URL', { pattern: '^https://', help: 'Must allow being framed by this site (no X-Frame-Options / frame-ancestors block).' }),
      text('title', 'Frame title (screen readers)'),
      { kind: 'image', key: 'poster', label: 'Poster', optional: true, help: 'Still of the first screen, 16:9, shown until the visitor clicks (the page only loads then).' },
      opt('prompt', 'Cover text', { help: 'Default "Click to play".' }),
      { kind: 'number', key: 'viewport', label: 'Layout width (px)', optional: true, step: 10, help: 'Width the embedded page lays out for, zoomed to fit. Default 600 (game). A website wants its desktop width, e.g. 900.' },
      { kind: 'strings', key: 'keys', label: 'Controls', optional: true, itemLabel: 'row', help: 'One row each, "Action: keys", e.g. "Jump: Space / ↑".' },
    ],
  },
  { kind: 'image', key: 'image', label: 'Disc label art', optional: true, help: 'Square, ≥1024 px. Keep the subject out of the centre 24% (the hub). Empty = generated from the palette.' },
  { kind: 'image', key: 'heroImage', label: 'Hero image', optional: true, help: 'Currently not shown on detail pages.' },
  {
    kind: 'object', key: 'palette', label: 'Disc colours', help: 'Used for generated label art.',
    fields: [{ kind: 'color', key: 'base', label: 'Background' }, { kind: 'color', key: 'accent', label: 'Accent' }, { kind: 'color', key: 'ink', label: 'Text' }],
  },
  {
    kind: 'object', key: 'logo', label: 'Disc logo', optional: true,
    help: 'Printed on the label. Pick a colour version that reads on the label (e.g. a white one on dark art).',
    fields: [
      { kind: 'image', key: 'src', label: 'Logo (SVG or PNG)' },
      { kind: 'number', key: 'x', label: 'Centre X (0–1, default 0.5)', optional: true, step: 0.01 },
      { kind: 'number', key: 'y', label: 'Centre Y (0–1, default 0.78)', optional: true, step: 0.01 },
      { kind: 'number', key: 'width', label: 'Width (0–1, default 0.3)', optional: true, step: 0.01 },
    ],
  },
  {
    kind: 'object', key: 'art', label: 'Label art adjustments', optional: true,
    fields: [
      { kind: 'number', key: 'scale', label: 'Scale', optional: true, step: 0.05 },
      { kind: 'number', key: 'x', label: 'Shift X', optional: true, step: 0.01 },
      { kind: 'number', key: 'y', label: 'Shift Y', optional: true, step: 0.01 },
      { kind: 'number', key: 'rotation', label: 'Rotation (radians)', optional: true, step: 0.01 },
      { kind: 'bool', key: 'rim', label: 'Print facts around the rim (supplied art)', optional: true, help: 'Default on.' },
      { kind: 'bool', key: 'title', label: 'Print the title over the art (supplied art)', optional: true, help: 'Default off.' },
      { kind: 'number', key: 'titleY', label: 'Title position (0–1, default 0.3)', optional: true, step: 0.01 },
      { kind: 'number', key: 'titleTilt', label: 'Title tilt (radians, default -0.04)', optional: true, step: 0.01 },
      { kind: 'text', key: 'titleText', label: 'Disc title text', optional: true, help: 'Overrides the project title on the disc only.' },
    ],
  },
];

export const DOCS: DocSpec[] = [
  {
    id: 'site', title: 'Site & SEO', file: 'src/content/data/site.json',
    blurb: 'Name, wordmark, gallery intro, preloader year, scroll-next labels and the browser tab title.',
    root: {
      kind: 'object', key: '', label: '', fields: [
        text('name', 'Name', { help: 'Preloader, About page heading, chat bot.' }),
        text('mark', 'Wordmark', { help: 'Nav logo and portrait placeholder, e.g. "GR".' }),
        text('sectionLabel', 'Gallery section label', { help: 'Screen readers only: the gallery heading and carousel label.' }),
        opt('tagline', 'Gallery tagline', { long: 2, help: 'Bottom-left of the gallery. Each sentence gets its own line. Empty hides it.' }),
        { kind: 'number', key: 'sinceYear', label: 'Preloader start year', help: 'The preloader counts from this year to the current one.' },
        text('nextLabel', 'Next-project kicker', { help: 'Bottom of detail pages, e.g. "Up next — 03 / 10".' }),
        text('continueHint', 'Next-project hint', { help: 'e.g. "Keep scrolling".' }),
        {
          kind: 'object', key: 'meta', label: 'Search & browser tab', fields: [
            text('title', 'Page title'),
            long('description', 'Meta description', { long: 3, help: 'Shown by search engines and link previews. ~150 characters.' }),
          ],
        },
      ],
    },
  },
  {
    id: 'projects', title: 'Discs & projects', file: 'src/content/data/projects.json',
    blurb: 'Every disc in the gallery, in order, and its detail page.',
    root: {
      kind: 'list', key: '', label: 'Discs', fields: project, summary: 'title', unique: 'slug', itemLabel: 'disc',
      newItem: () => ({
        slug: `new-project-${Date.now().toString(36)}`, title: 'New project', category: 'Category', year: String(new Date().getFullYear()),
        metadata: [{ label: 'Role', value: '' }], description: '', palette: { base: '#e8e1cf', accent: '#c9b98f', ink: '#3a2f22' },
      }),
    },
  },
  {
    id: 'about', title: 'About page', file: 'src/content/data/about.json',
    blurb: 'Headline, bio, experience, skills, education and contact on /about. Empty optional fields hide their row or section.',
    root: {
      kind: 'object', key: '', label: '', fields: [
        text('headline', 'Headline', { help: 'Small caps under the name.' }),
        opt('location', 'Based in'),
        opt('availability', 'Status', { help: 'e.g. "Open to new roles". Empty hides the row.' }),
        long('intro', 'Intro statement', { long: 3, help: 'Large serif line next to the portrait.' }),
        { kind: 'strings', key: 'bio', label: 'Bio paragraphs', long: true, itemLabel: 'paragraph' },
        { kind: 'object', key: 'portrait', label: 'Portrait', optional: true, help: 'Empty shows the wordmark instead.', fields: [{ kind: 'image', key: 'src', label: 'Photo' }, text('alt', 'Description (alt text)')] },
        {
          kind: 'list', key: 'experience', label: 'Experience', summary: 'role', itemLabel: 'role',
          fields: [text('role', 'Role'), text('company', 'Company'), text('period', 'Period', { help: 'e.g. "2023 — 2024".' }), opt('location', 'Location'), opt('summary', 'Summary', { long: 4 }), opt('href', 'Company link')],
          newItem: () => ({ role: '', company: '', period: '' }),
        },
        {
          kind: 'list', key: 'skills', label: 'Skills', summary: 'group', itemLabel: 'group',
          fields: [text('group', 'Group'), { kind: 'strings', key: 'items', label: 'Skills', itemLabel: 'skill' }],
          newItem: () => ({ group: '', items: [] }),
        },
        {
          kind: 'list', key: 'education', label: 'Education', optional: true, summary: 'degree', itemLabel: 'entry',
          fields: [text('degree', 'Degree'), text('school', 'School'), text('period', 'Period'), opt('note', 'Note', { long: 2 })],
          newItem: () => ({ degree: '', school: '', period: '' }),
        },
        {
          kind: 'list', key: 'recognition', label: 'Recognition', optional: true, summary: 'title', itemLabel: 'award',
          fields: [text('title', 'Title'), text('issuer', 'Issuer'), text('year', 'Year')],
          newItem: () => ({ title: '', issuer: '', year: '' }),
        },
        {
          kind: 'object', key: 'contact', label: 'Contact', fields: [
            text('prompt', 'Call to action', { help: 'Large line above the email, e.g. "Start a conversation".' }),
            text('email', 'Email', { help: 'Also used by the chat bot and error messages.' }),
            opt('phone', 'Phone', { help: 'Public if filled in.' }),
            { kind: 'object', key: 'resume', label: 'Résumé button', optional: true, fields: link('Résumé', 'Put the PDF in /public, e.g. /resume.pdf.') },
            { kind: 'list', key: 'socials', label: 'Social buttons', summary: 'label', itemLabel: 'link', fields: link('Label'), newItem: () => ({ label: '', href: 'https://' }) },
          ],
        },
      ],
    },
  },
  {
    id: 'ui', title: 'Interface text', file: 'src/content/data/ui.json',
    blurb: 'Nav, section headings, website-card chrome and screen-reader text. {tokens} are filled in automatically.',
    root: {
      kind: 'object', key: '', label: '', fields: [
        {
          kind: 'object', key: 'nav', label: 'Navigation', fields: [
            text('work', 'Work link'), text('about', 'About link'), text('index', 'Index menu'),
            text('ask', 'Chat button', { help: 'Opens the "Ask about me" chat in a dialog, on every page.' }),
            text('night', 'Night mode toggle', { help: 'Homepage only: turns the room lights down and drops the lamp.' }),
            text('homeLabel', 'Logo label (screen readers)', { help: 'Tokens: {name}.' }),
          ],
        },
        {
          kind: 'object', key: 'gallery', label: 'Gallery (screen readers)', fields: [
            long('help', 'Keyboard help', { long: 2 }),
            text('announce', 'Disc change announcement', { help: 'Tokens: {title}, {n}, {total}.' }),
          ],
        },
        {
          kind: 'object', key: 'detail', label: 'Project pages', fields: [
            text('websiteOne', 'Previews heading (one)'), text('websiteMany', 'Previews heading (several)'),
            text('address', 'Browser card: address label'), text('go', 'Browser card: button'),
            text('done', 'Browser card: status'), text('visitSite', 'Browser card: visit link'),
            text('visitLabel', 'Browser card label (screen readers)', { help: 'Tokens: {label}, {host}.' }),
            text('sectionLabel', 'Write-up section label (screen readers)', { help: 'Tokens: {title}.' }),
            text('play', 'Game: start prompt'), text('resume', 'Game: resume prompt'),
            text('playLabel', 'Game: start button (screen readers)', { help: 'Tokens: {title}.' }),
            text('enlarge', 'Game: enlarge button'), text('shrink', 'Game: shrink button'),
            text('newTab', 'Game: new-tab button'), text('newTabLabel', 'Game: new-tab label (screen readers)', { help: 'Tokens: {title}.' }),
          ],
        },
        {
          kind: 'object', key: 'about', label: 'About page headings', fields: [
            text('basedIn', 'Based in row'), text('status', 'Status row'), text('email', 'Email row'),
            text('experience', 'Experience'), text('skills', 'Skills'), text('education', 'Education'),
            text('recognition', 'Recognition'), text('contact', 'Contact'), text('bioLabel', 'Bio section (screen readers)'),
          ],
        },
      ],
    },
  },
  {
    id: 'assistant', title: 'Chat copy', file: 'src/content/data/assistant.json',
    blurb: 'Everything visitors read in the "Ask about me" chat, including its error messages.',
    root: {
      kind: 'object', key: '', label: '', fields: [
        text('label', 'Heading'),
        long('greeting', 'Greeting', { long: 3, help: 'Shown before the first question.' }),
        text('placeholder', 'Input placeholder'),
        { kind: 'strings', key: 'suggestions', label: 'Suggested questions', itemLabel: 'question', help: 'Keep to 3–4 short ones.' },
        {
          kind: 'object', key: 'ui', label: 'Buttons and labels', fields: [
            text('note', 'Disclaimer'), text('clear', 'Clear button'), text('close', 'Close button (nav dialog)'), text('thinking', 'Waiting text'),
            text('ask', 'Send button'), text('stop', 'Stop button'),
            text('inputLabel', 'Input label (screen readers)'), text('sendLabel', 'Send label (screen readers)'),
            text('stopLabel', 'Stop label (screen readers)'), text('youAsked', 'Question prefix (screen readers)'),
            text('answer', 'Answer prefix (screen readers)'), text('suggestionsLabel', 'Suggestions label (screen readers)'),
            text('logLabel', 'Conversation label (screen readers)'),
          ],
        },
        {
          kind: 'object', key: 'errors', label: 'Error messages', help: 'Error bubbles are followed by your email address automatically.', fields: [
            text('busy', 'Model busy'), text('quota', 'Daily limit reached'), text('tooMany', 'Visitor asked too often'),
            text('cutOff', 'Answer cut off'), text('empty', 'Empty answer'), text('unavailable', 'Chat unreachable'),
            text('generic', 'Unknown error'), text('notConfigured', 'No API key'), text('invalid', 'Bad request'),
          ],
        },
      ],
    },
  },
  {
    id: 'knowledge', title: 'Bot knowledge', file: 'src/content/data/knowledge.json',
    blurb: 'What the chat bot knows beyond the site, and how it behaves. It also reads everything on the About page and every write-up.',
    root: {
      kind: 'object', key: '', label: '', fields: [
        {
          kind: 'strings', key: 'notes', label: 'Extra facts', long: true, itemLabel: 'fact',
          help: 'One plain fact per entry. The bot treats these as true and may repeat them to anyone, so nothing private.',
        },
        long('instructions', 'Rules (system prompt)', { long: 16, help: 'Tokens: {name}, {first}, {email}. The site knowledge is appended after this text.' }),
      ],
    },
  },
  {
    id: 'questionnaire', title: 'Questionnaire', file: 'CHATBOT_KNOWLEDGE.md',
    blurb: 'Your working notes (CHATBOT_KNOWLEDGE.md). Not sent to the bot: move approved answers into Bot knowledge › Extra facts.',
  },
];

export const docSpec = (id: string) => DOCS.find((d) => d.id === id);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Type-checks a value against a field. Returns human-readable errors ("Discs › 3 › Title: …"). */
export function validate(field: Field, value: unknown, path: string[] = []): string[] {
  const where = [...path, field.label].filter(Boolean).join(' › ');
  const err = (m: string) => [`${where || 'Document'}: ${m}`];
  if (value === undefined) return field.optional ? [] : err('missing');
  switch (field.kind) {
    case 'text':
    case 'image':
      if (typeof value !== 'string') return err('must be text');
      if (field.kind === 'text' && field.pattern && !new RegExp(field.pattern).test(value)) return err(`"${value}" is not allowed here`);
      return [];
    case 'color':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? [] : err('must be a colour like #1a2b3c');
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? [] : err('must be a number');
    case 'bool':
      return typeof value === 'boolean' ? [] : err('must be on or off');
    case 'strings':
      return Array.isArray(value) && value.every((v) => typeof v === 'string') ? [] : err('must be a list of text');
    case 'lines':
      return typeof value === 'string' || (Array.isArray(value) && value.every((v) => typeof v === 'string')) ? [] : err('must be text');
    case 'object': {
      if (!isObj(value)) return err('must be a group of fields');
      return field.fields.flatMap((f) => validate(f, value[f.key], [...path, field.label].filter(Boolean)));
    }
    case 'list': {
      if (!Array.isArray(value)) return err('must be a list');
      const out = value.flatMap((item, i) => {
        const name = `${field.label || 'Item'} ${i + 1}`;
        return isObj(item) ? field.fields.flatMap((f) => validate(f, item[f.key], [...path, name])) : [`${name}: must be a group of fields`];
      });
      if (field.unique) {
        const seen = new Set<unknown>();
        value.forEach((item, i) => {
          const k = isObj(item) ? item[field.unique!] : undefined;
          if (seen.has(k)) out.push(`${field.label || 'Item'} ${i + 1}: "${String(k)}" is used twice (${field.unique} must be unique)`);
          seen.add(k);
        });
      }
      return out;
    }
  }
}

/**
 * Drops empty optional values (so an emptied optional field hides its row, as when it's
 * left out of the file) and trims trailing whitespace-only list items. Unknown keys are kept.
 */
export function clean(field: Field, value: unknown): unknown {
  switch (field.kind) {
    case 'text':
    case 'image':
      return field.optional && typeof value === 'string' && !value.trim() ? undefined : value;
    case 'number':
      return typeof value === 'number' && !Number.isFinite(value) ? undefined : value;
    case 'strings': {
      if (!Array.isArray(value)) return value;
      const list = value.filter((v) => typeof v !== 'string' || v.trim());
      return field.optional && !list.length ? undefined : list;
    }
    case 'lines': {
      if (!Array.isArray(value)) return value;
      const list = value.filter((v) => typeof v !== 'string' || v.trim());
      return list.length > 1 ? list : (list[0] ?? '');
    }
    case 'object': {
      if (!isObj(value)) return value;
      const out: Record<string, unknown> = { ...value };
      for (const f of field.fields) {
        const v = clean(f, out[f.key]);
        if (v === undefined) delete out[f.key];
        else out[f.key] = v;
      }
      // An optional group whose fields are all empty (e.g. `art: {}`) is removed.
      return field.optional && !Object.keys(out).length ? undefined : out;
    }
    case 'list': {
      if (!Array.isArray(value)) return value;
      const list = value.map((item) => clean({ ...field, kind: 'object', optional: false } as Field, item));
      return field.optional && !list.length ? undefined : list;
    }
    default:
      return value;
  }
}
