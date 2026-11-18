// Terrain: the shape of the world and how the land looks.
//   createTerrain(ctx) -> { heightAt(x, z), sample(x, z, out), update(dt), object3D, heightGLSL, heightUniforms, stats, debug }
//
// Architecture (details in each file):
//   height.glsl.js   the world function, written once in scalar GLSL            (single source of truth)
//   height.gen.js    the same function transliterated to JS  -> heightAt()       (CPU: physics, cameras)
//   clipmap.js       GPU evaluates the world function into a camera-centred toroidal height pyramid
//   lod.js           CDLOD quadtree picks patches; ONE instanced draw call renders them, geomorphed, crack-free
//   material.js      MeshStandardMaterial with clipmap displacement and
//   surface.glsl.js  the procedural biome / material shader, AO and height-field self-shadowing
import * as THREE from 'three';
import { AIRPORTS } from '../data/airports.js';
import { heightAt, heightAtLod, sampleTerrain } from './height.gen.js';
import { createClipmap, SNAP, EDGE } from './clipmap.js';
import { createLodSelector } from './lod.js';
import { createTerrainMaterial, clipmapGLSL, TILE_SCALES } from './material.js';
import { createNoiseTextures } from './noisetex.js';

export { heightAt };

const P = 32;            // quads per patch side
const L = 13;            // clipmap / LOD levels: vertex spacing 1 m .. 4096 m
const S0 = 1;            // vertex spacing of level 0, metres

function configFor(ctx) {
  const q = ctx.quality, raw = ctx.params.raw || {};
  let N = q.level === 'low' ? 256 : q.level === 'medium' ? 512 : 1024;
  if (raw.terrN && [256, 512, 1024, 2048].includes(+raw.terrN)) N = +raw.terrN;
  N = Math.min(N, ctx.renderer.capabilities.maxTextureSize);
  const TPV = N >= 1024 ? 2 : 1;                               // texels per vertex spacing (normals at 2x mesh resolution)
  const kMax = Math.floor(N / (2 * TPV) - P - (SNAP + EDGE + 1) / TPV - 1);
  const k = Math.max(48, Math.min(kMax, Math.round(200 * (q.terrainDetail ?? 1))));   // LOD range in vertex spacings
  const m0 = Math.max(0.62, (1 + 1.45 * P / k) / 2 + 0.01);    // geomorph starts here (fraction of the level's range)
  const steps = raw.terrShadow !== undefined ? +raw.terrShadow : ({ low: 8, medium: 14, high: 20, ultra: 28 }[q.level] ?? 16);
  return { N, TPV, k, m0, t0: S0 / TPV, shadowSteps: steps };
}

export async function createTerrain(ctx) {
  const renderer = ctx.renderer;
  let cfg = configFor(ctx);
  let clip = createClipmap(renderer, { N: cfg.N, L, t0: cfg.t0 });
  let sel = createLodSelector({ P, s0: S0, L, k: cfg.k, maxInstances: 4096, heightAt });
  const noiseTex = createNoiseTextures(ctx.quality.anisotropy ?? 4);

  // ---- uniforms (shared by reference with the public height hook) ------------------------------------------
  const F = ctx.uniforms.frame;
  const uniforms = {
    tTerrH: { value: clip.textureH }, tTerrD: { value: clip.textureD },
    tTerrNoise: { value: noiseTex.noise }, tTerrNorm: { value: noiseTex.norm },
    uTerrLvl: { value: Array.from({ length: L }, () => new THREE.Vector3()) },
    uTerrCam: { value: new THREE.Vector4(0, 1000, 0, 1000) },
    uTerrLod: { value: new THREE.Vector4(cfg.k * S0, L - 1, L - 1, cfg.m0) },
    uTerrTile: { value: TILE_SCALES.map(() => new THREE.Vector2()) },
    uTerrAp: { value: AIRPORTS.slice(0, 5).map(() => new THREE.Vector4()) },
    uTerrShadowOn: { value: 1 },
    uTerrWin: { value: 1 }, uTerrOrg: { value: new THREE.Vector3() }, uTerrCurv: { value: 1 },
    uOrigin: F.uOrigin, uSunDir: F.uSunDir,
  };

  // ---- geometry: one (P+1)^2 grid patch, instanced ---------------------------------------------------------
  const geo = new THREE.InstancedBufferGeometry();
  {
    const n = P + 1, pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), idx = new Uint16Array(P * P * 6);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; pos[k] = i; pos[k + 1] = j; nor[k + 1] = 1; }
    let o = 0;
    for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
      const a = j * n + i, b = a + n, c = a + 1, d = b + 1;       // a=(i,j) b=(i,j+1) c=(i+1,j) d=(i+1,j+1): CCW seen from above
      idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = c; idx[o++] = b; idx[o++] = d;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  let attrA, attrB;
  function bindInstances() {
    attrA = new THREE.InstancedBufferAttribute(sel.iA, 4); attrA.setUsage(THREE.DynamicDrawUsage);
    attrB = new THREE.InstancedBufferAttribute(sel.iB, 4); attrB.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iA', attrA); geo.setAttribute('iB', attrB);
  }
  bindInstances();
  geo.instanceCount = 0;

  let material = createTerrainMaterial(ctx, { L, shadowSteps: cfg.shadowSteps, uniforms });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'terrain'; mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);

  ctx.world.setTerrainHeightFn(heightAt);

  const stats = { patches: 0, triangles: 0, minLevel: L - 1, texelsThisFrame: 0, clearance: 0, drawCalls: 1 };
  const vp = new THREE.Matrix4();
  let frameNo = 0;
  const RING = [[1, 0], [0.707, 0.707], [0, 1], [-0.707, 0.707], [-1, 0], [-0.707, -0.707], [0, -1], [0.707, -0.707]];

  function rebuild() {
    cfg = configFor(ctx);
    clip.dispose();
    clip = createClipmap(renderer, { N: cfg.N, L, t0: cfg.t0 });
    sel = createLodSelector({ P, s0: S0, L, k: cfg.k, maxInstances: 4096, heightAt });
    bindInstances();
    uniforms.tTerrH.value = clip.textureH; uniforms.tTerrD.value = clip.textureD;
    material.dispose();
    material = createTerrainMaterial(ctx, { L, shadowSteps: cfg.shadowSteps, uniforms });
    mesh.material = material;
    noiseTex.noise.anisotropy = noiseTex.norm.anisotropy = ctx.quality.anisotropy ?? 4;
    noiseTex.noise.needsUpdate = noiseTex.norm.needsUpdate = true;
    frameNo = 0;
  }
  ctx.events.on('quality:change', rebuild);
  renderer.domElement?.addEventListener?.('webglcontextrestored', () => clip.invalidate());

  // Debug URL params (screenshots / tooling only):
  //   terrCam=dx,dy,dz,pitch,yaw   camera at player + offset (m), looking pitch/yaw degrees (yaw = true heading)
  //   terrCurv=0                   no earth-curvature drop     terrN=256|512|1024, terrShadow=<steps>
  const raw = ctx.params.raw || {};
  const dbgCam = raw.terrCam ? raw.terrCam.split(',').map(Number) : null;
  if (raw.terrCurv !== undefined) uniforms.uTerrCurv.value = +raw.terrCurv;

  function update() {
    const cam = ctx.camera, org = ctx.world.origin;
    if (dbgCam && ctx.player) {
      const p = ctx.player.state.position;
      cam.position.set(p.x - org.x + dbgCam[0], p.y + dbgCam[1], p.z - org.z + dbgCam[2]);
      cam.rotation.set((dbgCam[3] || 0) * Math.PI / 180, -(dbgCam[4] || 0) * Math.PI / 180, 0, 'YXZ');
      cam.updateMatrixWorld(true);
      F.uCameraPos.value.copy(cam.position); F.uCameraWorld.value.copy(cam.matrixWorld); F.uViewMatrix.value.copy(cam.matrixWorldInverse);
    }
    const wx = cam.position.x + org.x, wz = cam.position.z + org.z, cy = cam.position.y;
    // LOD clearance: (approximate) distance from the camera to the nearest ground or sea surface
    const g0 = Math.max(heightAt(wx, wz), 0);
    const H0 = Math.max(cy - g0, 1);
    let Hd = H0;
    for (let ring = 0; ring < 2; ring++) {
      const r = H0 * (ring ? 1.1 : 0.5);
      for (let i = 0; i < 8; i++) {
        const dy = cy - Math.max(heightAt(wx + RING[i][0] * r, wz + RING[i][1] * r), 0);
        const dd = dy > 0 ? Math.sqrt(r * r + dy * dy) : r;
        if (dd < Hd) Hd = dd;
      }
    }
    Hd = Math.max(Hd, 1);
    stats.clearance = Hd;
    const r0 = cfg.k * S0;
    const wantMin = Math.min(L - 1, Math.max(0, Math.ceil(Math.log2((Hd * 0.97) / r0))));

    // refresh the height pyramid, coarse to fine; whole-level refills are rationed per frame (never in test mode)
    let fills = ctx.params.test ? 99 : frameNo === 0 ? 5 : 2;
    let validMin = L, tex = 0;
    for (let l = L - 1; l >= wantMin; l--) {
      const r = clip.update(l, wx, wz, fills > 0);
      if (r < 0) break;
      if (r >= cfg.N * cfg.N) fills--;
      tex += r; validMin = l;
    }
    frameNo++;
    stats.texelsThisFrame = tex;
    const minLevel = Math.min(L - 1, Math.max(validMin, wantMin));
    stats.minLevel = minLevel;

    vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const count = sel.update(cam.position, org, Hd, vp.elements, minLevel);
    geo.instanceCount = count;
    attrA.needsUpdate = true; attrB.needsUpdate = true;
    stats.patches = count; stats.triangles = sel.triangles;

    // uniforms
    uniforms.uTerrCam.value.set(cam.position.x, cy, cam.position.z, Hd);
    uniforms.uTerrLod.value.set(r0, minLevel, L - 1, cfg.m0);
    const N = cfg.N;
    for (let l = 0; l < L; l++) {
      const span = N * clip.levels[l].t;
      const fx = org.x / span, fz = org.z / span;
      uniforms.uTerrLvl.value[l].set(fx - Math.floor(fx) + 0.5 / N, fz - Math.floor(fz) + 0.5 / N, 1 / span);
    }
    for (let i = 0; i < TILE_SCALES.length; i++) {
      const s = TILE_SCALES[i], c = Math.cos(s.angle), sn = Math.sin(s.angle);
      const u = (c * org.x - sn * org.z) / s.period, v = (sn * org.x + c * org.z) / s.period;
      uniforms.uTerrTile.value[i].set(u - Math.floor(u), v - Math.floor(v));
    }
    for (let i = 0; i < uniforms.uTerrAp.value.length; i++) {
      const a = AIRPORTS[i];
      uniforms.uTerrAp.value[i].set(a.position.x - org.x, a.position.z - org.z, a.flattenRadius, i);
    }
    uniforms.uTerrWin.value = (N / 2 - SNAP - EDGE - 1) * cfg.t0;
    uniforms.uTerrOrg.value.copy(org);
  }

  // ---- public GLSL hook for other shaders (ocean depth, shoreline foam) -------------------------------------
  // Samples the same height pyramid the terrain is drawn from: metre-accurate near the camera, coarser with distance.
  const heightGLSL = /* glsl */`
${clipmapGLSL(L)}
uniform float uTerrWin;          // trusted half-extent of the level-0 window, metres
uniform vec3 uTerrOrg;           // world position of the render origin
float terrainHeight(vec2 worldXZ) {
  vec2 rxz = worldXZ - uTerrOrg.xz;
  vec2 q = abs(rxz - uTerrCam.xz);
  float dc = max(q.x, q.y);
  float lvl = clamp(ceil(log2(max(dc, 1.0) / uTerrWin)), uTerrLod.y, uTerrLod.z);
  vec4 a = terrTexH(rxz, lvl);
  float h = a.x + a.y;
  float kb = smoothstep(0.8, 1.0, dc / (uTerrWin * exp2(lvl)));
  if (kb > 0.0 && lvl < uTerrLod.z) { vec4 b = terrTexH(rxz, lvl + 1.0); h = mix(h, b.x + b.y, kb); }
  return dc > uTerrWin * exp2(uTerrLod.z) ? -2000.0 : h;
}`;
  const heightUniforms = {
    tTerrH: uniforms.tTerrH, uTerrLvl: uniforms.uTerrLvl, uTerrCam: uniforms.uTerrCam, uTerrLod: uniforms.uTerrLod,
    uTerrWin: uniforms.uTerrWin, uTerrOrg: uniforms.uTerrOrg,
  };

  // ---- debug helpers (tests / tooling) ------------------------------------------------------------------------
  const debug = {
    get config() { return { ...cfg, P, L, S0 }; },
    /** Compare the GPU-generated heights of one clipmap level with the CPU function. Returns max/mean abs error (m). */
    parity(level = 0, step = 7) {
      const N = cfg.N, lv = clip.levels[level];
      if (!lv.valid) return null;
      const buf = new Uint16Array(N * N * 4);
      const prev = renderer.getRenderTarget();
      clip.rtH.viewport.set(0, 0, N, N); clip.rtH.scissor.set(0, 0, N, N);
      renderer.setRenderTarget(clip.rtH, level);
      renderer.readRenderTargetPixels(clip.rtH, 0, 0, N, N, buf);
      renderer.setRenderTarget(prev);
      let max = 0, sum = 0, n = 0, at = null;
      const half = N >> 1, mod = (a) => ((a % N) + N) % N;
      for (let j = lv.cz - half + EDGE; j < lv.cz + half - EDGE; j += step) for (let i = lv.cx - half + EDGE; i < lv.cx + half - EDGE; i += step) {
        const k = (mod(j) * N + mod(i)) * 4;
        const g = THREE.DataUtils.fromHalfFloat(buf[k]) + THREE.DataUtils.fromHalfFloat(buf[k + 1]);
        const x = i * lv.t, z = j * lv.t;
        const c = heightAtLod(x, z, lv.t);
        const e = Math.abs(g - c); sum += e; n++;
        if (e > max) { max = e; at = [x, z, g, c]; }
      }
      return { level, spacing: lv.t, samples: n, max, mean: sum / Math.max(n, 1), at };
    },
  };

  return {
    object3D: mesh, heightAt, sample: sampleTerrain, update, heightGLSL, heightUniforms, stats, debug,
  };
}
