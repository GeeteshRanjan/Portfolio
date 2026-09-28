# Project context (always loaded)

Portfolio site: 3D disc carousel gallery, project detail pages, about page. Recreates the
interaction system of a reference site (a24.raviklaassens.com).

## Stack and commands
- React 19 + TypeScript + Vite 7, react-router 7, three 0.186, gsap 3, lenis.
- `npm run typecheck` (fast), `npm run build` (tsc + vite). No test runner.
- `npm run dev` is long-running: ask the user to run it.
- Browser checks: Playwright scripts in `reference/tools/` (`node reference/tools/check.js <url> <prefix> [scenario]`), output to `validation/`. `?debug` exposes `galleryDebug.state()`.
- Git repo (since 2026-09-28): `main` → https://github.com/GeeteshRanjan/Portfolio.git, deployed by Vercel. Commit/push only when the user asks.

## Where things are
- Routes: `src/App.tsx` (`/`, `/work/:slug`, `/about`).
- System-to-file map: `reference/REFERENCE_ANALYSIS.md` §10. Constants: `src/three/config.ts`, `src/motion/tokens.ts` (tune there, not in engines).
- Content (user-owned): JSON in `src/content/data/*.json` (site, projects, about, ui, assistant, knowledge), typed by the `src/content/*.ts` wrappers, types in `src/content/types.ts`. Edited from `/admin` (schema `src/admin/schema.ts`); new fields must be added to the schema too.

## Reading economy
- Never open: `node_modules/`, `dist/`, `reference/source/` (minified bundles), `reference/recordings/`, `reference/screenshots/`, `validation/`, `package-lock.json`, `reference/*.json`.
- `reference/REFERENCE_ANALYSIS.md` (~470 lines): `grep -n '^#'` first, then read only the section needed.
- `src/three/DiscGallery.ts` (~1200 lines): grep or `read_code` with a selector, never a full read.
- Only re-read code you are about to change.

## Handoff
- `HANDOFF.md` = current state + gotchas (short). Read it once per session, only when about to change code or when asked about project state. Skip for unrelated Q&A.
- `HANDOFF_LOG.md` = append-only history, one self-contained line per entry. Don't read it by default. It is never the only place a still-relevant fact lives (that belongs in `HANDOFF.md`).
  - History of a specific thing: `grep -n -i '<file or keyword>' HANDOFF_LOG.md` (searches the whole log).
  - General "what happened recently": `tail -n 15 HANDOFF_LOG.md`.
- After a task that changed files (skip for Q&A/read-only):
  1. `HANDOFF.md` "Now": replace the lines that became false. Don't rewrite the rest.
  2. `HANDOFF.md` "Gotchas": add a new trap if one was found; delete ones that no longer apply.
  3. `HANDOFF_LOG.md`: `fs_append` one line `- YYYY-MM-DD: what changed (files). Why, if not obvious.` No read needed.
- No size limits on any of these files. Never summarise, compact or reword to make things fit.
