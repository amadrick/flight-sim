// Learned pavement reflectance: how grooved, rubber-coated, damp runway asphalt reflects the sun and the sky.
//
// Why: the engine shades pavement as a flat Lambert + GGX surface with a few bumps. Real asphalt is crushed stone
// standing out of a black binder, cut by 6 x 6 mm saw grooves every 38 mm, filled with rubber in the touchdown zones
// and with water when it rains. At the grazing angles a runway is seen at from the cockpit those millimetre shapes
// shadow and mask each other: the eye sees only stone tops (lit ones down-sun, shaded ones into the sun), the grooves
// hide the sky's mirror image looking across them and show it looking along them, rubber and dampness smooth it.
// Two small MLPs learned that from a reference renderer (tools/neural/ground/pave/trace.py: 0.45 mm height fields of
// stone, binder, grooves, rubber and water; Lambert + GGX facets, exact cast shadows and masking, Monte Carlo sky):
//
//   SUN net (mu_s, mu_v, azimuth invariants of sun and view about the runway axis, groove, exposure, rubber, wet)
//           -> ln Kd (diffuse relative to Lambert at the tile's albedo), ln(Ks + eps) (specular BRF)
//   SKY net (mu_v, view azimuth invariant, groove, exposure, rubber, wet) -> ln Hd, ln Hs (unit sky)
//
// Runtime: per airport a small LUT is baked for the current sun (relative to that airport's first runway) and wetness:
// 32 (view azimuth from the runway axis) x 16 (mu_v) x 4 layers (groove 0/1 x rubber 0/1), RGBA16F, holding the
// FACTORS the pavement shader multiplies three.js' lighting terms by: r = Kd, g = Ks / Ks_three(roughness 0.6),
// b = Hd, a = Hs / DFG_three(0.6). Rebaked only when the sun moves (> 0.25 deg) or the wetness changes; ~2 k network
// evaluations, a few ms. Cost in the pavement shader: 2 bilinear fetches on asphalt pixels.
import * as THREE from 'three';
import { decodeTurfNet as decodeNet, turfForward as forward } from './ground-turf.js';
import { PAVE_SUN, PAVE_SKY, PAVE_EVAL } from './ground-pave-weights.js';

export { PAVE_EVAL };
export const PNA = 32, PNV = 16, PMU0 = 0.03, PAVE_EXPOSURE = 0.6, REF_ROUGH = 0.6;
export const muOfRow = (j) => PMU0 + (1 - PMU0) * (j / (PNV - 1)) ** 2;

let _nets = null;
export function paveNets() {
  if (!_nets) _nets = { sun: decodeNet({ sizes: PAVE_SUN.sizes, b64: PAVE_SUN.data }), sky: decodeNet({ sizes: PAVE_SKY.sizes, b64: PAVE_SKY.data }), eps: PAVE_SUN.eps };
  return _nets;
}
/** Kd, Ks for sun / view directions given by mu and azimuth about the runway axis (radians). */
export function paveSun(nets, g, e, r, w, mus, phs, muv, phv, out = [0, 0]) {
  const x = nets.sun.x;
  x[0] = mus * 2 - 1; x[1] = muv * 2 - 1; x[2] = Math.cos(phv - phs); x[3] = Math.cos(phs) ** 2 * 2 - 1; x[4] = Math.cos(phv) ** 2 * 2 - 1;
  x[5] = Math.cos(phs) * Math.cos(phv); x[6] = Math.sin(phs) * Math.sin(phv); x[7] = g * 2 - 1; x[8] = e * 2 - 1; x[9] = r * 2 - 1; x[10] = w * 2 - 1;
  const y = forward(nets.sun, x);
  out[0] = Math.exp(y[0]); out[1] = Math.max(Math.exp(y[1]) - nets.eps, 0);
  return out;
}
export function paveSky(nets, g, e, r, w, muv, phv, out = [0, 0]) {
  const x = nets.sky.x;
  x[0] = muv * 2 - 1; x[1] = Math.cos(phv) ** 2 * 2 - 1; x[2] = g * 2 - 1; x[3] = e * 2 - 1; x[4] = r * 2 - 1; x[5] = w * 2 - 1;
  const y = forward(nets.sky, x);
  out[0] = Math.exp(y[0]); out[1] = Math.exp(y[1]);
  return out;
}
/** pi * f_GGX as three.js evaluates it (D_GGX, V_GGX_SmithCorrelated, F_Schlick F0 0.04) on a flat surface. */
export function ggxBRF(mus, phs, muv, phv, rough) {
  const a2 = rough ** 4, sl = Math.sqrt(1 - mus * mus), sv = Math.sqrt(1 - muv * muv);
  let hx = sl * Math.cos(phs) + sv * Math.cos(phv), hy = sl * Math.sin(phs) + sv * Math.sin(phv), hz = mus + muv;
  const hn = Math.hypot(hx, hy, hz); hx /= hn; hy /= hn; hz /= hn;
  const vh = sv * Math.cos(phv) * hx + sv * Math.sin(phv) * hy + muv * hz;
  const d = hz * hz * (a2 - 1) + 1, D = a2 / (Math.PI * d * d);
  const V = 0.5 / Math.max(mus * Math.sqrt(a2 + (1 - a2) * muv * muv) + muv * Math.sqrt(a2 + (1 - a2) * mus * mus), 1e-6);
  return Math.PI * (0.04 + 0.96 * (1 - vh) ** 5) * V * D;
}
/** three.js DFGApprox specular reflectance under a uniform environment (F0 0.04). */
export function dfgSpec(muv, rough) {
  const r = [rough * -1 + 1, rough * -0.0275 + 0.0425, rough * -0.572 + 1.04, rough * 0.022 - 0.04];
  const a004 = Math.min(r[0] * r[0], 2 ** (-9.28 * muv)) * r[0] + r[1];
  return 0.04 * (-1.04 * a004 + r[2]) + (1.04 * a004 + r[3]);
}

/** Fill a Float32 RGBA LUT (PNA x PNV x 4 layers) for sun (mu_s, azimuth from the runway axis) and wetness. */
export function bakePaveLUT(data, mus, phs, wet, nets = paveNets()) {
  const s = [0, 0], k = [0, 0];
  mus = Math.max(mus, 0.03);
  for (let L = 0; L < 4; L++) {
    const g = L >> 1, r = L & 1;
    for (let j = 0; j < PNV; j++) {
      const muv = muOfRow(j);
      for (let i = 0; i < PNA; i++) {
        const phv = (i + 0.5) / PNA * 2 * Math.PI;
        paveSun(nets, g, PAVE_EXPOSURE, r, wet, mus, phs, muv, phv, s);
        paveSky(nets, g, PAVE_EXPOSURE, r, wet, muv, phv, k);
        const o = ((L * PNV + j) * PNA + i) * 4;
        data[o] = Math.min(s[0], 4);
        data[o + 1] = Math.min(s[1] / Math.max(ggxBRF(mus, phs, muv, phv, REF_ROUGH), 1e-4), 8);
        data[o + 2] = Math.min(k[0], 2);
        data[o + 3] = Math.min(k[1] / dfgSpec(muv, REF_ROUGH), 4);
      }
    }
  }
  return data;
}

/** Per-airport LUT texture + updater (call update from the pavement material's onBeforeRender). */
export function createPaveLUT() {
  const data = new Float32Array(PNA * PNV * 4 * 4);
  const tex = new THREE.DataArrayTexture(data, PNA, PNV, 4);
  tex.format = THREE.RGBAFormat; tex.type = THREE.FloatType; tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  let last = null, lastT = -1e9;
  return {
    texture: tex,
    /** sun: world direction toward the sun (y up); axis: unit runway axis in world xz [x, z]; wet 0..1 */
    update(sun, axis, wet) {
      const w = Math.min(wet, 0.3);                     // standing water stays with the classic model (glint)
      const key = [sun.x, sun.y, sun.z, axis[0], axis[1], w];
      if (last) {
        const ds = Math.abs(key[0] - last[0]) + Math.abs(key[1] - last[1]) + Math.abs(key[2] - last[2]);
        const same = key[3] === last[3] && key[4] === last[4] && Math.abs(w - last[5]) < 0.02;
        if (same && ds < 0.004) return false;
        // (time acceleration: a ~20 ms bake at most every 2 s unless the sun jumped)
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        if (same && ds < 0.05 && now - lastT < 2000) return false;
        lastT = now;
      }
      last = key;
      // azimuth about the runway axis (x = along, y = across: across = axis rotated +90 deg in xz)
      const al = sun.x * axis[0] + sun.z * axis[1], ac = -sun.x * axis[1] + sun.z * axis[0];
      bakePaveLUT(data, sun.y, Math.atan2(ac, al), w);
      tex.needsUpdate = true;
      return true;
    },
  };
}
