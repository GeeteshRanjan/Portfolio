import type { Project, SiteContent } from './types';
import siteData from './data/site.json';
import projectData from './data/projects.json';

/*
 * Site and project content lives in ./data/site.json and ./data/projects.json,
 * edited from the admin at /admin (or by hand). This module only types it.
 * Images: add `image` (square disc label art, ≥1024 px) and `heroImage`
 * (wide, ~1920×1200) per project once available; until then the label and
 * hero art are generated from `palette`.
 * The "About Me" disc (href "/about") only uses title, category, year, metadata and palette.
 */

export const site: SiteContent = siteData;
export const projects: Project[] = projectData as Project[];

export const projectIndex = (slug: string) => projects.findIndex((p) => p.slug === slug);

/** Route a disc opens: its own `href` if set, otherwise its detail page. */
export const projectUrl = (p: Project) => p.href ?? `/work/${p.slug}`;
