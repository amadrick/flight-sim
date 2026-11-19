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
import { createPaveShared, makePavementMaterial, buildPavementGeometry, buildPaintGeometry, makePaintMaterial, buildFringeGeometry, makeFringeMaterial } from './pavement.js';
import { createLightSystem } from './lights.js';
import { makeCurtainMaterial } from './curtain.js';
import { MultiBuilder, lin } from './builder.js';
import { buildStructures } from './structures.js';
import { setupDebugCamera } from './debugcam.js';
import { makeAirliner, makeWidebody, makeTanker, makeTurboprop, makeFighter, makeLightPlane, makeVehicles, instances, aircraftInstances, makeParkedMaterial } from './parked.js';

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
  const fringeMat = makeFringeMaterial(ctx, shared);

  // ---- layouts first (pure), so the sign atlas can collect every text it needs
  const heightAt = (ap) => (x, z) => ctx.world.terrainHeightAt(ap.position.x + x, ap.position.z + z) - ap.elevation;
  const layouts = AIRPORTS.map((ap) => buildLayout(ap));
  const markings = layouts.map((L) => buildMarkings(L));
  const plans = AIRPORTS.map((ap, i) => buildLightPlan(layouts[i], heightAt(ap)));
  const signTexts = new Set();
  for (const L of layouts) {
    for (const p of L.props) if (p.type === 'drsign') { signTexts.add('dr:' + p.a); signTexts.add('dr:' + p.b); }
    for (const R of L.runways) signTexts.add('hold:' + R.ends.map((e) => e.digits + e.letter).join('-'));
    for (const h of L.holds) signTexts.add('loc:' + h.twyName);
    for (const g of L.dirSigns) { signTexts.add('dir:' + g.txt + ':' + g.arrow); signTexts.add('loc:' + g.loc); }
  }
  const signs = makeSignAtlas(ctx, [...signTexts]);

  // ---- shared materials
  const std = (o) => addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, ...o })));
  const M = {
    glass: addPools(addCurvature(makeCurtainMaterial(facades.glass.map))),
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
  const emissiveMats = [M.office, M.garage, M.cab, M.sign];
  const carMat = addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.6 })));
  const carGeo = makeCarGeometry();
  const sockGeo = makeWindsockGeometry();
  const sockMat = addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));

  const parkedMat = addPools(addCurvature(makeParkedMaterial({ roughness: 0.42, metalness: 0.1 })));
  const vehMat = addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 })));
  const GEO = { narrow: makeAirliner(), wide: makeWidebody(), tanker: makeTanker(), prop: makeTurboprop(), fighter: makeFighter(), light: makeLightPlane(), veh: makeVehicles() };
  // fictional airlines: [tail / engines, belly / cheatline]
  const LIVERY = [[0x0b3d91, 0x9aa4b0], [0xc8102e, 0x2a2d34], [0x00843d, 0xc9ccd0], [0xf2a900, 0x1f3a68], [0x5b2c83, 0xb9bdc1], [0x0093b2, 0x0b3d5c],
    [0x1d1d1b, 0xc8102e], [0xe35205, 0xd8dadc], [0x7a1f2b, 0xc2b59b], [0x2e6db4, 0xe8e8e8], [0x0f6b5c, 0x0f6b5c], [0xd0d3d6, 0x1a4d8f]];

  const treeMat = addPools(addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
  const treeGeo = {
    broad: (() => { const B = new MultiBuilder(); B.cylinder('b', 0, 0, 0, 0.18, 2.6, 6, lin(0x5a4a3a)); B.dome('b', 0, 2.2, 0, 2.6, lin(0x3d5a2a), -0.6, 8, 3); B.dome('b', 0.6, 3.6, 0.3, 1.8, lin(0x46642f), -0.5, 7, 2); return B.build().b; })(),
    conifer: (() => { const B = new MultiBuilder(); B.cylinder('b', 0, 0, 0, 0.2, 1.6, 6, lin(0x4a3a2c)); for (let k = 0; k < 3; k++) B.cylinder('b', 0, 1.2 + k * 2.6, 0, 2.4 - k * 0.6, 3.6, 8, lin(0x24402a), null, 0.05); return B.build().b; })(),
  };
  const fixtureGeo = (() => { const B = new MultiBuilder(); B.cylinder('b', 0, 0, 0, 0.035, 0.28, 6, lin(0x9a9a40)); B.cylinder('b', 0, 0.28, 0, 0.07, 0.09, 8, [1, 1, 1], 'b', 0.05); return B.build().b; })();
  const fixtureMat = addCurvature(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.1 }));

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
    const fringe = new THREE.Mesh(buildFringeGeometry(L), fringeMat);
    fringe.receiveShadow = true; fringe.renderOrder = -1; fringe.userData.scnLowOff = true; mid.add(fringe);
    const paint = new THREE.Mesh(buildPaintGeometry(L, markings[i]), makePaintMaterial(ctx, shared, paveMat.userData.pools));
    paint.receiveShadow = true; paint.renderOrder = 1; far.add(paint);
    if (ctx.params.raw?.shide?.includes('paint')) paint.visible = false;
    if (ctx.params.raw?.shide?.includes('mid')) mid.visible = false;
    // stand occupancy (decided before the structures so empty gates get their jet bridge retracted)
    {
      const orng = mulberry(ap.id.charCodeAt(0) * 131 + ap.id.charCodeAt(3) * 7 + 17);
      for (const st of L.stands) st.occupied = orng() < (st.bridge ? 0.88 : st.size === 'light' ? 0.65 : ap.kind === 'regional' || ap.kind === 'island' ? 0.85 : 0.72);
    }
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
    // parked aircraft on the occupied stands (types by airport role), ground support equipment around airline gates
    {
      const occ = L.stands.filter((st) => st.occupied);
      const lists = { narrow: [], wide: [], tanker: [], prop: [], fighter: [], light: [] };
      const veh = { tug: [], belt: [], fuel: [], cart: [], stairs: [], bus: [], catering: [], gpu: [], follow: [], arff: [], cone: [], chock: [] };
      const vcol = { tug: 0xe9e6dc, belt: 0xf0c020, fuel: 0xdcdcd6, cart: 0x6a7a8a, stairs: 0xe9e6dc, bus: 0xe6e8ea, catering: 0xe8e8e2, gpu: 0xf0c020, follow: 0xf0c020, arff: 0xd8d4c8, cone: 0xffffff, chock: 0xffffff };
      const mil = ap.kind === 'military';
      if (mil) { vcol.tug = vcol.belt = vcol.gpu = 0x9a9a7a; vcol.fuel = 0x8a8f7a; vcol.follow = 0x8a8f7a; vcol.arff = 0xd8d0b0; }
      const vadd = (k, p, hdg) => veh[k].push({ x: p.x, z: p.z, hdg, color: vcol[k] });
      for (const st of occ) {
        const h = st.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
        const at = (fwd, right) => ({ x: st.x + dx * fwd + rx * right, z: st.z + dz * fwd + rz * right });
        if (st.size === 'heavy' || st.size === 'medium') {
          let type = st.size === 'heavy' ? 'wide' : 'narrow';
          if (mil) type = 'tanker';
          else if (ap.kind === 'regional') type = 'prop';
          else if (ap.kind === 'island') type = rnd() < 0.5 ? 'prop' : 'narrow';
          const liv = st.cargo ? [[0x5a3417, 0x5a3417], [0xf2a900, 0x3a3a3a], [0x1d1d1b, 0xd9dcdf]][Math.floor(rnd() * 3)] : LIVERY[Math.floor(rnd() * LIVERY.length)];
          const sc = type === 'narrow' ? (rnd() < 0.3 ? 0.88 : 1) : 1;
          lists[type].push({ x: st.x, z: st.z, hdg: st.hdg, scale: sc, color: mil ? 0xffffff : liv[0], color2: mil ? 0x7d858c : liv[1] });
          const k = type === 'wide' ? 1.7 : type === 'prop' ? 0.72 : sc;
          // chocks at the nose gear, cones at the wingtips and engines (safety zone)
          vadd('chock', at(0, 0), st.hdg + 90);
          const span = type === 'wide' ? 31 : type === 'prop' ? 13.6 : type === 'tanker' ? 20 : 17.5 * sc;
          for (const sg of [-1, 1]) { vadd('cone', at(-(type === 'wide' ? 34 : 15 * k), sg * (span + 1.5)), 0); vadd('cone', at(-3 * k, sg * 6 * k), 0); }
          vadd('cone', at(-36 * k, 0), 0);
          if (mil) { if (rnd() < 0.5) vadd('fuel', at(-14, 12), st.hdg + 90); continue; }
          if (rnd() < 0.85) vadd('gpu', at(3.5, 2.5), st.hdg + 90);
          if (st.bridge || rnd() < 0.6) {
            if (rnd() < 0.55) vadd('tug', at(6.5, 0), st.hdg + 180);
            vadd('belt', at(-6 * k, 3.6 * k), st.hdg - 25);
            if (rnd() < 0.7) vadd('belt', at(-22 * k, 3.6 * k), st.hdg + 25);
            if (rnd() < 0.6) vadd('catering', at(-26 * k, 4.8 * k), st.hdg + 90);
            if (rnd() < 0.5) vadd('fuel', at(-13 * k, 11 * k), st.hdg + 180);
            const nc = 2 + Math.floor(rnd() * 3);
            for (let c = 0; c < nc; c++) vadd('cart', at(-10 * k - c * 3.5, 9 * k + c * 0.3), st.hdg + 180);
          }
          if (!st.bridge && type !== 'prop') {
            vadd('stairs', at(-3.5 * k, -4.2 * k), st.hdg + 180);
            if (rnd() < 0.6) vadd('bus', at(-3 * k, -16 * k), st.hdg);
          }
        } else if (st.size === 'fighter') {
          lists.fighter.push({ x: st.x, z: st.z, hdg: st.hdg, color: 0xffffff, color2: 0x7d858c });
          vadd('chock', at(0, 0), st.hdg + 90);
          if (rnd() < 0.35) vadd('gpu', at(-2, -3.5), st.hdg + 90);
        } else if (st.size === 'light') {
          const liv = LIVERY[Math.floor(rnd() * LIVERY.length)];
          lists.light.push({ x: st.x, z: st.z, hdg: st.hdg, color: liv[0], color2: 0xf2f2f2 });
        }
      }
      // a follow-me car near the apron entrance, crash tenders at the fire station
      if (L.aprons[0]) { const a0 = L.aprons[0], p = L.frame.P(a0.a - a0.len / 2 + 30, a0.cIn + a0.side * 12); vadd('follow', p, L.frame.H + 90); }
      for (const b of L.buildings) if (b.type === 'firestation') {
        const d = { x: Math.sin(b.hdg * DEG), z: -Math.cos(b.hdg * DEG) }, r = { x: Math.cos(b.hdg * DEG), z: Math.sin(b.hdg * DEG) };
        const n = ap.kind === 'international' || mil ? 3 : 1;
        for (let k = 0; k < n; k++) { const off = (k - (n - 1) / 2) * 6; vadd('arff', { x: b.x + d.x * off - r.x * (b.wid / 2 + 9), z: b.z + d.z * off - r.z * (b.wid / 2 + 9) }, b.hdg + 90); }
      }
      for (const [k, list] of Object.entries(lists)) if (list.length) (k === 'light' ? near : mid).add(aircraftInstances(GEO[k], parkedMat, list));
      // GSE is static: bake every vehicle into one merged mesh per airport (one draw call instead of one per type)
      const gse = bakeStatic(Object.entries(veh).filter(([k, l]) => l.length && GEO.veh[k]).map(([k, l]) => [GEO.veh[k], l]));
      if (gse) { const m = new THREE.Mesh(gse, vehMat); m.castShadow = true; m.receiveShadow = true; near.add(m); }
    }
    // trees (landside planting; conifers at the alpine strip)
    for (const kind of ['broad', 'conifer']) {
      const list = L.trees.filter((t) => t.kind === kind).map((t, k) => ({ x: t.x, z: t.z, hdg: (k * 137.5) % 360, scale: t.s * (kind === 'conifer' ? 1.6 : 1.2), color: new THREE.Color().setHSL(0.2 + 0.06 * Math.sin(k * 1.7), 0.3, 0.8 + 0.12 * Math.sin(k * 2.3)).getHex() }));
      if (list.length) { const m = instances(treeGeo[kind], treeMat, list); m.userData.scnLowOff = true; mid.add(m); }
    }
    // windsocks (animated)
    const socks = [];
    for (const p of L.props) if (p.type === 'windsock') {
      const s = new THREE.Mesh(sockGeo, sockMat);
      s.position.set(p.x, 5.75, p.z); s.rotation.order = 'YZX'; s.castShadow = true;
      near.add(s); socks.push(s);
    }
    // lights
    // elevated edge-light fixtures (runway + taxiway), visible by day
    {
      const d = plans[i].data, seen = new Set(), list = [];
      for (let k = 0; k < plans[i].count; k++) {
        const o = k * 16, y = d[o + 1];
        if (d[o + 11] !== 0 || y < 0.3 || y > 0.4) continue;
        const key = Math.round(d[o] * 10) + ',' + Math.round(d[o + 2] * 10);
        if (seen.has(key)) continue; seen.add(key);
        const blue = d[o + 5] > d[o + 3];
        list.push({ x: d[o], z: d[o + 2], hdg: 0, color: blue ? 0x3050ff : 0xfff2c0 });
      }
      if (list.length) near.add(instances(fixtureGeo, fixtureMat, list));
    }
    const lightMesh = lights.build(plans[i]);
    root.add(lightMesh);
    if (ctx.params.raw?.shide?.includes('lights')) lightMesh.layers.set(5);

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

  // quality: shadow casting from scenery only when the preset has shadows
  let rangeK = 1;
  const applyQuality = () => {
    rangeK = { low: 0.35, medium: 0.7, high: 1, ultra: 1.25 }[ctx.quality.level] ?? 1;
    const sh = ctx.quality.shadows !== false;
    for (const A of airports) A.root.traverse((o) => { if (o.userData.scnLowOff) o.visible = ctx.quality.level !== 'low'; });
    for (const A of airports) A.root.traverse((o) => { if (o.isMesh && o.userData.scnCaster) o.castShadow = sh; });
  };
  for (const A of airports) A.root.traverse((o) => { if (o.isMesh && o.castShadow) o.userData.scnCaster = true; });
  applyQuality();
  ctx.events.on('quality:change', applyQuality);

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
    M.glass.userData.curtain.uIntNight.value = winK;
    M.glass.userData.curtain.uIntDay.value = 0.07 * (1 - THREE.MathUtils.smoothstep(night, 0.0, 0.6)) * (0.4 + 0.6 * Math.max(0, Math.min(1, (ctx.env.sunDir?.y ?? 0.5) * 2)));
    M.office.emissiveIntensity = 0.9 * winK;
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
      A.mid.visible = dist < RANGE.buildings * Math.max(0.5, rangeK);
      A.near.visible = dist < RANGE.props * rangeK;
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
  const texMB = textureBytes([noise, atlas, fenceTex, signs.tex, ...Object.values(facades).flatMap((f) => [f.map, f.emissive])]) / 1048576;
  const info = { bootMs: performance.now() - t0, textureMB: +texMB.toFixed(2), ...stats };
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
  const perAirport = [];
  for (const A of airports) {
    const pa = { id: A.id, draws: 0, triangles: 0, lowDraws: 0, lowTriangles: 0 };
    A.root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      let t = n;
      if (o.isInstancedMesh) { t = n * o.count; inst += o.count; }
      else if (g.isInstancedBufferGeometry) { t = n * g.instanceCount; inst += g.instanceCount; }
      draws++; tris += t; pa.draws++; pa.triangles += t;
      if (!o.userData.scnLowOff) { pa.lowDraws++; pa.lowTriangles += t; }
    });
    pa.triangles = Math.round(pa.triangles); pa.lowTriangles = Math.round(pa.lowTriangles);
    perAirport.push(pa);
  }
  return { ...base, drawables: draws, drawablesPerAirport: +(draws / airports.length).toFixed(1), triangles: Math.round(tris), instances: inst, perAirport };
}

/** Bytes of GPU texture memory for the scenery's generated textures (RGBA8, + 1/3 for mip chains). */
function textureBytes(texs) {
  let b = 0;
  for (const t of texs) { const im = t?.image; if (!im) continue; b += (im.width * im.height * 4) * (t.generateMipmaps !== false ? 4 / 3 : 1); }
  return Math.round(b);
}

/** Merge transformed, colour-tinted copies of small static geometries: [[geometry, [{ x, z, y?, hdg, color, scale }]]]. */
function bakeStatic(groups) {
  let nv = 0, ni = 0;
  for (const [g, list] of groups) { nv += g.attributes.position.count * list.length; ni += g.index.count * list.length; }
  if (!nv) return null;
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni);
  const c = new THREE.Color();
  let vo = 0, io = 0;
  for (const [g, list] of groups) {
    const P = g.attributes.position.array, N = g.attributes.normal.array, C = g.attributes.color.array, I = g.index.array, n = g.attributes.position.count;
    for (const o of list) {
      const h = -o.hdg * DEG, ch = Math.cos(h), sh = Math.sin(h), s = o.scale || 1, y0 = o.y || 0;
      c.set(o.color ?? 0xffffff);
      for (let v = 0; v < n; v++) {
        const x = P[v * 3] * s, y = P[v * 3 + 1] * s, z = P[v * 3 + 2] * s, k = (vo + v) * 3;
        // rotation about +Y by h (same convention as instances(): heading 0 = -Z)
        pos[k] = o.x + x * ch + z * sh; pos[k + 1] = y0 + y; pos[k + 2] = o.z - x * sh + z * ch;
        const nx = N[v * 3], nz = N[v * 3 + 2];
        nrm[k] = nx * ch + nz * sh; nrm[k + 1] = N[v * 3 + 1]; nrm[k + 2] = -nx * sh + nz * ch;
        col[k] = C[v * 3] * c.r; col[k + 1] = C[v * 3 + 1] * c.g; col[k + 2] = C[v * 3 + 2] * c.b;
      }
      for (let i = 0; i < I.length; i++) idx[io + i] = I[i] + vo;
      vo += n; io += I.length;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
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
