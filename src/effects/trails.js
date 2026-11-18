// Volumetric tube trails (contrails, wingtip vortices, smoke trails).
// A trail is a ring buffer of points emitted by distance. Each SEGMENT (point i → i+1) is one instance of a
// camera-facing bounding quad; the fragment shader integrates a gaussian-profile tube analytically along the view
// ray (erf), clipped to the segment's slab and to the opaque scene depth. Result: correct optical depth from any
// angle — thin and crisp from the side, dense and round when looking straight down the trail from the chase camera —
// with no joints, no sorting and no overdraw artefacts at bends.
// Points grow (radius² ∝ age: turbulent diffusion), drift with the wind, sink (wake-vortex descent), migrate
// laterally toward the wing-tip vortex pair (multi-engine trails merge) and develop Crow-instability wobble.
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { premulMaterialOpts } from './fxglsl.js';

const STRIDE = 12;

export class Trail {
  /**
   * opts: { life, diff (m²/s), sink (m/s), formStart, formEnd (s), sigma, albedo [r,g,b], g (phase), mergeTau (s),
   *         wobble, spacingMin, spacingMax, maxDt, emissive [r,g,b] }
   */
  constructor(ctx, shared, header, anchor, capacity, opts = {}) {
    this.ctx = ctx; this.anchor = anchor; this.capacity = capacity; this.opts = opts;
    this.array = new Float32Array((capacity + 1) * STRIDE);
    for (let i = 0; i <= capacity; i++) this.array[i * STRIDE + 3] = -1e9;
    const buf = this.buffer = new THREE.InstancedInterleavedBuffer(this.array, STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    ['a0', 'a1', 'a2'].forEach((n, k) => g.setAttribute(n, new THREE.InterleavedBufferAttribute(buf, 4, k * 4)));
    ['b0', 'b1', 'b2'].forEach((n, k) => g.setAttribute(n, new THREE.InterleavedBufferAttribute(buf, 4, STRIDE + k * 4)));
    g.instanceCount = capacity;
    this.geometry = g;
    const alb = opts.albedo || [1, 1, 1], em = opts.emissive || [0, 0, 0];
    this.uniforms = {
      ...shared,
      uLife: { value: opts.life ?? 60 }, uDiff: { value: opts.diff ?? 40 }, uSink: { value: opts.sink ?? 1.5 },
      uForm: { value: new THREE.Vector2(opts.formStart ?? 0.15, opts.formEnd ?? 0.5) },
      uSigma: { value: opts.sigma ?? 1 }, uAlbedo: { value: new THREE.Color(...alb) }, uG: { value: opts.g ?? 0.7 },
      uMergeTau: { value: opts.mergeTau ?? 12 }, uWobble: { value: opts.wobble ?? 1 }, uEmissive: { value: new THREE.Color(...em) },
      uWindScale: { value: 1 },
    };
    this.material = new THREE.ShaderMaterial({ ...premulMaterialOpts(), uniforms: this.uniforms, vertexShader: header + VERT, fragmentShader: '#define FX_FRAG\n' + header + FRAG });
    const m = this.mesh = new THREE.Mesh(g, this.material);
    m.frustumCulled = false; m.layers.set(LAYERS.POST); m.renderOrder = 5; m.name = 'fx-trail';
    ctx.scene.add(m);
    this._unreg = anchor.register(this);
    this.head = 0;            // index of the LIVE point (being moved with the emitter)
    this.active = false;
    this.lastPos = new THREE.Vector3(); this.lastTime = 0; this.dist = 0;
    this.dirty = []; this.full = false;
    this._v = new THREE.Vector3();
  }
  _write(i, wp, strength, connect, w0, lat, merge) {
    const a = this.array, o = i * STRIDE, l = this.anchor.toLocal(wp, this._v);
    a[o] = l.x; a[o + 1] = l.y; a[o + 2] = l.z; a[o + 3] = this.ctx.time.now;
    a[o + 4] = strength; a[o + 5] = connect; a[o + 6] = this.dist; a[o + 7] = w0;
    a[o + 8] = lat ? lat.x : 0; a[o + 9] = lat ? lat.y : 0; a[o + 10] = lat ? lat.z : 0; a[o + 11] = merge || 0;
    if (i === 0) { for (let k = 0; k < STRIDE; k++) a[this.capacity * STRIDE + k] = a[k]; this.dirty.push(this.capacity); }
    this.dirty.push(i);
  }
  /** Emit this frame at world position wp. strength: optical-depth scale (0..1+), w0: initial radius (m),
   *  lat: world lateral unit vector (for merge/wobble), merge: lateral metres to migrate toward the vortex. */
  emit(wp, strength, w0, lat, merge = 0) {
    const now = this.ctx.time.now, o = this.opts;
    if (!this.active) {
      this.active = true; this.dist = 0;
      this.head = (this.head + 1) % this.capacity;
      this._write(this.head, wp, strength, 0, w0, lat, merge);       // anchor point
      this.lastPos.copy(wp); this.lastTime = now;
      this.head = (this.head + 1) % this.capacity;
      this._write(this.head, wp, strength, 1, w0, lat, merge);       // live point
      return;
    }
    const d = wp.distanceTo(this.lastPos);
    const spd = d / Math.max(1e-3, now - this.lastTime);
    const spacing = Math.min(o.spacingMax ?? 40, Math.max(o.spacingMin ?? 2, spd * (o.life ?? 60) / (this.capacity * 0.8)));
    const curDist = this.dist + d;
    if (d >= spacing || now - this.lastTime >= (o.maxDt ?? 0.5)) {
      // commit the live point here, open a new live point
      this.dist = curDist;
      this._write(this.head, wp, strength, 1, w0, lat, merge);
      this.lastPos.copy(wp); this.lastTime = now;
      this.head = (this.head + 1) % this.capacity;
      this._write(this.head, wp, strength, 1, w0, lat, merge);
    } else {
      const keep = this.dist; this.dist = curDist;
      this._write(this.head, wp, strength, 1, w0, lat, merge);
      this.dist = keep;
    }
  }
  /** End the current trail (the last point stays where it is). */
  stop() { this.active = false; }
  flush() {
    if (!this.dirty.length) return;
    const buf = this.buffer; buf.clearUpdateRanges();
    if (this.full) buf.addUpdateRange(0, (this.capacity + 1) * STRIDE);
    else for (const i of this.dirty) buf.addUpdateRange(i * STRIDE, STRIDE);
    buf.needsUpdate = true; this.dirty.length = 0; this.full = false;
  }
  rebase(d) {
    const a = this.array;
    for (let o = 0; o < a.length; o += STRIDE) { a[o] -= d.x; a[o + 2] -= d.z; }
    this.full = true; this.dirty.push(0);
  }
  clear() {
    for (let i = 0; i <= this.capacity; i++) this.array[i * STRIDE + 3] = -1e9;
    this.active = false; this.full = true; this.dirty.push(0);
  }
  dispose() { this._unreg(); this.ctx.scene.remove(this.mesh); this.geometry.dispose(); this.material.dispose(); }
}

const COMMON = /* glsl */`
uniform float uLife; uniform float uDiff; uniform float uSink; uniform vec2 uForm; uniform float uSigma;
uniform vec3 uAlbedo; uniform float uG; uniform float uMergeTau; uniform float uWobble; uniform vec3 uEmissive;
uniform float uWindScale;
`;

const VERT = COMMON + /* glsl */`
in vec4 a0; in vec4 a1; in vec4 a2; in vec4 b0; in vec4 b1; in vec4 b2;
flat out vec3 vA; flat out vec3 vB; flat out vec4 vR; flat out vec4 vS; // vR: rA rB distA distB, vS: sigA sigB ageA ageB
out vec3 vView;
void pointState(vec4 p0, vec4 p1, vec4 p2, out vec3 pos, out float r, out float sig, out float age) {
  age = uTime - p0.w;
  float w0 = max(p1.w, 0.05);
  r = sqrt(w0 * w0 + uDiff * age);
  float dist = p1.z;
  vec3 lat = p2.xyz;
  pos = p0.xyz + uFxAnchor + uFxWind * uWindScale * age;
  pos += lat * p2.w * (1.0 - exp(-age / max(uMergeTau, 0.1)));
  pos.y -= uSink * min(age, 45.0);
  // Crow-instability style wobble (grows with age), wavelength ~ 120 m
  float amp = uWobble * r * 0.35 * smoothstep(4.0, 40.0, age);
  float ph = dist * 0.0524 + p0.w * 0.0;
  pos += lat * sin(ph) * amp + vec3(0.0, cos(ph * 0.9) * amp * 0.6, 0.0);
  float form = smoothstep(uForm.x, uForm.y, age);
  float fade = 1.0 - smoothstep(uLife * 0.55, uLife, age);
  sig = p1.x * uSigma * form * fade * pow(w0 / r, 1.25);
}
void main() {
  bool ok = b1.y > 0.5 && b0.w >= a0.w && (uTime - a0.w) < uLife && (uTime - b0.w) >= 0.0;
  if (!ok) { gl_Position = vec4(0.0); return; }
  vec3 pa, pb; float ra, rb, sa, sb, aa, ab;
  pointState(a0, a1, a2, pa, ra, sa, aa);
  pointState(b0, b1, b2, pb, rb, sb, ab);
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
  vView = P;
  gl_Position = projectionMatrix * vec4(P, 1.0);
}`;

const FRAG = COMMON + /* glsl */`
flat in vec3 vA; flat in vec3 vB; flat in vec4 vR; flat in vec4 vS;
in vec3 vView;
out vec4 outColor;
float fxErf(float x) {
  float s = sign(x), a = abs(x); float t = 1.0 / (1.0 + 0.3275911 * a);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-a * a);
  return s * y;
}
void main() {
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
  // world position of the closest approach and its offset from the axis
  vec3 Pv = rd * tq;
  vec3 Av = A + u * (sc * L);
  vec3 Pw = (uCameraWorld * vec4(Pv, 1.0)).xyz;
  vec3 off = mat3(uCameraWorld) * (Pv - Av);
  float age = mix(vS.z, vS.w, sc);
  float dist = mix(vR.z, vR.w, sc);
  // lumpy, cauliflower structure: noise in tube space (along-trail distance, offset/r), evolving slowly
  vec3 nq = vec3(dist / (6.0 + r * 3.0), 0.0, age * 0.01) + off * ir * 0.3 + vec3(0.0, fract(vR.z * 1e-4), 0.0);
  vec4 nz = fxNoise(nq * 0.25);
  float lump = mix(1.0, 0.35 + 1.3 * nz.r * (0.6 + 0.8 * nz.a), clamp(age * 0.25, 0.25, 1.0));
  float edge = smoothstep(1.9, 0.4, sqrt(dmin2) * ir + (nz.g - 0.5) * 0.9);
  tau *= sig * lump * edge;
  float a = 1.0 - exp(-tau);
  if (a < 0.002) discard;
  vec3 n = normalize(off + vec3(0.0, 0.35 * r, 0.0));
  vec3 rdw = normalize(Pw - uCameraPos);
  vec3 lit = fxMediaLight(uAlbedo, Pw, n, rdw, clamp(tau * 0.5, 0.0, 1.0), uG);
  outColor = fxFinish(lit * a, a, uEmissive * a, Pw);
}`;
