// Body-fixed condensation volumes, ray-marched in the aircraft frame (they ride with the airframe, while their noise
// is advected aft at flow speed so they visibly stream off the surfaces):
//   * over-wing vapour sheet (high G / high lift in humid air) — grows from the forward upper surface aft and spills
//     past the trailing edge,
//   * LERX vortices (fighters at high AoA) — two spiralling tubes from the strake apex over the wing root, bursting aft,
//   * transonic vapour cone (Prandtl–Glauert) — a bell-shaped shock-bounded shell around the airframe, flashing on
//     the sonic boom.
// Each volume is one box mesh (one draw) and only drawn when its amount > 0.
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { premulMaterialOpts } from './fxglsl.js';

const DEG = Math.PI / 180;

function makeMaterial(shared, header, densityGLSL, extraUniforms) {
  return new THREE.ShaderMaterial({
    ...premulMaterialOpts(),
    side: THREE.BackSide,
    uniforms: {
      ...shared,
      uCenter: { value: new THREE.Vector3() }, uSize: { value: new THREE.Vector3(1, 1, 1) },
      uCamLocal: { value: new THREE.Vector3() }, uSunLocal: { value: new THREE.Vector3(0, 1, 0) },
      uAmount: { value: 0 }, uFlow: { value: 0 }, uSteps: { value: 16 }, uSigma: { value: 4 },
      ...extraUniforms,
    },
    vertexShader: header + /* glsl */`
      uniform vec3 uCenter; uniform vec3 uSize;
      out vec3 vLocal; out vec3 vWorld;
      void main() {
        vec3 p = position * uSize + uCenter;
        vLocal = p;
        vec4 w = modelMatrix * vec4(p, 1.0); vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: '#define FX_FRAG\n' + header + /* glsl */`
      uniform vec3 uCenter; uniform vec3 uSize; uniform vec3 uCamLocal; uniform vec3 uSunLocal;
      uniform float uAmount; uniform float uFlow; uniform float uSteps; uniform float uSigma;
      in vec3 vLocal; in vec3 vWorld;
      out vec4 outColor;
      ${densityGLSL}
      void main() {
        vec3 ro = uCamLocal, rd = normalize(vLocal - uCamLocal);
        vec3 bmin = uCenter - 0.5 * uSize, bmax = uCenter + 0.5 * uSize;
        vec3 inv = 1.0 / (rd + vec3(1e-7));
        vec3 ta = (bmin - ro) * inv, tb = (bmax - ro) * inv;
        vec3 tmn = min(ta, tb), tmx = max(ta, tb);
        float t0 = max(max(tmn.x, tmn.y), max(tmn.z, 0.0));
        float t1 = min(min(tmx.x, tmx.y), tmx.z);
        t1 = min(t1, fxSceneDist());
        if (t1 <= t0) discard;
        float n = uSteps, dt = (t1 - t0) / n;
        float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
        float cosT = dot(rd, uSunLocal);
        float phase = mix(1.0, fxHG(cosT, 0.72) * 4.0 * FX_PI, 0.55);
        vec3 sun = fxSun(vWorld), amb = atmAmbient(vWorld, vec3(0.0, 1.0, 0.0));
        float T = 1.0; vec3 L = vec3(0.0);
        for (int i = 0; i < 40; i++) {
          if (float(i) >= n || T < 0.02) break;
          vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
          vec2 dl = density(p);            // x: density, y: sun-facing factor 0..1
          float s = dl.x * uSigma;
          if (s > 1e-4) {
            float a = 1.0 - exp(-s * dt);
            vec3 S = sun * phase * mix(0.55, 1.0, dl.y) / FX_PI + amb + fxLocal(vWorld) / FX_PI;
            L += T * a * S;
            T *= 1.0 - a;
          }
        }
        float alpha = 1.0 - T;
        if (alpha < 0.003) discard;
        outColor = fxFinish(L, alpha, vec3(0.0), vWorld);
      }`,
  });
}

const WING_GLSL = /* glsl */`
uniform vec4 uRoot; uniform vec4 uTip;   // x, y, zLE, chord
vec2 density(vec3 p) {
  float ax = abs(p.x);
  float s = (ax - uRoot.x) / (uTip.x - uRoot.x);
  if (s < 0.0 || s > 1.0) return vec2(0.0);
  float yW = mix(uRoot.y, uTip.y, s), zLE = mix(uRoot.z, uTip.z, s), c = mix(uRoot.w, uTip.w, s);
  float u = (p.z - zLE) / c;
  float h = p.y - yW;
  if (h < -0.04 * c || u < 0.0 || u > 1.8) return vec2(0.0);
  float thick = c * (0.03 + 0.12 * clamp(u, 0.0, 1.4));
  float d = smoothstep(0.04, 0.3, u) * (1.0 - smoothstep(0.95, 1.7, u)) * exp(-max(h, 0.0) / thick);
  d *= smoothstep(0.0, 0.12, s) * (1.0 - smoothstep(0.8, 1.0, s));
  // streaky, fast-streaming texture
  vec4 nz = fxNoise(vec3(p.x * 0.6, h * 1.8, p.z * 0.08 - uFlow));
  vec4 nz2 = fxNoise(vec3(p.x * 2.2, h * 5.0, p.z * 0.3 - uFlow * 2.3) + 0.5);
  float tex = nz.r * 0.6 + nz2.g * 0.7 - 0.25;
  // threshold rises as the amount falls → vapour shrinks toward the dense core
  d = clamp(d * (0.5 + tex) * 2.2 - (1.0 - uAmount) * 1.1, 0.0, 1.0);
  d = smoothstep(0.05, 0.6, d);
  return vec2(d, clamp(h / thick, 0.0, 1.0));
}`;

const LERX_GLSL = /* glsl */`
uniform vec3 uP0; uniform vec3 uP1; uniform vec3 uP2; uniform float uBurst;
float tube(vec3 p, vec3 a, vec3 b, float r0, float r1, float s0, out float sOut) {
  vec3 ab = b - a; float s = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
  vec3 c = a + ab * s; float r = mix(r0, r1, s);
  float d = length(p - c);
  sOut = s0 + s;
  float sw = fxNoise(vec3((s0 + s) * 3.0 - uFlow * 1.5, d / r, atan(p.y - c.y, p.x - c.x) * 0.3)).r;
  return exp(-(d * d) / (r * r) * (1.2 + sw)) * (0.5 + sw);
}
vec2 density(vec3 p) {
  vec3 q = vec3(abs(p.x), p.y, p.z);
  float s1, s2;
  float d1 = tube(q, uP0, uP1, 0.06, 0.22, 0.0, s1);
  float rb = mix(0.3, 0.9, uBurst);
  float d2 = tube(q, uP1, uP2, 0.22, rb, 1.0, s2);
  float d = max(d1 * smoothstep(0.0, 0.25, s1), d2 * (1.0 - smoothstep(1.4, 2.0, s2)));
  d = clamp(d * 1.5 - (1.0 - uAmount) * 1.2, 0.0, 1.0);
  return vec2(d, 0.6);
}`;

const CONE_GLSL = /* glsl */`
uniform float uZc; uniform float uR; uniform float uDepth;
vec2 density(vec3 p) {
  float r = length(p.xy);
  if (r > uR) return vec2(0.0);
  float rn = r / uR;
  vec4 nz = fxNoise(vec3(p.x * 0.3, p.y * 0.3, p.z * 0.1 - uFlow * 0.3));
  vec4 nz2 = fxNoise(vec3(p.xy * 0.9, p.z * 0.45) + 0.3);
  // conical shock front opening aft (half-angle ~55°), slightly bowed; condensation evaporates aft of it
  float zf = uZc + r * 0.72 + 0.12 * uR * rn * rn + (nz.g - 0.5) * 0.25;
  float z = p.z - zf;
  float front = smoothstep(-0.1, 0.06, z);
  float depth = uDepth * (0.35 + 0.8 * rn) * (0.5 + 1.0 * nz.b);
  float d = front * exp(-max(z, 0.0) / depth);
  float rim = 1.0 - smoothstep(0.62 + 0.3 * nz.r, 1.0, rn);
  d *= rim * smoothstep(0.04, 0.2, rn);
  d *= smoothstep(0.25, 0.8, 0.3 + 0.8 * nz.r * (0.5 + nz2.a));
  d = clamp(d * 1.3 - (1.0 - uAmount) * 1.0, 0.0, 1.0);
  return vec2(d, 0.7);
}`;

export function createVapor(ctx, shared, header, def, group) {
  const g = def.geometry || {};
  const L = g.length || 15, span = g.span || 10, H = g.height || 4;
  const fighter = ['fighter', 'attack'].includes(def.category);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const vols = [];
  const tip = g.wingtips?.[1] || [span / 2, 0, 0];
  const mc = (g.wingArea || span * L * 0.18) / span;
  const cr = mc * 1.45, ct = mc * 0.42;
  const xr = Math.max(0.45, L * 0.05), xt = Math.abs(tip[0]);
  const sweep = (fighter ? 40 : 27) * DEG;
  const tipLE = tip[2] - ct * 0.5;
  const rootLE = tipLE - (xt - xr) * Math.tan(sweep);
  const rootY = tip[1] - (xt - xr) * Math.tan((fighter ? 0 : 5) * DEG);

  function addVol(glsl, extra, center, size, sigma) {
    const m = makeMaterial(shared, header, glsl, extra);
    m.uniforms.uCenter.value.copy(center); m.uniforms.uSize.value.copy(size); m.uniforms.uSigma.value = sigma;
    const mesh = new THREE.Mesh(box, m);
    mesh.layers.set(LAYERS.POST); mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 15; mesh.name = 'fx-vapor';
    group.add(mesh);
    const v = { mesh, u: m.uniforms, amount: 0 };
    vols.push(v); return v;
  }
  // wing sheet
  const zMin = Math.min(rootLE, tipLE) - 0.3, zMax = Math.max(rootLE + cr, tipLE + ct) + cr * 0.8;
  const yMin = Math.min(rootY, tip[1]) - 0.2, yMax = Math.max(rootY, tip[1]) + cr * 0.45 + 0.3;
  const wing = addVol(WING_GLSL, {
    uRoot: { value: new THREE.Vector4(xr, rootY, rootLE, cr) }, uTip: { value: new THREE.Vector4(xt, tip[1], tipLE, ct) },
  }, new THREE.Vector3(0, (yMin + yMax) / 2, (zMin + zMax) / 2), new THREE.Vector3(2 * xt + 0.6, yMax - yMin, zMax - zMin), 5 / Math.max(1, cr / 3));
  // LERX vortices (fighters)
  let lerx = null;
  if (fighter) {
    const nz = g.noseZ ?? -L * 0.55, tz = g.tailZ ?? L * 0.45;
    const p0 = new THREE.Vector3(span * 0.05, H * 0.0, nz * 0.58);
    const p1 = new THREE.Vector3(span * 0.13, H * 0.05, rootLE + cr * 0.1);
    const p2 = new THREE.Vector3(span * 0.2, H * 0.12, tz * 0.75);
    lerx = addVol(LERX_GLSL, { uP0: { value: p0 }, uP1: { value: p1 }, uP2: { value: p2 }, uBurst: { value: 0 } },
      new THREE.Vector3(0, H * 0.06, (p0.z + p2.z) / 2), new THREE.Vector3(span * 0.5 + 2, H * 0.45 + 1.5, p2.z - p0.z + 1.5), 6);
  }
  // vapour cone
  const zc = (g.noseZ ?? -L * 0.55) * 0.18;
  const R = span * 0.58 + L * 0.04;
  const depth = L * 0.07;
  const zLen = 0.84 * R + depth * 4 + 0.8;
  const cone = addVol(CONE_GLSL, { uZc: { value: zc }, uR: { value: R }, uDepth: { value: depth } },
    new THREE.Vector3(0, 0, zc - 0.4 + zLen / 2), new THREE.Vector3(2 * R, 2 * R, zLen), 2.2);

  const inv = new THREE.Matrix4(), q = new THREE.Quaternion();
  let boom = 0, flow = 0;
  return {
    boom() { boom = 1; },
    update(dt, wingA, lerxA, coneA, s, camPos, quality) {
      boom = Math.max(0, boom - dt * 2.2);
      const tas = s?.tas || 0;
      flow += dt * tas * 0.06;
      // smooth amounts (vapour appears/disappears over ~0.15 s)
      const k = Math.min(1, dt * 7);
      wing.amount += (wingA - wing.amount) * k;
      if (lerx) lerx.amount += (lerxA - lerx.amount) * k;
      cone.amount += (Math.max(coneA, boom) - cone.amount) * Math.min(1, dt * 12);
      group.updateWorldMatrix(true, false);
      inv.copy(group.matrixWorld).invert();
      q.setFromRotationMatrix(group.matrixWorld).invert();
      const steps = Math.round(10 + 14 * (quality ?? 1));
      for (const v of vols) {
        v.mesh.visible = v.amount > 0.02;
        if (!v.mesh.visible) continue;
        v.u.uAmount.value = Math.min(1, v.amount);
        v.u.uFlow.value = flow;
        v.u.uSteps.value = steps;
        v.u.uCamLocal.value.copy(camPos).applyMatrix4(inv);
        v.u.uSunLocal.value.copy(ctx.env.sunDir).applyQuaternion(q);
      }
      if (lerx) lerx.u.uBurst.value = Math.min(1, Math.max(0, ((Math.abs(s?.aoa || 0) / DEG) - 22) / 12));
    },
    dispose() { for (const v of vols) { v.mesh.removeFromParent(); v.mesh.material.dispose(); } box.dispose(); },
  };
}
