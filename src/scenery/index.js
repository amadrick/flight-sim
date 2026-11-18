// Airports and their scenery: runways, taxiways, aprons, markings, buildings, furniture and the aeronautical ground
// lighting system. API: createScenery(ctx) -> { update(dt), airports, surfaceAt, stats(), dispose() }
//   airports[i] = { id, name, kind, data, layout, root (anchored Group), towerPosition (world Vector3),
//                   towerHeading (deg), parking: [{ position (world Vector3, nose-wheel stop mark), heading (deg), size, number }] }
// Registers a surface provider with ctx.world (runway / taxiway / apron, height = airport elevation).
import * as THREE from 'three';
import { AIRPORTS } from '../data/airports.js';
import { CURVATURE_GLSL } from '../core/glsl.js';
import { buildLayout } from './layout.js';
import { buildMarkings } from './markings.js';
import { buildLightPlan } from './lightplan.js';
import { createSurfaceProvider } from './surface.js';
import { makePavementNoise, makeGlyphAtlas, makeFacades, makeSignAtlas, makeFenceTexture } from './textures.js';
import { createPaveShared, makePavementMaterial, buildPavementGeometry, buildPaintGeometry, makePaintMaterial } from './pavement.js';
import { createLightSystem } from './lights.js';
import { MultiBuilder, lin } from './builder.js';
import { buildStructures } from './structures.js';
import { setupDebugCamera } from './debugcam.js';
import { makeAirliner, makeFighter, makeLightPlane, makeVehicles, instances } from './parked.js';

const DEG = Math.PI / 180;
const RANGE = { pavement: 70000, buildings: 26000, props: 9000, lights: 110000 };

/** Inject the earth-curvature drop into a built-in material (keeps far scenery seated on the curved terrain). */
export function addCurvature(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    if (sh.vertexShader.includes('curvatureDrop(')) return;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${CURVATURE_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec4 wpC = modelMatrix * vec4(transformed, 1.0); transformed.y -= curvatureDrop(distance(wpC.xz, cameraPosition.xz)); }`);
  };
  return mat;
}

const MAX_OBJ_POOLS = 24;
const objPools = {
  uObjPools: { value: Array.from({ length: MAX_OBJ_POOLS }, () => new THREE.Vector4()) },
  uObjPoolCount: { value: 0 }, uObjNight: { value: 0 },
};
/** Floodlight pools on objects (aircraft, vehicles, buildings): nearest airport's apron lights, in render space. */
export function addPools(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, objPools);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vScnW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 sw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          sw = instanceMatrix * sw;
          #endif
          vScnW = (modelMatrix * sw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vScnW; uniform vec4 uObjPools[${MAX_OBJ_POOLS}]; uniform int uObjPoolCount; uniform float uObjNight;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uObjNight > 0.001) {
          vec3 nW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float e = 0.0;
          for (int i = 0; i < ${MAX_OBJ_POOLS}; i++) {
            if (i >= uObjPoolCount) break;
            vec3 Lv = uObjPools[i].xyz - vScnW; float r2 = dot(Lv, Lv);
            e += uObjPools[i].w * max(dot(nW, Lv * inversesqrt(r2)), 0.0) / r2;
          }
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.9, 0.78) * e * uObjNight;
        }`);
  };
  return mat;
}

export async function createScenery(ctx) {
  const t0 = performance.now();
  const noise = makePavementNoise(ctx);
  const atlas = makeGlyphAtlas(ctx);
  const facades = makeFacades(ctx);
  const fenceTex = makeFenceTexture(ctx);
  const shared = createPaveShared(ctx, noise, atlas);
  const lights = createLightSystem(ctx);

  // ---- layouts first (pure), so the sign atlas can collect every text it needs
  const heightAt = (ap) => (x, z) => ctx.world.terrainHeightAt(ap.position.x + x, ap.position.z + z) - ap.elevation;
  const layouts = AIRPORTS.map((ap) => buildLayout(ap));
  const markings = layouts.map((L) => buildMarkings(L));
  const plans = AIRPORTS.map((ap, i) => buildLightPlan(layouts[i], heightAt(ap)));
  const signTexts = new Set();
  for (const L of layouts) {
    for (const p of L.props) if (p.type === 'drsign') { signTexts.add('dr:' + p.a); signTexts.add('dr:' + p.b); }
    for (const R of L.runways) signTexts.add('hold:' + R.ends.map((e) => e.digits + e.letter).join('-'));
  }
  const signs = makeSignAtlas(ctx, [...signTexts]);

  // ---- shared materials
  const std = (o) => addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, ...o })));
  const M = {
    glass: std({ map: facades.glass.map, emissiveMap: facades.glass.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.15, metalness: 0.15 }),
    office: std({ map: facades.office.map, emissiveMap: facades.office.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8 }),
    garage: std({ map: facades.garage.map, emissiveMap: facades.garage.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.9 }),
    cab: std({ map: facades.cab.map, emissiveMap: facades.cab.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.08, metalness: 0.5 }),
    metal: std({ map: facades.metal.map, bumpMap: facades.metal.map, bumpScale: 1.5, roughness: 0.5, metalness: 0.35 }),
    door: std({ map: facades.door.map, roughness: 0.55, metalness: 0.25 }),
    concrete: std({ map: facades.concrete.map, roughness: 0.92 }),
    roof: std({ map: facades.roof.map, roughness: 0.95 }),
    plain: std({ roughness: 0.6 }),
    sign: std({ map: signs.tex, emissiveMap: signs.tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.5 }),
    fence: std({ map: fenceTex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }),
    leaf: std({ side: THREE.DoubleSide, roughness: 0.8 }),
  };
  const tiles = Object.fromEntries(Object.entries(facades).map(([k, v]) => [k, v.tile]));
  const emissiveMats = [M.glass, M.office, M.garage, M.cab, M.sign];
  const carMat = addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.6 })));
  const carGeo = makeCarGeometry();
  const sockGeo = makeWindsockGeometry();
  const sockMat = addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));

  const parkedMat = addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 })));
  const vehMat = addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 })));
  const GEO = { airliner: makeAirliner(), fighter: makeFighter(), light: makeLightPlane(), veh: makeVehicles() };
  const LIVERY = [0x0b3d91, 0xc8102e, 0x00843d, 0xf2a900, 0x5b2c83, 0x0093b2, 0x1d1d1b, 0xe35205, 0x7a1f2b, 0x2e6db4];

  const airports = [];
  let stats = { drawables: 0, triangles: 0, lights: 0, instances: 0 };
  AIRPORTS.forEach((ap, i) => {
    const L = layouts[i];
    const root = new THREE.Group(); root.name = 'airport-' + ap.id;
    ctx.world.anchor(root, new THREE.Vector3(ap.position.x, ap.elevation, ap.position.z));
    ctx.scene.add(root);
    const far = new THREE.Group(), mid = new THREE.Group(), near = new THREE.Group();
    root.add(far, mid, near);
    // pools: apron floodlights + street lights (airport-local)
    const pools = [...L.floods.map((f) => ({ x: f.x, z: f.z, h: f.h, I: 0.5 * f.h * f.h })), ...L.streetLights.map((s) => ({ x: s.x, z: s.z, h: s.h, I: 0.28 * s.h * s.h }))];
    const paveMat = makePavementMaterial(ctx, shared, pools);
    const pave = new THREE.Mesh(buildPavementGeometry(L), paveMat);
    pave.receiveShadow = true; far.add(pave);
    const paint = new THREE.Mesh(buildPaintGeometry(L, markings[i]), makePaintMaterial(ctx, shared, paveMat.userData.pools));
    paint.receiveShadow = true; paint.renderOrder = 1; far.add(paint);
    // structures
    const B = new MultiBuilder(tiles);
    buildStructures(L, B, signs.index, plans[i].poles);
    const geos = B.build();
    const nearKeys = new Set(['fence', 'sign', 'leaf']);
    for (const [k, g] of Object.entries(geos)) {
      const m = new THREE.Mesh(g, M[k] || M.plain);
      m.castShadow = k !== 'fence'; m.receiveShadow = true;
      (nearKeys.has(k) ? near : mid).add(m);
    }
    // cars in the car parks
    const bays = L.parkingLots.flatMap((p) => p.bays || []);
    const rnd = mulberry(ap.id.charCodeAt(1) * 97 + ap.id.charCodeAt(2));
    const carList = bays.filter(() => rnd() < 0.72);
    if (carList.length) {
      const cars = new THREE.InstancedMesh(carGeo, carMat, carList.length);
      const palette = [0xf2f2f2, 0x1a1a1a, 0x8a8f95, 0x2f4f7f, 0x8b1e1e, 0xc0c4c8, 0x3c3c3c, 0x5d6b3a, 0xd8d0b8, 0x234a6e];
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      carList.forEach((b, k) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (90 - b.hdg) * DEG + (rnd() - 0.5) * 0.08);
        m4.compose(new THREE.Vector3(b.x, 0.02, b.z), q, new THREE.Vector3(1, 1, 0.9 + rnd() * 0.25));
        cars.setMatrixAt(k, m4);
        cars.setColorAt(k, col.set(palette[Math.floor(rnd() * palette.length)]));
      });
      cars.castShadow = true; cars.receiveShadow = true;
      cars.computeBoundingSphere();
      near.add(cars);
    }
    // parked aircraft on ~70 % of the stands, ground vehicles around the occupied gates
    {
      const occ = L.stands.filter(() => rnd() < 0.7);
      const lists = { airB: [], airA: [], ftr: [], gaB: [], gaA: [], tug: [], belt: [], fuel: [], cart: [] };
      for (const st of occ) {
        const h = st.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
        if (st.size === 'heavy' || st.size === 'medium') {
          const sc = st.size === 'heavy' ? 1.55 : 1;
          const liv = LIVERY[Math.floor(rnd() * LIVERY.length)];
          lists.airB.push({ x: st.x, z: st.z, hdg: st.hdg, scale: sc, color: rnd() < 0.85 ? 0xf4f4f2 : 0xd0d4d8 });
          lists.airA.push({ x: st.x, z: st.z, hdg: st.hdg, scale: sc, color: liv });
          if (st.bridge || rnd() < 0.5) {
            const at = (fwd, right) => ({ x: st.x + dx * fwd * sc + rx * right * sc, z: st.z + dz * fwd * sc + rz * right * sc });
            if (rnd() < 0.6) lists.tug.push({ ...at(5.5, 0), hdg: st.hdg + 180, color: 0xe8e8e0 });
            if (rnd() < 0.8) lists.belt.push({ ...at(-7, 3.4), hdg: st.hdg - 20, color: 0xf0c020 });
            if (rnd() < 0.5) lists.fuel.push({ ...at(-15, 9.5), hdg: st.hdg + 90, color: 0xdddddd });
            if (rnd() < 0.7) for (let k = 0; k < 3; k++) lists.cart.push({ ...at(-12 - k * 3.6, 7 + k * 0.2), hdg: st.hdg + 180, color: 0x6a7a8a });
          }
        } else if (st.size === 'fighter') lists.ftr.push({ x: st.x, z: st.z, hdg: st.hdg, color: ap.kind === 'military' ? 0x9aa1a8 : 0xb0b0b0 });
        else if (st.size === 'light') {
          lists.gaB.push({ x: st.x, z: st.z, hdg: st.hdg, color: 0xf2f2f2 });
          lists.gaA.push({ x: st.x, z: st.z, hdg: st.hdg, color: LIVERY[Math.floor(rnd() * LIVERY.length)] });
        }
      }
      const add = (geo, list, mat, grp) => { if (geo && list.length) grp.add(instances(geo, mat, list)); };
      add(GEO.airliner.b, lists.airB, parkedMat, mid); add(GEO.airliner.a, lists.airA, parkedMat, mid);
      add(GEO.fighter.b, lists.ftr, parkedMat, mid);
      add(GEO.light.b, lists.gaB, parkedMat, near); add(GEO.light.a, lists.gaA, parkedMat, near);
      for (const k of ['tug', 'belt', 'fuel', 'cart']) add(GEO.veh[k], lists[k], vehMat, near);
    }
    // windsocks (animated)
    const socks = [];
    for (const p of L.props) if (p.type === 'windsock') {
      const s = new THREE.Mesh(sockGeo, sockMat);
      s.position.set(p.x, 5.75, p.z); s.rotation.order = 'YZX'; s.castShadow = true;
      near.add(s); socks.push(s);
    }
    // lights
    const lightMesh = lights.build(plans[i]);
    root.add(lightMesh);

    const F = L.frame;
    const towerPosition = L.tower ? new THREE.Vector3(ap.position.x + L.tower.x, ap.elevation + L.tower.h + 1.7, ap.position.z + L.tower.z) : null;
    const parking = L.stands.map((s) => ({
      position: new THREE.Vector3(ap.position.x + s.x, ap.elevation, ap.position.z + s.z),
      heading: s.hdg, size: s.size, number: s.number ?? null,
    }));
    airports.push({
      id: ap.id, name: ap.name, kind: ap.kind, data: ap, layout: L, root, far, mid, near, lightMesh, socks,
      towerPosition, towerHeading: F.H, parking, plan: plans[i], paveMat, pools,
    });
    stats.lights += plans[i].count;
  });

  // ---- physics surface
  const surfaceAt = createSurfaceProvider(AIRPORTS, layouts, () => Math.min(1, (ctx.weather.precipitation || 0) * 1.6));
  ctx.world.addSurfaceProvider(surfaceAt);

  const debugCam = setupDebugCamera(ctx, airports);
  const camW = new THREE.Vector3();
  let sockPhase = 0;

  function update(dt) {
    debugCam?.update();
    lights.update();
    const night = ctx.env.nightFactor ?? 0;
    const on = lights.uniforms.uOn.value;
    shared.uNight.value = on;
    shared.uWet.value = Math.min(1, (ctx.weather.precipitation || 0) * 1.4);
    const res = ctx.uniforms.frame.uResolution.value;
    shared.uPixAngle.value = (2 * Math.tan((ctx.camera.fov * DEG) / 2)) / Math.max(1, res.y);
    const winK = THREE.MathUtils.smoothstep(night, 0.1, 0.8);
    M.glass.emissiveIntensity = 0.55 * winK; M.office.emissiveIntensity = 0.9 * winK;
    M.garage.emissiveIntensity = 0.7 * winK; M.cab.emissiveIntensity = 0.8 * winK; M.sign.emissiveIntensity = 1.5 * Math.max(winK, on * 0.6);
    ctx.world.toWorld(ctx.camera.position, camW);
    const w = ctx.weather.wind, ws = Math.hypot(w.x, w.z);
    const kt = ws / 0.514444;
    sockPhase += dt;
    const hideAll = ctx.params.raw?.snoscn === '1';
    {
      const A = airports.reduce((b, a) => (Math.hypot(camW.x - a.data.position.x, camW.z - a.data.position.z) < Math.hypot(camW.x - b.data.position.x, camW.z - b.data.position.z) ? a : b));
      const o = ctx.world.origin, P = A.data.position, n = Math.min(MAX_OBJ_POOLS, A.pools.length);
      for (let k = 0; k < n; k++) { const p = A.pools[k]; objPools.uObjPools.value[k].set(P.x + p.x - o.x, A.data.elevation + p.h, P.z + p.z - o.z, p.I); }
      objPools.uObjPoolCount.value = n;
      objPools.uObjNight.value = on;
    }
    for (const A of airports) {
      A.root.visible = !hideAll;
      const dx = camW.x - A.data.position.x, dz = camW.z - A.data.position.z;
      const dist = Math.hypot(dx, dz);
      A.far.visible = dist < RANGE.pavement;
      A.mid.visible = dist < RANGE.buildings;
      A.near.visible = dist < RANGE.props;
      A.lightMesh.visible = dist < RANGE.lights;
      if (A.near.visible) {
        const yaw = Math.atan2(-w.z, w.x);
        const droop = (1 - Math.min(1, kt / 15)) * 72 * DEG;
        A.socks.forEach((s, k) => {
          const fl = Math.sin(sockPhase * (6 + k) + k) * (0.02 + 0.04 * Math.min(1, kt / 10));
          s.rotation.set(0, ws > 0.2 ? yaw + fl : 0.3 * k, -droop + fl * 0.5);
        });
      }
    }
  }

  stats = computeStats(airports, stats);
  const info = { bootMs: performance.now() - t0, ...stats };
  if (ctx.params.raw?.sdebug) console.info('scenery', JSON.stringify(info));

  return {
    update, airports, surfaceAt, lights,
    /** Nearest airport to a world position. */
    nearest(x, z) { let best = null, bd = Infinity; for (const A of airports) { const d = Math.hypot(x - A.data.position.x, z - A.data.position.z); if (d < bd) { bd = d; best = A; } } return best; },
    stats() { return info; },
    dispose() { for (const A of airports) { ctx.world.unanchor(A.root); ctx.scene.remove(A.root); } },
  };
}

function computeStats(airports, base) {
  let draws = 0, tris = 0, inst = 0;
  for (const A of airports) {
    A.root.traverse((o) => {
      if (!o.isMesh) return;
      draws++;
      const g = o.geometry;
      const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      if (o.isInstancedMesh) { tris += n * o.count; inst += o.count; }
      else if (g.isInstancedBufferGeometry) { tris += n * g.instanceCount; inst += g.instanceCount; }
      else tris += n;
    });
  }
  return { ...base, drawables: draws, drawablesPerAirport: +(draws / airports.length).toFixed(1), triangles: Math.round(tris), instances: inst };
}

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function makeCarGeometry() {
  // car body + cabin, length along local +Z... built along X then rotated: length 4.5 m along X axis
  const B = new MultiBuilder();
  const white = [1, 1, 1], glass = [0.08, 0.09, 0.1], dark = [0.05, 0.05, 0.05];
  B.box('b', 0, 0.28, 0, 90, 4.4, 1.8, 0.62, white);
  B.box('b', -0.2, 0.9, 0, 90, 2.3, 1.62, 0.55, glass);
  B.box('b', -0.2, 1.44, 0, 90, 2.1, 1.5, 0.03, white);
  for (const sx of [-1.4, 1.4]) for (const sz of [-0.82, 0.82]) B.box('b', sx, 0, sz, 90, 0.62, 0.22, 0.6, dark);
  const g = B.build().b;
  return g;
}

function makeWindsockGeometry() {
  // truncated cone along +X, 3.6 m, orange/white bands (5), plus a ring frame at the mouth
  const seg = 12, bands = 5, len = 3.6, r0 = 0.45, r1 = 0.2;
  const pos = [], col = [], nrm = [], idx = [];
  const orange = lin(0xff5a10), white = lin(0xf2f2f2);
  for (let b = 0; b <= bands * 2; b++) {
    const t = b / (bands * 2), x = t * len, r = r0 + (r1 - r0) * t;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      pos.push(x, Math.cos(a) * r, Math.sin(a) * r);
      nrm.push(0.07, Math.cos(a), Math.sin(a));
      const band = Math.min(bands - 1, Math.floor(t * bands - 1e-6));
      const c = band % 2 === 0 ? orange : white;
      col.push(...c);
    }
  }
  for (let b = 0; b < bands * 2; b++) for (let s = 0; s < seg; s++) {
    const a = b * (seg + 1) + s, c = a + seg + 1;
    idx.push(a, c, a + 1, a + 1, c, c + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
