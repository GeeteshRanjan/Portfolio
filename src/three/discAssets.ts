import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { LOOK } from './config';
import { builders, type MapJob, type SurfaceSettings } from './proceduralMaps';
import type { Project } from '../content/types';
import { generateLabelArt, drawSuppliedLabelText } from '../art/placeholderArt';

/**
 * Shared, render-context-independent disc resources: geometries, procedural
 * maps, materials, environment and label textures. Built once, reused by the
 * gallery and the scroll-next scene.
 */

RectAreaLightUniformsLib.init();

// ---------- procedural maps (worker with main-thread fallback) ----------
let worker: Worker | null = null;
let workerFailed = false;
let jobId = 0;
const pending = new Map<number, { resolve: (d: Uint8ClampedArray) => void; reject: (e: Error) => void }>();

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./proceduralMaps.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, data, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) p.reject(new Error(error));
      else p.resolve(data);
    };
    worker.onerror = () => {
      workerFailed = true;
      pending.forEach((p) => p.reject(new Error('worker failed')));
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  } catch {
    workerFailed = true;
  }
  return worker;
}

function runJob(job: MapJob, size: number, s: SurfaceSettings): Promise<Uint8ClampedArray> {
  const local = () => Promise.resolve().then(() => builders[job](size, s));
  const w = getWorker();
  if (!w) return local();
  return new Promise<Uint8ClampedArray>((resolve, reject) => {
    const id = ++jobId;
    pending.set(id, { resolve, reject });
    w.postMessage({ id, job, size, settings: s });
  }).catch(local);
}

function dataTexture(data: Uint8ClampedArray, size: number, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.colorSpace = colorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

function canvasTexture(c: HTMLCanvasElement, colorSpace: THREE.ColorSpace) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------- geometry ----------
function planarUV(g: THREE.BufferGeometry) {
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) * 0.5 + 0.5, pos.getY(i) * 0.5 + 0.5);
  uv.needsUpdate = true;
}

function edgeGeometry() {
  const e = LOOK.discThickness / 2;
  const t = 0.0015 + LOOK.edgeBevel * Math.min(LOOK.discThickness * 0.55, 0.018);
  const n = 1 - LOOK.edgeBleed;
  const pts = [
    new THREE.Vector2(n, e), new THREE.Vector2(1 - t, e), new THREE.Vector2(1, e - t),
    new THREE.Vector2(1, -e + t), new THREE.Vector2(1 - t, -e), new THREE.Vector2(n, -e),
  ];
  const g = new THREE.LatheGeometry(pts, 256);
  g.computeVertexNormals();
  return g;
}

/** Annular ridge profile used for the hub, its data band and the frosted lip. */
function ridgeGeometry(inner: number, outer: number, thickness: number, ridge: number, segments = 160) {
  const h = thickness / 2;
  const a = Math.max(0.002, inner);
  const span = Math.max(1e-4, outer - a);
  const pts = [new THREE.Vector2(a, -h), new THREE.Vector2(a, h)];
  for (let i = 0; i <= 5; i++) {
    const t = i / 5;
    pts.push(new THREE.Vector2(a + span * t, h * (1 - ridge) + h * ridge * (0.6 + 0.4 * Math.cos(t * Math.PI * 3))));
  }
  pts.push(new THREE.Vector2(outer, h * 0.92), new THREE.Vector2(outer, -h * 0.92));
  for (let i = 5; i >= 0; i--) {
    const t = i / 5;
    pts.push(new THREE.Vector2(a + span * t, -(h * (1 - ridge) + h * ridge * (0.6 + 0.4 * Math.cos(t * Math.PI * 3)))));
  }
  const g = new THREE.LatheGeometry(pts, segments);
  g.computeVertexNormals();
  return g;
}

// ---------- environment (dark studio with soft strip lights) ----------
function environmentCanvas() {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, '#25282f'); g.addColorStop(0.5, '#0e0f13'); g.addColorStop(1, '#020203');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 512);
  const band = 0.07;
  ([[0.14, band, 1], [0.4, band * 0.7, 0.6], [0.26, band * 1.1, 0.85], [0.62, band * 0.5, 0.35]] as const).forEach(([v, hgt, s]) => {
    const lg = ctx.createLinearGradient(0, 512 * (v - hgt), 0, 512 * (v + hgt));
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, `rgba(255,255,255,${Math.max(0.1, 0.85 * s)})`);
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, 512 * (v - hgt), 1024, 512 * hgt * 2);
  });
  return c;
}

const envByRenderer = new WeakMap<THREE.WebGLRenderer, THREE.WebGLRenderTarget>();
export function environmentFor(renderer: THREE.WebGLRenderer) {
  let rt = envByRenderer.get(renderer);
  if (!rt) {
    const tex = new THREE.CanvasTexture(environmentCanvas());
    tex.mapping = THREE.EquirectangularReflectionMapping;
    // Intentionally left as NoColorSpace (values read as linear), as in the reference:
    // this is what gives the studio env its brightness and the soft strip reflections.
    const pm = new THREE.PMREMGenerator(renderer);
    rt = pm.fromEquirectangular(tex);
    tex.dispose();
    pm.dispose();
    envByRenderer.set(renderer, rt);
  }
  return rt.texture;
}

function matrixCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(256, 256, 40.96, 256, 256, 256);
  g.addColorStop(0, '#d9dde4'); g.addColorStop(0.42, '#f0f2f5'); g.addColorStop(0.72, '#cfd4dc'); g.addColorStop(1, '#b8bec8');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 512);
  [0.255, 0.285, 0.315, 0.345].forEach((r, i) => {
    ctx.strokeStyle = `rgba(255,255,255,${0.14 - i * 0.018})`;
    ctx.beginPath();
    ctx.arc(256, 256, 512 * r, 0, Math.PI * 2);
    ctx.stroke();
  });
  return c;
}

// ---------- renderer pool ----------
// WebGL contexts are expensive to create and every new context recompiles all
// shaders (a multi-hundred-ms stall for the physical materials). Like the
// reference, released renderers are kept (max 2) and handed to the next scene,
// so programs, uploaded textures and the PMREM environment are reused.
const pool: THREE.WebGLRenderer[] = [];

export function acquireRenderer(isSmall: boolean) {
  const r = pool.pop() || createRenderer(isSmall);
  r.setPixelRatio(Math.min(devicePixelRatio || 1, isSmall ? 1.5 : 2));
  r.toneMappingExposure = LOOK.exposure;
  return r;
}

export function releaseRenderer(r: THREE.WebGLRenderer) {
  r.domElement.remove();
  if (pool.length < 2 && !pool.includes(r) && !r.getContext().isContextLost()) {
    r.renderLists.dispose();
    pool.push(r);
    return;
  }
  envByRenderer.get(r)?.dispose();
  envByRenderer.delete(r);
  r.dispose();
  r.forceContextLoss();
}

/** Compile all programs for a scene without blocking (KHR_parallel_shader_compile), with a timeout. */
export function warmUp(r: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, timeout = 1500) {
  return Promise.race([
    (r.compileAsync?.(scene, camera) ?? Promise.resolve()).catch(() => undefined),
    new Promise((res) => setTimeout(res, timeout)),
  ]);
}

/** Run tasks one per idle slot so heavy work never lands inside an animation frame. */
const idleQueue: (() => void)[] = [];
let idleRunning = false;
export function whenIdle<T>(task: () => T | Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    idleQueue.push(() => { Promise.resolve().then(task).then(resolve, reject); });
    if (idleRunning) return;
    idleRunning = true;
    const schedule = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 16));
    const next = () => {
      const job = idleQueue.shift();
      if (!job) { idleRunning = false; return; }
      job();
      schedule(next);
    };
    schedule(next);
  });
}

// ---------- renderer ----------
export function createRenderer(isSmall: boolean) {
  const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, isSmall ? 1.5 : 2));
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = LOOK.exposure;
  r.setClearColor(0x000000, 0);
  // Hub transmission pass at half resolution (reference setting).
  if ('transmissionResolutionScale' in r) (r as unknown as { transmissionResolutionScale: number }).transmissionResolutionScale = 0.5;
  Object.assign(r.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none' });
  return r;
}

/** Studio light rig from the reference: warm key from below-right, cool rim from behind, soft top strip. */
export function addLights(scene: THREE.Scene) {
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  const key = new THREE.DirectionalLight(LOOK.keyColor, LOOK.keyIntensity);
  key.position.set(LOOK.keyX, LOOK.keyY, 6);
  const fill = new THREE.DirectionalLight(0xffffff, LOOK.fillIntensity);
  fill.position.set(-5, -2, 4);
  const rim = new THREE.DirectionalLight(LOOK.rimColor, LOOK.rimIntensity);
  rim.position.set(0, 3, -6);
  const strip = new THREE.RectAreaLight(0xffffff, LOOK.topStripIntensity, 6, 0.4);
  strip.position.set(0, 3.2, 3);
  strip.lookAt(0, 0, 0);
  scene.add(ambient, key, fill, rim, strip);
  return [ambient, key, fill, rim, strip];
}

// ---------- shared assets ----------
export interface DiscAssets {
  front: THREE.BufferGeometry;
  back: THREE.BufferGeometry;
  edge: THREE.BufferGeometry;
  hub: THREE.BufferGeometry;
  matrix: THREE.BufferGeometry;
  frost: THREE.BufferGeometry;
  pick: THREE.BufferGeometry;
  pickMaterial: THREE.MeshBasicMaterial;
  frontNormal: THREE.Texture;
  frontRough: THREE.Texture;
  backMaterial: THREE.MeshPhysicalMaterial;
  edgeMaterial: THREE.MeshPhysicalMaterial;
  hubMaterial: THREE.MeshPhysicalMaterial;
  matrixMaterial: THREE.MeshPhysicalMaterial;
  frostMaterial: THREE.MeshPhysicalMaterial;
  placeholder: THREE.Texture;
  textures: THREE.Texture[];
}

let assetsPromise: Promise<DiscAssets> | null = null;

export function getDiscAssets(): Promise<DiscAssets> {
  assetsPromise ||= (async () => {
    const s: SurfaceSettings = {
      texPrint: LOOK.texPrint, texScratches: LOOK.texScratches, texGrain: LOOK.texGrain, texGloss: LOOK.texGloss,
      frontRough: LOOK.frontRough, backRough: LOOK.backRough, backRadialDetail: LOOK.backRadialDetail,
    };
    const [fn, bn, fr, br] = await Promise.all([
      runJob('frontNormal', 1024, s), runJob('backNormal', 1024, s), runJob('frontRough', 512, s), runJob('backRough', 512, s),
    ]);
    const frontNormal = dataTexture(fn, 1024);
    const backNormal = dataTexture(bn, 1024);
    const frontRough = dataTexture(fr, 512);
    const backRough = dataTexture(br, 512);

    const hole = LOOK.holeSize;
    const hubR = LOOK.hubSize;
    const outer = 1 - LOOK.edgeBleed;
    const front = new THREE.RingGeometry(hubR, outer, 220, 1);
    const back = new THREE.RingGeometry(hubR, outer, 220, 1);
    planarUV(front); planarUV(back);
    const band = hubR - hole;
    const matrixInner = hole + band * 0.34;
    const matrixOuter = matrixInner + band * LOOK.hubMatrixWidth;
    const th = LOOK.discThickness * 1.02;

    const matrixTex = canvasTexture(matrixCanvas(), THREE.SRGBColorSpace);
    const ph = document.createElement('canvas');
    ph.width = ph.height = 16;
    const pctx = ph.getContext('2d')!;
    pctx.fillStyle = '#0c0c0e';
    pctx.fillRect(0, 0, 16, 16);
    const placeholder = canvasTexture(ph, THREE.SRGBColorSpace);

    return {
      front, back,
      edge: edgeGeometry(),
      hub: ridgeGeometry(matrixOuter, hubR, th, 0.22, 160),
      matrix: ridgeGeometry(matrixInner, matrixOuter, th * 0.88, 0.12, 128),
      frost: ridgeGeometry(hole, matrixInner, th * 0.96, 0.4, 128),
      pick: new THREE.CircleGeometry(1, 24),
      pickMaterial: new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide, depthWrite: false }),
      frontNormal, frontRough,
      backMaterial: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(LOOK.backBaseColor), roughness: LOOK.backRough, metalness: LOOK.backMetal, roughnessMap: backRough,
        clearcoat: LOOK.backClearcoat, clearcoatRoughness: 0.06, iridescence: LOOK.backIridescence, iridescenceIOR: LOOK.backIridIOR,
        iridescenceThicknessRange: [140, LOOK.backIridThickness], normalMap: backNormal, normalScale: new THREE.Vector2(0.5, 0.5),
        envMapIntensity: 1.5,
      }),
      edgeMaterial: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(LOOK.edgeColor), roughness: LOOK.edgeRoughness, metalness: LOOK.edgeMetalness,
        clearcoat: 0.7, clearcoatRoughness: 0.05, envMapIntensity: 1.8, side: THREE.DoubleSide,
      }),
      hubMaterial: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(LOOK.hubColor), roughness: LOOK.hubRoughness, metalness: 0, transmission: LOOK.hubTransmission,
        thickness: 0.6, ior: LOOK.hubIOR, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3, transparent: true, side: THREE.DoubleSide,
      }),
      matrixMaterial: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xdfe3e9), map: matrixTex, roughness: 0.28, metalness: 0.82, clearcoat: 0.7, clearcoatRoughness: 0.12,
        envMapIntensity: 1.45, side: THREE.DoubleSide,
      }),
      frostMaterial: new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xeef0f5), roughness: 0.25 + LOOK.hubFrostedEdge * 0.55, metalness: 0,
        transmission: (1 - LOOK.hubFrostedEdge) * 0.5, thickness: 0.3, ior: 1.5, clearcoat: 0.4, clearcoatRoughness: 0.3,
        envMapIntensity: 0.9, transparent: true, side: THREE.DoubleSide,
      }),
      placeholder,
      textures: [frontNormal, backNormal, frontRough, backRough, matrixTex, placeholder],
    } satisfies DiscAssets;
  })();
  return assetsPromise;
}

export function createFrontMaterial(a: DiscAssets) {
  return new THREE.MeshPhysicalMaterial({
    map: a.placeholder, roughness: LOOK.frontRough, metalness: LOOK.frontMetal, roughnessMap: a.frontRough,
    clearcoat: LOOK.frontClearcoat, clearcoatRoughness: 0.18 * (1 - LOOK.texGloss), normalMap: a.frontNormal,
    normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.85,
  });
}

export interface DiscObject {
  group: THREE.Group;
  spin: THREE.Group;
  pick: THREE.Mesh;
  frontMaterial: THREE.MeshPhysicalMaterial;
}

/** One disc: outer group (layout transform) → spin group (user rotation) → meshes. */
export function createDisc(a: DiscAssets): DiscObject {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const frontMaterial = createFrontMaterial(a);
  const th = LOOK.discThickness;
  const front = new THREE.Mesh(a.front, frontMaterial);
  const back = new THREE.Mesh(a.back, a.backMaterial);
  const edge = new THREE.Mesh(a.edge, a.edgeMaterial);
  const hub = new THREE.Mesh(a.hub, a.hubMaterial);
  const matrix = new THREE.Mesh(a.matrix, a.matrixMaterial);
  const frost = new THREE.Mesh(a.frost, a.frostMaterial);
  front.position.z = th / 2 + 6e-4;
  back.position.z = -th / 2 - 6e-4;
  back.rotation.y = Math.PI;
  [edge, hub, matrix, frost].forEach((m) => (m.rotation.x = Math.PI / 2));
  spin.add(front, back, edge, hub, matrix, frost);
  const pick = new THREE.Mesh(a.pick, a.pickMaterial);
  pick.renderOrder = -1;
  group.add(pick);
  return { group, spin, pick, frontMaterial };
}

// ---------- label textures ----------
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Draws art into the label annulus (outer edge, centre hub masked) like a printed disc. */
function composeLabel(src: CanvasImageSource & { width: number; height: number }, p: Project, size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const inner = size * 0.5 * Math.max(LOOK.holeSize, LOOK.hubSize);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.arc(size / 2, size / 2, inner, 0, Math.PI * 2, true);
  ctx.clip('evenodd');
  ctx.fillStyle = '#0c0c0e';
  ctx.fillRect(0, 0, size, size);
  const art = p.art || {};
  ctx.translate(size / 2 + (art.x || 0) * size, size / 2 - (art.y || 0) * size);
  ctx.rotate(THREE.MathUtils.degToRad(art.rotation || 0));
  const aspect = src.width / src.height;
  let w = size * (art.scale || 1), h = w;
  if (aspect > 1) w = h * aspect; else h = w / aspect;
  ctx.drawImage(src, -w / 2, -h / 2, w, h);
  ctx.restore();
  return c;
}

const labelCache = new Map<string, Promise<THREE.Texture | null>>();
export function labelTexture(p: Project): Promise<THREE.Texture | null> {
  let v = labelCache.get(p.slug);
  if (!v) {
    v = (async () => {
      try {
        const src = p.image ? await loadImage(p.image) : await whenIdle(() => generateLabelArt(p, LOOK.artResolution));
        // Canvas compositing runs in an idle slot, never inside an animation frame.
        let label = await whenIdle(() => composeLabel(src, p, LOOK.artResolution));
        // Supplied art gets the logo, printed rim credits (and optionally a title) on top.
        if (p.image) label = await whenIdle(() => drawSuppliedLabelText(label, p));
        const tex = canvasTexture(label, THREE.SRGBColorSpace);
        // Label canvases are drawn with +Y down; ring UVs are +Y up.
        tex.flipY = true;
        return tex;
      } catch (e) {
        console.warn(e);
        return null;
      }
    })();
    labelCache.set(p.slug, v);
  }
  return v;
}
