# Reference analysis — interaction system

Reference: https://a24.raviklaassens.com/ (inspected 2026-09-26).
Purpose: capture the interaction, motion, lighting and material system so it can be transplanted onto different content. No branding, copy, artwork or metadata from the reference is reused.

## 0. How this was determined

- Every value marked `[source]` was read directly from the shipped, unminified-by-hand bundle `_astro/main.qdXy8l6N.js` (beautified copy in `reference/source/pretty/`). The gallery exposes its tunables as a config object and a runtime debug API (`element.discGalleryDebug.state()`), which was sampled during scripted interactions.
- Values marked `[measured]` come from Playwright sessions (`reference/tools/interact.js`, `detail.js`) with screenshots in `reference/screenshots/` and videos in `reference/recordings/` (`.webm`, since Playwright records WebM and no ffmpeg was available for MP4 conversion).
- Values marked `[inference]` could not be read or measured directly.

## 1. Technology stack `[source]`

| Concern | Technology |
|---|---|
| Site shell | Webflow export rendered by Astro; Barba.js page transitions |
| 3D | Three.js r178, `WebGLRenderer` (alpha, antialias, `ACESFilmicToneMapping`, exposure 0.86, sRGB output, `transmissionResolutionScale` 0.5). Imperative, no React/R3F |
| Lights | `AmbientLight`, 3× `DirectionalLight`, 1× `RectAreaLight` (+ `RectAreaLightUniformsLib`) |
| Environment | Procedural equirect canvas → `PMREMGenerator` → `scene.environment` |
| Materials | `MeshPhysicalMaterial` everywhere (clearcoat, iridescence, transmission) |
| Geometry | `RingGeometry` faces, `LatheGeometry` edge/hub, `CircleGeometry` invisible pick mesh |
| Procedural textures | Normal + roughness maps generated in a Web Worker (Blob URL) into canvases, cached globally |
| Animation | GSAP 3.15 core + `CustomEase` + `ScrollTrigger` + `SplitText`. **No** Draggable, InertiaPlugin, Flip or Observer in use for these interactions (they are bundled but the gallery implements its own physics) |
| Smooth scroll | Lenis 1.3.26 (`lerp .165`, `wheelMultiplier 1.25`; `lerp 1` on coarse pointers). The gallery sets `data-lenis-prevent` and consumes wheel itself |
| Render loop | Render-on-demand `requestAnimationFrame` loop; stops when idle, resumes on input. Adaptive resolution (render scale 1 → .85 → .7 → .55 if avg frame > 26.5 ms), pixel budget 12 MP, DPR cap 2 (1.5 mobile) |
| Grain | Fixed full-screen noise AVIF, `opacity .2`, `steps` keyframe jitter every 0.6 s |
| Fonts | High-contrast display serif (headings), neo-grotesk (body), spaced small-caps serif (eyebrows). Proprietary — replaced with open fonts in the implementation |

Global easing: `CustomEase "main" = 0.625, 0.05, 0, 1`, default duration 0.6 s. Gallery ease `discGlide = 0.32, 0.72, 0, 1` (same curve as `energy` used for text).

## 2. Page architecture

Home page is exactly one viewport tall (`scrollHeight 900 == innerHeight 900` `[measured]`). There is no document scroll; wheel/trackpad input steps the carousel. Layers, back to front:

1. Background `#f2f2f2`.
2. Canvas (`pointer-events:none`, absolute inset 0). All hit-testing is done by raycasting from the gallery wrapper's pointer events.
3. Info panel top-left (≈ 20.8% width): title (display serif, uppercase), then 3 rows "label (eyebrow) ↔ value (right-aligned)", each with a 1px rule above.
4. Quote strip bottom-centre: two columns, stars, source (eyebrow), quote (display serif uppercase, balanced into 2 lines with typographic quotes).
5. Nav top-centre (logo, two section links with active dot, index dropdown). On mobile the nav moves to a bottom pill.
6. Grain overlay (`z 99`).

Detail page (`/production/<slug>`, 3272 px tall at 900 vh `[measured]`): hero (title, metadata table, CTAs) with an organic "dissolve" bottom edge → full-bleed image (parallax) → description → "scroll-next" section that leads to the next item.

## 3. 3D scene `[source]`

```
Scene
 ├─ Fog(#FFFFFF, near 7, far 14)            // fades far discs toward white
 ├─ PerspectiveCamera(fov 40, near .1, far 100) at (0,0,4.4) looking at origin
 ├─ AmbientLight(#fff, .25)
 ├─ DirectionalLight key  (#FFF9E8, .75) at (3.5, -8, 6)   // warm, from below-right
 ├─ DirectionalLight fill (#fff, .30)    at (-5, -2, 4)
 ├─ DirectionalLight rim  (#499FF5, .75) at (0, 3, -6)     // cool blue from behind/top
 ├─ RectAreaLight strip   (#fff, 1.9, 6 × .4) at (0, 3.2, 3) lookAt origin  // soft top highlight band
 └─ Group "gallery"  rotation.x = -30°, rotation.y = -30°, scale 1.08
      └─ per disc: Group(position/rotation/scale) → Group "spin" (user spin) → meshes
```

Environment map: 1024×512 canvas, vertical gradient `#25282f → #0e0f13 → #020203`, plus four soft white horizontal bands at v = .14, .26, .40, .62 (heights .07·[1, 1.1, .7, .5], opacities .85·[1, .85, .6, .35]). PMREM-filtered. This dark studio env with white strip-lights is what makes the rim and hub read as satin metal rather than chrome. `environmentIntensity 1`.

### Disc construction (unit radius 1)

| Part | Geometry | Material |
|---|---|---|
| Front label | `RingGeometry(hub .24 → 1-edgeBleed .974, 220 seg)`, planar UVs | Physical: `map` = artwork, `roughness .42`, `metalness .48`, `roughnessMap` (procedural), `clearcoat .8`, `clearcoatRoughness 0`, `normalMap` (procedural, scale .3), `envMapIntensity .85` |
| Back (data side) | Same ring, rotated π | Physical: `#1A1E2A`, `roughness .23`, `metalness 1`, `clearcoat .34 / .06`, `iridescence 1`, `iridescenceIOR 1.86`, thickness range `[140, 900]`, radial normal map (scale .5), `envMapIntensity 1.5` |
| Outer edge | `LatheGeometry` bevelled profile, 256 seg, thickness .01 | Physical white, `roughness .04`, `metalness .55`, `clearcoat .7/.05`, `envMapIntensity 1.8` |
| Hub | Lathe ring .?→.24 with a cosine ridge profile | Physical white, `transmission .68`, `roughness .38`, `ior 2`, `thickness .6`, `clearcoat 1/.04` |
| Hub "matrix" band | Lathe ring | Physical `#DFE3E9` + concentric-ring canvas map, `roughness .28`, `metalness .82` |
| Frosted inner lip | Lathe ring from hole .14 | Physical `#EEF0F5`, `roughness .55`, `transmission .23`, `ior 1.5` |
| Pick | `CircleGeometry(1, 24)`, invisible | used for raycast + UV (hover tilt direction, press tilt) |

Procedural maps (worker):
- Front normal: faint concentric sine (`sin(r·.6)·.02`), ink noise (`texPrint .35`), ~11 random linear scratches, ~180 dust specks. Front roughness: base .42 ± grain noise, minus concentric gloss rings `sin(r·14)` → visible radial sheen bands when light passes.
- Back normal: strong `sin(r·3.2)` rings → moiré-like iridescent grooves. Back roughness .23 ± radial variation.
- Artwork is drawn into a square canvas (1024) clipped to the annulus, background `#0c0c0e`.

Result: highlights move as broad, soft bands across the label (clearcoat + RectAreaLight strip), a crisp specular line runs along the rim, the hub reads as frosted glass, and the back shows a green/magenta iridescent sheen when flipped (`reference/screenshots/space-flip-4.png`).

## 4. Carousel layout model `[source]`

Continuous position `L` (float index). For each visible disc with index `p`, `m = p - L`, `h = |m|`, `θ = m · 0.35`:

```
x = sin(θ) · hGap(2.3) · 2.4
z = -cos(θ) · depth · 2.4 + depth · 2.4          depth = max(.03, .12, depthGap 1) = 1
y = (active ? activeDiscY .06 : 0) - dip · (active ? .7 : 1)
rotY = -θ + lean · (active ? 1 : 1.12)
rotZ = -lean · flowBank(.32) · (active ? .7 : 1)
rotX = hover tilt
scale = active ? 1 : max(inactiveScale .8, 1 - h · .2 · .6)
```
Positions are in the rotated gallery group, so the arc recedes diagonally from bottom-left to top-right in screen space (screenshot `01-initial.png`). Render radius 5 (up to 13 pooled disc objects); textures beyond radius are disposed (LRU cap 16).

Per-disc follow: every transform channel lerps toward its target with factor `A = min(1, dt · k)`, `k = clamp(base − h · 1.15, 6.5, 15)`, `base = 15` while dragging, `11` otherwise. Near discs track tightly, far discs trail — the carousel "ripples" rather than moving rigidly.

"Flow" velocity `Ce`: smoothed dL/dt (rise rate 14, fall rate 6, clamp ±40). Derived:
- `lean = clamp(sign(Ce)·sqrt|Ce|·.055, ±.3)` → discs yaw into the direction of travel.
- `dip = min(.09, |Ce|·.014)` → discs sink slightly while moving.
- bank = roll around Z.

Newly assigned discs at the edges spawn offset: `x += dir·.9`, `z -= .45`, `rotY -= dir·.3`, `scale ·= .72`, then follow in.

## 5. Interaction specification

INTERACTION: Initial load / preloader
Trigger: First visit (skipped under reduced motion)
Affected element: Lead disc, counter, side labels, other discs, info panel, nav
Visual result: Large rolling-digit counter (odometer drums, 5% per digit) orbits around the lead disc on an arc while the disc rises from below and turns from edge-on to face-on. Counter beats: label → random 40–52 → random 68–80 → 100. Side labels ("<section name>" left, year odometer right) slide up from 120%. At 100 the counter glyphs are pushed up (yPercent −110, stagger .14) by the growing disc, then the other discs fan out.
Movement: Disc rises from `y −3` (clamped so it clears the counter) and `z −.7`, `rise = easeOutCubic`
Rotation: `spinY` from −90° → 0 (`turn`, ease `1-(1-t)^2.4`), spin Z from 1.1 rad → 0 (quadratic)
Scale: active scale .001 → .8 (`preloadBoost`) during first 50% of rise, → 1 in fan
Position: Counter position = disc centre + orbit (theta 0 → π over beats, power2.inOut)
Depth: Others recede (`z -= (1-s)·2.2`) and pop in when `s > .35`
Lighting: unchanged
Material: unchanged
Opacity: text via transforms only
Duration: min 2.85 s; fan 1.15 s; exit labels .5 s power3.in stagger .04
Easing: progress chases target with `1 - exp(-8·dt)`; fan `discGlide`
Inertia: none
Damping: exponential chase (8/s)
Scroll relationship: scroll locked during preload
Pointer relationship: none
Likely technology: GSAP tweens + custom rAF, Three.js
Confidence: High `[source]` (`reference/screenshots/intro-*.png`)
Implementation recommendation: Reproduce as a timeline driven by real texture-load progress, minimum duration ~2.85 s, odometer drums in DOM, disc pose via the gallery API (`pose({turn, rise})`, `fan()`).

INTERACTION: Pointer hover over a disc
Trigger: `pointermove` over gallery (fine pointers only), raycast against pick circles
Affected element: Hovered disc
Visual result: Disc tilts toward the pointer; cursor becomes `pointer` (else `grab`)
Movement: none (rotation only)
Rotation: `rotX += hover · .21 · ndcY`, `rotY += hover · .21 · ndcX` (screen NDC of pointer, not disc-local)
Scale: none
Position: none
Depth: none
Lighting: highlight bands slide across label as the disc tilts (material/light, not overlay)
Material: n/a
Opacity: n/a
Duration: `hover` weight approaches 1 at `min(1, dt·10)` per frame (~100 ms time constant)
Easing: exponential
Inertia: none
Damping: per-disc follow lerp (k 6.5–15)
Scroll relationship: none
Pointer relationship: direct, normalised device coordinates
Likely technology: Three.js raycaster + custom lerp
Confidence: High `[source]`, `[measured]` (`hover-tilt-*.png`)
Implementation recommendation: Hover weight per disc, tilt from NDC, applied through the same follow lerp as layout so it feels weighted.

INTERACTION: Pointer "wipe" (fast pass across a disc)
Trigger: Pointer enters a different disc with speed ≥ 9 px/frame
Affected element: Newly hovered disc
Visual result: Disc is nudged along the pointer path and wobbles back
Movement: `pushV += clamp(v·.012, ±.5)` (x, −y)
Rotation: `pushRotV += clamp(v·.009, ±.4)`
Scale: none
Depth: none
Duration: ~0.6–1 s settle
Easing: damped spring: velocity `*= exp(-4.5·dt)`, position `-= pos·min(1, dt·3.4)`
Inertia: yes (impulse)
Damping: 4.5 / return 3.4
Pointer relationship: impulse proportional to pointer velocity (px per 16.7 ms)
Likely technology: custom physics
Confidence: High `[source]`
Implementation recommendation: Per-disc push state (pos + vel for x/y/z/rotX/rotY), integrated in the render loop.

INTERACTION: Hand-drawn scribble around the active disc
Trigger: Pointer hovering the active disc (and item has a destination), or keyboard navigation
Affected element: Scribble mesh attached to the gallery group (inherits the disc's plane/perspective, not its user spin)
Visual result: Two loose, thin black loops around the disc, each an incomplete arc (~68% ± 20% of a turn), random start angle, radius `1.06` and `1.105`, per-point radial jitter ±2.8% (24 control points, smoothstep-interpolated), line width .012 with tapered ends. Redrawn with fresh randomness at **10 fps**, so the line "boils" like hand-drawn animation.
Movement: follows disc with lag: `lerp/slerp factor 1 - exp(-15·dt)`; snaps when disc is settled
Rotation: in gallery plane (appears as a perspective ellipse)
Scale: follows disc scale
Draw-in: 3 frames at sweep ×[.3, .5, .72] then 1; draw-out: ×[.72, .5, .3] then hidden (100 ms per frame → ~400 ms in, ~400 ms out)
Opacity: none (pure geometry)
Easing: stepped (10 fps)
Likely technology: Three.js ribbon `BufferGeometry` + `MeshBasicMaterial` (not SVG)
Confidence: High `[source]`, `[measured]` (`hover-scribble-*.png`, `hover-out-*.png`)
Implementation recommendation: The brief requires SVG. Render the same algorithm as an SVG overlay: sample the loop in gallery-plane space, project each point through the camera to screen, build a variable-width filled path (tapered ribbon). Regenerate at 10 fps, sweep frames as above, draw with a dash reveal on the first frame. Result keeps perspective fidelity and "boil".

INTERACTION: Drag on the active disc (spin)
Trigger: `pointerdown` on the active disc (within .6 of L) + move > 5 px
Affected element: Active disc "spin" group
Visual result: Disc turns in 3D like a coin under the finger; scribble stays in the gallery plane
Rotation: `spinY += dx · .95 · .0045`, `spinX += dy · .95 · .0045`, with soft limit: beyond 80% of 180°, same-direction deltas are attenuated by `1 / (1 + r²·14)`
Position/Scale: none
Lighting: highlights sweep dramatically as the face angle changes; back side iridescence shows past 90°
Duration on release: tween spinX/spinY → 0 in 1.2 s `power3.out`
Inertia: none (spring-back tween)
Cursor: `grabbing`, `user-select:none`
Likely technology: pointer capture + custom
Confidence: High `[source]`, `[measured]` (`drag-disc-*.png`)
Implementation recommendation: Pointer capture on wrapper, window listeners for move/up, same constants.

INTERACTION: Drag on empty space (scrub carousel)
Trigger: `pointerdown` not on the active disc + move > 5 px
Affected element: Carousel position L
Visual result: Whole arc slides with the pointer; discs lean and dip into the motion; far discs trail
Movement: `L -= dx / width · 6 · .95` (mouse), touch span ≈ fitted value (≈1.8)
Inertia: on release (mouse) velocity continues: `L += v·frames`, `v *= .89^frames`; `v` sampled as `clamp(16.667/dt · dL, ±.5)`, smoothed `v += (s - v)·.32`
Settle: after inertia, critically-damped-ish spring to nearest integer: `a = (round(L) - L)·9.5²`, `v *= exp(-12·dt)`
Touch release: flick — if |v| ≥ .035 go to next/prev integer in that direction, else nearest; tween `snapDuration + .1` s
Info panel: text transitions out while dragging, reveals ≤ 500 ms after settle
Likely technology: custom physics in the render loop
Confidence: High `[source]`, `[measured]` (dragVelocity decays .0444 → .0004 over ~17 frames, then spring engages)
Implementation recommendation: Identical integrator. GSAP Draggable/InertiaPlugin cannot target a raycast-selected WebGL object whose behaviour changes by hit result, so the reference's own physics is the correct match.

INTERACTION: Wheel / trackpad
Trigger: `wheel` on gallery (captured, `preventDefault`)
Affected element: Carousel
Visual result: One gesture = one step, regardless of trackpad momentum. Fast repeated flicks advance multiple items.
Gesture detection: exponential envelope `τ = 550 ms`, noise floor .3, step accumulator threshold 6 (per-event cap 24). A new step within a gesture requires a pause ≥ 130 ms, or a "tick" gap ≥ 34 ms with ≥ 90 ms since last step, or a rising flick (1.2× envelope) ≥ 190 ms, or sustained input ≥ 480 ms at ≥ 80% of peak. Idle reset 150 ms.
Step tween: `L → target`, duration `snapDuration(.46) + .05`, ease `discGlide`; flow kick `Ce += dir · 2.5` (makes discs lean immediately)
Likely technology: custom wheel intent classifier + GSAP
Confidence: High `[source]`, `[measured]` (`wheel` samples: flow 3.1 → 6.7 → decay, tween ends ≈ 350 ms)
Implementation recommendation: Port the classifier verbatim; it is what makes trackpads feel deliberate.

INTERACTION: Click / keyboard selection
Trigger: Click non-active disc; ←/→/Home/End; nav prev/next
Affected element: Carousel, clicked disc
Visual result: Clicked disc gets a "press" impulse (`pushVZ −= .55`, tilt by UV · 1.5) then glides to centre
Duration: click `clamp(.45 + dist·.11, .46, 1.05)` s, kick `min(5, dist·1.4)`; key `min(.6, .42 + dist·.05)` s, kick 4
Easing: `discGlide`
Keyboard: scribble shown on active disc; Space flips disc (spinY → π or 0, .75 s `power3.inOut`); Enter opens
Confidence: High `[source]`, `[measured]` (`click-side-*.png`, `key-right-*.png`, `space-flip-*.png`)

INTERACTION: Active-state change → info panel + quotes
Trigger: `discgallerychange` (active index changes, including mid-drag)
Affected element: Title, labels, values, rules, quote blocks
Visual result: Out: each text block's SplitText lines slide up `yPercent −120` in .4 s (line stagger .016, item stagger .016); rules collapse `scaleX → 0` toward the right. Content is swapped when out completes and the carousel has settled for 100 ms (500 ms cap while dragging). In: lines rise from `yPercent 120` → 0, .7 s, line stagger .05, item stagger .035, group gap .06 between panel and quotes; rules draw `scaleX 0 → 1` from the left. Masks animate height .5 s to the new content height. Interrupted reveals reverse at 1.6×.
Easing: `energy` (0.32, 0.72, 0, 1)
Opacity: `autoAlpha` only to hide pre-reveal
Likely technology: GSAP + SplitText (lines) + overflow masks
Confidence: High `[source]`, `[measured]` (`text-*.png`)
Implementation recommendation: One text-transition controller with state machine hidden → revealing → visible → hiding, driven by gallery change events.

INTERACTION: Open item (gallery → detail)
Trigger: Click active disc / Enter
Visual result: Active disc presses (scale ×.94, .12 s power2.out), springs (×1.015, .16 s), then shrinks to .001 while spinning to edge-on (spinY → next π/2 multiple) over .55 s `power2.in`; other discs recede/scale out with index stagger (.45 of duration, max 4); page fades (`autoAlpha`, .4 s) and the detail page fades in after .4 s.
Confidence: High `[source]`, `[measured]` (`sheets/detail-transition.png`)

INTERACTION: Return / section switch (detail → gallery, gallery ↔ gallery)
Visual result: Gallery "in": active grows .001 → 1 over 1 s `discGlide`, others fan in `others 0 → 1` over .85 s starting at .1 s with stagger (.28 inbound), receding from `z −2.2`.
Section flip (films ↔ tv): active disc turns edge-on (spinY π/2) while boosting to 1.45×, others out; reverse on enter.
Confidence: High `[source]`

INTERACTION: Detail hero "dissolve" edge
Trigger: Scroll (ScrollTrigger scrub from `top bottom` of the following section to `top top − (edge band)`), pointer movement, time
Affected element: Hero section clip-path bottom edge revealing the full-bleed image below
Visual result: Organic, living contour (2D noise iso-line via marching squares, grid 16 px, scale 230, warp 1.25) that rises as you scroll. It breathes slowly (`lifeSpeed .15` cycles/s), agitates with scroll velocity (×2.2), and the pointer "bites" drops into it (radius ~90 px spreading 2.6×, relax 1.1 s). Edge amplitude is strongest at the horizontal centre (cosine window).
Duration: intro 1.5 s growth
Likely technology: CPU marching squares → `clip-path: path(evenodd, …)` each ticker frame
Confidence: High for mechanism `[source]`, medium for exact noise
Implementation recommendation: Reproduce with layered value noise along x (1D height field) + time phase + velocity agitation + cursor Gaussian dents → `clip-path: path()`. Simplification: 1D height field cannot form islands, which the 2D iso-line occasionally does. Documented deviation.

INTERACTION: Detail parallax
Trigger: Scroll
Affected element: Full-bleed image, other `[data-parallax]` targets
Movement: `yPercent 20 → −20` (defaults; image uses custom start/end), `ease none`, `scrub true`, `start clamp(top bottom)`, `end clamp(bottom top)`
Confidence: High `[source]`

INTERACTION: Scroll-next (end of detail → next item)
Trigger: Scroll through last section (ScrollTrigger `top bottom` → `bottom bottom`, progress + velocity), then continued wheel/touch/keys at the page end
Affected element: Next item title (split over horizontal rules), next disc (own canvas), fill scribble
Visual result:
- Rules draw in; title words slide horizontally along the rules with scroll (offsets .18–.38 of width).
- From progress .3 → .97 the disc arrives: tilt from (−52°, 10°) to rest (−30°, −30°), drops in from below (`arriveDrop .9`), pops in scale .35 → 1 (1.05 s `discGlide`).
- Disc spins on its axis from scroll velocity: `target = clamp(−v·.0032, ±7) rad/s`, follow 9/s, friction 2.4/s, plus idle spin −.14 rad/s and a small idle wobble.
- At the page end, further wheel (620 px per full), touch (380 px) or ↓/Space (+.34) fills a "push" value 0 → 1. The disc lifts (+.1), grows (×1.04), tilts to push pose (−16°, −10°), spins faster (−6 rad/s), and a hand-drawn ring (10 fps, 40 points) sweeps around it proportional to push. If input stops for 350 ms the push drains (.9/s).
- At 1: exit — disc spins (−16), lifts .35, scales out; copy lines rise −120%, rules collapse from the end; navigate at .48 s.
Confidence: High `[source]`, `[measured]` (`sheets/detail-scroll.png`)

INTERACTION: Nav / text hover
Trigger: Hover (fine pointers)
Visual result: Label duplicates via `::after`; original clips out downward (`clip-path inset(100% 0 0)`, translate .25em, scale .95) while duplicate clips in from the top (delay 75 ms, scale 1.05 → 1). `:active` squashes ×.955. Elastic `linear()` ease on transform .45 s; clip .4 s `cubic-bezier(.32,.72,0,1)`; scale .3 s `cubic-bezier(.34,2.27,.64,1)`.
Confidence: High `[source]`

INTERACTION: Grain
Visual result: Noise texture over everything, opacity .2, jittered in 5 discrete positions every .6 s (`steps`) — film grain, not animated noise shader.
Confidence: High `[source]`

INTERACTION: Resize
Visual result: Renderer resizes via ResizeObserver; camera aspect updated; below 992 px the touch layout engages (see §6). DPR resets adaptive scale on large changes.
Confidence: High `[source]`, `[measured]` (`resize-*.png`)

INTERACTION: Reduced motion
Visual result: No preloader; steps jump (`L` lerps at 20/s rather than tweening); no flow lean, no push, no scribble boil (static on), text swaps without transitions; parallax and dissolve disabled; CSS transitions .01 ms.
Confidence: High `[source]`, `[measured]` (`reduced-*.png`)

## 6. Mobile / touch `[source]`, `[measured]`

- Breakpoint 991 px switches to a touch layout: gallery scale is fitted so the adjacent disc peeks at `touchPeek 1` NDC (binary search, scale ×[.3, 3]), limited so the lead disc stays under 60% of height.
- Layout per disc: `x = m·2.2`, `y = −min(|m|, 2.5)·1`, `z = −min(|m|,2.5)·.5` (discs step down and back to the right), rotY for trailing discs ramps to `−2·galleryRotY`, active scale 1.5, inactive .6.
- Touch drag uses a span derived from the fitted layout (≈ one item per 1/2 screen width); release always snaps (flick threshold .035).
- DPR capped at 1.5. Nav becomes a bottom pill. Info panel spans full width at top. `touch-action: none` on the gallery.
- Hover tilt, wipe and scribble are pointer-fine only.

## 7. Motion inventory

| # | Motion | Present | Mechanism / values |
|---|---|---|---|
| 1 | Scroll-driven animation | Detail page only | ScrollTrigger scrub (dissolve edge, parallax, scroll-next progress) |
| 2 | Pointer-follow | Yes | Hover tilt from NDC, weight lerp 10/s |
| 3 | Mouse parallax (layers) | No global parallax | Depth comes from the perspective arc and per-disc follow lag. `[measured]` DOM text does not move with the pointer |
| 4 | 3D rotation | Yes | Arc yaw `−m·.35`, lean, bank, hover, spin, flip |
| 5 | 3D translation | Yes | Arc x/z, dip, push, spawn slide |
| 6 | 3D scale | Yes | Inactive falloff, active boost, fan/pop |
| 7 | Camera movement | No | Camera is static; all motion is object-side |
| 8 | Drag | Yes | Spin (active) / scrub (background) |
| 9 | Inertia | Yes | Friction .89/frame |
| 10 | Momentum | Yes | Flow velocity feeds lean/dip |
| 11 | Damping | Yes | Follow lerp k 6.5–15; push damping 4.5 |
| 12 | Hover | Yes | Tilt + cursor + scribble on active |
| 13 | Selection | Yes | Press impulse + glide |
| 14 | Active-state transition | Yes | Scale/position lerp + text state machine |
| 15 | SVG stroke animation | No (in reference it is WebGL geometry) | Implemented as SVG per brief |
| 16 | Hand-drawn ring | Yes | 2 loops, 10 fps boil, sweep in/out frames |
| 17 | Typography reveal | Yes | SplitText lines ±120% in masks |
| 18 | Stagger | Yes | lines .05, items .035, discs by distance |
| 19 | Opacity transitions | Minimal | Page fades .4 s; text uses transforms |
| 20 | Scale transitions | Yes | Rules scaleX, disc pop |
| 21 | Depth transitions | Yes | Recede `z −2.2` during fan, fog 7–14 |
| 22 | Lighting changes | Implicit | Lights are static; perceived change comes from object rotation |
| 23 | Material response | Yes | Clearcoat, gloss rings, iridescent back, transmissive hub |
| 24 | Specular highlight movement | Yes | RectAreaLight strip + env bands across rotating faces |
| 25 | Shadow movement | No shadow maps | Depth via fog + tone; no cast shadows `[source]` (no `castShadow`) |
| 26 | Section transitions | Yes | Detail press/shrink, gallery fan-in, flip |
| 27 | Cursor interaction | Yes | `grab`/`grabbing`/`pointer`; dissolve bites |
| 28 | Smooth scrolling | Yes | Lenis on detail pages; gallery captures wheel |

Note on shadows: the reference renders no shadow maps. The brief asks for soft shadows; the implementation adds a very soft contact-shadow-like `ShadowMaterial` plane only if it does not visibly contradict the reference's floating look. Default: off, available as a scene option.

## 8. Timing tokens (derived)

| Token | Value | Use |
|---|---|---|
| fast | .12–.3 s | press .12, spring .16, scribble frame .1 |
| medium | .4–.75 s | text out .4, text in .7, step .46–.6, flip .75 |
| slow | .85–1.4 s | fan .85–1.15, reset spin 1.2, pop 1.05 |
| ease.glide | `0.32, 0.72, 0, 1` | carousel steps, text, masks |
| ease.main | `0.625, 0.05, 0, 1` | general UI defaults |
| ease.press | `power2.out` / `power2.in` | press / exit |
| ease.return | `power3.out` | spin reset |

## 9. Implementation plan (derived from the above)

- React + TypeScript + Vite. React owns DOM/UI and routing; Three.js is driven imperatively by controllers (render-on-demand loop), because per-frame physics must not go through React reconciliation. R3F is not used for the same reason the reference is imperative; documented choice.
- Controllers: `DiscGallery` (scene/camera/lights/materials/layout), `PointerController`, `DragController` (spin + scrub physics), `WheelIntent`, `SelectionController`, `ScribbleEffect` (SVG), `TextTransition`, `SmoothScroll` (Lenis + ScrollTrigger), `Dissolve`, `ScrollNext`, `Preloader`, `motion.ts` tokens.
- Content in `src/content/projects.ts` with a typed model; procedural placeholder artwork until real imagery is supplied.

## 10. Implementation map

| System | File |
|---|---|
| Motion tokens (eases, durations, staggers), GSAP plugin registration | `src/motion/tokens.ts` |
| Smooth scroll (Lenis ↔ ScrollTrigger on the GSAP ticker) | `src/motion/SmoothScroll.ts` |
| Look + behaviour constants (all values from §3–§6) | `src/three/config.ts` |
| Procedural normal/roughness maps (worker + fallback) | `src/three/proceduralMaps.ts`, `proceduralMaps.worker.ts` |
| Renderer, env map, light rig, geometries, materials, label textures | `src/three/discAssets.ts` |
| Carousel engine: layout, follow, hover, wipe, press, spin drag, scrub drag, inertia, spring, flights, preloader API, render-on-demand loop, adaptive resolution | `src/three/DiscGallery.ts` |
| Wheel intent classifier | `src/three/WheelIntent.ts` |
| Hand-drawn scribble (SVG, projected through the 3D camera, 10 fps boil) | `src/three/ScribbleSvg.ts` |
| Info panel / quote text swap state machine | `src/motion/TextTransition.ts` |
| First-visit preloader | `src/motion/Preloader.ts` |
| Detail dissolve edge | `src/motion/Dissolve.ts` |
| Scroll-next controller + disc scene | `src/motion/ScrollNext.ts`, `src/three/NextDisc.ts` |
| Page transitions | `src/app/Transition.tsx` |
| Content model / placeholder content / generated placeholder art | `src/content/types.ts`, `src/content/projects.ts`, `src/art/placeholderArt.ts` |

Deliberate choices:
- Three.js is driven imperatively, not through React Three Fiber, so per-frame physics never passes through React reconciliation (the reference is imperative for the same reason).
- GSAP Draggable / InertiaPlugin are not used for the carousel: the drag target is a raycast result that switches between "spin this disc" and "scrub the carousel", and the reference's own integrator (friction .89/frame, spring 9.5/12) was matched numerically instead.
- Scribble is SVG (brief requirement) rather than the reference's WebGL ribbon. Same algorithm and constants; perspective comes from projecting disc-plane points through the camera.
- No shadow maps, matching the reference (discs float; depth reads through fog, scale and parallax of the arc).
- Fonts are open substitutes: Instrument Serif (display), Inter Tight (body), Cormorant SC (eyebrow).

## 11. Browser validation log

Method: identical Playwright scenarios run against the reference and the implementation (`reference/tools/scenarios.js`, `physics.js`, `texttiming.js`, `nextcheck.js`), comparing screenshots frame by frame and sampling both debug APIs (`?debug` exposes `galleryDebug.state()` on the implementation).

Numeric comparison (1440×900, same pointer script):

| Measure | Reference | Implementation |
|---|---|---|
| Scrub release velocity | .0387 | .0433 |
| Inertia → spring hand-over | 665 ms | 680 ms |
| Wheel step peak flow velocity | 6.20 at 106 ms | 6.17 at 105 ms |
| Render loop when idle | stopped | stopped |
| Title line out (−120%) complete | ~420 ms | ~405 ms |
| New content written | 757 ms | 739 ms |
| Line back to rest | ~1265 ms | ~1244 ms |

Mismatches found and fixed:

REFERENCE: Label reads as bright satin print with visible gloss bands and a white rim.
IMPLEMENTATION: Label dark and muddy, rim grey.
MISMATCH: Environment far too dim.
FIX: Env canvas left as linear (`NoColorSpace`) exactly as the reference does; tagging it sRGB had darkened the studio env.

REFERENCE: Background grain is a light, sparse speckle.
IMPLEMENTATION: Heavy uniform grey noise.
MISMATCH: Tile statistics.
FIX: Generated tile matched to the reference AVIF (250 px, mean value ≈64, mean alpha ≈6%).

REFERENCE: Returning from a detail page plays the fan-in; the counter preloader only runs on first load of the gallery.
IMPLEMENTATION: Counter preloader ran after navigating from a directly-loaded detail page.
FIX: Preloader gated on `arrival === 'load'`; detail pages mark the intro done.

REFERENCE: Panel copy reappears as the fan-in lock releases (~90% of 1.05 s).
IMPLEMENTATION: Copy waited for the full intro plus a delay.
FIX: Intro no longer awaited in `init`; copy released at 950 ms.

REFERENCE: Scroll-next frame stays pinned while the disc arrives.
IMPLEMENTATION: Sticky frame scrolled away; disc drifted off the bottom.
FIX: Section uses `overflow: clip` (not `hidden`) so `position: sticky` works; disc anchored higher against the fourth rule.

REFERENCE: Push-to-continue ring visibly grows around the visible top of the disc.
IMPLEMENTATION: Partial ring sometimes drawn below the fold (random start angle).
FIX: Progress-ring mode in `ScribbleSvg`: exact sweep, grown symmetrically from the disc's top.

REFERENCE: At ≤991 px the nav becomes a bottom pill, the panel widens to ~50%, and quotes sit above the pill.
IMPLEMENTATION: Nav stayed on top until 767 px; quotes overlapped the pill.
FIX: Breakpoints aligned to 991 px; quote strip lifted.

REFERENCE: Titles always fit the viewport.
IMPLEMENTATION: Long titles overflowed on mobile.
FIX: `.fit` sizing from character count (`--chars`).

Verified behaviours (screenshot and state comparison): preloader orbit/rise/turn/fan, hover tilt direction and amplitude, scribble draw-in / boil / draw-out and lag while gliding, spin drag with in-plane scribble and 1.2 s return, scrub drag with lean/dip/trailing discs, wheel single-step and burst, keyboard steps with scribble, Space flip to the iridescent back, click-to-centre with press impulse, open (press → spring → edge-on shrink), detail hero reveal, dissolve edge rising with scroll, image parallax, scroll-next arrival/slide/spin, push ring, exit and navigation to the next project, touch layout and flick, reduced motion, resize across breakpoints.

Could not be verified from headless automation:
- Real trackpad momentum streams (the classifier was tested with synthetic wheel bursts only).
- Physical touch devices and iOS Safari (touch was emulated through CDP).
- GPU-limited devices triggering the adaptive render-scale step-down.
- Perceived feel at 120 Hz.

Known deviation: the dissolve edge is a 1D height field instead of a 2D iso-contour, so it never forms detached islands.

### Smoothness pass (frame pacing)

Measured with `reference/tools/perf.js` (rAF intervals + long tasks per interaction phase, identical script on both sites) and `phases.js`.

REFERENCE: Solid 60 fps (p95 16.8 ms) through wheel, drag, keys, hover, open and detail scroll.
IMPLEMENTATION: 60 fps until the first drag, then locked at ~30 fps (every other frame 33 ms) for the rest of the session, even when idle-animating.
MISMATCH: `DiscGallery.frame()` cleared its rAF handle at the start of each frame, so any `request()` made during the frame (GSAP tween callbacks, text/scribble updates) scheduled a second loop. Each drag added another loop; two or more loops rendered the scene several times per vsync.
FIX: The handle now stays set for the life of a running loop and is cleared only when the loop stops. The same fix went into `ScrollNext`. The first frame after waking uses a nominal dt instead of a negative one.

REFERENCE: Renderers are pooled (max 2) and reused across pages, so shader programs and the PMREM environment survive navigation.
IMPLEMENTATION: Every page created a fresh WebGL context and recompiled every physical-material program.
FIX: `acquireRenderer` / `releaseRenderer` pool, plus `compileAsync` warm-up before the first visible frame. The scroll-next scene boots only near the viewport or after 2.5 s idle (reference `bootMargin 150%`, `idleBoot 2500`).

REFERENCE: Disc art is decoded off-thread (image decode) and textures are created in `requestIdleCallback` slots.
IMPLEMENTATION: Placeholder label art ran per-pixel `getImageData` grain loops (~30–60 ms each) and GPU uploads inside animation frames. The detail hero art used a 60 px blur on a 1920×1200 canvas.
FIX: Grain is a pattern composite; label generation, compositing and `initTexture` run through an idle queue; hero placeholder is rendered at half resolution.

Result after fixes (1440×900, p50 / p95 / frames over 25 ms):

| Phase | Reference | Implementation |
|---|---|---|
| Wheel | 16.7 / 16.8 / 1 | 16.7 / 16.8 / 0 |
| Drag | 16.7 / 16.7 / 0 | 16.7 / 16.7 / 0 |
| Keys | 16.7 / 16.8 / 0 | 16.7 / 16.7 / 0 |
| Hover | 16.7 / 16.7 / 0 | 16.7 / 16.7 / 0 |
| Open → detail | 16.7 / 16.8 / 1 | 16.7 / 16.8 / 1 |
| Detail scroll | 16.7 / 16.8 / 0 | 16.7 / 16.7 / 0 |
