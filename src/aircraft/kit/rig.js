// Aircraft kit — the rig: collects meshes, merges static geometry per material, owns the moving nodes, the lamps,
// the per-frame state view and the visual object handed to the simulator.
import * as THREE from 'three';
import { Mesh, ellipsoid } from './mesh.js';
import { lampMaterial } from './materials.js';
import { bakeContactAO } from './occlusion.js';
import { LAYERS } from '../../core/constants.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
export const smooth01 = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
/** Sub-range of a 0..1 sequence: seq(g, a, b) is 0 below a, 1 above b, eased in between. */
export const seq = (g, a, b) => smooth01((g - a) / (b - a));
/** Piecewise-linear keyframes: keys = [[x, y], ...] ascending in x. */
export function keys(k, x) {
  if (x <= k[0][0]) return k[0][1]; const n = k.length; if (x >= k[n - 1][0]) return k[n - 1][1];
  let i = 1; while (k[i][0] < x) i++;
  return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * (x - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
}

const SURF_DEFAULTS = { aileronL: 0, aileronR: 0, elevatorL: 0, elevatorR: 0, rudder: 0, flaps: 0, slats: 0, spoilerL: 0, spoilerR: 0, speedbrake: 0, gear: 1, hook: 0, wingSweep: 0, canopy: 0, nozzlePitch: 0 };
const LIGHT_DEFAULTS = { nav: true, strobe: true, beacon: true, landing: false, taxi: false };

// lamp radiance (linear, HDR) by kind: [day, night]
// By day a position light is only about as bright as sunlit white paint (≈ 1) while a landing lamp or a xenon strobe is
// hundreds of times brighter; at night the camera's exposure rises 10 – 40×, so the levels come down to keep the bloom sane.
const LAMP_LEVEL = { nav: [5, 7], strobe: [300, 150], beacon: [110, 70], landing: [340, 110], taxi: [130, 50], formation: [0.9, 2.5] };

/**
 * createRig(ctx, { geometry, name }) → rig
 *   rig.material(key, material, { layer, shadow = true })      register a material under a key ('paint' = atlas material…)
 *   rig.addStatic(mesh, key = 'paint')                         geometry that never moves (merged: one draw call per key)
 *   rig.part(name, mesh, { key, parent, pivot })               a moving node; pivot = rotation centre in body coords
 *   rig.node(name, { parent, pivot })                          an empty transform node
 *   rig.hinge(node, a, b, { ref, toward })                     → set(angleRad): rotate about the line a→b; positive moves `ref` toward `toward`
 *   rig.lamp(kind, pos, { color, size, parent, squash })        emissive lamp: kind = nav | strobe | beacon | landing | taxi | formation
 *   rig.onUpdate((S, dt) => …)                                 animation callback; S = tolerant state view (see makeStateView)
 *   rig.build() → { object3D, update(state, dt), dispose(), parts, stats }
 */
export function createRig(ctx, o = {}) {
  const geometry = o.geometry || { engines: [], gear: [], pilotEye: [0, 0, 0] };
  const root = new THREE.Group(); root.name = o.name || 'aircraft';
  const mats = new Map(), statics = new Map(), parts = {}, updaters = [], lamps = [], owned = [], occluders = [];
  const t0 = performance.now();
  let tris = 0, built = false;
  const S = makeStateView(geometry);
  const _v = new THREE.Vector3(), _inv = new THREE.Matrix4();
  const eye = new THREE.Vector3().fromArray(geometry.pilotEye || [0, 0, 0]);

  const setupMesh = (obj, info) => {
    obj.castShadow = info.shadow; obj.receiveShadow = info.shadow;
    if (info.layer !== undefined) obj.layers.set(info.layer);
    if (info.renderOrder) obj.renderOrder = info.renderOrder;
    return obj;
  };
  const attach = (obj, name, parent, pivot) => {
    const pp = parent ? parent.userData.pivot : [0, 0, 0];
    obj.position.set(pivot[0] - pp[0], pivot[1] - pp[1], pivot[2] - pp[2]);
    obj.userData.pivot = pivot.slice(); obj.name = name;
    (parent || root).add(obj);
    if (name) parts[name] = obj;
    return obj;
  };

  const rig = {
    ctx, geometry, root, parts, state: S,
    cameraInCockpit: false, cameraBody: new THREE.Vector3(0, 0, 1e6),
    material(key, mat, opt = {}) { mats.set(key, { mat, shadow: opt.shadow ?? true, layer: opt.layer, renderOrder: opt.renderOrder }); if (!opt.shared) owned.push(mat); return mat; },
    /** Glass goes on LAYERS.POST by default (drawn after the atmosphere composite). */
    glass(key, mat, opt = {}) { return rig.material(key, mat, { shadow: false, layer: opt.layer ?? o.glassLayer ?? LAYERS.POST, renderOrder: 5, ...opt }); },
    addStatic(mesh, key = 'paint') {
      if (!mesh || !mesh.triCount) return rig;
      if (!mats.has(key)) throw new Error('rig: unknown material key ' + key);
      let m = statics.get(key); if (!m) statics.set(key, m = new Mesh());
      m.add(mesh); return rig;
    },
    node(name, opt = {}) { return attach(new THREE.Group(), name, opt.parent, opt.pivot || (opt.parent ? opt.parent.userData.pivot : [0, 0, 0])); },
    part(name, mesh, opt = {}) {
      const info = mats.get(opt.key || 'paint'); if (!info) throw new Error('rig: unknown material key ' + opt.key);
      const pivot = opt.pivot || (opt.parent ? opt.parent.userData.pivot : [0, 0, 0]);
      const m = mesh.clone().translate(-pivot[0], -pivot[1], -pivot[2]);
      if (opt.ao !== false && !m.p2) occluders.push({ mesh, key: opt.key || 'paint' });   // rest pose counts for the contact-occlusion bake
      tris += m.triCount;
      const obj = setupMesh(new THREE.Mesh(m.toGeometry(), info.mat), info);
      if (m.p2) obj.morphTargetInfluences = [0];
      return attach(obj, name, opt.parent, pivot);
    },
    hinge(node, a, b, opt = {}) {
      const axis = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      let sign = 1;
      if (opt.ref && opt.toward) {
        const r = new THREE.Vector3(opt.ref[0] - a[0], opt.ref[1] - a[1], opt.ref[2] - a[2]);
        const v = new THREE.Vector3().crossVectors(axis, r);
        if (v.dot(new THREE.Vector3().fromArray(opt.toward)) < 0) sign = -1;
      }
      const set = (ang) => { node.quaternion.setFromAxisAngle(axis, sign * ang); };
      set.axis = axis; set.sign = sign;
      return set;
    },
    /** Shorthand: make a part from a control-surface result ({ mesh, hinge, ref }) and return { node, set }. */
    hingePart(name, ctrl, opt = {}) {
      const node = rig.part(name, opt.mesh || ctrl.mesh, { key: opt.key, parent: opt.parent, pivot: ctrl.hinge.a });
      return { node, set: rig.hinge(node, ctrl.hinge.a, ctrl.hinge.b, { ref: ctrl.ref, toward: opt.toward || [0, 1, 0] }) };
    },
    lamp(kind, pos, opt = {}) {
      const size = opt.size ?? 0.05, sq = opt.squash || [1, 1, 1];
      const m = opt.mesh || ellipsoid(size * sq[0], size * sq[1], size * sq[2], { segments: 8, rings: 5 });
      if (!opt.mesh) m.translate(pos[0], pos[1], pos[2]);
      let c = pos, r = size * Math.max(sq[0], sq[1], sq[2]);
      if (opt.mesh || !pos) { const b = m.bounds(); c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]; r = Math.max(0.01, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2); }
      lamps.push({ kind, mesh: m, color: opt.color || [1, 1, 1], parent: opt.parent || null, phase: opt.phase ?? 0, group: opt.group ?? '', centre: c, radius: r });
      return rig;
    },
    onUpdate(fn) { updaters.push(fn); return rig; },
    build() {
      if (built) throw new Error('rig: build() called twice'); built = true;
      let firstStatic = null;
      for (const [key, m] of statics) {
        const info = mats.get(key), obj = setupMesh(new THREE.Mesh(m.toGeometry(), info.mat), info);
        obj.name = 'static:' + key; root.add(obj); tris += m.triCount; if (!firstStatic && info.layer === undefined) firstStatic = obj;
      }
      // lamps: one mesh per (kind, parent, group, phase) with vertex colours
      const lampGroups = new Map();
      for (const L of lamps) {
        const key = L.kind + '|' + (L.parent ? L.parent.uuid : '') + '|' + L.group + '|' + L.phase;
        let g = lampGroups.get(key); if (!g) lampGroups.set(key, g = { kind: L.kind, parent: L.parent, phase: L.phase, mesh: new Mesh(), colors: [], centres: [] });
        g.mesh.add(L.mesh); for (let i = 0; i < L.mesh.vertexCount; i++) { g.colors.push(L.color[0], L.color[1], L.color[2]); g.centres.push(L.centre[0], L.centre[1], L.centre[2], L.radius); }
      }
      const lampObjs = [];
      for (const g of lampGroups.values()) {
        const pivot = g.parent ? g.parent.userData.pivot : [0, 0, 0];
        const geo = g.mesh.translate(-pivot[0], -pivot[1], -pivot[2]).toGeometry();
        geo.setAttribute('color', new THREE.Float32BufferAttribute(g.colors, 3));
        for (let i = 0; i < g.centres.length; i += 4) { g.centres[i] -= pivot[0]; g.centres[i + 1] -= pivot[1]; g.centres[i + 2] -= pivot[2]; }
        geo.setAttribute('kitLamp', new THREE.Float32BufferAttribute(g.centres, 4));
        const mat = lampMaterial(ctx); owned.push(mat);
        const obj = new THREE.Mesh(geo, mat); obj.name = 'lamp:' + g.kind; obj.castShadow = false; obj.receiveShadow = false;
        (g.parent || root).add(obj); tris += g.mesh.triCount;
        lampObjs.push({ obj, mat, kind: g.kind, phase: g.phase });
      }
      if (firstStatic) firstStatic.onBeforeRender = (renderer, scene, camera) => {
        if (!camera.isPerspectiveCamera) return;
        _inv.copy(root.matrixWorld).invert();
        rig.cameraBody.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
        rig.cameraInCockpit = rig.cameraBody.distanceTo(eye) < (o.cockpitRadius ?? 0.75);
      };
      // contact occlusion (wing roots, tail, pylons, nacelles → fuselage charts), then pack the atlas layers into GPU textures
      const isSkin = (key) => !!mats.get(key)?.mat?.userData?.kitSkin, tA = performance.now();
      if (o.contactAO !== false && (ctx?.quality?.level || 'high') !== 'low') {
        try {
          const occ = []; for (const [key, m] of statics) if (isSkin(key)) occ.push(m);
          for (const q of occluders) if (isSkin(q.key)) occ.push(q.mesh);
          rig.aoInfo = bakeContactAO(occ, rig.disposables, typeof o.contactAO === 'object' ? o.contactAO : {});
        } catch (e) { console.warn('[kit] contact occlusion bake failed', e); }
      }
      occluders.length = 0;
      const tB = performance.now();
      for (const d of rig.disposables) d?.bake?.();
      const tC = performance.now();
      let draws = 0; root.traverse(n => { if (n.isMesh) draws++; });
      const stats = { triangles: tris, drawCalls: draws, buildMs: performance.now() - t0, occlusionMs: Math.round(tB - tA), packMs: Math.round(tC - tB) };
      const visual = {
        object3D: root, parts, stats, rig,
        update(state, dt) {
          dt = num(dt, 0);
          readState(S, state, dt, ctx);
          for (let i = 0; i < updaters.length; i++) updaters[i](S, dt);
          // lamps
          const night = S.night, lt = S.lights, t = S.t;
          for (let i = 0; i < lampObjs.length; i++) {
            const L = lampObjs[i], lv = LAMP_LEVEL[L.kind] || LAMP_LEVEL.nav; let on = 0;
            const tt = t + L.phase;
            if (L.kind === 'nav' || L.kind === 'formation') on = lt.nav ? 1 : 0;
            else if (L.kind === 'strobe') { const ph = tt % 1.1; on = lt.strobe && (ph < 0.055 || (ph > 0.16 && ph < 0.215)) ? 1 : 0; }
            else if (L.kind === 'beacon') { const ph = (tt + 0.45) % 1.25; on = lt.beacon ? (ph < 0.16 ? Math.sin(ph / 0.16 * Math.PI) : 0) : 0; }
            else if (L.kind === 'landing') on = lt.landing ? 1 : 0;
            else if (L.kind === 'taxi') on = lt.taxi ? 1 : 0;
            const I = on * (lv[0] + (lv[1] - lv[0]) * night);
            L.mat.color.setRGB(I, I, I); L.mat.userData.lampUniforms.uLampNight.value = night;      // unlit lamps stay visible as lenses
          }
        },
        dispose() {
          root.traverse(n => { if (n.isMesh) n.geometry?.dispose(); });
          for (const m of owned) m?.dispose?.();
          for (const d of rig.disposables) d?.dispose?.();
          root.removeFromParent();
        },
      };
      return visual;
    },
    disposables: [],
  };
  return rig;
}

/** Tolerant, allocation-free view of AircraftState handed to animation callbacks. */
export function makeStateView(geometry) {
  return {
    sf: { ...SURF_DEFAULTS },
    eng: (geometry.engines || []).map(() => ({ running: true, n1: 0, n2: 0, thrust: 0, afterburner: 0, nozzle: 0, reverser: 0, egt: 0 })),
    gear: (geometry.gear || []).map(() => ({ onGround: false, compression: 0, wheelSpeed: 0, steer: 0, skid: 0 })),
    lights: { ...LIGHT_DEFAULTS },
    onGround: false, groundSpeed: 0, throttle: 0, t: 0, dt: 0, night: 0, raw: null, hasGearState: false,
  };
}
function readState(S, s, dt, ctx) {
  s = s || {}; S.raw = s; S.dt = dt; S.t += dt;
  const sf = s.surfaces || {}, out = S.sf;
  for (const k in SURF_DEFAULTS) { const v = num(sf[k], SURF_DEFAULTS[k]); out[k] = v < -1 ? -1 : v > 1 ? 1 : v; }
  const en = Array.isArray(s.engines) ? s.engines : [];
  for (let i = 0; i < S.eng.length; i++) {
    const e = en[i] || en[0] || {}, d = S.eng[i];
    d.running = e.running !== false; d.n1 = num(e.n1); d.n2 = num(e.n2); d.thrust = num(e.thrust); d.afterburner = clamp01(num(e.afterburner)); d.nozzle = clamp01(num(e.nozzle)); d.reverser = clamp01(num(e.reverser)); d.egt = num(e.egt);
  }
  const gr = Array.isArray(s.gear) ? s.gear : []; S.hasGearState = gr.length > 0;
  for (let i = 0; i < S.gear.length; i++) {
    const g = gr[i] || {}, d = S.gear[i];
    d.onGround = g.onGround !== undefined ? !!g.onGround : !!s.onGround; d.compression = clamp01(num(g.compression)); d.steer = num(g.steer); d.skid = num(g.skid);
    d.wheelSpeed = g.wheelSpeed !== undefined && (g.wheelSpeed !== 0 || !d.onGround) ? num(g.wheelSpeed) : NaN;   // NaN → derive from ground speed
  }
  const l = s.lights || {};
  for (const k in LIGHT_DEFAULTS) S.lights[k] = l[k] !== undefined ? !!l[k] : LIGHT_DEFAULTS[k];
  S.onGround = !!s.onGround; S.groundSpeed = num(s.groundSpeed); S.throttle = num(s.throttle);
  S.night = clamp01(num(ctx?.env?.nightFactor));
}
