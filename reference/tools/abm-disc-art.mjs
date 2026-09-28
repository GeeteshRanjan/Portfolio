// Generates public/images/abm-email-automation-disc.svg (deterministic). Check with labels.mjs.
// node reference/tools/abm-disc-art.mjs
// "Grooves" on maroon vinyl: the disc's tracks as hairline rings, clear at the top (the label prints
// the ANSR logo at y 0.14 and the title at y 0.3 there) and densest toward the lower right; a few
// short orange arcs are the signals found on individual tracks. A faint bow-tie sheen crosses the
// record like light on vinyl.
import { writeFileSync } from 'node:fs';

const S = 1024, C = S / 2;
const R0 = 0.135 * S, R1 = 0.43 * S;        // just outside the hub mask (0.12) to inside the rim credits (0.445)
const ORANGE = '#FD4E11';                   // the ANSR mark's orange
const GROOVE = '#F2D8CE';                   // warm pale rose, reads as light on the ridges
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const f = (n) => +n.toFixed(1);
const rng = (seed) => () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
const pt = (r, a) => `${f(C + r * Math.cos(a))} ${f(C + r * Math.sin(a))}`;

// Tone 0–1: clear at the top, full at the bottom, heavier toward the lower right.
const tone = (x, y) => {
  const u = x / S, v = y / S;
  const bloom = Math.exp(-((u - 0.66) ** 2 + (v - 0.72) ** 2) / (2 * 0.2 ** 2));
  return Math.min(1, smooth(0.34, 0.84, v) * (0.5 + 0.5 * bloom));
};

const rand = rng(7), rings = [], arcs = [];
for (let r = R0 + 4; r < R1 - 4; r += 5.5) {
  // Each ring is drawn as short segments so its opacity can follow the tone around it.
  const n = Math.ceil((2 * Math.PI * r) / 14);
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI, am = (a0 + a1) / 2;
    const t = tone(C + r * Math.cos(am), C + r * Math.sin(am));
    if (t < 0.03) continue;
    const o = f(0.1 + 0.85 * t * (0.7 + 0.3 * rand()));
    rings.push(`<path d="M${pt(r, a0)}A${f(r)} ${f(r)} 0 0 1 ${pt(r, a1)}" stroke-opacity="${o}"/>`);
  }
}
// Signals: short arcs in the lower-right bloom, on distinct tracks.
const used = new Set();
while (arcs.length < 6) {
  const r = R0 + 4 + 5.5 * Math.floor(rand() * ((R1 - R0 - 8) / 5.5));
  const a = Math.PI * (0.05 + rand() * 0.75), len = 0.12 + rand() * 0.16;
  const key = Math.round(r / 30);
  if (used.has(key) || tone(C + r * Math.cos(a), C + r * Math.sin(a)) < 0.6) continue;
  used.add(key);
  arcs.push(`<path d="M${pt(r, a)}A${f(r)} ${f(r)} 0 0 1 ${pt(r, a + len)}"/>`);
}

// Sheen: two opposite wedges through the centre (upper left / lower right), blurred.
const wedge = (a, w) => `M${C} ${C}L${pt(S, a - w)}L${pt(S, a + w)}Z`;
const sheen = [-2.35, 0.79].map((a) => wedge(a, 0.16)).join('');

writeFileSync(new URL('../../public/images/abm-email-automation-disc.svg', import.meta.url), `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
<defs><radialGradient id="field" cx="0.42" cy="0.3" r="0.85"><stop offset="0" stop-color="#5A1620"/><stop offset="0.55" stop-color="#3A0C14"/><stop offset="1" stop-color="#1E0509"/></radialGradient>
<filter id="blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="28"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -1.2 0.9"/></filter></defs>
<rect width="${S}" height="${S}" fill="url(#field)"/>
<path d="${sheen}" fill="#FFE6DC" opacity="0.07" filter="url(#blur)"/>
<g fill="none" stroke="${GROOVE}" stroke-width="1.1">${rings.join('')}</g>
<g fill="none" stroke="${ORANGE}" stroke-width="2.6" stroke-linecap="round">${arcs.join('')}</g>
<rect width="${S}" height="${S}" filter="url(#grain)" opacity="0.14"/>
</svg>
`);
console.log(rings.length, 'groove segments');
