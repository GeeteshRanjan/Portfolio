import type { UiContent } from './types';
import data from './data/ui.json';

/** Small interface strings (nav, labels, accessibility text). Edited from /admin. */
export const ui: UiContent = data;

/** Fills `{token}` placeholders; unknown tokens are left as written. */
export const fill = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
