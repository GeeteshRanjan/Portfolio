import type { AboutContent } from './types';
import data from './data/about.json';

/*
 * About page (/about) content lives in ./data/about.json (edited from /admin).
 * Optional fields (location, availability, portrait, education, recognition,
 * phone, resume) can be removed to hide their row or section.
 * Put images/files in /public and reference them from the site root ("/images/…").
 */

export const about: AboutContent = data;
