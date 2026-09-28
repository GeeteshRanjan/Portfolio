/**
 * Procedural surface maps for the disc materials (normal + roughness).
 * Pure functions so they can run in a worker or on the main thread.
 * Recipe mirrors the reference's print/scratch/gloss-ring approach
 * (REFERENCE_ANALYSIS.md §3).
 */

export interface SurfaceSettings {
  texGrain: number;
  texPrint: number;
  texScratches: number;
  texGloss: number;
  frontRough: number;
  backRough: number;
  backRadialDetail: number;
}

export type MapJob = 'frontNormal' | 'backNormal' | 'frontRough' | 'backRough';

const hash = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Seeded random so scratches are stable between reloads.
function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function heightToNormal(height: Float32Array, size: number) {
  const out = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + Math.max(0, x - 1)];
      const r = height[y * size + Math.min(size - 1, x + 1)];
      const u = height[Math.max(0, y - 1) * size + x];
      const d = height[Math.min(size - 1, y + 1) * size + x];
      let nx = l - r, ny = u - d, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      const i = (y * size + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  return out;
}

function frontNormal(size: number, s: SurfaceSettings) {
  const h = new Float32Array(size * size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c) + 1e-4;
      h[y * size + x] = Math.sin(r * 0.6) * 0.02 + (hash(x * 0.4, y * 0.4) - 0.5) * 0.5 * s.texPrint;
    }
  const rand = mulberry(7);
  const scratches = Math.floor(30 * s.texScratches);
  for (let k = 0; k < scratches; k++) {
    const a = rand() * Math.PI * 2, len = 30 + rand() * 220;
    const sx = rand() * size, sy = rand() * size, dx = Math.cos(a), dy = Math.sin(a);
    const depth = (rand() * 0.7 + 0.2) * s.texScratches;
    for (let t = 0; t < len; t++) {
      const px = Math.round(sx + dx * t), py = Math.round(sy + dy * t);
      if (px < 1 || py < 1 || px >= size - 1 || py >= size - 1) continue;
      h[py * size + px] -= depth;
    }
  }
  const dust = Math.floor(500 * s.texScratches);
  for (let k = 0; k < dust; k++) {
    h[Math.floor(rand() * size) * size + Math.floor(rand() * size)] += (rand() - 0.5) * s.texScratches * 1.2;
  }
  return heightToNormal(h, size);
}

function backNormal(size: number, s: SurfaceSettings) {
  const h = new Float32Array(size * size);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const r = Math.hypot(x - c, y - c);
      h[y * size + x] = Math.sin(r * 3.2) * 0.5 * s.backRadialDetail + (hash(x * 0.6, y * 0.6) - 0.5) * 0.06 * s.backRadialDetail;
    }
  return heightToNormal(h, size);
}

function grey(size: number, fn: (x: number, y: number, r: number) => number) {
  const out = new Uint8ClampedArray(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = clamp(fn(x, y, Math.hypot(x - c, y - c)), 0.02, 1) * 255;
      const i = (y * size + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  return out;
}

function frontRough(size: number, s: SurfaceSettings) {
  return grey(size, (x, y, r) => {
    let v = s.frontRough;
    v += (hash(x * 2.3, y * 2.3) - 0.5) * 0.35 * s.texGrain;
    v += (hash(x * 0.5, y * 0.5) - 0.5) * 0.3 * s.texPrint;
    // Concentric gloss bands: highlights break into rings as the disc turns.
    v -= (Math.sin((r / (size * 0.5)) * 14) * 0.5 + 0.5) * 0.5 * s.texGloss;
    return v;
  });
}

function backRough(size: number, s: SurfaceSettings) {
  return grey(size, (x, y, r) =>
    s.backRough + Math.sin(r * 1.6) * 0.06 * s.backRadialDetail + (hash(x * 1.2, y * 1.2) - 0.5) * 0.04 * s.backRadialDetail,
  );
}

export const builders: Record<MapJob, (size: number, s: SurfaceSettings) => Uint8ClampedArray> = {
  frontNormal,
  backNormal,
  frontRough,
  backRough,
};
