// Near-field 3-D turf: shell layers over the airfield grass around the camera.
//
// The sward is drawn as N horizontal shells (one instanced draw of a camera-centred grid, instance = shell) between
// the ground and 1.3 x the local sward height. Each shell shows the cross-sections of the blades at its height from a
// baked, mip-mapped blade texture (bladeTexture: ~22 000 tapered blades per m^2 in clumps, each at its own height and
// with its own lean), shifted by the lay of the mower pass and by the wind, so the blades lean the same way the
// ground shader's turf reflectance assumes and sway in travelling gusts. Shells are alpha-blended bottom to top
// (back to front for a camera above them), so filtering never aliases: far away the coverage mips converge to a soft
// mean, and the whole layer fades out (0.45 .. 0.85 R and at grazing angles) into the textured ground, which takes
// the same colours and lay. Cells of the grid that lie entirely on pavement are left out of the index buffer
// (CPU, on recentre); the fragment shader stops the blades at the pavement edge (airfield distance map).
//
// Cost (2 blade fetches): medium 6 shells x 64^2 grid within 40 m, high 8 x 80^2 within 60 m, ultra 12 x 96^2 within 84 m; one draw
// call; per shell fragment 2 blade-array fetches + 2 noise fetches in the vertex shader.
import * as THREE from 'three';
import { AIRFIELD_GLSL } from '../airfield.js';
import { vegVertexCommon } from './common.js';

export const TURF_TIERS = { low: null, medium: { N: 6, G: 64, R: 40 }, high: { N: 8, G: 80, R: 60 }, ultra: { N: 12, G: 96, R: 84 } };
export const BLADE_TILE = 0.32;   // metres per blade texture repeat
const BT = 256, BL = 8;           // blade texture size, levels

function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Blade cross-sections per level: RG8 array (R = coverage, G = blade tint 0..1), BT^2 x BL, tiling. */
export function bladeTexture(seed = 7) {
  const r = rng(seed), data = new Uint8Array(BT * BT * BL * 2);
  const cov = new Float32Array(BT * BT * BL), tint = new Float32Array(BT * BT * BL);
  const n = Math.round(22000 * BLADE_TILE * BLADE_TILE), px = BLADE_TILE / BT;
  const clumps = Array.from({ length: Math.round(n / 12) }, () => [r() * BT, r() * BT]);
  for (let b = 0; b < n; b++) {
    const c = clumps[Math.floor(r() * clumps.length)];
    const g = () => { let s = 0; for (let k = 0; k < 4; k++) s += r(); return (s - 2) * 0.9; };
    const x0 = c[0] + g() * 0.008 / px, y0 = c[1] + g() * 0.008 / px;
    const rh = 0.55 + 0.75 * r();                                  // blade height / sward height
    const la = r() * 6.2832, lk = 0.25 * r();                      // own lean (in sward heights per unit height)
    const w0 = (0.0026 + 0.0016 * r()) / px * 0.5;                 // half width at the base, px
    const tn = r();
    for (let k = 0; k < BL; k++) {
      const z = (k + 0.5) / BL * 1.3;                              // level height / sward height
      if (z >= rh) break;
      const hw = w0 * Math.sqrt(1 - Math.pow(z / rh, 2));          // tapering to the tip
      // offset of the blade at this height: own lean, bending more toward the tip (x 4 cm-ish sward units)
      const off = lk * z * z * 0.05 / px;
      const cx = x0 + Math.cos(la) * off, cy = y0 + Math.sin(la) * off;
      const R = Math.max(hw, 0.35), Ri = Math.ceil(R + 1);
      for (let dy = -Ri; dy <= Ri; dy++) for (let dx = -Ri; dx <= Ri; dx++) {
        const X = Math.floor(cx) + dx, Y = Math.floor(cy) + dy;
        const ddx = X + 0.5 - cx, ddy = Y + 0.5 - cy;
        const a = Math.max(0, Math.min(1, R + 0.5 - Math.hypot(ddx, ddy))) * Math.min(1, hw / 0.35);
        if (a <= 0) continue;
        const i = k * BT * BT + (((Y % BT) + BT) % BT) * BT + (((X % BT) + BT) % BT);
        if (a > cov[i]) { cov[i] = Math.max(cov[i], a); tint[i] = 0.6 * tn + 0.4 * (z / rh); }
      }
    }
  }
  for (let i = 0; i < cov.length; i++) { data[i * 2] = Math.round(cov[i] * 255); data[i * 2 + 1] = Math.round(tint[i] * 255); }
  const tex = new THREE.DataArrayTexture(data, BT, BT, BL);
  tex.format = THREE.RGFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  let mean = 0; for (let k = 0; k < BL; k++) { let s = 0; for (let i = 0; i < BT * BT; i++) s += cov[k * BT * BT + i]; mean += s / (BT * BT) / BL; }
  return { texture: tex, meanCoverage: mean };
}

export function createTurf(ctx, { L, tier, uniforms, U, airfield }) {
  const t0 = performance.now();
  const { N, G, R } = tier;
  const cell = 2 * R / G;
  const blade = bladeTexture();
  const TU = {
    tTurfBlade: { value: blade.texture },
    uTurfGrid: { value: new THREE.Vector4(0, 0, cell, R) },      // xy = render-space xz of the grid's low corner
    uTurfOn: { value: 1 },
    tTerrNoise: uniforms.tTerrNoise, uTerrTile: uniforms.uTerrTile,
    tAirMap: uniforms.tAirMap, uAirMap: uniforms.uAirMap, uAirInfo: uniforms.uAirInfo,
  };
  // grid geometry: (G+1)^2 vertices, local integer coordinates; index buffer rebuilt on recentre
  const geo = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array((G + 1) * (G + 1) * 3);
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) { const k = (j * (G + 1) + i) * 3; pos[k] = i; pos[k + 2] = j; }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length); for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const idx = new Uint32Array(G * G * 6);
  const idxAttr = new THREE.BufferAttribute(idx, 1); idxAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(idxAttr);
  geo.instanceCount = N;
  geo.setDrawRange(0, 0);

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, TU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${vegVertexCommon(L)}
        ${AIRFIELD_GLSL}
        uniform vec4 uTurfGrid; uniform float uTurfOn;
        uniform sampler2D tTerrNoise; uniform vec2 uTerrTile[7];
        varying vec3 vTW; varying vec3 vTV; varying vec4 vTP; varying vec4 vTP2; varying float vTZ;
        vec2 tnUV(float c, float s, float inv, vec2 off, vec2 p) { return vec2(c * p.x - s * p.y, s * p.x + c * p.y) * inv + off; }`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        float zf = (float(gl_InstanceID) + 0.5) / ${N.toFixed(1)};             // shell height / (1.3 sward height)
        vec2 rxz = uTurfGrid.xy + position.xz * uTurfGrid.z;
        vec2 w = rxz + uOrigin.xz;
        vec2 am = airMap(rxz);
        // the same noise the ground shader reads for the mowing plan (scales 2 and 3 of the terrain noise)
        vec4 n2 = textureLod(tTerrNoise, tnUV(${Math.cos(2.29).toFixed(6)}, ${Math.sin(2.29).toFixed(6)}, ${(1 / 410).toExponential(6)}, uTerrTile[2], rxz), 0.0);
        vec4 n3 = textureLod(tTerrNoise, tnUV(${Math.cos(0.71).toFixed(6)}, ${Math.sin(0.71).toFixed(6)}, ${(1 / 110).toExponential(6)}, uTerrTile[3], rxz), 0.0);
        TurfP T = turfPlan(w, am.x, n2.r, n2.g, n3.r);
        float H = T.H * 1.3;
        float zm = zf * H;
        // lay: blades of a laid pass lean over by up to ~60 degrees, bending most near the tips
        vec2 lean = T.dir * (T.lay * 0.9 * zm * zf);
        // wind: travelling gusts, bending with height squared
        float ph = dot(w, uVegWind.xy) * 0.22 - uTime * 2.3;
        float gust = 0.55 + 0.45 * sin(ph) * sin(ph * 0.37 + 1.3) + 0.15 * sin(uTime * 7.1 + w.x * 3.1 + w.y * 2.3);
        lean += uVegWind.xy * (uVegWind.z * gust * zf * zf * H * 0.55);
        vec3 tp = vec3(rxz.x, vegGround(rxz) + zm + 0.004, rxz.y);
        float dc = distance(rxz, uTerrCam.xz);
        tp.y -= uTerrCurv * curvatureDrop(dc);
        // (render-space coordinates for the blade texture: the origin moves in 1024 m steps = whole tiles, and world
        // coordinates far from 0 would lose the millimetres in float32)
        vTW = vec3(rxz.x - lean.x, tp.y, rxz.y - lean.y);
        vTV = cameraPosition - tp;
        vTP = vec4(am.x, T.longG, T.since, dc);
        vTP2 = vec4(n2.r, n3.g, T.dir * T.lay);
        vTZ = zf;
        vec3 objectNormal = normalize(vec3(-T.dir.x * T.lay * 0.5, 1.0, -T.dir.y * T.lay * 0.5));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = tp;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform highp sampler2DArray tTurfBlade; uniform vec4 uTurfGrid; uniform float uTurfOn;
        varying vec3 vTW; varying vec3 vTV; varying vec4 vTP; varying vec4 vTP2; varying float vTZ;
        float tss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }`)
      .replace('#include <map_fragment>', /* glsl */`
        // keep in step with the ground shader's turf: worn verge, short / long zones, colours relative to TURF_REF
        float dP = vTP.x, longG = vTP.y, since = vTP.z, dc = vTP.w;
        float layer = floor(vTZ * ${BL.toFixed(1)});
        // two lookups at different scales and orientations (a single 0.32 m tile shows its lattice at grazing angles)
        vec2 bl = texture(tTurfBlade, vec3(vTW.xz * ${(1 / BLADE_TILE).toFixed(4)}, layer)).rg;
        vec2 bl2 = texture(tTurfBlade, vec3(vec2(0.6 * vTW.x - 0.8 * vTW.z, 0.8 * vTW.x + 0.6 * vTW.z) * ${(1 / (BLADE_TILE * 0.71)).toFixed(4)} + 0.37, layer)).rg;
        bl = vec2(clamp(0.62 * (bl.r + bl2.r), 0.0, 1.0), max(bl.g, bl2.g));
        bl.r *= 0.7 + 0.6 * vTP2.y;                       // clumpier and thinner patches
        // thin, worn turf along the pavement, none on it
        float edge = tss(0.05, 2.4 + 0.8 * (vTP2.y - 0.5), dP);
        float fadeD = 1.0 - tss(uTurfGrid.w * 0.45, uTurfGrid.w * 0.85, dc);
        vec3 V = normalize(vTV);
        float graze = tss(0.08, 0.30, abs(V.y) + 1.5 / max(dc, 1.0));      // shells read as sheets at grazing angles far off
        float a = bl.r * edge * fadeD * graze * uTurfOn;
        if (a < 0.02) discard;
        vec3 c = vec3(0.072, 0.100, 0.042) * (0.75 + 0.5 * bl.g);
        c = mix(c, vec3(0.165, 0.150, 0.080), longG * 0.30 * bl.g + 0.25 * tss(0.6, 0.85, vTP2.x));
        // inside the sward: lower parts see less sky and sun (bright tips, dark bases), blades of older passes dull
        c *= (0.35 + 0.75 * vTZ) * (1.0 - 0.15 * since);
        diffuseColor.rgb = c;
        diffuseColor.a = a;`)
      .replace('#include <normal_fragment_maps>', 'normal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => `skyward-turf-${N}`;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-turf'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.renderOrder = 2;

  let gx = 1e9, gz = 1e9, lastAp = null;
  function rebuild(camWX, camWZ, org) {
    // cells whose centre lies deeper than a cell diagonal inside pavement are not drawn (no growth there)
    let n = 0;
    const half = cell * 0.75;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const x = gx + (i + 0.5) * cell, z = gz + (j + 0.5) * cell;
      if (Math.hypot(x - camWX, z - camWZ) > R + cell) continue;
      const d = airfield.distanceAt(x, z)[0];
      if (d < -half) continue;
      const a = j * (G + 1) + i, b = a + 1, c = a + (G + 1), e = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b; idx[n++] = b; idx[n++] = c; idx[n++] = e;
    }
    idxAttr.needsUpdate = true;
    idxAttr.clearUpdateRanges?.();
    geo.setDrawRange(0, n);
    return n;
  }
  const stats = { shells: N, gridCells: 0, radius: R, bootMs: 0, triangles: 0 };
  stats.bootMs = performance.now() - t0;
  return {
    mesh, stats, blade,
    update(camWX, camWZ, org, agl) {
      // only near the ground and only where there is an airfield map with turf (inside ~4 km of its centre)
      const on = agl < 120 && airfield.stats.airport != null;
      mesh.visible = on;
      if (!on) return;
      const snap = cell * 4;
      const nx = Math.floor((camWX - R) / snap) * snap, nz = Math.floor((camWZ - R) / snap) * snap;
      if (nx !== gx || nz !== gz || airfield.stats.airport !== lastAp) {
        gx = nx; gz = nz; lastAp = airfield.stats.airport;
        const n = rebuild(camWX, camWZ, org);
        stats.gridCells = n / 6; stats.triangles = n / 3 * N;
      }
      TU.uTurfGrid.value.set(gx - org.x, gz - org.z, cell, R);
    },
    dispose() { geo.dispose(); mat.dispose(); blade.texture.dispose(); },
  };
}
