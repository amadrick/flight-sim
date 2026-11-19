// Aircraft kit — public API. See README.md in this directory for the reference and the step-by-step guide.
export { Mesh, merge, lathe, tube, pipe, ellipsoid, shell, rbox, limb, box, boxBetween, prism, plate, thicken, well, centroid, ribs } from './mesh.js';
export { loft, roundEnd, pchip } from './loft.js';
export { naca4, naca5, naca6, cst, supercritical, biconvex, hexagonal, slab } from './airfoil.js';
export { wing, blendedWinglet } from './surface.js';
export { createAtlas, FINISH, FONT, drawText, drawStarBar } from './atlas.js';
export { SKIN_DEFAULTS, skinMaterial } from './skin.js';
export { glassMaterial, GLASS, lampMaterial, glowMaterial } from './materials.js';
export { createRig, makeStateView, seq, keys, smooth01 } from './rig.js';
export { buildGear, wheel, tyreStrips, swing, arrestorHook } from './gear.js';
export { fan, fanBackdrop, petalNozzle, afterburnerGlow, abGlowColor, nozzle2D, nacelle, pylon, intake2DStations } from './propulsion.js';
export { pilot, ejectionSeat, crewSeat, hud, stick, throttle, yoke, pedals, tub, liner, bulkhead, deck } from './cockpit.js';
export { missile, launchRail, tank, probe, bladeAntenna, staticWicks, vortexGenerators, fence } from './stores.js';

/** Tessellation multiplier and atlas size for a quality level. */
export function detailFor(ctx) {
  const level = ctx?.quality?.level || 'high';
  return { low: { detail: 0.6, atlas: 1024 }, medium: { detail: 0.85, atlas: 2048 }, high: { detail: 1, atlas: 2048 }, ultra: { detail: 1.2, atlas: 2048 } }[level] || { detail: 1, atlas: 2048 };
}

/** Phase timer for build budgets: const lap = stopwatch(); … lap('geometry'); … lap('paint'); → lap.out = { geometry: ms, paint: ms } */
export function stopwatch() {
  let t = performance.now(); const out = {};
  const lap = (name) => { const n = performance.now(); out[name] = Math.round((out[name] || 0) + n - t); t = n; };
  lap.out = out; return lap;
}
