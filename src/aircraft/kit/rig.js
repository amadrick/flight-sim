// Aircraft kit — the rig: collects meshes, merges static geometry per material, owns the moving nodes, the lamps,
// the per-frame state view and the visual object handed to the simulator.
import * as THREE from 'three';
import { Mesh, ellipsoid } from './mesh.js';
import { lampMaterial } from './materials.js';
import { displayTexture, createLiveDisplays, liveTileAt } from './displays.js';
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
 * Flash pattern shared with the effects light sprites (src/effects/lights.js), so a lens and its sprite / halo flash together:
 * strobes double-flash every 1.25 s (50 ms, gap, 50 ms); the beacon is a rotating-beacon pulse sin⁸ at 0.95 Hz.
 * lampFlash(kind, t, phase = 0) → 0..1 for 'strobe' / 'strobeTail' / 'beacon' / 'beacon2', 1 for steady lamps.
 * Use the lamp clock `S.tLamp` (the simulator clock, the one the effects module counts) for t.
 */
export function lampFlash(kind, t, phase = 0) {
  if (kind === 'strobe' || kind === 'strobeTail') { const ph = ((t + phase + (kind === 'strobeTail' ? 0.05 : 0)) % 1.25 + 1.25) % 1.25; return ph < 0.05 || (ph > 0.16 && ph < 0.21) ? 1 : 0; }
  if (kind === 'beacon' || kind === 'beacon2') { const ph = (((t + phase) * 0.95 + (kind === 'beacon2' ? 0.5 : 0)) % 1 + 1) % 1, s = Math.sin(ph * Math.PI); return s > 0 ? Math.pow(s, 8) : 0; }
  return 1;
}

// Point sprites named 'halos' (night glow sprites some visuals add next to their lamps): the sprite is a flat square at the
// lamp's depth, so where the lamp sits in the skin the fuselage cuts a wedge out of it ("pac-man"). Pull the sprite's depth
// toward the camera by a fraction of its own size (it still hides behind the airframe when the lamp is on the far side).
function fixHalos(root) {
  if (globalThis.__kitNoHaloFix) return;                              // harness halofix=0: compare with the unpatched sprites
  root.traverse((n) => {
    const m = n.isPoints && n.name === 'halos' ? n.material : null;
    if (!m || m.userData.kitHaloFix || !m.vertexShader) return;
    const k = 'gl_Position = projectionMatrix * mv;';
    if (!m.vertexShader.includes(k)) return;
    m.vertexShader = m.vertexShader.replace(k, 'vec4 mvH = mv; mvH.xyz *= max(0.2, 1.0 - min(1.2, 0.35 + 0.02 * length(mv.xyz)) / max(length(mv.xyz), 1e-3)); gl_Position = projectionMatrix * mvH;');
    m.userData.kitHaloFix = true; m.needsUpdate = true;
  });
}

// kit-owned materials for sidecar geometry (Mesh.sidecar): cockpit displays, panel legends + flood, HUD symbology, visor
// `live` is the rig's live display canvas (displays.js): its pages answer UV v in (1, 2] and the materials sample it there.
const LIVE_GLSL = `
	vec2 kUv = KUV; float kLive = step(1.0, kUv.y);
	vec4 kS = texture2D(KMAP, vec2(kUv.x, min(kUv.y, 0.99995)));
	vec4 kL = texture2D(uKitLive, vec2(kUv.x, max(kUv.y - 1.0, 0.00005)));
	vec4 kTex = mix(kS, kL, kLive);`;
function kitMaterial(kind, live) {
  const tex = displayTexture(), liveTex = live ? live.texture : tex;
  if (kind === 'display') {
    // glass-fronted LCD: black, glossy (reflects the cockpit / sky a little), the page in the emissive term only
    const m = new THREE.MeshStandardMaterial({ color: 0x030405, roughness: 0.1, metalness: 0, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35, envMapIntensity: 0.55 });
    const u = { uKitLive: { value: liveTex } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uKitLive;')
        .replace('#include <emissivemap_fragment>', '#ifdef USE_EMISSIVEMAP' + LIVE_GLSL.replace('KUV', 'vEmissiveMapUv').replace('KMAP', 'emissiveMap') + '\n\ttotalEmissiveRadiance *= kTex.rgb;\n#endif');
    };
    m.customProgramCacheKey = () => 'kit-display';
    return { mat: m, shadow: false };
  }
  if (kind === 'panel') {
    // painted panel face / gauge dial: lit like any surface by day; at night only the white lettering glows (edge-lit legends,
    // integral gauge lighting: luminance mask of the texel, keeps the ink colour) plus a dim flood. Both levels come from the rig.
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.66, metalness: 0 });
    const u = { uKitFlood: { value: new THREE.Color(0, 0, 0) }, uKitGlow: { value: 0 } };
    m.userData.flood = u.uKitFlood.value; m.userData.glow = u.uKitGlow;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uKitFlood;\nuniform float uKitGlow;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
	float kLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
	totalEmissiveRadiance += diffuseColor.rgb / max(kLum, 1e-3) * smoothstep(0.22, 0.55, kLum) * uKitGlow;
	totalEmissiveRadiance += diffuseColor.rgb * uKitFlood;`)
        // the panel sits deep under the glareshield: most of the sky the scene's ambient / IBL assumes is hidden by the coaming
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n\treflectedLight.indirectDiffuse *= 0.3;\n\treflectedLight.indirectSpecular *= 0.35;');
    };
    m.customProgramCacheKey = () => 'kit-panel';
    return { mat: m, shadow: true };
  }
  if (kind === 'hud') {
    const m = new THREE.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: true });
    const u = { uKitLive: { value: liveTex } };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uKitLive;')
        .replace('#include <map_fragment>', '#ifdef USE_MAP' + LIVE_GLSL.replace('KUV', 'vMapUv').replace('KMAP', 'map') + '\n\tdiffuseColor *= kTex;\n#endif');
    };
    m.customProgramCacheKey = () => 'kit-hud';
    return { mat: m, shadow: false, layer: LAYERS.POST, renderOrder: 7, cockpitOnly: true };
  }
  if (kind === 'visor') {
    // helmet visor: dark smoked polycarbonate with a mirror-like reflection of the sky and the canopy frame
    const m = new THREE.MeshPhysicalMaterial({ color: 0x15171c, roughness: 0.06, metalness: 0.55, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.4 });
    return { mat: m, shadow: true };
  }
  return null;
}

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
  const kitMats = new Map(), cockpitOnly = [];
  let live = null, liveUsed = null;                                     // live display canvas (created with the first screen / HUD)
  const kitKey = (kind) => {                                            // register the kit material for a sidecar kind (once)
    const key = 'kit:' + kind;
    if ((kind === 'display' || kind === 'hud') && !live && !globalThis.__kitNoLive) { live = createLiveDisplays(); if (live) { liveUsed = new Set(); owned.push(live); } }
    if (!mats.has(key)) { const k = kitMaterial(kind, live); if (!k) return null; kitMats.set(kind, k.mat); mats.set(key, { mat: k.mat, shadow: k.shadow, layer: k.layer, renderOrder: k.renderOrder, cockpitOnly: k.cockpitOnly }); owned.push(k.mat); }
    return key;
  };
  const noteLive = (kind, sm) => {                                      // which live pages this rig's screens show (only those are redrawn)
    if (!liveUsed || (kind !== 'display' && kind !== 'hud')) return;
    const uv = sm.uv; for (let i = 0; i < uv.length; i += 2) if (uv[i + 1] > 1) { const n = liveTileAt(uv[i], uv[i + 1]); if (n) liveUsed.add(n); }
  };

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
    material(key, mat, opt = {}) { mats.set(key, { mat, shadow: opt.shadow ?? true, layer: opt.layer ?? mat?.userData?.kitLayer, renderOrder: opt.renderOrder ?? mat?.userData?.kitRenderOrder }); if (!opt.shared) owned.push(mat); return mat; },
    /** Glass goes on LAYERS.POST by default (drawn after the atmosphere composite). */
    glass(key, mat, opt = {}) { return rig.material(key, mat, { shadow: false, layer: opt.layer ?? o.glassLayer ?? LAYERS.POST, renderOrder: 5, ...opt }); },
    addStatic(mesh, key = 'paint') {
      if (!mesh || !mesh.triCount) return rig;
      if (!mats.has(key)) throw new Error('rig: unknown material key ' + key);
      let m = statics.get(key); if (!m) statics.set(key, m = new Mesh());
      m.add(mesh);
      if (m.side) {                                                     // sidecar geometry → the kit's own materials
        const side = m.side; m.side = null;
        for (const kind in side) { const k = kitKey(kind); if (!k || !side[kind].triCount) continue; noteLive(kind, side[kind]); let s2 = statics.get(k); if (!s2) statics.set(k, s2 = new Mesh()); s2.add(side[kind]); }
      }
      return rig;
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
      attach(obj, name, opt.parent, pivot);
      if (m.side) for (const kind in m.side) {                          // sidecar geometry moves with the part
        const k = kitKey(kind), sm = m.side[kind]; if (!k || !sm.triCount) continue; noteLive(kind, sm);
        const info2 = mats.get(k), child = setupMesh(new THREE.Mesh(sm.toGeometry(), info2.mat), info2); child.name = name + ':' + kind;
        if (sm.p2 && obj.morphTargetInfluences) child.morphTargetInfluences = obj.morphTargetInfluences;   // the visor turns with the head
        obj.add(child); tris += sm.triCount; if (info2.cockpitOnly) cockpitOnly.push(child);
      }
      if (mesh.onPart) mesh.onPart(obj, rig);                         // kit parts that animate themselves (pilot head, …)
      return obj;
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
      if (live && liveUsed) { for (const n of [...live.used]) if (!liveUsed.has(n)) live.used.delete(n); }
      for (const [key, m] of statics) {
        if (m.morphOptional) m.p2 = null;                               // only an optional morph (a merged pilot's head turn): static keeps still
        const info = mats.get(key), obj = setupMesh(new THREE.Mesh(m.toGeometry(), info.mat), info);
        obj.name = 'static:' + key; root.add(obj); tris += m.triCount; if (!firstStatic && info.layer === undefined) firstStatic = obj;
        if (info.cockpitOnly) cockpitOnly.push(obj);
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
      // contact occlusion (wing roots, tail, pylons, nacelles → fuselage charts) is baked into the atlas occlusion layer here;
      // the layers are packed into their GPU textures (uploads + one draw per atlas) on the first update(), i.e. together with
      // the other texture uploads of the first frame — call atlas.bake() yourself to force it earlier.
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
      let packed = false, halosFixed = false, liveDrawn = false;
      const pack = () => { packed = true; const t = performance.now(); for (const d of rig.disposables) d?.bake?.(); stats.packMs = Math.round(performance.now() - t); };
      let draws = 0; root.traverse(n => { if (n.isMesh) draws++; });
      const stats = { triangles: tris, drawCalls: draws, buildMs: performance.now() - t0, occlusionMs: Math.round(tB - tA), packMs: 0 };
      const visual = {
        object3D: root, parts, stats, rig,
        update(state, dt) {
          dt = num(dt, 0);
          if (!packed) pack();
          readState(S, state, dt, ctx);
          if (!halosFixed) { fixHalos(root); halosFixed = true; }
          for (let i = 0; i < updaters.length; i++) updaters[i](S, dt);
          // kit cockpit lighting. By day screens run at full brightness and panels are plain painted surfaces. At night the crew
          // dims everything to what dark-adapted eyes want: the levels are set against the camera exposure (ctx.env.exposure,
          // up to 40× at night) so that, after exposure, screens peak around 0.5, lit legends around 0.2 and the flood leaves the
          // panel paint a few percent — dark panels, crisp dim lettering, bright but not blooming screens.
          if (kitMats.size) {
            const n = S.night, E = Math.max(1, num(ctx?.env?.exposure, 1 / (1 - n + n * 0.03))), d = kitMats.get('display'), p = kitMats.get('panel'), h = kitMats.get('hud');
            if (d) d.emissiveIntensity = 0.35 + (0.5 / E - 0.35) * n;
            if (p) { p.userData.glow.value = n * 0.2 / E; p.userData.flood.setRGB(1, 0.84, 0.62).multiplyScalar(n * 0.06 / E); }
            if (h) { const I = 2.2 + (0.9 / E - 2.2) * n; h.color.setRGB(0.35 * I, 1.0 * I, 0.5 * I); }
            for (let i = 0; i < cockpitOnly.length; i++) cockpitOnly[i].visible = rig.cameraInCockpit;
            if (live && live.used.size && (rig.cameraInCockpit || !liveDrawn)) { liveState(live.state, S, geometry); live.step(liveDrawn ? dt : 1); liveDrawn = true; }
          }
          // lamps
          const night = S.night, lt = S.lights, t = S.tLamp;
          for (let i = 0; i < lampObjs.length; i++) {
            const L = lampObjs[i], lv = LAMP_LEVEL[L.kind] || LAMP_LEVEL.nav; let on = 0;
            const tt = t + L.phase;
            if (L.kind === 'nav' || L.kind === 'formation') on = lt.nav ? 1 : 0;
            else if (L.kind === 'strobe') on = lt.strobe ? lampFlash('strobe', tt) : 0;
            else if (L.kind === 'beacon') on = lt.beacon ? lampFlash('beacon', tt) : 0;
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

const KT = 1.943844, FT = 3.28084, R2D = 180 / Math.PI;
/** Cockpit page state (displays.js units) from the state view: attitude, air data, heading, engines. Missing fields keep defaults. */
function liveState(L, S, geometry) {
  const s = S.raw || {}, e = S.eng;
  if (typeof s.pitch === 'number') L.pitch = s.pitch * R2D;
  if (typeof s.roll === 'number') L.roll = s.roll * R2D;
  if (typeof s.ias === 'number' && (s.ias > 0 || S.onGround)) { const v = s.ias * KT; L.trend = (v - L.ias) / Math.max(S.dt, 1e-3) * 10 * 0.2 + (L.trend || 0) * 0.8; L.ias = v; }
  if (typeof s.tas === 'number' && s.tas > 0) L.tas = s.tas * KT;
  if (typeof s.groundSpeed === 'number') L.gs = s.groundSpeed * KT;
  if (typeof s.mach === 'number') L.mach = s.mach;
  if (typeof s.altitude === 'number' && (s.altitude !== 0 || s.position)) L.alt = s.altitude * FT;
  else if (s.position && typeof s.position.y === 'number') L.alt = s.position.y * FT;
  if (typeof s.verticalSpeed === 'number') L.vs = s.verticalSpeed * FT * 60;
  if (typeof s.heading === 'number') L.hdg = s.heading * R2D;
  if (typeof s.aoa === 'number') L.aoa = s.aoa * R2D;
  if (typeof s.beta === 'number') L.beta = s.beta * R2D;
  if (typeof s.gLoad === 'number') L.g = s.gLoad;
  if (typeof s.fuel === 'number' && s.fuel > 0) L.fuel = s.fuel;
  L.engines = Math.max(1, e.length || 2); L.onGround = S.onGround; L.flaps = S.sf.flaps; L.gear = S.sf.gear; L.t = S.t;
  for (let i = 0; i < Math.min(4, e.length); i++) {
    if (e[i].n1 > 0 || !e[i].running) L.n1[i] = e[i].n1 * 100;
    if (e[i].n2 > 0) L.n2[i] = e[i].n2 * 100;
    if (e[i].egt > 0) L.egt[i] = e[i].egt;
    const ff = s.engines && s.engines[i] && s.engines[i].fuelFlow; if (typeof ff === 'number' && ff > 0) L.ff[i] = ff * 3.6;
  }
  const ap = s.ap; if (ap && ap.engaged) { if (ap.altitude) L.altSel = ap.altitude * FT; if (ap.speed) L.spdSel = ap.speed * KT; if (typeof ap.heading === 'number') L.hdgSel = ap.heading * R2D; }
  else { L.altSel = Math.round(L.alt / 1000) * 1000; L.hdgSel = Math.round(L.hdg / 5) * 5; L.spdSel = Math.round(L.ias / 5) * 5; }
  void geometry;
}

/** Tolerant, allocation-free view of AircraftState handed to animation callbacks. */
export function makeStateView(geometry) {
  return {
    sf: { ...SURF_DEFAULTS },
    eng: (geometry.engines || []).map(() => ({ running: true, n1: 0, n2: 0, thrust: 0, afterburner: 0, nozzle: 0, reverser: 0, egt: 0 })),
    gear: (geometry.gear || []).map(() => ({ onGround: false, compression: 0, wheelSpeed: 0, steer: 0, skid: 0 })),
    lights: { ...LIGHT_DEFAULTS },
    onGround: false, groundSpeed: 0, throttle: 0, t: 0, tLamp: 0, dt: 0, night: 0, raw: null, hasGearState: false,
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
  // lamp clock: the simulator clock when there is one (the effects module's sprites count the same seconds), else S.t
  const now = ctx?.time?.now; S.tLamp = typeof now === 'number' && isFinite(now) && now > 0 ? now : S.t;
}
