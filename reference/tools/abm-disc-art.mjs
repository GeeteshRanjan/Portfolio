// Generates public/images/abm-email-automation-disc.svg (deterministic). Check with labels.mjs.
// node reference/tools/abm-disc-art.mjs
// A CD's data spiral set as a halftone: thousands of accounts as teal dots, a few lit white
// (the signals), one of them marked. Dots fade out toward the top, leaving the orange clear
// for the logo and title printed over it.
import { writeFileSync } from 'node:fs';

const S = 1024, C = S / 2;
const TEAL = '#005465', WHITE = '#FFFFFF';
const R0 = 0.135 * S, R1 = 0.41 * S;       // just outside the hub mask (0.12) to inside the rim credits (0.445)
const PITCH = 11, STEP = 11, DOT = 4.4;    // spiral pitch, dot spacing along it, max dot radius (px)
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const f = (n) => +n.toFixed(1);

// Halftone tone at (x, y), 0–1: clear at the top, full at the bottom, heavier toward the lower right.
const tone = (x, y) => {
  const u = x / S, v = y / S;
  const bloom = Math.exp(-((u - 0.68) ** 2 + (v - 0.74) ** 2) / (2 * 0.2 ** 2));
  return Math.min(1, smooth(0.36, 0.86, v) * (0.55 + 0.45 * bloom));
};

const dots = [];
for (let a = 0, r = R0; r < R1; a += STEP / r, r = R0 + (PITCH * a) / (2 * Math.PI)) {
  const x = C + r * Math.cos(a), y = C + r * Math.sin(a), t = tone(x, y);
  const d = DOT * Math.sqrt(t);          // radius ∝ √tone keeps ink area proportional to tone
  if (d >= 0.5) dots.push({ x, y, d, t });
}

// Signals: a few dots in the dense part, spread out; the first is the marked account.
let seed = 11;
const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const pool = dots.filter((p) => p.t > 0.5);
const lit = [];
while (lit.length < 7) {
  const p = pool[Math.floor(rand() * pool.length)];
  if (lit.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 120)) lit.push(p);
}
const mark = lit[0];

const circle = (p, r) => `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(r)}"/>`;
writeFileSync(new URL('../../public/images/abm-email-automation-disc.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs><linearGradient id="field" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stop-color="#FF6419"/><stop offset="0.6" stop-color="#FF5400"/><stop offset="1" stop-color="#EA4A00"/></linearGradient>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.2 0.9"/></filter></defs>
<rect width="${S}" height="${S}" fill="url(#field)"/>
<g fill="${TEAL}">${dots.filter((p) => !lit.includes(p)).map((p) => circle(p, p.d)).join('')}</g>
<g fill="${WHITE}">${lit.map((p) => circle(p, DOT * 0.8)).join('')}</g>
<circle cx="${f(mark.x)}" cy="${f(mark.y)}" r="13" fill="none" stroke="${WHITE}" stroke-width="1.2"/>
<rect width="${S}" height="${S}" filter="url(#grain)" opacity="0.18"/>
</svg>
`);
console.log(dots.length, 'dots');
