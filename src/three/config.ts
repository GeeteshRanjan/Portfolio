/**
 * Disc look + gallery behaviour. Values mirror the reference configuration
 * (REFERENCE_ANALYSIS.md §3–§6). Tune here, never in the engine.
 */
export const LOOK = {
  // Label surface
  texGrain: 0.59,
  texPrint: 0.35,
  texScratches: 0.36,
  texGloss: 1,
  frontClearcoat: 0.8,
  frontRough: 0.42,
  frontMetal: 0.48,
  // Data side
  backBaseColor: '#1A1E2A',
  backRough: 0.23,
  backMetal: 1,
  backClearcoat: 0.34,
  backIridescence: 1,
  backIridIOR: 1.86,
  backIridThickness: 900,
  backRadialDetail: 1,
  // Rim + hub
  edgeColor: '#FFFFFF',
  edgeRoughness: 0.04,
  edgeMetalness: 0.55,
  edgeBleed: 0.026,
  hubColor: '#FFFFFF',
  hubTransmission: 0.68,
  hubRoughness: 0.38,
  hubIOR: 2,
  hubMatrixWidth: 0.4,
  hubFrostedEdge: 0.54,
  discThickness: 0.01,
  edgeBevel: 1,
  holeSize: 0.14,
  hubSize: 0.24,
  // Camera + light
  cameraDistance: 4.4,
  cameraFOV: 40,
  exposure: 0.86,
  environmentIntensity: 1,
  keyIntensity: 0.75,
  keyColor: '#FFF9E8',
  keyX: 3.5,
  keyY: -8,
  fillIntensity: 0.3,
  rimIntensity: 0.75,
  rimColor: '#499FF5',
  topStripIntensity: 1.9,
  fogColor: '#FFFFFF',
  artResolution: 1024,
} as const;

export const GALLERY = {
  galleryScale: 1.08,
  hGap: 2.3,
  depthGap: 1,
  activeDiscY: 0.06,
  galleryRotX: -30,
  galleryRotY: -30,
  inactiveScale: 0.8,
  hoverTiltStrength: 0.21,
  dragSensitivity: 0.95,
  dragVelocitySmoothing: 0.32,
  dragMaxVelocity: 0.5,
  friction: 0.89,
  maxSpinAngle: 180,
  resetDuration: 1.2,
  dragStartDistance: 5,
  snapDuration: 0.46,
  flowLean: 0.055,
  flowLeanMax: 0.3,
  flowBank: 0.32,
  flowDip: 0.014,
  flowDipMax: 0.09,
  followTight: 15,
  followBase: 11,
  followFalloff: 1.15,
  followMin: 6.5,
  spawnSlide: 0.9,
  spawnShrink: 0.72,
  snapFreq: 9.5,
  snapDamping: 12,
  wipePush: 0.012,
  wipePushMax: 0.5,
  wipeSpin: 0.009,
  wipeSpinMax: 0.4,
  wipeMinSpeed: 9,
  pushDamping: 4.5,
  pushReturn: 3.4,
  pressDepth: 0.55,
  pressTilt: 1.5,
  flightRecede: 2.2,
  flightStagger: 0.45,
  flightStaggerIn: 0.28,
  flightStaggerMax: 4,
  flightPopScale: 0.35,
  flightPopScaleIn: 0.02,
  preloadBoost: 0.8,
  preloadGrowBy: 0.5,
  preloadSpin: 1.1,
  preloadRiseFrom: 3,
  preloadRiseDepth: 0.7,
  preloadFanDuration: 1.15,
  // Touch layout
  touchFlickVelocity: 0.035,
  touchPeek: 1,
  touchMinScale: 0.3,
  touchMaxScale: 3,
  touchGap: 2.2,
  touchDepth: 0.5,
  touchLeadMaxHeight: 0.6,
  touchDropY: 1,
  touchActiveScale: 1.5,
  touchInactiveScale: 0.6,
  // Wheel intent
  wheelNoiseFloor: 0.3,
  wheelStepThreshold: 6,
  wheelEventCap: 24,
  wheelEnvelopeTau: 550,
  wheelRiseFactor: 1.2,
  wheelTickGap: 34,
  wheelTickRatio: 1,
  wheelPauseGap: 130,
  wheelIdleReset: 150,
  wheelMinStepTick: 90,
  wheelMinStepFlick: 190,
  wheelSustainDelay: 480,
  wheelSustainRatio: 0.8,
  // Scribble
  scribbleColor: '#000000',
  scribbleFps: 10,
  scribblePoints: 24,
  scribbleJitter: 0.028,
  scribbleLoops: 2,
  scribbleLoopGap: 0.045,
  scribblePadding: 0.06,
  scribbleWidth: 0.012,
  scribbleSweep: 0.68,
  scribbleSweepJitter: 0.4,
  scribbleIn: [0.3, 0.5, 0.72],
  scribbleOut: [0.72, 0.5, 0.3],
  scribbleLag: 15,
  // Gallery hover note: its arrow points here (disc-plane, unit radius; just outside the ring, lower right).
  noteAnchor: [0.86, -0.86],
  renderRadius: 5,
} as const;

export type GalleryConfig = typeof GALLERY;

/**
 * Night mode (Lamp.ts): the studio rig dims and a pendant lamp lights the stage.
 * Lengths are in disc radii (the lamp scales with the active disc).
 */
export const NIGHT = {
  room: 0.05, // share of the studio rig + environment left on at night (bounce light)
  fog: '#0c0b0a', // must equal the night --bg in global.css
  warm: '#ffc98f', // filament at full heat (~3000 K)
  ember: '#ff5a14', // filament while heating / cooling
  // Retro enamel pendant: cream glazed dome, dark rolled rim, brass collar, cloth cord.
  enamel: '#e8dfcc', // shade outside
  trim: '#2a2622', // rolled rim bead
  lining: '#f3eee4', // shade inside (lit by the bulb)
  brass: '#b48a4e', // collar + cord grip
  cordColor: '#6b4a36', // braided cloth cord
  sheen: 6, // reflection boost on the glazed/metal parts, so they still read in the dark room
  halo: 0.32, // soft glow of the light leaving the mouth (0 = off)
  // Faint warm fill on the lamp itself (the lit pool bouncing back), so the glaze and brass read.
  fill: 0.05, // candela at disc radius 1
  fillColor: '#ffb877',
  fillAt: [0.15, 0.1, 0.45], // from the shade, disc radii (toward the camera)
  fillRange: 0.8, // cut-off distance (disc radii); keep it short of the discs
  intensity: 7, // candela at disc radius 1 (scaled by radius², i.e. inverse-square)
  // The title sits ~30–43° from the beam axis: a narrow core would leave it dim, a wide one flattens the pool.
  core: 20, // full-strength cone (deg)
  spread: 62, // light fades to zero here (deg); the shade's rim cut-off is ~43°, the rest is spill off the lining
  size: 0.2, // shade rim radius
  // Bulb position from the stage (world axes, disc radii): up, left and toward the camera.
  // Must stay in front of the label face (offset · disc normal > 0). The bulb's mirror glint is the
  // brightest thing on the label, so the lamp is placed where it lands on the aim point (middle of
  // the lower-right quadrant); the camera still sees a sliver of the lit lining. Moving the lamp
  // back (−z) or up pushes the glint toward the hub and then onto the title.
  offset: [-0.9, 0.8, 0.8],
  offsetTouch: [-0.9, 0.95, 1.1],
  // Where the beam points, on the active disc (disc-local, radii from its centre): the middle of
  // the lower-right quadrant (~0.6 radii out on the diagonal).
  aim: [0.4, -0.45],
  aimTouch: [0.4, -0.45],
  ceiling: 0.6, // cord anchor above the top of the frame
  dropHz: 1.1, // cord spring
  dropDamping: 0.7,
  heatOn: 0.08, // filament time constants (s)
  heatOff: 0.2,
  swingPeriod: 2, // pendulum (s), reads as a ~1 m cord
  swingDecay: 1.1,
  swingKick: [0.035, 0.12], // rad/s from the reel's release (toward camera, sideways)
} as const;
