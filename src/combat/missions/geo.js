// Places and terrain-aware placement for mission scripts. Pure math; safe in node.
// Every altitude a mission uses goes through these helpers, so nothing ever spawns inside a mountain:
// the real page has terrain up to ~3000 m, the node bench is flat (or whatever groundFn a test supplies).
import * as THREE from 'three';
import { AIRPORTS, CARRIER } from '../../data/airports.js';
import { headingVec } from '../util.js';

const apt = (id) => { const a = AIRPORTS.find((x) => x.id === id); return a ? { x: a.position.x, z: a.position.z, elev: a.elevation } : { x: 0, z: 0, elev: 0 }; };

/**
 * Named points (world x/z, metres). Airports come from the data file; the rest are this module's own
 * invented geography, placed on the generated terrain (coast at z ≈ +12 km south of Haven, the high
 * range from z ≈ −70 km to −150 km, the desert plateau around Redrock).
 */
export const PLACES = {
  haven: apt('KHVN'), redrock: apt('KRDR'), pinecrest: apt('KPNC'), coral: apt('PCRK'), baywater: apt('KBAY'),
  carrier: { x: CARRIER.position.x, z: CARRIER.position.z, elev: CARRIER.deckHeight },
  gullShoal: { x: 6000, z: 34000 },          // over-water training range south of Haven
  tinplate: { x: 112000, z: -8000 },        // dry-lake air combat range west of Redrock
  saddle: { x: -14000, z: -62000 },          // the pass climbing from the coastal plain toward Pinecrest
  cobbler: { x: 40000, z: -120000 },         // a deep valley system in the high range
  lanternLine: { z: -150000 },               // the ceasefire line along the far side of the range
  glassFlats: { x: 70000, z: -40000 },       // open high plain between the coast and the desert
  saltReach: { x: -40000, z: 70000 },        // open sea south-west of the carrier
};

/** Vector3 at `dist` metres along true bearing `brg` from `from` ({x,z}); y = alt. */
export function offset(from, brg, dist, alt = 0, out = new THREE.Vector3()) {
  headingVec(brg, out).multiplyScalar(dist);
  return out.set(from.x + out.x, alt, from.z + out.z);
}

/** Highest ground (m MSL, never below sea level) at x/z and on two rings around it. */
export function groundMax(world, x, z, r = 2500) {
  let h = Math.max(0, world.groundHeightAt(x, z));
  for (let k = 0; k < 8; k++) {
    const a = k * Math.PI / 4;
    const c = Math.cos(a), s = Math.sin(a);
    h = Math.max(h, world.groundHeightAt(x + c * r, z + s * r), world.groundHeightAt(x + c * r * 0.5, z + s * r * 0.5));
  }
  return h;
}

/** An altitude at least `clearance` above the highest ground near x/z; `want` when that is already higher. */
export function safeAlt(world, x, z, want, clearance = 500, r = 2500) {
  return Math.max(want ?? 0, groundMax(world, x, z, r) + clearance);
}

/** Highest ground along the segment a→b (both {x,z}), sampled every `step` metres with a side ring of `r`. */
export function routeMax(world, a, b, step = 2000, r = 1200) {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(L / step));
  let h = 0;
  for (let i = 0; i <= n; i++) h = Math.max(h, groundMax(world, a.x + dx * i / n, a.z + dz * i / n, r));
  return h;
}

/** Height of the ground straight below x/z (sea level when the terrain is under water). */
export function groundAt(world, x, z) { return Math.max(0, world.groundHeightAt(x, z)); }
