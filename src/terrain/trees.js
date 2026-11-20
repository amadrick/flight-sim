// Vegetation: trees, shrubs and grass near and far, built and baked at boot, placed on the GPU with the surface
// shader's land cover (terrCover in surface.glsl.js) so 3-D vegetation stands exactly where the surface paints forest.
//
//   veg/species.js    species table (crown envelopes, leaf optics; shared with the offline path tracer)
//   veg/foliage.js    procedural leaf / needle / frond / grass / bark atlas (pure JS rasteriser)
//   veg/treegen.js    procedural trees (trunk, limbs, leaf-cluster cards) -> vertex-pulling texture
//   veg/impostor.js   hemi-octahedral impostor atlases baked from those meshes (2 draw calls at boot)
//   veg/placement.js  toroidal per-cell placement map (species, height, terrain shadow, cover)
//   veg/near.js       full meshes near the camera (1 draw + shadow-map depth pass)
//   veg/far.js        impostors out to ~1.4 km (1 draw)
//   veg/grass.js      grass / turf / reeds within ~60 m (1 small map pass + 1 draw)
//   src/neural/veg.js crown light transfer + canopy reflectance networks, baked into 3-D LUTs (veg=classic: off)
//
// API used by terrain/index.js: createTrees(ctx, { L, uniforms }) -> { object3D, triangles, radius, update, dispose, stats }
import * as THREE from 'three';
import { createFoliageAtlas } from './veg/foliage.js';
import { buildTreeMeshes } from './veg/treegen.js';
import { bakeImpostors } from './veg/impostor.js';
import { createPlacement } from './veg/placement.js';
import { createCommonUniforms, vegDebug } from './veg/common.js';
import { createNearTrees } from './veg/near.js';
import { createFarTrees } from './veg/far.js';
import { createGrass } from './veg/grass.js';
import { createTurf, TURF_TIERS } from './veg/turf.js';
import { createBlades, BLADE_TIERS } from './veg/blades.js';
import { TREE_CELL } from './veg/species.js';
import { createVegNeural } from '../neural/veg.js';

// per quality: G = far map cells per side (6.5 m), near = mesh radius (m), grass = grass cells per side (1 m),
// frame = impostor frame size (px), blend = 4-view impostor blending
const TIERS = {
  low:    { G: 176, near: 0,   grass: 0,   frame: 64, blend: false },
  medium: { G: 320, near: 70,  grass: 96,  frame: 72, blend: true },
  high:   { G: 384, near: 80,  grass: 112, frame: 72, blend: true },
  ultra:  { G: 512, near: 130, grass: 160, frame: 72, blend: true },
};

let shared = null;      // meshes / atlases survive quality changes (rebuilding them is the expensive part of boot)

export function createTrees(ctx, { L, uniforms, airfield = null }) {
  const t0 = performance.now();
  const raw = ctx.params.raw || {};
  const tier = { ...(TIERS[ctx.quality.level] || TIERS.medium) };
  if (raw.vegG) tier.G = Math.max(16, Math.min(640, +raw.vegG | 0));
  if (raw.vegNear !== undefined) tier.near = Math.max(0, +raw.vegNear);
  const neuralOn = raw.veg !== 'classic';
  vegDebug.mode = raw.vegDbg ? +raw.vegDbg | 0 : 0;
  if (!shared || shared.renderer !== ctx.renderer || shared.frame !== tier.frame || shared.neural !== neuralOn) {
    shared?.dispose();
    const foliage = createFoliageAtlas();
    const tA = performance.now();
    const meshes = buildTreeMeshes();
    const tB = performance.now();
    const imp = bakeImpostors(ctx.renderer, meshes, foliage, ctx.uniforms.frame, { F: tier.frame });
    const tC = performance.now();
    const neural = createVegNeural({ neural: neuralOn });
    shared = {
      renderer: ctx.renderer, frame: tier.frame, neural: neuralOn, foliage, meshes, imp, nn: neural,
      ms: { foliage: tA - t0, meshes: tB - tA, impostors: tC - tB, neural: performance.now() - tC },
      dispose() { foliage.dispose(); meshes.texture.dispose(); imp.dispose(); neural.dispose(); },
    };
  }
  const { foliage, meshes, imp, nn } = shared;
  // the canopy LUT uniforms ride along in the terrain's shared uniforms (for the surface shader's distant forest)
  Object.assign(uniforms, nn.uniforms);
  const G = tier.G, Gn = tier.near > 0 ? Math.ceil(2 * tier.near / TREE_CELL) + 2 : 0;
  const placement = createPlacement(ctx, { L, G, uniforms });
  const U = createCommonUniforms(ctx, uniforms, placement, meshes, nn);
  U.tVegVerts = { value: meshes.texture };
  U.tVegFoliage = { value: foliage };
  const R = G * TREE_CELL * 0.5;
  const farEnd = R * 0.96, farStart = R * 0.80;
  U.uVegRange.value.set(tier.near, Math.min(18, tier.near * 0.2), farStart, farEnd);
  if (!Gn) U.uVegRange.value.set(0, 0.0001, farStart, farEnd);

  const group = new THREE.Group();
  group.name = 'vegetation';
  group.matrixAutoUpdate = false;
  const near = Gn ? createNearTrees(ctx, { L, Gn, U, neuralGLSL: nn.glsl }) : null;
  const far = createFarTrees(ctx, { L, G, U, imp, neuralGLSL: nn.glsl, blend: tier.blend });
  const grass = tier.grass ? createGrass(ctx, { L, Gg: tier.grass, uniforms, U }) : null;
  // near-field 3-D airfield turf (shells); turf=0 turns it off
  const turfTier = raw.turf === '0' || !airfield ? null : TURF_TIERS[ctx.quality.level] || null;
  const turf = turfTier ? createTurf(ctx, { L, tier: turfTier, uniforms, U, airfield }) : null;
  uniforms.uTurfShell.value.set(turf ? 1 : 0, turfTier ? turfTier.R : 0, 0, 0);
  if (turf) group.add(turf.mesh);
  // near-field grass blades (real geometry within a few metres); blades=0 turns them off
  const bladeTier = raw.blades === '0' || !airfield ? null : BLADE_TIERS[ctx.quality.level] || null;
  const blades = bladeTier ? createBlades(ctx, { L, tier: bladeTier, uniforms, U }) : null;
  if (blades) group.add(blades.mesh);
  uniforms.uTurfShell.value.z = blades ? bladeTier.R1 : 0;
  if (near) group.add(near.mesh);
  group.add(far.mesh);
  if (grass) group.add(grass.mesh);
  group.visible = false;
  // the surface shader shows shaded forest floor instead of painted crowns where 3-D trees stand
  uniforms.uTerrTree.value.set(0, farStart, farEnd, 0);

  const nearTris = near ? Gn * Gn * meshes.info.reduce((m, s) => Math.max(m, s.tris), 0) : 0;
  const stats = {
    bootMs: performance.now() - t0, parts: shared.ms, G, Gn, grassG: tier.grass, nearRadius: tier.near, farRadius: farEnd,
    impostorAtlas: `${imp.W}x${imp.H} x2 RGBA8`, textureMB: 0, drawCalls: 0, trianglesSubmitted: 0,
    species: meshes.info.map((s) => `${s.id}:${s.tris}`).join(' '), neural: neuralOn,
  };
  // debug (tools only): read an impostor atlas back as base64 RGBA, every `step`-th texel
  stats.readAtlas = (which = 0, step = 2) => {
    const rt = which ? imp.rtB : imp.rtA, buf = new Uint8Array(imp.W * imp.H * 4);
    ctx.renderer.readRenderTargetPixels(rt, 0, 0, imp.W, imp.H, buf);
    const w = Math.floor(imp.W / step), h = Math.floor(imp.H / step), out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) out[(y * w + x) * 4 + c] = buf[((y * step) * imp.W + x * step) * 4 + c];
    let s = ''; for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.subarray(i, i + 8192));
    return JSON.stringify({ w, h, b64: btoa(s) });
  };
  stats.readGrass = () => grass ? grass.read() : null;
  const vtexBytes = meshes.texture.image.data.byteLength;
  stats.textureMB = +((imp.bytes + 1024 * 1024 * 4 * 4 / 3 + vtexBytes + G * G * 8 + (tier.grass ? tier.grass ** 2 * 8 : 0) + nn.textureBytes) / 1048576).toFixed(1);
  let lastTime = -1;
  const shadowsOn = () => !!ctx.quality.shadows;
  return {
    object3D: group,
    get triangles() { return stats.trianglesSubmitted; },
    radius: R,
    stats,
    /** camWX/camWZ: camera world position; org: world origin; Hd: camera clearance above the ground. */
    update(camWX, camWZ, org, Hd, minLevel) {
      // trees fade out with clearance: impostors shrink to a few pixels by ~1.6 km
      const on = minLevel <= 4 ? 1 - Math.min(Math.max((Hd - 1250) / 350, 0), 1) : 0;
      uniforms.uTerrTree.value.x = on;
      group.visible = on > 0;
      stats.drawCalls = 0; stats.trianglesSubmitted = 0;
      // the neural LUTs follow the sun at every altitude (the surface shader's distant canopy uses them too)
      if (ctx.time && ctx.time.now !== lastTime) { lastTime = ctx.time.now; nn.update(ctx.uniforms.frame.uSunDir.value.y); }
      if (!group.visible) return;
      placement.update(camWX, camWZ, org);
      const w = ctx.weather;
      if (w) {
        const ws = w.windSpeed ?? (w.wind ? Math.hypot(w.wind.x, w.wind.z) : 3);
        let dx = w.wind?.x ?? 1, dz = w.wind?.z ?? 0;
        const l = Math.hypot(dx, dz) || 1;
        U.uVegWind.value.set(dx / l, dz / l, Math.min(ws / 12, 2.2), Math.min(1, (w.turbulence ?? 0.2) + ws / 30));
      }
      const doy = ctx.time?.dayOfYear ?? 172;
      U.uVegSeason.value.x = Math.max(0, Math.min(1, (doy - 262) / 30)) * (1 - Math.max(0, Math.min(1, (doy - 325) / 20)));
      if (near) { near.update(camWX, camWZ); near.mesh.castShadow = shadowsOn(); }
      if (grass) grass.update(camWX, camWZ, org, Hd);
      if (turf) { turf.update(camWX, camWZ, org, Hd); uniforms.uTurfShell.value.x = turf.mesh.visible ? 1 : 0; }
      if (blades) { blades.update(camWX, camWZ, org, Hd, airfield); uniforms.uTurfShell.value.z = blades.mesh.visible ? bladeTier.R1 : 0; }
      const bladesOn = blades && blades.mesh.visible;
      stats.drawCalls = (near ? (shadowsOn() ? 2 : 1) : 0) + 1 + (grass && grass.mesh.visible ? 1 : 0) + (turf && turf.mesh.visible ? 1 : 0) + (bladesOn ? 1 : 0);
      stats.trianglesSubmitted = nearTris + G * G * 2 + (grass && grass.mesh.visible ? tier.grass ** 2 * 6 : 0) + (turf && turf.mesh.visible ? turf.stats.triangles : 0) + (bladesOn ? blades.stats.triangles : 0);
      stats.turf = turf ? turf.stats : null;
      stats.blades = blades ? blades.stats : null;
    },
    dispose() {
      placement.dispose(); near?.dispose(); far.dispose(); grass?.dispose(); turf?.dispose(); blades?.dispose();
      uniforms.uTurfShell.value.x = 0;
      uniforms.uTerrTree.value.x = 0;
    },
  };
}
