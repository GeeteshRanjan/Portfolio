import * as THREE from 'three';
import { LOOK, NIGHT as N } from './config';

/**
 * Night mode: a retro enamel pendant (glazed dome, rolled rim, brass collar,
 * cloth cord) on a rise-and-fall cord, hung up and to the left of the stage
 * (where the active disc settles) and aimed at the lower half of the disc.
 *
 * The lamp is a real SpotLight with inverse-square decay, so every way a disc
 * moves (carousel travel, hover tilt, spin drag, flip, press, flights) is lit
 * by the renderer from its actual normals: discs slide into and out of the
 * pool, highlights travel with the surface, the data side only shows the
 * bulb's reflection. Nothing tracks the discs.
 *
 * The room fade belongs to CSS (`--night` in global.css). The scene reads it
 * back, so the page, the fog and the studio rig dim on the same curve.
 *
 * Rig units are disc radii: `place()` scales it by the active disc's radius.
 */

// Enamel dome, rim → neck (rim radius 1). Bulb centre at the origin, light along -Y.
// A bell that flares slightly at the lip, like a 1950s glazed pendant.
const RIM_DEPTH = 1.08;
const PROFILE = [
  [1, -RIM_DEPTH], [0.985, -0.96], [0.955, -0.8], [0.9, -0.6], [0.82, -0.41], [0.71, -0.23],
  [0.58, -0.07], [0.45, 0.07], [0.34, 0.17], [0.26, 0.23], [0.215, 0.26],
].map(([x, y]) => new THREE.Vector2(x, y));
const BEAD = 0.032; // rolled rim bead (tube radius)
const GRIP_TOP = 0.82; // top of the cord grip (last point of the collar profile)
// The rim cuts direct light off at atan(1 / RIM_DEPTH) ≈ 43° (NIGHT.spread goes a little past it).

/** Inside of the shade glows brightest round the bulb and falls off toward the lip (lathe v: rim 0 → neck 1). */
function liningGlow() {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 128, 0, 0); // canvas y is flipped against uv v
  grad.addColorStop(0, '#2a2a2a');
  grad.addColorStop(0.45, '#7a7a7a');
  grad.addColorStop(0.8, '#d6d6d6');
  grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft round glow for the light spilling out of the mouth. */
function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const DOWN = new THREE.Vector3(0, -1, 0);
const WARM = new THREE.Color(N.warm);
const EMBER = new THREE.Color(N.ember);
// Fog is mixed after output encoding, so blend in sRGB like the CSS page colour does.
const FOG_DAY = new THREE.Color(LOOK.fogColor).convertLinearToSRGB();
const FOG_NIGHT = new THREE.Color(N.fog).convertLinearToSRGB();

export class Lamp {
  private root = new THREE.Group(); // cord anchor, above the frame
  private arm = new THREE.Group(); // pendulum about the anchor
  private head = new THREE.Group();
  private cord: THREE.Mesh;
  private spot: THREE.SpotLight;
  private inner: THREE.MeshStandardMaterial;
  private bulb: THREE.MeshStandardMaterial;
  private halo: THREE.SpriteMaterial;
  private fill: THREE.PointLight;
  private owned: { dispose(): void }[];
  private base: number[];
  private room = 0;
  private drop: number; // 0 retracted, 1 hanging
  private dropV = 0;
  private heat = 0; // filament temperature, 0..1
  private swing = new THREE.Vector2(); // rad about x (toward camera) and z (sideways)
  private swingV = new THREE.Vector2();
  private hang = 1; // cord length when hanging
  private grip = new THREE.Vector3(); // bulb → top of the cord grip, disc radii
  private r2 = 1;

  constructor(private scene: THREE.Scene, private studio: THREE.Light[], private on: boolean) {
    this.drop = on ? 1 : 0;
    this.base = studio.map((l) => l.intensity);

    // Glazed enamel and brass get a reflection boost: the room (and so the environment) is at ~5% by night.
    const glaze = { roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.22, envMapIntensity: N.sheen };
    const enamel = new THREE.MeshPhysicalMaterial({ color: N.enamel, ...glaze });
    const trim = new THREE.MeshPhysicalMaterial({ color: N.trim, ...glaze, roughness: 0.4 });
    const brass = new THREE.MeshPhysicalMaterial({ color: N.brass, metalness: 1, roughness: 0.3, envMapIntensity: N.sheen });
    const cloth = new THREE.MeshStandardMaterial({ color: N.cordColor, roughness: 0.9 });
    const glow = liningGlow();
    this.inner = new THREE.MeshStandardMaterial({ color: N.lining, roughness: 0.7, emissive: N.warm, emissiveMap: glow, emissiveIntensity: 0, side: THREE.BackSide });
    this.bulb = new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.25, emissive: N.warm, emissiveIntensity: 0 });
    const haloTex = haloTexture();
    this.halo = new THREE.SpriteMaterial({ map: haloTex, color: N.warm, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });

    const shell = new THREE.LatheGeometry(PROFILE, 72);
    const bead = new THREE.TorusGeometry(1, BEAD, 10, 72).rotateX(Math.PI / 2).translate(0, -RIM_DEPTH, 0);
    // Brass collar over the neck (stepped ring, sleeve, cap), then a narrow cord grip.
    const collar = new THREE.LatheGeometry(
      [[0.27, 0.215], [0.285, 0.23], [0.285, 0.27], [0.22, 0.29], [0.22, 0.5], [0.24, 0.515], [0.24, 0.55], [0.16, 0.58], [0.08, 0.6], [0.065, 0.78], [0.075, 0.8], [0, GRIP_TOP]]
        .map(([x, y]) => new THREE.Vector2(x, y)),
      48,
    );
    const bulbGeo = new THREE.SphereGeometry(0.22, 24, 12);
    const cordGeo = new THREE.CylinderGeometry(0.008, 0.008, 1, 8, 1, true).translate(0, -0.5, 0);
    this.owned = [enamel, trim, brass, cloth, glow, this.inner, this.bulb, haloTex, this.halo, shell, bead, collar, bulbGeo, cordGeo];

    this.cord = new THREE.Mesh(cordGeo, cloth);
    // Full strength inside `core`, smooth fall-off to `spread` (a little past the rim cut-off: the lining's spill).
    const spread = THREE.MathUtils.degToRad(Math.max(N.spread, N.core + 1));
    this.spot = new THREE.SpotLight(N.warm, 0, 0, spread, 1 - THREE.MathUtils.degToRad(N.core) / spread, 2);
    this.spot.position.set(0, 0, 0); // SpotLight defaults to (0, 1, 0): put it in the bulb
    this.spot.target.position.copy(DOWN);
    const halo = new THREE.Sprite(this.halo);
    halo.position.y = -RIM_DEPTH * 0.92; // just inside the lip, so the glow reads as light leaving the mouth
    halo.scale.setScalar(2.4);
    halo.visible = N.halo > 0;
    this.head.scale.setScalar(N.size);
    this.head.add(
      new THREE.Mesh(shell, enamel), new THREE.Mesh(shell, this.inner), new THREE.Mesh(bead, trim), new THREE.Mesh(collar, brass),
      new THREE.Mesh(bulbGeo, this.bulb), halo, this.spot, this.spot.target,
    );
    // Glow the lit pool throws back into the room, just enough to model the enamel and brass.
    // Short range (in disc radii), so it never reaches the discs. Always in the scene, like the spot.
    this.fill = new THREE.PointLight(N.fillColor, 0, N.fillRange, 2);
    this.arm.add(this.cord, this.head, this.fill);
    this.root.add(this.arm);
    scene.add(this.root);
  }

  /** Hang the lamp at `offset` (disc radii) from the stage, aimed at `aim`, cord running up out of frame. */
  place(stage: THREE.Vector3, aim: THREE.Vector3, radius: number, camera: THREE.PerspectiveCamera, offset: readonly [number, number, number]) {
    const bulb = new THREE.Vector3(...offset).multiplyScalar(radius).add(stage);
    this.head.quaternion.setFromUnitVectors(DOWN, aim.clone().sub(bulb).normalize());
    // The cord ends in the cord grip on top of the tilted shade, not at the bulb.
    this.grip.set(0, GRIP_TOP * N.size, 0).applyQuaternion(this.head.quaternion);
    const end = bulb.clone().addScaledVector(this.grip, radius);
    const top = (camera.position.z - end.z) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    this.hang = Math.max(0, top - end.y) / radius + N.ceiling;
    this.root.position.set(end.x, end.y + this.hang * radius, end.z);
    this.root.scale.setScalar(radius);
    this.r2 = radius * radius; // keeps irradiance at the disc constant under inverse-square
    this.fill.distance = N.fillRange * radius; // light range is in world units, not scaled by the parent
    this.pose();
  }

  set(on: boolean, reduced: boolean) {
    if (on === this.on) return;
    this.on = on;
    // The reel lets go with a small jolt; the pendulum takes it from there.
    if (on && !reduced && this.drop < 0.5) this.swingV.set(N.swingKick[0], N.swingKick[1]);
  }

  /** Steps the lamp. Returns true while anything is still moving. */
  update(dt: number, reduced: boolean) {
    let busy = false;
    if (this.room !== (this.on ? 1 : 0)) {
      const r = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--night')) || 0;
      if (r !== this.room) { this.room = r; this.dim(); busy = true; }
    }
    // Cord: a damped spring toward hanging, or retracted once the bulb has cooled.
    const hang = this.on || this.heat > 0.05 ? 1 : 0;
    if (reduced) { this.drop = hang; this.dropV = 0; } else if (this.drop !== hang) {
      const w = 2 * Math.PI * N.dropHz;
      this.dropV += ((hang - this.drop) * w * w - 2 * N.dropDamping * w * this.dropV) * dt;
      this.drop += this.dropV * dt;
      if (Math.abs(hang - this.drop) < 1e-4 && Math.abs(this.dropV) < 1e-3) { this.drop = hang; this.dropV = 0; }
      busy = true;
    }
    // Filament: switches on as the lamp arrives, heats fast, cools slower.
    const hot = this.on && this.drop > 0.9 ? 1 : 0;
    if (this.heat !== hot) {
      this.heat += (hot - this.heat) * (1 - Math.exp(-dt / (hot ? N.heatOn : N.heatOff)));
      if (Math.abs(hot - this.heat) < 1e-3) this.heat = hot;
      busy = true;
    }
    // Pendulum (small-angle, damped; amplitude decays with swingDecay) until the sway is sub-pixel (~0.03°).
    const w = (2 * Math.PI) / N.swingPeriod;
    if (this.swing.lengthSq() + this.swingV.lengthSq() / (w * w) > 2.5e-7) {
      this.swingV.addScaledVector(this.swing, -w * w * dt).multiplyScalar(Math.exp((-2 * dt) / N.swingDecay));
      this.swing.addScaledVector(this.swingV, dt);
      busy = true;
    } else if (this.swing.x || this.swing.y) {
      this.swing.set(0, 0);
      this.swingV.set(0, 0);
      busy = true;
    }
    if (busy) this.pose();
    return busy;
  }

  private dim() {
    const f = 1 - this.room * (1 - N.room);
    this.studio.forEach((l, i) => (l.intensity = this.base[i] * f));
    this.scene.environmentIntensity = LOOK.environmentIntensity * f;
    (this.scene.fog as THREE.Fog).color.lerpColors(FOG_DAY, FOG_NIGHT, this.room).convertSRGBToLinear();
  }

  private pose() {
    const len = Math.max(1e-3, this.drop * this.hang);
    this.cord.scale.y = len;
    this.head.position.set(-this.grip.x, -len - this.grip.y, -this.grip.z);
    this.fill.position.set(this.head.position.x + N.fillAt[0], this.head.position.y + N.fillAt[1], this.head.position.z + N.fillAt[2]);
    this.arm.rotation.set(this.swing.x, 0, this.swing.y);
    // Visible output climbs steeply with filament temperature; colour runs ember → warm white.
    const glow = this.heat ** 3;
    this.spot.color.lerpColors(EMBER, WARM, this.heat);
    this.spot.intensity = N.intensity * this.r2 * glow;
    this.inner.emissive.copy(this.spot.color);
    this.inner.emissiveIntensity = 1.2 * glow;
    this.bulb.emissive.copy(this.spot.color);
    this.bulb.emissiveIntensity = 6 * glow;
    this.halo.color.copy(this.spot.color);
    this.halo.opacity = N.halo * glow;
    this.fill.intensity = N.fill * this.r2 * glow;
  }

  dispose() {
    this.scene.remove(this.root);
    this.spot.dispose();
    this.fill.dispose();
    this.owned.forEach((o) => o.dispose());
  }
}
