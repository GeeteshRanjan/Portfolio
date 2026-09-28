import * as THREE from 'three';
import type { Project } from '../content/types';
import { LOOK } from './config';
import { acquireRenderer, addLights, createDisc, environmentFor, getDiscAssets, labelTexture, releaseRenderer, warmUp, whenIdle, type DiscObject } from './discAssets';

/**
 * Single-disc scene for the end-of-page "next project" section.
 * Hierarchy: tilt (pose, position, scale) → wobble (idle sway) → spin (label rotation).
 * The controller in motion/ScrollNext.ts drives every value; this class only
 * places, renders and hit-tests.
 */
export class NextDisc {
  renderer!: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(LOOK.cameraFOV, 1, 0.1, 100);
  tilt = new THREE.Group();
  disc!: DiscObject;
  width = 1;
  height = 1;
  ready = false;
  private ro?: ResizeObserver;
  private disposed = false;

  constructor(private mount: HTMLElement, private project: Project) {}

  async init() {
    this.renderer = acquireRenderer(innerWidth <= 767);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.mount.replaceChildren(this.renderer.domElement);
    this.camera.position.set(0, 0, LOOK.cameraDistance);
    this.camera.lookAt(0, 0, 0);
    addLights(this.scene);
    const a = await getDiscAssets();
    if (this.disposed) return;
    this.scene.environment = environmentFor(this.renderer);
    this.disc = createDisc(a);
    this.tilt.add(this.disc.group);
    this.scene.add(this.tilt);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.mount);
    const tex = await labelTexture(this.project);
    if (tex) {
      this.disc.frontMaterial.map = tex;
      this.disc.frontMaterial.needsUpdate = true;
      await whenIdle(() => this.renderer.initTexture(tex));
    }
    // Compile off the main thread before the first visible frame (avoids a link stall mid-scroll).
    await warmUp(this.renderer, this.scene, this.camera);
    if (this.disposed) return;
    this.ready = true;
  }

  resize() {
    this.width = Math.max(1, this.mount.clientWidth);
    this.height = Math.max(1, this.mount.clientHeight);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** World units per CSS pixel on the z=0 plane. */
  get unit() {
    return (2 * LOOK.cameraDistance * Math.tan(THREE.MathUtils.degToRad(LOOK.cameraFOV / 2))) / this.height;
  }

  /** Place the disc centre at canvas px (cx, cy) with radius r px. */
  place(cx: number, cy: number, r: number) {
    const k = this.unit;
    this.tilt.position.set((cx - this.width / 2) * k, -(cy - this.height / 2) * k, 0);
    this.tilt.scale.setScalar(Math.max(1e-4, r * k));
  }

  render() {
    if (this.ready) this.renderer.render(this.scene, this.camera);
  }

  /** Point-in-disc test in canvas px (projects the rim). */
  hit(x: number, y: number) {
    if (!this.ready || !this.tilt.visible) return false;
    this.tilt.updateMatrixWorld(true);
    const nx = (x / this.width) * 2 - 1, ny = 1 - (y / this.height) * 2;
    const v = new THREE.Vector3();
    const poly: [number, number][] = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      v.set(Math.cos(a), Math.sin(a), 0).applyMatrix4(this.disc.group.matrixWorld).project(this.camera);
      poly.push([v.x, v.y]);
    }
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > ny !== yj > ny && nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ready = false;
    this.ro?.disconnect();
    this.disc?.frontMaterial.dispose();
    this.scene.clear();
    if (this.renderer) releaseRenderer(this.renderer);
  }
}
