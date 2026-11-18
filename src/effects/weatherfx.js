// Weather effects: rain streaks around the camera and lightning bolts.
//
// Rain: a 36 m box of drops that wraps around the camera (positions = mod(seed·box + shift)); each drop is a thin
// quad stretched along the drop velocity RELATIVE to the camera × shutter time, so at speed the streaks rake past the
// windscreen along the airspeed vector. One instanced draw, count ∝ precipitation × quality.
// Lightning: on the 'lightning' event a branching bolt (midpoint displacement + forks) is built into a pooled segment
// buffer and drawn as HDR camera-facing strips with a soft glow for ~0.7 s (return strokes + afterglow).
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { premulMaterialOpts } from './fxglsl.js';

const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);

export function createRain(ctx, shared, header) {
  const MAXN = 9000, BOX = 36;
  const seeds = new Float32Array(MAXN * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = 0;
  const u = {
    ...shared, uShift: { value: new THREE.Vector3() }, uBox: { value: BOX }, uVrel: { value: new THREE.Vector3(0, -9, 0) },
    uStreak: { value: 0.03 }, uAmount: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    ...premulMaterialOpts(), uniforms: u,
    vertexShader: header + /* glsl */`
      uniform vec3 uShift; uniform float uBox; uniform vec3 uVrel; uniform float uStreak; uniform float uAmount;
      in vec4 seed;
      out vec2 vC; out float vA; out vec3 vW;
      void main() {
        vec3 rel = mod(seed.xyz * uBox + uShift, uBox) - 0.5 * uBox;
        vec3 c = uCameraPos + rel;
        float dist = length(rel);
        vec3 dir = uVrel * uStreak * (0.7 + 0.6 * seed.w);
        float L = length(dir);
        if (L > 9.0) { dir *= 9.0 / L; L = 9.0; }
        vec4 vc = viewMatrix * vec4(c, 1.0);
        float pxPerM = projectionMatrix[1][1] * 0.5 * uResolution.y / max(-vc.z, 0.05);
        float wPhys = 0.0025, wMin = 0.75 / pxPerM;
        float w = max(wPhys, wMin);
        vec3 toCam = normalize(uCameraPos - c);
        vec3 side = cross(dir, toCam); float sl = length(side);
        side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
        vec3 p = c + dir * (position.y * 0.5) + side * w * position.x;
        vC = position.xy;
        // fade near the box edge (no popping) and right at the lens
        float edge = 1.0 - smoothstep(0.32 * uBox, 0.5 * uBox, dist);
        float nearF = smoothstep(0.3, 1.5, dist);
        vA = uAmount * edge * nearF * clamp(wPhys / w, 0.15, 1.0) * clamp(1.6 / (1.0 + L * 0.25), 0.25, 1.0);
        vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: '#define FX_FRAG\n' + header + /* glsl */`
      in vec2 vC; in float vA; in vec3 vW;
      out vec4 outColor;
      void main() {
        float sd = fxSceneDist();
        float d = length(vW - uCameraPos);
        if (d > sd) discard;
        float a = vA * exp(-vC.x * vC.x * 3.0) * (1.0 - smoothstep(0.5, 1.0, abs(vC.y))) * 0.5;
        if (a < 0.002) discard;
        // drops refract the bright sky: lighter than the background by day, faintly lit at night
        vec3 L = atmAmbient(vW, vec3(0.0, 1.0, 0.0)) * 1.8 + fxSun(vW) * 0.03 + fxLocal(vW) * 0.4;
        outColor = fxFinish(L * a, a * 0.35, vec3(0.0), vW);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.set(LAYERS.POST); mesh.frustumCulled = false; mesh.renderOrder = 40; mesh.name = 'fx-rain';
  ctx.scene.add(mesh);
  const camW = new THREE.Vector3(), prevCam = new THREE.Vector3(), camVel = new THREE.Vector3(), dv = new THREE.Vector3(), tv = new THREE.Vector3();
  let first = true;
  return {
    update(dt, s) {
      const w = ctx.weather;
      ctx.camera.getWorldPosition(camW); ctx.world.toWorld(camW, camW);
      if (first) { prevCam.copy(camW); first = false; }
      if (dt > 0) {
        dv.subVectors(camW, prevCam);
        if (dv.lengthSq() > 800 * 800 * dt * dt) dv.set(0, 0, 0);         // teleport (camera switch / restart)
        else camVel.lerp(tv.copy(dv).multiplyScalar(1 / dt), Math.min(1, dt * 20));
      } else dv.set(0, 0, 0);
      prevCam.copy(camW);
      const alt = camW.y;
      const top = w.cloudTop || 3000, base = w.cloudBase || 1000;
      const inRain = alt < base ? 1 : alt < top ? 0.65 * (1 - (alt - base) / Math.max(1, top - base)) : 0;
      const amt = Math.min(1, (w.precipitation || 0) * 1.1) * inRain;
      const n = Math.round(MAXN * Math.min(1, amt * 1.1) * Math.min(1, ctx.quality?.particles ?? 1));
      geo.instanceCount = n;
      mesh.visible = n > 10;
      if (!mesh.visible) return;
      // drop velocity (terminal ~9 m/s + wind) relative to the camera
      const vy = -9 - 2 * (w.precipitation || 0);
      const wx = w.wind.x, wz = w.wind.z;
      u.uVrel.value.set(wx - camVel.x, vy - camVel.y, wz - camVel.z);
      const sh = u.uShift.value;
      sh.x = (((sh.x + (wx * dt - dv.x)) % BOX) + BOX) % BOX;
      sh.y = (((sh.y + (vy * dt - dv.y)) % BOX) + BOX) % BOX;
      sh.z = (((sh.z + (wz * dt - dv.z)) % BOX) + BOX) % BOX;
      u.uAmount.value = 0.35 + 0.65 * amt;
      u.uStreak.value = 0.022;
    },
    dispose() { ctx.scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
export function createLightning(ctx, shared, header) {
  const MAXSEG = 900, STRIDE = 8; // a.xyz, width | b.xyz, level
  const array = new Float32Array(MAXSEG * STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(array, STRIDE, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('sa', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('sb', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.instanceCount = 0;
  const u = { ...shared, uOffset: { value: new THREE.Vector3() }, uI: { value: 0 }, uBranchI: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    ...premulMaterialOpts(), uniforms: u,
    vertexShader: header + /* glsl */`
      uniform vec3 uOffset; uniform float uI; uniform float uBranchI;
      in vec4 sa; in vec4 sb;
      out vec2 vC; out float vI; out vec3 vW; out float vCoreFrac;
      void main() {
        vec3 a = sa.xyz + uOffset, b = sb.xyz + uOffset;
        float lvl = sb.w;
        float I = lvl < 0.5 ? uI : uBranchI * pow(0.55, lvl - 1.0);
        if (I < 1e-3) { gl_Position = vec4(0.0); return; }
        vec3 c = position.y < 0.0 ? a : b;
        vec4 vc = viewMatrix * vec4(c, 1.0);
        float pxPerM = projectionMatrix[1][1] * 0.5 * uResolution.y / max(-vc.z, 1.0);
        float core = max(sa.w, 1.2 / pxPerM);
        float halo = core * 7.0 + 10.0 / pxPerM;
        vec3 dir = b - a; vec3 toCam = normalize(uCameraPos - c);
        vec3 side = normalize(cross(dir, toCam) + vec3(1e-6));
        vec3 p = c + side * position.x * halo + normalize(dir) * position.y * halo * 0.5;
        vC = position.xy; vCoreFrac = core / halo;
        vI = I * clamp(sa.w / core, 0.05, 1.0) * 1.0;
        vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: '#define FX_FRAG\n' + header + /* glsl */`
      in vec2 vC; in float vI; in vec3 vW; in float vCoreFrac;
      out vec4 outColor;
      void main() {
        float sd = fxSceneDist();
        if (length(vW - uCameraPos) > sd + 50.0) discard;
        float x = abs(vC.x);
        float core = exp(-pow(x / max(vCoreFrac, 1e-3), 2.0) * 2.0);
        float glow = exp(-x * 4.0) * 0.08;
        vec3 e = (vec3(0.85, 0.88, 1.0) * core + vec3(0.55, 0.6, 1.0) * glow) * vI;
        outColor = fxFinish(vec3(0.0), 0.0, e, vW);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.set(LAYERS.POST); mesh.frustumCulled = false; mesh.renderOrder = 35; mesh.name = 'fx-lightning'; mesh.visible = false;
  ctx.scene.add(mesh);

  const origin = new THREE.Vector3(); // world position the segments are stored relative to
  let t = 1e9, intensity = 1, nseg = 0;
  const flashPos = new THREE.Vector3();
  const pts = [], A = new THREE.Vector3(), B = new THREE.Vector3();

  function seg(a, b, w, lvl) {
    if (nseg >= MAXSEG) return;
    const o = nseg * STRIDE;
    array[o] = a.x; array[o + 1] = a.y; array[o + 2] = a.z; array[o + 3] = w;
    array[o + 4] = b.x; array[o + 5] = b.y; array[o + 6] = b.z; array[o + 7] = lvl;
    nseg++;
  }
  // jagged polyline from a to b (local coords), returns array of points
  function jag(a, b, depth, rough) {
    let line = [a.clone(), b.clone()];
    let disp = a.distanceTo(b) * rough;
    for (let d = 0; d < depth; d++) {
      const nl = [line[0]];
      for (let i = 1; i < line.length; i++) {
        const p = line[i - 1], q = line[i];
        const m = p.clone().add(q).multiplyScalar(0.5);
        m.x += (Math.random() * 2 - 1) * disp; m.z += (Math.random() * 2 - 1) * disp; m.y += (Math.random() * 2 - 1) * disp * 0.3;
        nl.push(m, q);
      }
      line = nl; disp *= 0.55;
    }
    return line;
  }
  return {
    strike(e) {
      const wp = e.worldPos; if (!wp) return;
      intensity = Math.max(0.2, Math.min(2, e.intensity ?? 1));
      origin.set(wp.x, 0, wp.z);
      const top = new THREE.Vector3(0, wp.y, 0);
      const gx = wp.x + (Math.random() * 2 - 1) * wp.y * 0.25, gz = wp.z + (Math.random() * 2 - 1) * wp.y * 0.25;
      const gh = ctx.world.groundHeightAt(gx, gz);
      const cloudToCloud = Math.random() < 0.25 || wp.y - gh < 300;
      const bottom = cloudToCloud
        ? new THREE.Vector3((Math.random() * 2 - 1) * 3000, wp.y + (Math.random() * 2 - 1) * 300, (Math.random() * 2 - 1) * 3000)
        : new THREE.Vector3(gx - wp.x, gh, gz - wp.z);
      nseg = 0;
      const main = jag(top, bottom, 8, 0.12);
      for (let i = 1; i < main.length; i++) seg(main[i - 1], main[i], 2.2, 0);
      // forks
      const nb = 6 + Math.floor(Math.random() * 6);
      for (let k = 0; k < nb; k++) {
        const i0 = 1 + Math.floor(Math.random() * (main.length * 0.75));
        const s = main[i0]; const remain = s.distanceTo(bottom);
        const len = remain * (0.15 + Math.random() * 0.3);
        const dir = B.subVectors(bottom, s).normalize();
        dir.x += (Math.random() * 2 - 1) * 1.2; dir.z += (Math.random() * 2 - 1) * 1.2; dir.y -= 0.2; dir.normalize();
        const end = s.clone().addScaledVector(dir, len);
        const br = jag(s, end, 6, 0.15);
        for (let i = 1; i < br.length; i++) seg(br[i - 1], br[i], 1.0, 1);
        if (Math.random() < 0.6) {   // sub-fork
          const j = 1 + Math.floor(Math.random() * (br.length - 2));
          const e2 = br[j].clone().add(A.set((Math.random() * 2 - 1) * len * 0.4, -len * 0.3, (Math.random() * 2 - 1) * len * 0.4));
          const b2 = jag(br[j], e2, 5, 0.18);
          for (let i = 1; i < b2.length; i++) seg(b2[i - 1], b2[i], 0.6, 2);
        }
      }
      geo.instanceCount = nseg;
      buf.needsUpdate = true;
      flashPos.copy(main[Math.floor(main.length * 0.4)]).add(origin);
      t = 0;
    },
    update(dt) {
      t += dt;
      if (t > 0.9) { mesh.visible = false; return 0; }
      // stepped leader (branches) then return strokes + afterglow
      const strokes = (t < 0.05 ? 1 : t < 0.09 ? 0.15 : t < 0.14 ? 0.85 : t < 0.18 ? 0.1 : t < 0.23 ? 0.6 : 0.6 * Math.exp(-(t - 0.23) * 9));
      const flick = 0.85 + 0.3 * Math.random();
      u.uI.value = 260 * intensity * strokes * flick;
      u.uBranchI.value = 140 * intensity * (t < 0.12 ? 1 : Math.exp(-(t - 0.12) * 25)) * flick;
      u.uOffset.value.set(origin.x - ctx.world.origin.x, 0, origin.z - ctx.world.origin.z);
      mesh.visible = true;
      return strokes * intensity;
    },
    flashPos,
    clear() { t = 1e9; mesh.visible = false; },
    dispose() { ctx.scene.remove(mesh); geo.dispose(); mat.dispose(); },
  };
}
