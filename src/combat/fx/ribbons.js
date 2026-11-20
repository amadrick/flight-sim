// Pooled volumetric tube trails for every combat trail at once — ONE instanced draw.
// Same optical model as src/effects/trails.js (gaussian-profile tube integrated analytically along the view ray with
// erf, clipped to the segment slab and the scene depth; lit by sun/moon/ambient/fire light; aerial perspective), but:
//   * many trails share one buffer (ribbon-pool.js), so 40 trails cost one draw call;
//   * per-point style (life, diffusion, density, albedo, emission…) from a small uniform table, plus a per-point shade
//     (grey → soot black) and heat (emission near the source: motor-lit missile smoke, burning-fuel trails, flare glow);
//   * isotropic turbulent wander that grows with age (twisting, corkscrewing missile smoke) instead of the contrail's
//     lateral vortex merge; hot smoke can rise.
import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import { premulMaterialOpts } from '../../effects/fxglsl.js';
import { RibbonPool, Ribbon, STRIDE } from './ribbon-pool.js';

// style table — index = STYLE.*; A: life, diff (m²/s), sink (m/s), sigma (optical depth at birth through the axis)
//               B: formStart, formEnd (s), wobble, phase g;  C: albedo rgb, lumpiness;  D: emission rgb, tau (s)
export const STYLE = { MISSILE: 0, DAMAGE: 1, FIRE: 2, FLARE: 3, CONTRAIL: 4, WINGTIP: 5, DEBRIS: 6, LAUNCH: 7, LEAK: 8 };
const STYLES = [
  /* MISSILE  */ { A: [18, 5.5, 0.25, 3.2], B: [0.0, 0.06, 1.0, 0.62], C: [0.93, 0.93, 0.94, 0.9], D: [1.0, 0.62, 0.32, 0.02], E: 40 },
  /* DAMAGE   */ { A: [12, 3.5, -0.6, 1.8], B: [0.0, 0.05, 0.6, 0.45], C: [0.55, 0.55, 0.56, 1.0], D: [1.0, 0.42, 0.12, 0.05], E: 4 },
  /* FIRE     */ { A: [22, 7.0, -1.4, 3.6], B: [0.0, 0.04, 0.8, 0.40], C: [0.07, 0.065, 0.06, 1.1], D: [1.0, 0.40, 0.10, 0.06], E: 6 },
  /* FLARE    */ { A: [7.5, 2.2, 0.6, 2.4], B: [0.0, 0.05, 0.7, 0.60], C: [0.95, 0.95, 0.96, 0.9], D: [1.0, 0.90, 0.78, 0.12], E: 20 },
  /* CONTRAIL */ { A: [45, 5.0, 1.6, 3.0], B: [0.05, 0.35, 0.4, 0.72], C: [1.0, 1.0, 1.0, 0.8], D: [0, 0, 0, 1], E: 0 },
  /* WINGTIP  */ { A: [1.6, 0.03, 0.4, 0.8], B: [0.0, 0.08, 0.0, 0.75], C: [1.0, 1.0, 1.0, 0.3], D: [0, 0, 0, 1], E: 0 },
  /* DEBRIS   */ { A: [9, 2.5, -0.5, 2.6], B: [0.0, 0.04, 0.7, 0.40], C: [0.09, 0.085, 0.08, 1.0], D: [1.0, 0.45, 0.12, 0.1], E: 6 },
  /* LAUNCH   */ { A: [10, 4.0, 0.2, 2.2], B: [0.0, 0.05, 0.8, 0.60], C: [0.9, 0.9, 0.9, 0.9], D: [1.0, 0.6, 0.3, 0.05], E: 60 },
  /* LEAK     */ { A: [3.5, 0.8, 0.2, 0.9], B: [0.0, 0.03, 0.2, 0.75], C: [0.97, 0.97, 1.0, 0.5], D: [0, 0, 0, 1], E: 0 },
];
export const STYLE_LIFE = STYLES.map((s) => s.A[0]);

export function createRibbons(ctx, sharedU, header, anchor, opts = {}) {
  const pool = new RibbonPool([
    { name: 'long', count: opts.long ?? 32, points: opts.longPoints ?? 256 },
    { name: 'short', count: opts.short ?? 64, points: opts.shortPoints ?? 64 },
  ]);
  const buf = new THREE.InstancedInterleavedBuffer(pool.array, STRIDE, 1);
  buf.setUsage(THREE.DynamicDrawUsage);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  ['a0', 'a1', 'a2'].forEach((n, k) => g.setAttribute(n, new THREE.InterleavedBufferAttribute(buf, 4, k * 4)));
  ['b0', 'b1', 'b2'].forEach((n, k) => g.setAttribute(n, new THREE.InterleavedBufferAttribute(buf, 4, STRIDE + k * 4)));
  g.instanceCount = pool.records - 1;
  const N = STYLES.length;
  const uniforms = {
    ...sharedU,
    uSA: { value: STYLES.map((s) => new THREE.Vector4(...s.A)) },
    uSB: { value: STYLES.map((s) => new THREE.Vector4(...s.B)) },
    uSC: { value: STYLES.map((s) => new THREE.Vector4(...s.C)) },
    uSD: { value: STYLES.map((s) => new THREE.Vector4(s.D[0] * s.E, s.D[1] * s.E, s.D[2] * s.E, s.D[3]).multiplyScalar(ctx.params?.raw?.cfxnoemis ? 0 : 1).setW(s.D[3])) },
  };
  const material = new THREE.ShaderMaterial({
    ...premulMaterialOpts(), uniforms,
    defines: { N_STYLES: N },
    vertexShader: header + VERT, fragmentShader: '#define FX_FRAG\n' + header + FRAG,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false; mesh.layers.set(LAYERS.POST); mesh.renderOrder = 6; mesh.name = 'cfx-ribbons';
  mesh.visible = false;
  ctx.scene.add(mesh);
  const unreg = anchor.register({ rebase: (d) => pool.rebase(d.x, d.z) });
  let uploadFn = (start, count) => buf.addUpdateRange(start * STRIDE, count * STRIDE);

  const sys = {
    pool, mesh, uniforms, styles: STYLES,
    /** new emitter. cls 'long' | 'short'; style picks the default life. */
    ribbon(cls, style, o = {}) {
      const life = o.life ?? STYLE_LIFE[style];
      return new Ribbon(pool, cls, { life, spacingMin: o.spacingMin ?? 2, spacingMax: o.spacingMax ?? 40, maxDt: o.maxDt ?? 0.35 });
    },
    /** emit at a WORLD position (doubles). shade 0..1 darkens toward soot. */
    emit(rb, wp, strength, w0, heat, rise, style, shade = 0) {
      const a = anchor.world;
      return rb.emit(wp.x - a.x, wp.y, wp.z - a.z, ctx.time.now, strength, w0, heat, rise, style + Math.min(0.99, Math.max(0, shade)));
    },
    flush() {
      mesh.visible = ctx.time.now < pool.busyUntil();
      let any = false;
      buf.clearUpdateRanges();
      pool.drainDirty((s, c) => { any = true; uploadFn(s, c); });
      if (any) buf.needsUpdate = true;
    },
    clear() { pool.clear(); mesh.visible = false; },
    dispose() { unreg(); ctx.scene.remove(mesh); g.dispose(); material.dispose(); },
  };
  return sys;
}

const COMMON = /* glsl */`
uniform vec4 uSA[N_STYLES]; uniform vec4 uSB[N_STYLES]; uniform vec4 uSC[N_STYLES]; uniform vec4 uSD[N_STYLES];
`;

const VERT = COMMON + /* glsl */`
in vec4 a0; in vec4 a1; in vec4 a2; in vec4 b0; in vec4 b1; in vec4 b2;
flat out vec3 vA; flat out vec3 vB; flat out vec4 vR; flat out vec4 vS;   // vR: rA rB distA distB   vS: sigA sigB ageA ageB
flat out vec4 vH;                                                         // heatA heatB seed style
flat out vec3 vSun; flat out vec3 vAmbUp; flat out vec3 vAmbDn; flat out vec4 vApA; flat out vec4 vApB; flat out vec3 vAlb;
out vec3 vView;
void pointState(vec4 p0, vec4 p1, vec4 p2, vec4 A, vec4 B, out vec3 pos, out float r, out float sig, out float age) {
  age = uTime - p0.w;
  float w0 = max(p1.w, 0.05);
  r = sqrt(w0 * w0 + A.y * age);
  float dist = p1.z, seed = p2.y;
  pos = p0.xyz + uFxAnchor + uFxWind * age;
  pos.y += (p2.z - A.z) * min(age, 40.0);
  // turbulent wander: smooth in the along-trail distance (continuous across segments), growing with age —
  // the corkscrew / meander of a real missile trail a few seconds after the missile has passed
  float amp = B.z * (0.3 * r + 0.35 * min(age, 12.0));
  float ph = dist * 0.021 + seed * 40.0, ph2 = dist * 0.0067 + seed * 17.0;
  pos += vec3(sin(ph) + 0.6 * sin(ph2 * 1.3), 0.7 * cos(ph * 1.27 + 1.0) + 0.5 * sin(ph2), cos(ph * 0.83 + 2.0) + 0.6 * cos(ph2)) * amp * 0.6;
  float form = smoothstep(B.x, B.y + 1e-3, age);
  float fade = 1.0 - smoothstep(A.x * 0.45, A.x, age);
  sig = p1.x * A.w * form * fade * pow(w0 / r, 0.45) / (1.7725 * r);
}
void main() {
  int st = int(a2.w);
  vec4 SA = uSA[st], SB = uSB[st];
  bool ok = a1.y > 0.5 && b1.y == a1.y && b0.w >= a0.w && (uTime - a0.w) < SA.x && (uTime - b0.w) >= 0.0;
  if (!ok) { gl_Position = vec4(0.0); return; }
  vec3 pa, pb; float ra, rb, sa, sb, aa, ab;
  pointState(a0, a1, a2, SA, SB, pa, ra, sa, aa);
  pointState(b0, b1, b2, SA, SB, pb, rb, sb, ab);
  if (sa + sb <= 0.0) { gl_Position = vec4(0.0); return; }
  vec3 va = (viewMatrix * vec4(pa, 1.0)).xyz, vb = (viewMatrix * vec4(pb, 1.0)).xyz;
  float zn = -0.55;
  if (va.z > zn && vb.z > zn) { gl_Position = vec4(0.0); return; }
  vec3 ca = va, cb = vb;
  if (ca.z > zn) ca = mix(va, vb, (va.z - zn) / (va.z - vb.z));
  if (cb.z > zn) cb = mix(vb, va, (vb.z - zn) / (vb.z - va.z));
  vec2 sA = ca.xy / -ca.z, sB = cb.xy / -cb.z;
  vec2 d = sB - sA; float dl = length(d);
  vec2 dir = dl > 1e-7 ? d / dl : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  bool isB = position.y > 0.0;
  vec3 P = isB ? cb : ca;
  float r = (isB ? rb : ra) * 2.4;
  P.xy += (perp * position.x + dir * position.y) * r;
  vA = va; vB = vb; vR = vec4(ra, rb, a1.z, b1.z); vS = vec4(sa, sb, aa, ab);
  vH = vec4(a2.x, b2.x, a2.y, float(st));
  vec3 pm = 0.5 * (pa + pb);
  vSun = fxSun(pm); vAmbUp = atmAmbient(pm, vec3(0.0, 1.0, 0.0)); vAmbDn = atmAmbient(pm, vec3(0.0, -1.0, 0.0));
  vApA = fxAP(pa); vApB = fxAP(pb);
  float shade = fract(a2.w);
  vAlb = mix(uSC[st].rgb, vec3(0.045, 0.042, 0.04), shade);
  vView = P;
  gl_Position = projectionMatrix * vec4(P, 1.0);
}`;

const FRAG = COMMON + /* glsl */`
flat in vec3 vA; flat in vec3 vB; flat in vec4 vR; flat in vec4 vS; flat in vec4 vH;
flat in vec3 vSun; flat in vec3 vAmbUp; flat in vec3 vAmbDn; flat in vec4 vApA; flat in vec4 vApB; flat in vec3 vAlb;
in vec3 vView;
out vec4 outColor;
float fxErf(float x) {
  float s = sign(x), a = abs(x); float t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
void main() {
  int st = int(vH.w);
  vec3 rd = normalize(vView);
  vec3 A = vA, u = vB - vA; float L = max(length(u), 1e-4); u /= L;
  float b = dot(rd, u), aU = dot(A, u);
  float al = max(1.0 - b * b, 1e-7);
  float be = dot(rd, A) - b * aU;
  float ga = dot(A, A) - aU * aU;
  float tc = be / al;
  float dmin2 = max(ga - be * be / al, 0.0);
  float t0, t1;
  if (abs(b) < 1e-5) { if (-aU < 0.0 || -aU > L) discard; t0 = 0.0; t1 = 1e9; }
  else { float ta = aU / b, tb = (aU + L) / b; t0 = min(ta, tb); t1 = max(ta, tb); }
  t0 = max(t0, 0.0);
  t1 = min(t1, fxSceneDist());
  if (t1 <= t0) discard;
  float tq = clamp(tc, t0, t1);
  float sc = clamp((tq * b - aU) / L, 0.0, 1.0);
  float r = mix(vR.x, vR.y, sc), sig = mix(vS.x, vS.y, sc);
  float ir = 1.0 / r, sal = sqrt(al);
  float g0 = exp(-dmin2 * ir * ir);
  if (g0 < 1e-3) discard;
  float tau;
  if (sal * (t1 - t0) * ir < 0.03) { float dt = 0.5 * (t0 + t1) - tc; tau = exp(-(al * dt * dt + dmin2) * ir * ir) * (t1 - t0); }
  else tau = g0 * r / sal * 0.8862269 * (fxErf(sal * (t1 - tc) * ir) - fxErf(sal * (t0 - tc) * ir));
  vec3 Pv = rd * tq;
  vec3 Pw = (uCameraWorld * vec4(Pv, 1.0)).xyz;
  vec3 off = mat3(uCameraWorld) * (Pv - (A + u * (tq * b - aU)));
  float age = mix(vS.z, vS.w, sc);
  float dist = mix(vR.z, vR.w, sc);
  // billowy structure in tube space, evolving with age; stronger as the trail ages and breaks up
  vec3 nq = vec3(dist / (4.0 + r * 2.5), 0.0, age * 0.03) + off * ir * 0.35 + vec3(0.0, vH.z * 7.0, vH.z * 3.0);
  vec4 nz = fxNoise(nq * 0.25);
  vec4 nz2 = fxNoise(nq * 0.61 + 0.37);
  float lumpK = uSC[st].a * clamp(0.25 + age / 10.0, 0.25, 0.9);
  float lump = mix(1.0, 0.3 + 1.25 * nz.r * (0.55 + 0.9 * nz2.a), lumpK);
  float edge = smoothstep(1.9, 0.35, sqrt(dmin2) * ir + (nz.g - 0.5) * 1.1 + (nz2.b - 0.5) * 0.5);
  tau *= sig * lump * edge;
  float a = 1.0 - exp(-tau);
  if (a < 0.002) discard;
  vec3 rdw = normalize(Pw - uCameraPos);
  vec3 n = normalize(off * ir * 0.8 - rdw * 0.6 + vec3(0.0, 0.25, 0.0));
  vec3 lit = fxMediaLightPre(vAlb, vSun, vAmbUp, vAmbDn, Pw, n, rdw, clamp(tau * 0.5, 0.0, 1.0), uSB[st].w);
  // emission near the source: hot exhaust / burning fuel / flare light scattered by its own smoke
  vec4 SD = uSD[st];
  float heat = mix(vH.x, vH.y, sc);
  float ar = age / max(SD.w, 1e-3);
  float hk = heat * exp(-ar * ar);   // gaussian: gone within a segment or two (segments can be tens of metres long)
  vec3 emis = SD.rgb * hk * a * (0.6 + 0.8 * nz.r);
  // flame colour cools with age (yellow-white → orange → deep red)
  emis *= mix(vec3(0.75, 0.35, 0.25), vec3(1.0), exp(-age / max(SD.w * 0.6, 1e-3)));
  outColor = fxFinishAP(lit * a, a, emis, mix(vApA, vApB, sc));
}`;
