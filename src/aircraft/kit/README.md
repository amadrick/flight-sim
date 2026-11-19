# Aircraft kit — procedural aircraft modelling for Skyward

`src/aircraft/kit/` builds every aircraft visual in the simulator from code: no model files, no image files.
You describe an aeroplane with **station tables** (fuselage cross-sections), **planforms** (wing, tail, fin),
a **gear spec** and a **paint function**; the kit turns that into a few merged meshes with one PBR texture
atlas, animated from `AircraftState`.

Two finished aircraft use nothing but this kit and are the reference examples:

| Aircraft | File | Shows |
|---|---|---|
| F-16C Block 50 | `src/aircraft/f16/visual.js` | chined/blended body, bubble canopy with visible cockpit, fold-over intake, petal nozzle + afterburner, flaperons / LE flaps / stabilators, gear doors cut from the skin, stores, military liveries |
| Boeing 737-800 | `src/aircraft/b738/visual.js` | airliner tube, two atlases, painted windows + flight-deck lining, wing with slats / Krueger / double-slotted Fowler flaps / spoilers / winglets, high-bypass nacelles with fans and reverser sleeves, twin-wheel gear, fictional airline liveries |

Read one of them next to this file. Copy its structure.

---------------------------------------------------------------------------------------------------------------

## 1. Contract and conventions

```js
// src/aircraft/<id>/visual.js
import geometry from './geometry.js';
import * as K from '../kit/index.js';

export const LIVERIES = ['default', 'other'];
export function createVisual(ctx, opts = {}) {     // opts.livery selects a paint scheme (the sim calls createVisual(ctx))
  ...
  return rig.build();                              // { object3D, update(state, dt), dispose() }
}
```

* **Body axes**: origin = CG, **+X right wing, +Y up, −Z nose**. Metres. Parked, the ground is at `y = -geometry.cgHeight`.
* `geometry.js` is shared with physics: keep every field name; gear order is nose, left, right. Put wheels **exactly**
  at `geometry.gear[i].pos` (tyre contact point) and the pilot's eye at `geometry.pilotEye`; lights go where
  `geometry.lights` says (refine the numbers in `geometry.js` to match your model rather than the other way round).
* **State signs** (`rig.onUpdate((S, dt) => …)` gives you `S.sf` = `state.surfaces`, clamped, with defaults):
  `aileronL/R` + = trailing edge **up on that side**; `elevatorL/R` + = TE up; `rudder` + = TE **right**;
  `flaps, slats, spoilerL/R, speedbrake, hook, wingSweep, canopy` 0..1; `gear` 0 up … 1 down; `nozzlePitch` −1..1.
  `S.eng[i]` = `{ running, n1, n2, thrust, afterburner, nozzle, reverser, egt }`, `S.gear[i]` =
  `{ onGround, compression, wheelSpeed, steer, skid }`, `S.lights`, `S.onGround`, `S.groundSpeed`, `S.night` (0..1),
  `S.t` (seconds), `S.raw` (the untouched state). Missing fields never throw.
* **Budgets at `high`** (measured by the harness HUD): ≲ 150 k triangles, ≲ 60 draw calls, ≤ two 2048² atlases,
  build ≲ 300 ms. One atlas costs ≈ 150–250 ms to paint and convert, so use a second atlas only for airliner-sized
  aircraft. Every static mesh merges into one draw call per material; **each moving part is one draw call**, so
  merge things that move together (`mesh.add(other)`) before calling `rig.part`.
* `const { detail, atlas } = K.detailFor(ctx)` → tessellation multiplier (0.6 … 1.2) and atlas size per quality level.
* Lighting units: emissive lamps are HDR (the rig handles levels and `ctx.env.nightFactor`).
* Airline liveries must be **fictional**: invent the name, logo and registration (use an unassigned prefix such as `ZZ-`).

---------------------------------------------------------------------------------------------------------------

## 2. The viewer harness — look at your work

```
node tools/shot.mjs --entry src/aircraft/kit/harness.js --html dist/viewer.html \
     --params "aircraft=f16&view=sheet&gear=1" --size 1200x675 --frames 2 --out shots/f16-sheet.png --eval "sim.stats"
```

`--no-build` re-uses the last bundle. The software renderer is slow and shared: **one screenshot at a time**, small
sizes, and never build visuals in a loop inside `--eval` (each atlas holds ~50 MB while it is being painted).

| Param | Meaning |
|---|---|
| `aircraft=<id>` `livery=<name>` | registry id, livery passed as `createVisual(ctx, { livery })` |
| `view=` | `sheet` (6 views in one image) · `quarter` `side` `sider` `top` `bottom` `front` `rear` `rearq` `below` `noseq` `tailq` `cockpit` · `closeups` (4 close views) · close-ups placed from geometry.js: `cnose` `ccanopy` `croot` `cwing` `cgear` `cwheel` `cnoz` |
| `views=a,b,c` | your own sheet |
| `cam=az,el,dist` `tgt=x,y,z` `fov=` | free camera (az 0 = from the nose, 90 = from the right, 270 = from the left; el in degrees) |
| `gear=0..1` `flaps` `slats` `spoiler` `sb` `hook` `canopy` `sweep` `rev` | surface positions |
| `surf=±1` (all primaries) or `ail` `elev` `rud` `tvc` | control deflections |
| `n1` `ab` `noz` | engine state; `steer` `comp` gear state; `air=1` airborne (no ground, gear hangs) |
| `lights=nav,strobe,beacon,landing,taxi` `night=0..1` `t=seconds` | lamps (strobes flash: pick `t`) |
| `dims=1` | yellow reference box (length × span × height from geometry.js) + markers for gear, eye, engines, lights |
| `atlas=color\|orm\|height\|emis` `atlasN=0\|1` | show an atlas layer with chart names instead of the 3D view |
| `look=yaw,pitch` `near=` | cockpit view direction |
| `sun=az,el` `exposure=` `quality=low…ultra` `bg=` | environment |
| `prof=1` | time spent per pen method → `sim.penProf` (find what makes a paint function slow) |

The HUD line shows triangles, draw calls and build time. `window.__sim = { ready, step, ctx, visual, state, stats, K }`.
Also run the real sim once: `node tools/shot.mjs --params "aircraft=<id>&start=runway&cam=chase"` (wheels on the
runway, no console errors) and `…&start=air…`.

---------------------------------------------------------------------------------------------------------------

## 3. How to build a new aircraft — step by step

### Step 0 — collect numbers (30 minutes that decide everything)
Write a comment block at the top of the file with: overall length, span, height; fuselage max width/height and where;
wing root chord (at the centreline and at the body side), tip chord, leading-edge sweep, dihedral, where the root LE
sits; tailplane and fin root/tip chords, spans, sweep; engine positions and diameters; wheelbase, track, wheel sizes;
canopy/cockpit position. Convert everything to body axes (`z = noseZ + distance from the nose`, ground at
`-cgHeight`). Cross-check with ratios you can see in photos (e.g. "the canopy ends above the intake lip",
"nacelle diameter ≈ 55 % of the fuselage"). Then run the stub with `dims=1`: your model must fill the yellow box.

### Step 1 — atlas layout
```js
const atlas = K.createAtlas({ size: atlasSize, base: K.FINISH.matte('#7d8489') });
const cFus = atlas.chart('fus', { type: 'unwrap', z: [noseZ, tailZ], girth: 5.6, vScale: 0.9, strips: 2 });
const cWT  = atlas.chart('wingTop', { type: 'plan', x: [0.9, 4.6], z: [-2, 2.4], view: 'top', mirror: true });
const cWB  = atlas.chart('wingBot', { type: 'plan', x: [0.9, 4.6], z: [-2, 2.4], view: 'bottom', mirror: true, density: 0.8 });
const cFin = atlas.chart('finL', { type: 'side', z: [2.1, 6.1], y: [0.75, 3.4], view: 'left' });
atlas.pack();                                            // after this, charts and swatches give UVs
const U = { gearWell: atlas.swatch('well', K.FINISH.gearWhite), dark: atlas.swatch('dark', K.FINISH.darkGrey) };
```
* **Charts** get painted detail; everything else uses **swatches** (16-pixel flat cells: colour + roughness + metalness
  [+ emissive]). A swatch is just a `[u, v]` pair that every generator accepts as `uv`.
* Chart types: `unwrap` (lofted body: u along z, v around the ring; `girth` ≈ largest circumference, `strips: 2`
  splits a long fuselage in two rows so it gets twice the resolution), `plan` (top/bottom projection, `mirror: true`
  shares one chart between left and right — do not use it where text must read correctly on both sides), `side`
  (left/right projection for fins, winglets, slab sides), `proj` (any plane: `{ origin, u, v, a: [..], b: [..] }`),
  `rect` (free rectangle for instrument panels; address with `chart.uv(a, b)`).
* `density` scales a chart's resolution relative to the others (undersides 0.7–0.8, instrument panels 2+).
* Check the packing with `atlas=color`; wasted space means you can afford more charts or a higher `density`.

### Step 2 — fuselage: a station table
```js
//          z      top     bot    halfW
const FS = [[-8.2, 0.22,  0.22, 0.00], [-7.5, 0.43, 0.02, 0.21], ... ]
  .map(([z, top, bot, w]) => ({ z, y: (top + bot) / 2, w, top: (top - bot) / 2, bot: (top - bot) / 2 }));
const fus = K.loft({ stations: FS, segments: 64, step: 0.12, chart: cFus, capEnd: 'flat', capUV: U.dark,
                     cutouts: [{ name: 'cockpit', z: [-5.7, -3.3], t: [0.375, 0.625] },
                               { name: 'mlg', z: [-0.8, 0.9], t: [0.045, 0.19], mirror: true }] });
cFus.body = fus;                                         // lets the pen place decals by body height
```
* A station is a cross-section: centre height `y` (the height of the **widest point**), half-width `w`, heights
  `top` / `bot` above / below `y`, fullness `kTop` / `kBot` (0.5523 = ellipse, → 1 = box, < 0.5 = diamond; a pair
  `[atSide, atCentre]` shapes the two ends of the quadrant separately), `x` offset, `hard: true` for a crease ring.
* `chine: { w, y, tu, tl, k, e }` unions a blade to the section: strakes, LERX, blended wing roots, flat "shelves"
  beside engines (`w` half-width of the blade tip, `y` its height relative to the station's `y`, `tu`/`tl` root
  thickness above/below, `k` blend radius, `e` profile exponent). Add `creases: ['side']` to keep the chine edge sharp.
* Stations are interpolated monotonically (PCHIP) — two equal neighbours give an exactly constant section, so an
  airliner tube needs only its two end stations.
* Ring parameter **t**: 0 = bottom centre, 0.25 = right side (+X), 0.5 = top centre, 0.75 = left side.
* **Orientation rule**: the skin faces outward where z *increases* along the station list. For a lip (intake, nacelle)
  list the stations from deep inside the duct forward to the lip and back along the outside ("fold-over" loft).
* `fus.at(z, t)` → `{ p, n }`, `fus.topAt(z)`, `fus.botAt(z)`, `fus.halfWidthAt(z)`, `fus.tAtY(z, y)` (ring parameter
  at body height y on the right side), `fus.girthAt(z, t)`. Use them to seat canopies, antennas, liners, decals.
* **Cut-outs** are rectangles in (z, t) (grid aligned; `shape(z, t)` can drop cells but edges are stair-stepped, so
  keep cut-outs rectangular). The removed skin comes back as `fus.patches[name]` (`name + 'R' / 'L'` with `mirror`)
  with the same UVs: thicken it into a door (`K.thicken(patch, 0.02, innerUV)`), fill the hole with
  `K.well(patch, depth, uv)`. `fus.edges[name].tLo / tHi / zLo / zHi` are the four edges as point pairs — hinge lines.
* Sub-shells of the same stations: `tRange: [0.25, 0.75]`, `zRange: [z0, z1]`, `inflate: 0.004` → canopy glass,
  canopy frames, appliqué panels. Slanted windows that do not fit a (z, t) rectangle are **painted** (see step 7).

### Step 3 — lifting surfaces
```js
const wingR = K.wing({
  side: 1, airfoil: K.naca6(0.04, 0.004), chordPts: 12, spanAxis: 'x', tip: 'flat',
  stations: [{ x: 0.95, y: 0, z: -1.92, chord: 4.2, tc: 0.042 }, { x: 4.57, y: 0, z: 1.12, chord: 1.07, tc: 0.04, twist: -2.5 }],
  lines: { hingeTE: [[1.17, 0.805], [3.62, 0.745]], hingeLE: [[1.17, 0.13], [4.57, 0.265]] },   // [span, chord fraction]
  controls: [{ name: 'flaperon', type: 'flap', span: [1.17, 3.62], from: 'hingeTE', nose: 1 },
             { name: 'lef',      type: 'flap', span: [1.17, 4.57], to: 'hingeLE', tail: 1 }],
  charts: { upper: cWT, lower: cWB },
});
```
* Stations give the **leading-edge point of the right-hand surface**; `side: -1` mirrors the finished result.
  The section's thickness direction is perpendicular to the span direction in the X-Y plane, so the same call builds
  a wing (stations along +X), a **fin** (stations along +Y, `spanAxis: 'y'`; its "upper" surface faces −X = left, so
  `charts: { upper: finLeftChart, lower: finRightChart }`), a V-tail, a ventral fin, a pylon (`K.pylon`).
* Start the root station **inside** the body (the fuselage hides the overlap); `root: 'flat'` only for all-moving
  surfaces whose root you can see. `tip: 'round' | 'flat' | 'none'`.
* Airfoils (`airfoil.js`): `naca4('2412')`, `naca5('23012')`, `naca6(tc, camber)` (fighters), `supercritical()`
  (airliners), `biconvex(tc)` (supersonic tails), `hexagonal(tc)`, `slab(tc)` (stealth facets, simple plates),
  `cst(upper, lower)`. Each station may override `airfoil`, `tc`, `twist`.
* `lines` are hinge lines; the chordwise grid follows them, so they must not cross each other. Controls:
  * `type: 'flap'` — a full-depth block between two lines (`from` default leading edge, `to` default trailing edge):
    ailerons, elevators, rudders, flap segments, leading-edge flaps, slats (`cove: true`). `nose` / `tail` 0..1 round
    the front / rear face.
  * `type: 'panel'` — a skin panel on `surface: 'upper' | 'lower'` with a recess behind it: spoilers, airbrakes,
    Krueger flaps. `hinge: 'front' | 'rear'`.
  * `type: 'split'` — clamshell trailing edge (`parts.upper`, `parts.lower`): drag rudders, decelerons.
* Result: `wingR.mesh` (fixed part), `wingR.controls[name] = { mesh, hinge: { a, b }, ref, chord, up }`,
  `wingR.at(span, frac, 'upper' | 'lower' | 'mid')` → point (use the right-hand wing's `at` and mirror x yourself),
  `wingR.lines[name].at(wingR.spanToU(span))` → chord fraction of a line.
* `K.blendedWinglet(tipStation, { height, cant, radius, sweep, tipChord })` returns extra stations: build the winglet
  as its own `K.wing` (`spanAxis: 'u'`, a `side` chart) starting at the tip station.
* Variable sweep: build the moving panel as its own wing, `rig.part(name, mesh, { pivot })`, rotate about Y.

### Step 4 — propulsion
* **Fighter intake**: fold-over loft (inside → lip → outside) with `uvFn` to colour the duct white and the outside
  grey; splitter plates / ramps from `K.prism`. `K.intake2DStations({...})` gives the station list for a box intake.
* **Nozzle**: `K.petalNozzle({ z0, z1, r0, rClosed, rOpen, petals, centre, uvOuter, uvInner })` returns a mesh with a
  morph target; `node.morphTargetInfluences[0] = S.eng[i].nozzle`. Add a dark jet pipe (`K.lathe`) and
  `K.afterburnerGlow({ zDeep, zExit, rDeep, rExit, centre })` drawn with `rig.material('glow', K.glowMaterial(), { shadow: false })`;
  each frame `K.abGlowColor(glow.color, S.eng[i], S.night)`.
* **2D vectoring nozzle**: `K.nozzle2D({...})` → `{ fixed, upper, lower, interior }` (hinge the flaps).
* **Turbofan nacelle**: `K.nacelle({ centre, length, rHi, rMax, rThroat, rFan, zFan, rExit, flat, droop, sleeve, core, uv, uvLip, uvInner, … })`
  → `{ cowl, sleeve, cascade, core, plug, fanZ, sleeveTravel }`. `sleeve` is the translating reverser cowl
  (`node.position.z = rest + reverser × sleeveTravel`), `flat` flattens the inlet bottom (737NG), `K.fan({ radius, hub, blades })`
  is the spinning fan (rotate about Z), `K.fanBackdrop(radius, depth, uv)` closes the duct behind it,
  `K.pylon([{ y, z0, z1, x, tc }, …], { uv })` hangs it from the wing.
* Propellers / rotors: `K.wing` blades around a `K.lathe` spinner on a spinning `rig.part`; swap to a blurred disc
  (`K.lathe` disc with a translucent material on the glass layer) above ~30 % rpm.

### Step 5 — landing gear
```js
K.buildGear(rig, atlas, {
  name: 'nose', index: 0, contact: G.gear[0].pos, wheelRadius: G.gear[0].wheelRadius, wheelWidth: 0.15,
  pivot: [0, -0.66, -3.4], stroke: 0.2, fork: 'fork', steer: true, links: 'front',
  retract: { to: [0, -0.62, -2.78], twist: 90 }, brace: [0, -0.66, -2.95],
  doors: [{ name: 'noseDoor', mesh: K.thicken(patch, 0.02, U.well), hinge: { a, b }, ref: K.centroid(patch), open: 92 }],
  lamps: [{ kind: 'landing', pos: [-0.07, -0.86, -3.47], size: 0.045 }],
});
```
* `contact` is the tyre contact point when parked = `geometry.gear[i].pos` (for an offset single wheel give the strut
  axis as `contact` and `wheels: [±offset]`). `pivot` is the trunnion inside the airframe. Twin wheels:
  `wheels: [-0.22, 0.22]`; bogies: `axles: [-0.7, 0.7]`. Wheel axles stay horizontal on splayed legs.
* `retract: { to }` swings the axle onto the direction of `to` (stowed axle position), optionally twisting the wheel
  about the strut; or `{ axis, angle }`. `window: [a, b]` is the part of `surfaces.gear` used by the leg; doors open
  first (`closes: true` re-closes them when the gear is down, `onLeg: true` rides on the strut).
* The kit animates oleo travel (ground query when on the ground, else `compression`), torque links, wheel spin
  (`wheelSpeed`, or ground speed / radius), steering, and hides the leg when retracted.
* Cut the wells out of the body (`cutouts` → `K.well`) so the stowed wheels have somewhere to go.
* `K.arrestorHook({ pivot, length, uv })` + a `rig.hinge`.

### Step 6 — cockpit, glass, details
* **Fighter canopy**: a second loft whose stations sit on the cockpit cut-out's sill (`fus.at(z, tSill).p`) with
  `tRange: [0.25, 0.75]`; glass from one `zRange`, frames from narrow `tRange` / `zRange` strips with `inflate`.
  `rig.glass('canopy', K.glassMaterial(ctx, K.GLASS.gold))` then `rig.addStatic(mesh, 'canopy')` or a moving part.
  Glass is drawn on the post layer with Fresnel opacity and is invisible from inside (clear pilot view).
  Presets: `GLASS.clear`, `smoke`, `gold`, `airliner`, `hud`.
* Inside: `K.tub({ x, y0, y1, z0, z1, uv })`, `K.ejectionSeat({ eye, recline, uv })`, `K.pilot({ eye, uv, stick, throttle })`
  (hide it from the cockpit camera: `pilotNode.visible = !rig.cameraInCockpit`), `K.hud({ eye, dist, width, height })`
  → `{ glass, frame }` (the frame carries the HUD symbology, drawn by the rig on the post layer and only from the cockpit),
  `K.stick`, `K.throttle`, `K.pedals`, and either your own instrument panel quad UV-mapped to a `rect` chart, or
  `K.instrumentPanel({ eye | eyes, kind: 'fighter' | 'airline', uv })` (panel face, display units, glareshield) /
  `K.display({ centre, width, page, uv })` / `K.glareshield({ eye, uv })` — their screens and panel faces use kit-owned
  materials (`Mesh.sidecar`), so nothing has to be registered: screens are emissive pages from `displays.js`, panel faces
  get backlit legends and a dim flood at night (the rig drives the levels from `S.night`).
  Crew: `K.pilot({ eye, kind: 'fighter' | 'airline', recline, stick, throttle, uv })` — helmet, visor, mask and corrugated
  hose for fighters (`mask: false` = pressure suit), shirt, epaulettes and headset for airliners; its head turns (an
  optional morph: kept when the pilot is its own part, dropped when merged into static geometry). `K.crewSeat` is the
  airliner seat; both sit on the same layout as `K.ejectionSeat` built from the same eye point.
  `kitdemo=fighter|airline` in the harness previews these parts alone at an aircraft's eye point (views `cpanel`, `ccrew`).
* **Airliner flight deck**: paint the windows (dark `FINISH.paintedGlass`), then line the inside with
  `K.liner(fus, [[z, t] × 4], { uv, mirror: true })` patches that share edges and leave the window polygons open,
  `K.bulkhead(fus, z, { facing })`, `K.deck(fus, z0, z1, y)`, `K.crewSeat`, `K.yoke`, a glareshield `K.prism`.
  The outer skin is back-face culled from inside, so the pilot sees out through the gaps.
* Details: `K.probe(a, b, r, uv)`, `K.bladeAntenna`, `K.staticWicks`, `K.vortexGenerators`, `K.fence`,
  `K.missile`, `K.launchRail`, `K.tank`, plus the primitives `K.lathe`, `K.tube`, `K.pipe`, `K.ellipsoid`, `K.box`,
  `K.prism` (outline in the Z-Y plane extruded along X), `K.plate`.
* **Lamps**: `rig.lamp('nav' | 'strobe' | 'beacon' | 'landing' | 'taxi' | 'formation', pos, { color, size, squash, parent })`.
  Left nav red `[1, .04, .02]`, right green `[.02, 1, .25]`, tail white. The rig flashes strobes/beacons, follows
  `state.lights` and dims for night.

### Step 7 — paint
```js
const P = atlas.pen(cFus);                    // unwrap chart: paint coordinates are (z, t)
P.fill('all', paintF(mid));
P.band(noseZ, tailZ, -Infinity, (z) => 0.0, paintF(under), { feather: 3 });   // everything below body height 0
P.ring(-6.5, 0, 1, { px: 1.6, depth: 0.4, dark: 0.3 });                       // radome joint (groove + dark line)
P.yLine(-6, 5, 0.4, { px: 1, depth: 0.3, dark: 0.12 });                       // longitudinal seam at body height
P.decalOn(-1.75, 0.52, 'both', (g) => K.drawStarBar(g, 0.42, { lowVis: '#3c4044' }));
P.textOn('RESCUE', -5.35, 0.45, 'both', 0.04, { color: '#3c4044' });
P.windows(zList, 0.98, { w: 0.25, h: 0.35 });  P.doorOn(z0, z1, yLo, yHi, { px: 1.3, depth: 0.6, dark: 0.35 });
P.noise({ alpha: 0.08, scale: 2.2, rough: 0.06 });  P.streak(z0, t0, z1, t1, 0.01, { alpha: 0.15 });
```
* A **finish** is `{ color, rough, metal [, emissive, height] }`; `K.FINISH` has `gloss/semigloss/matte/ram/composite(colour)`
  and constants (`bareMetal`, `polished`, `titanium`, `heatStained`, `exhaust`, `steel`, `chrome`, `anodised`,
  `gearWhite`, `primer`, `rubber`, `black`, `darkGrey`, `interior`, `fabric`, `paintedGlass`, `lens`).
* Paint coordinates: `unwrap` (z, t) · `plan` (x, z) · `side` (z, y) · `rect` (a, b). Pen methods:
  `fill(path, finish, { alpha, feather })` (path = `'all'`, polygon, or `(g) => canvas path`), `stroke(path, width, finish, { px })`,
  `groove(path, { px, depth, dark })`, `line(points, opts)`, `panel(a0, b0, a1, b1, { r })`, `rivets(a0, b0, a1, b1, spacing, opts)`,
  `decal(a, b, fn)` (draw in metres; pre-mirrored on bottom/right views so text reads correctly), `text(str, a, b, h, opts)`,
  body-side helpers `decalOn / textOn / band / yLine / ring / windows / doorOn` (need `chart.body = loft`),
  `decalT(z, t, fn)`, `noise`, `streak`, `wear(path, width, finish)`, `shade(path, amount, { feather })` (occlusion layer).
* On `unwrap` charts the two axes have different scales: give line widths in pixels (`px`) there.
* Weight of detail: panel lines `dark ≈ 0.1–0.16`, control-surface gaps `px 2, depth 0.8, dark 0.5`, rivets
  `dark ≤ 0.05`. Anything heavier looks like a tiled floor at normal viewing distances. Look at `atlas=color`.
* Liveries: keep a `SCHEMES` table (colours, finish, markings) and branch inside the paint function; export `LIVERIES`.
* Finally `const mat = atlas.material(ctx); rig.material('paint', mat, { shared: true }); rig.disposables.push(atlas);`
  (`rig.disposables.push(atlas)` matters: the rig bakes contact occlusion into the atlas and packs its textures.)

#### What the skin material adds by itself (section 6 has the options)
You paint colour, roughness, metalness and grooves; `atlas.material()` turns that into a surface that is not plastic.
Everything below is keyed on the **roughness / metalness you painted**, runs in object space in the shader (so it also
works on flat swatches and costs neither texels nor build time) and needs no code in a visual:

| Painted finish | The material adds |
|---|---|
| gloss paint (`rough ≲ 0.3`, not metal) | a clear coat over a duller pigment layer (sharp sky / horizon reflection + broad sheen), orange peel in the coat, dried run-off streaks in its roughness |
| matt / semigloss paint | patchy sheen (handled areas go glossier), chalking on sun-facing surfaces, grime underneath and in run-off streaks |
| bare metal (`metal ≳ 0.6`) | brushed micro-normal along the airflow, roughness breakup; warm colours (titanium, `heatStained`) get straw / purple / blue heat tint |
| everything but rubber | "oil canning": bays between frames and stringers pull in or out by a fraction of a degree — visible only in grazing reflections |
| grooves, rivet rows | dirt: the height layer is blurred into a cavity mask that darkens and roughens gaps (no extra pen calls) |
| cavities | per-vertex occlusion (`mesh.occlude`, set automatically by `K.well`, nacelle inlets, fans, nozzle petals, wheel dishes) and the atlas `ao` layer (contact occlusion baked by the rig; paint more with `P.shade`) |

So: do **not** paint fake specular highlights, do not over-use `noise` (two calls per chart are plenty; they are
composited at quarter resolution), and choose finishes by what the surface is — the material does the rest.

### Step 8 — rig and animation
```js
const rig = K.createRig(ctx, { geometry: G, name: 'f16' });
rig.material('paint', mat, { shared: true });
rig.addStatic(staticMesh, 'paint');                     // copies the mesh NOW: add everything to it first
const flap = rig.hingePart('flaperonR', wingR.controls.flaperon);      // { node, set }; + angle = trailing edge up
const rud  = rig.hingePart('rudder', fin.controls.rudder, { toward: [1, 0, 0] });   // + angle = trailing edge right
const node = rig.part('stabR', mesh, { pivot });  const setStab = rig.hinge(node, a, b, { ref, toward: [0, 1, 0] });
rig.onUpdate((S, dt) => { flap.set((S.sf.aileronR * 21 - S.sf.flaps * 20) * DEG); rud.set(S.sf.rudder * 30 * DEG); });
return rig.build();
```
* `rig.hinge(node, a, b, { ref, toward })` returns `set(angleRad)`: a positive angle moves the point `ref` in the
  direction `toward`. That is the whole sign convention — state the direction you want and never think about axes.
* Fowler flaps / slats: hinge about a line **below** the surface (`a − up × d`, see `drop()` in the 737) so the
  panel translates as it rotates; parent the aft flap segment to the main flap node.
* `K.seq(g, a, b)` (eased sub-range) and `K.keys([[x, y], …], x)` help with sequencing.
* `const lap = K.stopwatch(); … lap('geometry'); … lap('paint');` then `visual.stats.phases = lap.out` shows where build time goes.
* `rig.build()` adds `stats = { triangles, drawCalls, buildMs }`; `dispose()` frees geometries, materials and
  everything in `rig.disposables`.

### Step 9 — verify from six views
`view=sheet` with gear down, then individually and critically: `side`, `top`, `front`, `rearq`, `below`, `cockpit`;
then every animated part at both extremes (`surf=1`, `surf=-1`, `flaps=1&slats=1&sb=1`, `gear=0.5`, `gear=0&air=1`,
`ab=1&noz=1`, `canopy=1`, `night=1&lights=…`), then the real sim on the runway and in the air.

---------------------------------------------------------------------------------------------------------------

## 4. Recognisability checklist

1. **Proportions first.** Length : span : height inside the `dims=1` box; fuselage fineness; where the wing sits
   along the body; tail size. A wrong proportion cannot be painted away.
2. **Side profile**: nose shape and droop, windshield/canopy slope and height, spine line, belly line, tail upsweep,
   fin leading-edge sweep and tip chord, nozzle length.
3. **Plan view**: LE and TE sweep, taper, kinks, strakes/LERX outline, tailplane position relative to the wing.
4. **Front view**: dihedral/anhedral, intake shape, engine spacing, gear track and leg splay, canopy width.
5. **Signature features** (pick the three that identify the type and get them right): e.g. F-16 chin intake + bubble
   canopy + ventral fins; 737 flat-bottomed nacelles + pointed nose + dorsal fin fillet.
6. **Stance**: wheels on the ground at `geometry.gear[i].pos`, correct deck angle, oleos not fully extended.
7. **Surfaces**: control-surface hinge lines where they really are; correct direction for every state sign.
8. **Materials**: matte tactical paint ≈ rough 0.66, airliner gloss ≈ 0.2, bare metal `metal: 1`; hot sections darker
   and metallic; tyres rough 0.9. Glass must show the cockpit, not a yellow or black blob.
9. **Restraint in textures**: thin panel lines, subtle weathering, readable markings in the right places.
10. **Cockpit eye view**: nothing blocks the forward view that does not in reality; HUD / glareshield at eye level.

---------------------------------------------------------------------------------------------------------------

## 5. API reference (everything is exported from `kit/index.js`)

**mesh.js** — `new Mesh()` (`vert`, `tri`, `quad`, `add(mesh[, Matrix4])`, `clone`, `transform`, `translate`, `scale`,
`rotateX/Y/Z`, `aim(dir)`, `mirrorX`, `flip`, `setUV(uv)`, `inflate(d)`, `smooth(creaseDeg)`, `bounds`, `toGeometry`,
`occlude(v | (x, y, z, i) => v)`, `vertexCount`, `triCount`, raw arrays `p`, `n`, `uv`, `idx`, optional `occ`) · `merge(...meshes)` · `lathe(profile [[r, z, hard?]], { segments, uv, arc, sx, sy, morph })`
(walk the profile with z increasing for an outward skin) · `tube(a, b, r0, r1, { segments, caps, uv })` · `pipe(points, radius, opts)`
· `ellipsoid(rx, ry, rz, { segments, rings, uv, z0, z1 })` · `box(sx, sy, sz, uv)` · `boxBetween(min, max, uv)` ·
`prism(outline [[z, y]], x0, x1, uv)` · `plate(p0, p1, p2, p3, t, uv)` · `thicken(patch, t, uvInner)` · `well(patch, depth, uv, dir)` · `centroid(mesh)`.

**loft.js** — `loft({ stations, segments, step, tRange, zRange, capStart, capEnd, capUV, creases, cutouts, chart | uv | uvFn(x, y, z, t, ring), uAxis, inflate, flip })`
→ `{ mesh, patches, edges, at, ring, tAtY, yAtT, topAt, botAt, halfWidthAt, girthAt, sAtZ, zRange, K }`. `ring` in `uvFn`
has `run` (index of the run between `hard` stations), `s`, `k` (fractional station index). `roundEnd`, `pchip(xs, ys)`.

**airfoil.js** — `naca4`, `naca5`, `naca6`, `cst`, `supercritical`, `biconvex`, `hexagonal`, `slab`.

**surface.js** — `wing(opts)`, `blendedWinglet(tip, opts)` (section 3, step 3).

**atlas.js** — `createAtlas({ size, base, swatchRows, maxDensity, heightScale = 1, skin })` → `chart(name, spec)`, `pack()`, `swatch(key, finish)`,
`strip(key, cells, (g, layer) => …)` → `{ uv(t) }` (a row of swatch cells painted as a 1-D gradient texture: tyre sections, wheel dishes; `null` when the swatch block is full),
`pen(chart)`, `material(ctx, { envMapIntensity, normalScale, normalStrength, emissiveIntensity, skin })`, `textures(ctx)`, `flush()`, `bake()`, `layer('ao' | 'emis')`, `layers`, `charts`, `dispose()` ·
`FINISH`, `FONT` (`sans`, `wide`, `round`, `serif`, `mono`), `drawText(g, str, h, opts, layer)`, `drawStarBar(g, size, { lowVis })`.
Chart: `uv(a, b)`, `uv3(x, y, z)`, `uvUnwrap(z, t)`, `body`.

**skin.js** — `SKIN_DEFAULTS`, `skinMaterial(ctx, tex, opts)` (what `atlas.material` returns; see section 6).

**occlusion.js** — `bakeContactAO(meshes, atlases, { cell, strength })` (called by `rig.build()`).

**materials.js** — `glassMaterial(ctx, { tint, opacity, edgeOpacity, metalness, roughness, reflect, dust })`, `GLASS`, `glowMaterial()`, `lampMaterial(ctx)`.

**rig.js** — `createRig(ctx, { geometry, name, cockpitRadius, glassLayer, contactAO })` → `material(key, mat, { layer, shadow, shared })`,
`glass(key, mat)`, `addStatic(mesh, key)`, `node(name, { parent, pivot })`, `part(name, mesh, { key, parent, pivot, ao })`,
`hinge(node, a, b, { ref, toward })`, `hingePart(name, control, { toward, key, parent })`, `lamp(kind, pos, opts)`,
`onUpdate(fn)`, `build()`, `cameraInCockpit`, `disposables` · `seq`, `keys`, `smooth01`.

**gear.js** — `buildGear(rig, atlas, spec)` → `{ leg, steer, piston, wheels, axis, axle, stroke, pivot, bottom }`, `wheel(opts)`,
`tyreStrips(atlas)`, `swing(pivot, from, to)`, `arrestorHook(opts)`. New optional spec fields: `lines: false` (no hydraulic lines on the
strut), `brakes: true | false` (brake stacks; default from `geometry.gear[i].braked`), `plainWheels: true` (flat tyre / hub swatches),
`bolts: n` (hub tie bolts, default 12, 8 on small wheels), `wheelSegments` (default 32). Wheels carry tie bolts, a bearing cap and a
valve; offset wheels a brake housing with a visible disc stack, piston bosses and a brake line; struts a gland seal and lock bolts;
torque links their pins. Doors thickened with an inner finish (`K.thicken(patch, t, uv)`) and wells (`K.well(patch, depth, uv)`)
get frames / stiffeners (`ribs: false` to switch off).

**propulsion.js** — `fan`, `fanBackdrop`, `petalNozzle`, `afterburnerGlow`, `abGlowColor`, `nozzle2D`, `nacelle`, `pylon`, `intake2DStations`.

**cockpit.js** — `pilot`, `ejectionSeat`, `crewSeat`, `hud`, `display`, `glareshield`, `instrumentPanel`, `stick`, `throttle`, `yoke`,
`pedals`, `tub`, `liner`, `bulkhead`, `deck`. **displays.js** — `displayTexture()`, `displayUV(page, u, v)`, `DISPLAY_TILES`.

**rig.js** — also `lampFlash(kind, t)`: the strobe / beacon pattern shared with the effects light sprites (use `S.tLamp`, the sim
clock, for t) — visuals that animate their own halos should use it so lens, halo and sprite flash together. Point sprites named
`halos` are depth-pulled toward the camera by the rig so the skin no longer clips them. `Mesh.sidecar(kind)` ('display' | 'panel' |
'hud') holds geometry for kit-owned materials; it follows transforms / add / clone and the rig draws it.
`glowMaterial()` draws on the post layer (the night grade cannot desaturate it); `abGlowColor` gives a dim turbine-exit glow at dry
thrust (visible at night) and switches the pattern to the flame holder in afterburner.

**stores.js** — `missile`, `launchRail`, `tank`, `probe`, `bladeAntenna`, `staticWicks`, `vortexGenerators`, `fence`.

Each function has a doc comment with all options at its definition.

---------------------------------------------------------------------------------------------------------------

## 6. Photorealism options (all optional, defaults are good)

```js
const atlas = K.createAtlas({ size, base, skin: { weathering: 0.7, framePitch: 0.35 } });   // per atlas …
const mat = atlas.material(ctx, { skin: { waviness: 0 } });                                 // … or per material (wins)
```

| `skin` option | Default | Meaning |
|---|---|---|
| `weathering` | `0.5` | 0 factory fresh … 1 hard-used: sheen patches, streaks, chalking, grime, dirt in panel gaps (gloss paint gets 60 % of it) |
| `waviness` | `1` | oil-canning strength (1 ≈ 0.3° of skin slope). `0` for thick machined or composite skins |
| `framePitch` | `0.45` | metres between frames (airliners ≈ 0.5, fighters ≈ 0.3–0.4); stringer pitch is 55 % of it |
| `orangePeel` | `1` | clear-coat texture on gloss paint |
| `clearcoat` | `1` | `0` drops the second specular lobe (it is always off at quality `low`) |
| `heatTint` | `1` | temper colours on warm bare metal |
| `cavity` | `1` | dirt in grooves and around fasteners, from the height layer |
| `mipBias` | `-0.35` | sharper stencils at glancing angles |
| `detail` | `true` | `false`: plain packed PBR without any procedural detail |

Other optional additions:
* **Occlusion**: `mesh.occlude(0.6)` or `mesh.occlude((x, y, z) => …)` darkens ambient light on ducts, bays and tubs you
  build yourself (jet pipes, intake ducts from `K.loft`, cockpit tubs). `P.shade(path, amount, { feather })` paints
  occlusion on a chart. `K.createRig(ctx, { contactAO: false })` or `{ contactAO: { strength, cell } }` controls the automatic
  bake onto fuselage charts (`chart.body` must be set — it is whenever you use `decalOn`); `chart(name, { …, ao: false })`
  skips one chart; `rig.part(name, mesh, { ao: false })` keeps a part out of the occluders (parts that are not in their
  built pose most of the time).
* **Glass**: `dust` (default 0.035) is the haze of a used canopy in sunlight; `0` for museum glass.
* **Lamps** are always drawn (an unlit lamp is a dark lens), are hot in the middle, and never shrink below a pixel.
  Levels by day are modest on purpose: a position light is no brighter than sunlit paint.
* **Afterburner**: `K.afterburnerGlow` + `K.glowMaterial()` draw a flame holder (rings, radial gutters, dark tail
  cone) and a streaky liner. Your own glow meshes are unaffected unless their `uv.y` is `2 + angle fraction`.

## 7. Pitfalls we already hit

* The atlas textures are **packed on the visual's first `update()`** (`atlas.bake()`; `rig.build()` bakes the contact
  occlusion first): swatches, strips and pen strokes made after `atlas.material()` still land in the textures as long
  as they happen before `rig.build()` returns. After the pack only the colour layer can still change, and the height /
  roughness / occlusion canvases are freed (append `&atlas=…` in the harness to keep them for inspection).
* `noise()` is deferred: it lands on top of everything painted on that chart, including markings painted after it.

* `rig.addStatic(mesh, key)` **copies** the mesh at call time. Finish adding to your static `Mesh` first.
* Fold-over lofts must start inside the duct; otherwise the lip is inside-out (looks black / see-through).
* Hinge names: a line named like a keyword wins — `from: 'te'` resolves a line called `te` before the trailing edge.
* `wing({ side: -1 }).at()` returns mirrored points; for painting mirrored charts use the right wing's `at`.
* A `flap` block's hinge is the control's own `hinge`; all-moving tails need an explicit pivot line (`rig.hinge`).
* Gold/metallic glass tints must stay dark (`#6e5a34`-ish) or the canopy turns into yellow plastic.
* Afterburner / lamp radiances are HDR; anything above ~20 burns to white after tone mapping.
* Value-noise weathering at high alpha shows a lattice; keep `noise` alpha ≤ 0.1 and add a second, larger octave.
* The packer gives every chart the same pixels per metre × `density`; one over-long chart (a 38 m fuselage in one
  strip) starves all the others — use `strips: 2`.
* Keep moving parts few: the 737 has 51 draw calls with every flap, slat, spoiler, fan and gear part separate.
