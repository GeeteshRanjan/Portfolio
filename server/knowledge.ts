/**
 * Builds the chat bot's system prompt from the site content, so the bot and
 * the pages never drift apart. Edit content in src/content/*, not here.
 */
import { about } from '../src/content/about';
import { projects, site } from '../src/content/projects';
import { knowledge as kb } from '../src/content/assistant';
import { fill } from '../src/content/ui';
import type { Project } from '../src/content/types';

const value = (v: string | string[]) => (Array.isArray(v) ? v.join(', ') : v);

/** Detail-page markup (`## Heading`, `- item`, `> question`) reads fine as plain text; just tidy headings and pull questions. */
const plain = (text: string) => text.replace(/^## (.+)$/gm, (_, h: string) => (/[?:]$/.test(h) ? h : `${h}:`)).replace(/^> /gm, '- ').replace(/\(\((.+?)\)\)(?!\))/g, '($1)');

function projectBlock(p: Project) {
  const lines = [`### ${p.title} (${p.category}, ${p.year})`];
  if (p.subtitle) lines.push(p.subtitle);
  lines.push(...p.metadata.map((m) => `${m.label}: ${value(m.value)}`));
  if (p.links?.length) lines.push(`Links: ${p.links.map((l) => `${l.label} ${l.href}`).join('; ')}`);
  if (p.previews?.length) lines.push(`Websites he built: ${p.previews.map((w) => `${w.label} ${w.href}`).join('; ')}`);
  if (p.detour) lines.push('', `${p.detour.label}:`, ...p.detour.paragraphs);
  lines.push('', plain(p.description));
  if (p.coda?.length) lines.push('', p.coda.join(' '));
  return lines.join('\n');
}

function knowledge() {
  const { contact } = about;
  const parts = [
    `## Profile`,
    `Name: ${site.name}`,
    `Headline: ${about.headline}`,
    about.location ? `Based in: ${about.location}` : '',
    about.availability ? `Availability: ${about.availability}` : '',
    `Portfolio tagline: ${site.tagline ?? ''}`,
    '',
    about.intro,
    ...about.bio,
    '',
    `## Experience (most recent first)`,
    ...about.experience.map((x) =>
      `- ${x.role}, ${x.company} (${x.period}${x.location ? `, ${x.location}` : ''})${x.summary ? `: ${x.summary}` : ''}`),
    '',
    `## Skills`,
    ...about.skills.map((g) => `- ${g.group}: ${g.items.join(', ')}`),
    '',
    `## Education`,
    ...(about.education ?? []).map((e) => `- ${e.degree}, ${e.school} (${e.period})${e.note ? `: ${e.note}` : ''}`),
    ...(about.recognition?.length ? ['', `## Recognition`, ...about.recognition.map((r) => `- ${r.title}, ${r.issuer} (${r.year})`)] : []),
    '',
    `## Contact`,
    `Email: ${contact.email}`,
    ...contact.socials.map((s) => `${s.label}: ${s.href}`),
    contact.resume ? `Résumé: ${contact.resume.href}` : '',
    '',
    `## Work write-ups (in his own words, first person)`,
    ...projects.filter((p) => !p.href).map(projectBlock),
    ...(kb.notes.length ? ['', `## Additional notes from ${site.name}`, ...kb.notes.map((n) => `- ${n}`)] : []),
  ];
  return parts.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
}

/** Rules (knowledge.json `instructions`, edited from /admin) followed by the site knowledge. */
export function systemPrompt() {
  const vars = { name: site.name, first: site.name.split(' ')[0], email: about.contact.email };
  return `${fill(kb.instructions, vars).trim()}

Knowledge about ${site.name}
${knowledge()}`;
}
