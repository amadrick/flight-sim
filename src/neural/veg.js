// Neural vegetation lighting: two tiny MLPs trained offline (tools/neural/veg) on a Monte Carlo path tracer of forest
// stands built from the browser's own procedural species. At runtime each network is evaluated in JS into a small
// 3-D texture for the CURRENT sun elevation and re-baked (amortised over frames) when the sun moves, so a shader
// pays one or two texture fetches.
//
//   VEG_CANOPY: stand bidirectional reflectance factor for direct sun (RGB), gap fraction, sunlit foliage fraction
//               inputs  mu_s, mu_v, cos(relative azimuth), cover, conifer share
//   VEG_CROWN:  light transfer inside a crown (neighbours included): sun transmittance, cosine-weighted sky visibility
//               inputs  h_rel, d_rel, cos(azimuth of the point from the axis vs the sun), mu_s, cover, conifer
//
// The JS forward pass (vegForward) is the exact twin of tools/neural/veg/nn.py (tested on exported vectors).
import * as THREE from 'three';
import { VEG_CANOPY_NET, VEG_CROWN_NET, VEG_NET_META } from './veg-weights.js';

export { VEG_NET_META };
export const E_BRF = VEG_NET_META.eBrf;

/** Decode an exported net into typed arrays. */
export function vegDecode(net) {
  const layers = [];
  for (let i = 0; i < net.sizes.length - 1; i++) {
    layers.push({ nIn: net.sizes[i], nOut: net.sizes[i + 1], W: Float64Array.from(net.W[i]), b: Float64Array.from(net.b[i]) });
  }
  const wmax = Math.max(...net.sizes);
  return { layers, a: new Float64Array(wmax), b: new Float64Array(wmax), out: new Float64Array(net.sizes[net.sizes.length - 1]) };
}

/** Forward pass. x: encoded inputs. Returns net.out (reused). ISRU hidden activation. */
export function vegForward(net, x) {
  let src = x;
  const L = net.layers;
  for (let l = 0; l < L.length; l++) {
    const { nIn, nOut, W, b } = L[l];
    const last = l === L.length - 1;
    const dst = last ? net.out : (src === net.a ? net.b : net.a);
    for (let o = 0, w = 0; o < nOut; o++) {
      let s = b[o];
      for (let i = 0; i < nIn; i++, w++) s += W[w] * src[i];
      dst[o] = last ? s : s / Math.sqrt(1 + s * s);
    }
    src = dst;
  }
  return net.out;
}

const _x = new Float64Array(8);
/** Canopy network on raw inputs. Returns [BRF r, g, b, gap, sunlit] (new array). */
export function canopyEval(net, mus, muv, caz, cover, conifer) {
  const cp = mus * muv + Math.sqrt(Math.max(1 - mus * mus, 0)) * Math.sqrt(Math.max(1 - muv * muv, 0)) * caz;
  _x[0] = 2 * mus - 1; _x[1] = 2 * muv - 1; _x[2] = caz; _x[3] = 2 * cover - 1; _x[4] = 2 * conifer - 1;
  _x[5] = cp; _x[6] = Math.sqrt(Math.max(1 - cp, 0));
  return vegForward(net, _x);
}
/** Crown network on raw inputs. Returns [T_sun, sky visibility] (reused array). */
export function crownEval(net, h, d, caz, mus, cover, conifer) {
  _x[0] = 2 * h - 1; _x[1] = 2 * d - 1; _x[2] = caz; _x[3] = 2 * mus - 1; _x[4] = 2 * cover - 1; _x[5] = 2 * conifer - 1;
  return vegForward(net, _x);
}

// ---- LUT layouts -------------------------------------------------------------------------------------------------
// canopy: 3-D RGBA16F  x = mu_v (16, 0.03..1), y = cos(rel az) (16, -1..1), z = cover (8) x conifer (3 slices)
//         rgb = BRF, a = gap fraction
// crown:  3-D RGBA16F  x = h_rel (16), y = d_rel (8), z = cos az (8) x cover (4 slices)
//         rg = (T_sun, sky) broadleaf, ba = conifer
export const CAN = { nv: 16, na: 16, nc: 8, nk: 3, mu0: 0.03 };
export const CRN = { nh: 16, nd: 8, na: 8, nc: 4 };

function f16(v) { return THREE.DataUtils.toHalfFloat(v); }

export function createVegNeural({ neural = true } = {}) {
  const canopy = vegDecode(VEG_CANOPY_NET), crown = vegDecode(VEG_CROWN_NET);
  const cData = new Uint16Array(CAN.nv * CAN.na * CAN.nc * CAN.nk * 4);
  const tData = new Uint16Array(CRN.nh * CRN.nd * CRN.na * CRN.nc * 4);
  const mk = (data, w, h, d) => {
    const t = new THREE.Data3DTexture(data, w, h, d);
    t.format = THREE.RGBAFormat; t.type = THREE.HalfFloatType;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
    return t;
  };
  const canopyTex = mk(cData, CAN.nv, CAN.na, CAN.nc * CAN.nk);
  const crownTex = mk(tData, CRN.nh, CRN.nd, CRN.na * CRN.nc);
  // diffuse (bi-hemispherical) albedo of the canopy for sky light, per (cover, conifer): from the network at boot
  const albedo = Array.from({ length: CAN.nc * CAN.nk }, () => new THREE.Vector3());

  const axis = (i, n, a, b) => a + (b - a) * i / (n - 1);
  function bakeCanopySlice(mus, z) {          // z: one (cover, conifer) slice
    const ci = z % CAN.nc, ki = Math.floor(z / CAN.nc);
    const cover = axis(ci, CAN.nc, 0, 1), conifer = ki / (CAN.nk - 1);
    for (let j = 0; j < CAN.na; j++) for (let i = 0; i < CAN.nv; i++) {
      const muv = axis(i, CAN.nv, CAN.mu0, 1), caz = axis(j, CAN.na, -1, 1);
      const k = ((z * CAN.na + j) * CAN.nv + i) * 4;
      if (!neural) {      // classic: a flat Lambertian canopy with the same diffuse albedo
        const al = albedo[z];
        cData[k] = f16(al.x); cData[k + 1] = f16(al.y); cData[k + 2] = f16(al.z); cData[k + 3] = f16(0.3 * (1 - cover));
        continue;
      }
      const o = canopyEval(canopy, mus, muv, caz, cover, conifer);
      cData[k] = f16(Math.max(Math.exp(o[0]) - E_BRF, 0)); cData[k + 1] = f16(Math.max(Math.exp(o[1]) - E_BRF, 0));
      cData[k + 2] = f16(Math.max(Math.exp(o[2]) - E_BRF, 0)); cData[k + 3] = f16(Math.min(Math.max(o[3], 0), 1));
    }
  }
  function bakeCrownSlice(mus, z) {           // z: one (cos az, cover) slice
    const ai = z % CRN.na, ci = Math.floor(z / CRN.na);
    const caz = axis(ai, CRN.na, -1, 1), cover = axis(ci, CRN.nc, 0.1, 1);
    for (let j = 0; j < CRN.nd; j++) for (let i = 0; i < CRN.nh; i++) {
      const h = axis(i, CRN.nh, 0, 1), d = axis(j, CRN.nd, 0, 1);
      const k = ((z * CRN.nd + j) * CRN.nh + i) * 4;
      for (let g = 0; g < 2; g++) {
        let ts, sk;
        if (neural) { const o = crownEval(crown, h, d, caz, mus, cover, g); ts = o[0]; sk = o[1]; } else [ts, sk] = classicCrown(h, d, caz, mus, cover, g);
        tData[k + g * 2] = f16(Math.min(Math.max(ts, 0), 1)); tData[k + g * 2 + 1] = f16(Math.min(Math.max(sk, 0), 1));
      }
    }
  }
  // the canopy albedo for sky light: cosine-weighted average of the BRF over sun and view hemispheres
  for (let z = 0; z < CAN.nc * CAN.nk; z++) {
    const ci = z % CAN.nc, ki = Math.floor(z / CAN.nc);
    const acc = [0, 0, 0];
    let wsum = 0;
    for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) for (let c = 0; c < 6; c++) {
      const mus = Math.sqrt((a + 0.5) / 6), muv = Math.sqrt((b + 0.5) / 6), caz = Math.cos(Math.PI * (c + 0.5) / 6);
      const o = canopyEval(canopy, mus, muv, caz, axis(ci, CAN.nc, 0, 1), ki / (CAN.nk - 1));
      for (let q = 0; q < 3; q++) acc[q] += Math.exp(o[q]) - E_BRF;
      wsum++;
    }
    albedo[z].set(acc[0] / wsum, acc[1] / wsum, acc[2] / wsum);
  }

  const uniforms = {
    tVegCanopyLUT: { value: canopyTex },
    tVegCrownLUT: { value: crownTex },
    uVegCanopyAlb: { value: albedo },
    uVegNeural: { value: neural ? 1 : 0 },
  };
  // amortised re-bake: when mu_s moved by more than ~0.004 (about 0.25 degrees), re-bake a few slices per frame into
  // the staging arrays, then upload both textures at once
  let bakedMu = -1, pendingMu = -1, step = 0;
  const NSTEP = CAN.nc * CAN.nk + CRN.na * CRN.nc;     // 24 + 32 slices
  function update(sunDirY, force = false) {
    const mus = Math.min(Math.max(sunDirY, 0.02), 1);
    if (pendingMu < 0) {
      if (!force && bakedMu >= 0 && Math.abs(mus - bakedMu) < 0.004) return false;
      pendingMu = mus; step = 0;
    }
    const per = force ? NSTEP : 8;
    for (let k = 0; k < per && step < NSTEP; k++, step++) {
      if (step < CAN.nc * CAN.nk) bakeCanopySlice(pendingMu, step); else bakeCrownSlice(pendingMu, step - CAN.nc * CAN.nk);
    }
    if (step >= NSTEP) {
      canopyTex.needsUpdate = true; crownTex.needsUpdate = true;
      bakedMu = pendingMu; pendingMu = -1;
      return true;
    }
    return false;
  }
  update(0.7, true);
  return {
    uniforms, update, canopy, crown, glsl: VEG_NEURAL_GLSL,
    get bakedMu() { return bakedMu; },
    /** CPU twin of the GLSL canopy lookup (direct evaluation, no LUT). */
    canopyBRF: (mus, muv, caz, cover, conifer) => { const o = canopyEval(canopy, mus, muv, caz, cover, conifer); return [Math.exp(o[0]) - E_BRF, Math.exp(o[1]) - E_BRF, Math.exp(o[2]) - E_BRF, o[3], o[4]]; },
    textureBytes: (cData.byteLength + tData.byteLength),
    dispose() { canopyTex.dispose(); crownTex.dispose(); },
  };
}

/** The non-neural crown transfer used with veg=classic: Beer-Lambert through the crown depth along the sun direction
 *  (envelope approximation), self-shadowing on the side away from the sun, a fixed neighbour term, and AO by depth. */
export function classicCrown(h, d, caz, mus, cover, conifer) {
  const sinS = Math.sqrt(Math.max(1 - mus * mus, 0));
  const k = conifer > 0.5 ? 1.6 : 1.1;
  const path = d * 1.0 + (1 - caz) * 0.5 * sinS * 0.8;         // crown depth toward the sun (crown radii)
  const own = Math.exp(-k * path);
  const neigh = 1 - cover * 0.55 * (1 - h) * (1 - mus * 0.6);
  const sky = (1 - 0.55 * d) * (0.55 + 0.45 * h) * (1 - 0.25 * cover * (1 - h));
  return [own * Math.max(neigh, 0), Math.max(sky, 0)];
}

// GLSL. Uniforms: tVegCanopyLUT, tVegCrownLUT, uVegCanopyAlb[24], uVegNeural.
export const VEG_NEURAL_GLSL = /* glsl */`
uniform highp sampler3D tVegCanopyLUT;
uniform highp sampler3D tVegCrownLUT;
uniform vec3 uVegCanopyAlb[${CAN.nc * CAN.nk}];
// Forest canopy reflectance for direct sun at the CURRENT sun elevation (the LUT is re-baked when the sun moves).
//   muV = cos(view zenith) (direction toward the viewer), cosAz = cos(azimuth between the view and sun directions,
//   both pointing away from the ground: 1 = sun behind the viewer = hotspot side), cover = tree-cell occupancy 0..1,
//   conifer = conifer share 0..1. Returns rgb = BRF (pi L / (E cos theta_s)), a = gap fraction (floor visible).
vec4 vegCanopyBRF(float muV, float cosAz, float cover, float conifer) {
  vec3 uvw;
  uvw.x = (clamp((muV - ${CAN.mu0.toFixed(3)}) / ${(1 - CAN.mu0).toFixed(3)}, 0.0, 1.0) * ${(CAN.nv - 1).toFixed(1)} + 0.5) / ${CAN.nv.toFixed(1)};
  uvw.y = (clamp(cosAz * 0.5 + 0.5, 0.0, 1.0) * ${(CAN.na - 1).toFixed(1)} + 0.5) / ${CAN.na.toFixed(1)};
  float zc = clamp(cover, 0.0, 1.0) * ${(CAN.nc - 1).toFixed(1)} + 0.5;
  float kf = clamp(conifer, 0.0, 1.0) * ${(CAN.nk - 1).toFixed(1)};
  float k0 = min(floor(kf), ${(CAN.nk - 2).toFixed(1)});
  vec4 a = texture(tVegCanopyLUT, vec3(uvw.xy, (k0 * ${CAN.nc.toFixed(1)} + zc) / ${(CAN.nc * CAN.nk).toFixed(1)}));
  vec4 b = texture(tVegCanopyLUT, vec3(uvw.xy, ((k0 + 1.0) * ${CAN.nc.toFixed(1)} + zc) / ${(CAN.nc * CAN.nk).toFixed(1)}));
  return mix(a, b, kf - k0);
}
// Diffuse (sky-light) albedo of the canopy.
vec3 vegCanopyAlbedo(float cover, float conifer) {
  float c = clamp(cover, 0.0, 1.0) * ${(CAN.nc - 1).toFixed(1)}, k = clamp(conifer, 0.0, 1.0) * ${(CAN.nk - 1).toFixed(1)};
  int c0 = int(min(floor(c), ${(CAN.nc - 2).toFixed(1)})), k0 = int(min(floor(k), ${(CAN.nk - 2).toFixed(1)}));
  float fc = c - float(c0), fk = k - float(k0);
  vec3 a = mix(uVegCanopyAlb[k0 * ${CAN.nc} + c0], uVegCanopyAlb[k0 * ${CAN.nc} + c0 + 1], fc);
  vec3 b = mix(uVegCanopyAlb[(k0 + 1) * ${CAN.nc} + c0], uVegCanopyAlb[(k0 + 1) * ${CAN.nc} + c0 + 1], fc);
  return mix(a, b, fk);
}
// Light transfer inside a crown at the current sun elevation: x = sun transmittance (own crown + neighbours),
// y = sky visibility. h = crown-relative height 0..1, d = depth into the crown 0 (surface) .. 1 (axis),
// cosAz = cos(azimuth of the point around the trunk vs the sun azimuth), cover 0..1, conifer 0/1 (blend allowed).
vec2 vegCrownTransfer(float h, float d, float cosAz, float cover, float conifer) {
  vec2 uv = vec2((clamp(h, 0.0, 1.0) * ${(CRN.nh - 1).toFixed(1)} + 0.5) / ${CRN.nh.toFixed(1)},
                 (clamp(d, 0.0, 1.0) * ${(CRN.nd - 1).toFixed(1)} + 0.5) / ${CRN.nd.toFixed(1)});
  float za = clamp(cosAz * 0.5 + 0.5, 0.0, 1.0) * ${(CRN.na - 1).toFixed(1)} + 0.5;
  float cf = clamp((cover - 0.1) / 0.9, 0.0, 1.0) * ${(CRN.nc - 1).toFixed(1)};
  float c0 = min(floor(cf), ${(CRN.nc - 2).toFixed(1)});
  vec4 a = texture(tVegCrownLUT, vec3(uv, (c0 * ${CRN.na.toFixed(1)} + za) / ${(CRN.na * CRN.nc).toFixed(1)}));
  vec4 b = texture(tVegCrownLUT, vec3(uv, ((c0 + 1.0) * ${CRN.na.toFixed(1)} + za) / ${(CRN.na * CRN.nc).toFixed(1)}));
  vec4 t = mix(a, b, cf - c0);
  return mix(t.xy, t.zw, clamp(conifer, 0.0, 1.0));
}
`;
