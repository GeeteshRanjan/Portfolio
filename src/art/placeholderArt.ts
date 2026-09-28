import type { Project } from '../content/types';

/**
 * Generated placeholder artwork. Used only when a project has no `image` /
 * `heroImage`. Produces label art with enough tonal and typographic detail for
 * the disc materials to show highlight movement, print texture and gloss.
 */

const DISPLAY = '"Instrument Serif", Georgia, serif';
const EYEBROW = '"Cormorant SC", Georgia, serif';
const SANS = '"Inter Tight Variable", Arial, sans-serif';

let fontsReady: Promise<unknown> | null = null;
export function waitForFonts() {
  fontsReady ||= Promise.all([
    document.fonts.load(`200px ${DISPLAY}`),
    document.fonts.load(`40px ${EYEBROW}`),
    document.fonts.load(`40px ${SANS}`),
  ]).catch(() => undefined);
  return fontsReady;
}

// Deterministic PRNG so each project always renders the same art.
function rng(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One shared noise tile, composited as a pattern (GPU canvas path) instead of
// per-pixel getImageData loops, which cost tens of ms per label.
let noiseTile: HTMLCanvasElement | null = null;
function noise() {
  if (noiseTile) return noiseTile;
  const s = 256;
  noiseTile = document.createElement('canvas');
  noiseTile.width = noiseTile.height = s;
  const ctx = noiseTile.getContext('2d')!;
  const img = ctx.createImageData(s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (Math.random() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return noiseTile;
}

function grain(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number, rand: () => number) {
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = Math.min(1, amount / 110);
  const pat = ctx.createPattern(noise(), 'repeat')!;
  pat.setTransform(new DOMMatrix().translate(rand() * 256, rand() * 256));
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function textOnCircle(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, start: number, spacing: number) {
  let a = start;
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    const step = (w + spacing) / r;
    ctx.save();
    ctx.translate(cx + Math.cos(a + step / 2) * r, cy + Math.sin(a + step / 2) * r);
    ctx.rotate(a + step / 2 + Math.PI / 2);
    ctx.fillText(ch, -w / 2, 0);
    ctx.restore();
    a += step;
  }
}

/** Square label art (not yet masked to the annulus). */
export async function generateLabelArt(p: Project, size = 1024): Promise<HTMLCanvasElement> {
  await waitForFonts();
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const rand = rng(p.slug);
  const { base, accent, ink } = p.palette;

  // Field: soft two-tone gradient with an off-centre bloom.
  const g = ctx.createLinearGradient(0, 0, size * (0.3 + rand() * 0.4), size);
  g.addColorStop(0, base);
  g.addColorStop(0.7, base);
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const bx = size * (0.2 + rand() * 0.6), by = size * (0.55 + rand() * 0.3);
  const bloom = ctx.createRadialGradient(bx, by, 0, bx, by, size * 0.7);
  bloom.addColorStop(0, `${ink}55`);
  bloom.addColorStop(1, `${ink}00`);
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, size, size);

  // Large graphic form (differs per project) to give the label a composition.
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = accent;
  const form = Math.floor(rand() * 3);
  if (form === 0) {
    ctx.beginPath();
    ctx.arc(size * (0.25 + rand() * 0.5), size * 0.95, size * 0.48, 0, Math.PI * 2);
    ctx.fill();
  } else if (form === 1) {
    for (let i = 0; i < 7; i++) {
      ctx.globalAlpha = 0.12 + i * 0.07;
      ctx.fillRect(0, size * (0.56 + i * 0.065), size, size * 0.03);
    }
  } else {
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-0.5 + rand());
    ctx.fillRect(-size, size * 0.12, size * 2, size * 0.7);
  }
  ctx.restore();

  drawLabelTitle(ctx, p, size, ink, 0.31, -0.12 + rand() * 0.08);
  drawLabelRim(ctx, p, size, ink);
  // Before the grain, so the logo carries the same print texture as the rest of the ink.
  await drawLabelLogo(ctx, p, size);

  grain(ctx, size, size, 26, rand);
  return c;
}

/** Title + "CATEGORY · YEAR" line, centred at `y` (fraction of size), tilted by `tilt` radians. */
function drawLabelTitle(ctx: CanvasRenderingContext2D, p: Project, size: number, ink: string, y: number, tilt: number, maxWidth = 0.62) {
  ctx.save();
  ctx.fillStyle = ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const text = p.art?.titleText || p.title;
  let fs = size * 0.19;
  ctx.font = `${fs}px ${DISPLAY}`;
  while (ctx.measureText(text).width > size * maxWidth && fs > 40) {
    fs -= 4;
    ctx.font = `${fs}px ${DISPLAY}`;
  }
  ctx.translate(size / 2, size * y);
  ctx.rotate(tilt);
  ctx.fillText(text, 0, 0);
  ctx.font = `${size * 0.028}px ${EYEBROW}`;
  ctx.globalAlpha = 0.85;
  const sub = `${p.category} · ${p.year}`.toUpperCase().split('').join(' ');
  ctx.fillText(sub, 0, size * 0.065);
  ctx.restore();
}

/** Metadata values set around the rim, like a pressed label. Shrinks the type if it would overlap itself. */
function drawLabelRim(ctx: CanvasRenderingContext2D, p: Project, size: number, ink: string) {
  const credits = p.metadata
    .flatMap((m) => (Array.isArray(m.value) ? m.value : [m.value]))
    .join('  ·  ')
    .toUpperCase();
  const r = size * 0.445, spacing = size * 0.004;
  let fs = size * 0.017;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${fs}px ${SANS}`;
  // Leave ~6% of the circumference as a gap so the ends never touch.
  const room = Math.PI * 2 * r * 0.94;
  const length = () => ctx.measureText(credits).width + spacing * credits.length;
  while (length() > room && fs > size * 0.011) {
    fs *= 0.95;
    ctx.font = `${fs}px ${SANS}`;
  }
  ctx.globalAlpha = 0.75;
  textOnCircle(ctx, credits, size / 2, size / 2, r, Math.PI * 0.62, spacing);
  ctx.restore();
}

/** `p.logo` at its label position. A logo that fails to load is skipped, not the whole label. */
async function drawLabelLogo(ctx: CanvasRenderingContext2D, p: Project, size: number) {
  const logo = p.logo;
  if (!logo) return;
  const img = new Image();
  img.src = logo.src;
  try {
    await img.decode();
  } catch {
    return console.warn(`Could not load ${logo.src}`);
  }
  const w = size * (logo.width ?? 0.3), h = (w * img.naturalHeight) / img.naturalWidth;
  ctx.drawImage(img, size * (logo.x ?? 0.5) - w / 2, size * (logo.y ?? 0.78) - h / 2, w, h);
}

/**
 * Print over a supplied label image (already masked): the logo, if any, and typography.
 * Rim credits are on by default; the title is opt-in via `art.title`, for art that has
 * no title of its own.
 */
export async function drawSuppliedLabelText(label: HTMLCanvasElement, p: Project) {
  const art = p.art || {};
  if (art.rim === false && !art.title && !p.logo) return label;
  await waitForFonts();
  const ctx = label.getContext('2d')!;
  const size = label.width;
  const ink = p.palette.ink;
  await drawLabelLogo(ctx, p, size);
  // Narrower than the placeholder title so it stays clear of the rim credits.
  if (art.title) drawLabelTitle(ctx, p, size, ink, art.titleY ?? 0.3, art.titleTilt ?? -0.04, 0.5);
  if (art.rim !== false) drawLabelRim(ctx, p, size, ink);
  return label;
}

/** Wide placeholder photograph for the detail page. Returns an object URL. */
// Soft, blurred composition: half resolution is visually identical once scaled and ~4× cheaper.
export async function generateHeroImage(p: Project, w = 960, h = 600): Promise<string> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const rand = rng(p.slug + ':hero');
  const { base, accent, ink } = p.palette;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, accent);
  g.addColorStop(0.55, base);
  g.addColorStop(1, accent);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.filter = 'blur(30px)';
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = [base, accent, ink][i % 3] + (i % 3 === 2 ? '66' : 'cc');
    ctx.beginPath();
    ctx.ellipse(rand() * w, rand() * h, w * (0.08 + rand() * 0.25), h * (0.08 + rand() * 0.3), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.filter = 'none';
  // Architectural lines give the parallax something to read against.
  ctx.strokeStyle = `${ink}33`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = w * (0.1 + rand() * 0.8);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rand() - 0.5) * w * 0.2, h);
    ctx.stroke();
  }
  grain(ctx, w, h, 22, rand);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.86));
  return URL.createObjectURL(blob);
}

const heroCache = new Map<string, Promise<string>>();
export function heroImageFor(p: Project) {
  if (p.heroImage) return Promise.resolve(p.heroImage);
  let v = heroCache.get(p.slug);
  if (!v) { v = generateHeroImage(p); heroCache.set(p.slug, v); }
  return v;
}

/** Tiny generated grain tile for the global overlay (no external asset). */
export function grainTile(size = 250): string {
  // Sparse specks: mean alpha ≈ 6% and mean value ≈ 64, matching the reference tile statistics.
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 255 * Math.random() ** 3;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255 * Math.random() ** 16;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
