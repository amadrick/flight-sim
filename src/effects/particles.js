// GPU particle system: one instanced draw call for thousands of camera-facing quads.
// Each particle is written ONCE (at spawn) into a pooled ring buffer: birth time, initial velocity, life, sizes,
// drag, buoyancy, colour, kind… The vertex shader integrates the motion analytically every frame
// (exponential relaxation toward wind + buoyancy, so smoke drifts with the wind, sparks fall ballistically).
// No per-frame CPU work besides uploading the freshly spawned slice. Positions are anchored (see anchor.js).
//
// kinds: 0 smoke/dust/spray (lit, premultiplied alpha)  1 fire (emissive, cools into dark smoke)
//        2 spark (additive, velocity-stretched streak)   3 glow (additive soft sprite, flashes)
//        4 vapour (lit, strongly forward-scattering, fast erosion)
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { premulMaterialOpts } from './fxglsl.js';

const STRIDE = 20;
export const KIND = { SMOKE: 0, FIRE: 1, SPARK: 2, GLOW: 3, VAPOR: 4 };

export class ParticleSystem {
  constructor(ctx, shared, header, anchor, capacity, name = 'fx-particles') {
    this.ctx = ctx; this.anchor = anchor; this.capacity = capacity;
    this.array = new Float32Array(capacity * STRIDE);
    for (let i = 0; i < capacity; i++) this.array[i * STRIDE + 3] = -1e9; // dead
    this.head = 0; this.pending = 0; this.full = false;
    const buf = this.buffer = new THREE.InstancedInterleavedBuffer(this.array, STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    for (let k = 0; k < 5; k++) g.setAttribute('i' + k, new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
    g.instanceCount = capacity;
    this.geometry = g;
    this.uniforms = { ...shared, uWindScale: { value: 1 } };
    this.material = new THREE.ShaderMaterial({
      ...premulMaterialOpts(), uniforms: this.uniforms,
      vertexShader: header + VERT, fragmentShader: '#define FX_FRAG\n' + header + FRAG,
    });
    const m = this.mesh = new THREE.Mesh(g, this.material);
    m.frustumCulled = false; m.layers.set(LAYERS.POST); m.name = name; m.renderOrder = 10;
    ctx.scene.add(m);
    this._unreg = anchor.register(this);
    this._v = new THREE.Vector3();
    // spawn parameters (mutate, then call spawn)
    this.p = { life: 2, size0: 1, size1: 3, drag: 1, buoy: 0, r: 0.8, g: 0.8, b: 0.8, opacity: 0.6, emissive: 0, kind: 0, aux: 0, delay: 0 };
  }
  /** Spawn one particle at a WORLD position with WORLD velocity using this.p. Returns slot index. */
  spawn(worldPos, vel) {
    const p = this.p, a = this.array, i = this.head, o = i * STRIDE;
    const l = this.anchor.toLocal(worldPos, this._v);
    a[o] = l.x; a[o + 1] = l.y; a[o + 2] = l.z; a[o + 3] = this.ctx.time.now + p.delay;
    a[o + 4] = vel.x; a[o + 5] = vel.y; a[o + 6] = vel.z; a[o + 7] = p.life;
    a[o + 8] = p.size0; a[o + 9] = p.size1; a[o + 10] = p.drag; a[o + 11] = p.buoy;
    a[o + 12] = p.r; a[o + 13] = p.g; a[o + 14] = p.b; a[o + 15] = p.opacity;
    a[o + 16] = p.emissive; a[o + 17] = Math.random(); a[o + 18] = p.kind; a[o + 19] = p.aux;
    this.head = (i + 1) % this.capacity; this.pending++;
    return i;
  }
  /** upload the slice written this frame */
  flush() {
    const n = this.pending; if (!n) return;
    const buf = this.buffer; buf.clearUpdateRanges();
    if (n >= this.capacity) buf.addUpdateRange(0, this.capacity * STRIDE);
    else {
      const start = (this.head - n + this.capacity) % this.capacity;
      if (start + n <= this.capacity) buf.addUpdateRange(start * STRIDE, n * STRIDE);
      else { buf.addUpdateRange(start * STRIDE, (this.capacity - start) * STRIDE); buf.addUpdateRange(0, this.head * STRIDE); }
    }
    buf.needsUpdate = true; this.pending = 0;
  }
  rebase(d) {
    const a = this.array;
    for (let o = 0; o < a.length; o += STRIDE) { a[o] -= d.x; a[o + 2] -= d.z; }
    this.pending = this.capacity;
  }
  clear() {
    for (let i = 0; i < this.capacity; i++) this.array[i * STRIDE + 3] = -1e9;
    this.pending = this.capacity;
  }
  dispose() { this._unreg(); this.ctx.scene.remove(this.mesh); this.geometry.dispose(); this.material.dispose(); }
}

const VERT = /* glsl */`
in vec4 i0; in vec4 i1; in vec4 i2; in vec4 i3; in vec4 i4;
uniform float uWindScale;
out vec2 vUv; out vec2 vCorner; out vec3 vPos; out float vDist; out float vSize;
out vec4 vColor; out vec4 vData; out vec4 vMask;
void main() {
  float age = uTime - i0.w, life = i1.w, t = age / life;
  if (age < 0.0 || t >= 1.0) { gl_Position = vec4(0.0); return; }
  float kind = i4.z, seed = i4.y;
  float k = max(i2.z, 0.02);
  vec3 vt = uFxWind * uWindScale + vec3(0.0, i2.w, 0.0);
  float ek = exp(-k * age);
  vec3 p = i0.xyz + uFxAnchor + vt * age + (i1.xyz - vt) * (1.0 - ek) / k;
  vec3 vel = vt + (i1.xyz - vt) * ek;
  float g = 1.0 - (1.0 - t) * (1.0 - t);
  float size = mix(i2.x, i2.y, kind == 1.0 ? sqrt(t) : g);
  if (kind < 1.5 || kind > 3.5) {   // lazy turbulent wander for media
    float s6 = seed * 6.2832;
    p += size * 0.18 * vec3(sin(age * 0.9 + s6), 0.5 * sin(age * 0.7 + s6 * 2.0), cos(age * 0.8 + s6 * 3.0));
  }
  vec4 vc = viewMatrix * vec4(p, 1.0);
  vec2 c = position.xy;
  vCorner = c;
  if (kind == 2.0) {
    // spark: quad stretched along the view-space velocity (motion blur streak of length |v|*aux)
    vec3 vv = mat3(viewMatrix) * vel * max(i4.w, 0.005);
    vec3 dir = length(vv) > 1e-4 ? vv : vec3(0.0, 0.001, 0.0);
    vec3 side = normalize(cross(dir, vc.xyz) + vec3(1e-6, 0.0, 0.0)) * size;
    vc.xyz += dir * (c.y * 0.5) + side * c.x;
  } else {
    float ang = seed * 6.2832 + age * (seed - 0.5) * (kind == 1.0 ? 1.4 : 0.6);
    float ca = cos(ang), sa = sin(ang);
    vec2 rc = vec2(ca * c.x - sa * c.y, sa * c.x + ca * c.y);
    vc.xy += c * size;
    c = rc;
  }
  vUv = c;
  vPos = (uCameraWorld * vec4(vc.xyz, 1.0)).xyz;
  vDist = length(vc.xyz); vSize = size;
  // opacity envelope
  float fin = kind == 3.0 ? 1.0 : smoothstep(0.0, kind == 1.0 ? 0.02 : 0.06, t);
  float fout = 1.0 - smoothstep(kind == 2.0 ? 0.3 : 0.45, 1.0, t);
  float nearFade = smoothstep(0.6, 0.6 + size * 1.2, -vc.z);
  vColor = vec4(i3.rgb, i3.a * fin * fout * nearFade);
  vData = vec4(t, i4.x, kind, seed);
  float v = floor(seed * 2.999);
  vMask = vec4(v == 0.0 ? 1.0 : 0.0, v == 1.0 ? 1.0 : 0.0, v == 2.0 ? 1.0 : 0.0, 0.0);
  gl_Position = projectionMatrix * vc;
}`;

const FRAG = /* glsl */`
in vec2 vUv; in vec2 vCorner; in vec3 vPos; in float vDist; in float vSize;
in vec4 vColor; in vec4 vData; in vec4 vMask;
out vec4 outColor;
void main() {
  float r2 = dot(vCorner, vCorner);
  if (r2 >= 1.0 && vData.z != 2.0) discard;
  float sd = fxSceneDist();
  if (vDist > sd + vSize * 0.25) discard;                       // manual occlusion
  float soft = clamp((sd - vDist) / max(vSize * 0.6, 0.3) + 0.25, 0.0, 1.0);
  float t = vData.x, kind = vData.z;
  vec4 tex = texture(tFxPuff, vUv * 0.5 + 0.5);
  if (kind == 2.0 || kind == 3.0) {
    float core = kind == 2.0 ? exp(-vCorner.x * vCorner.x * 6.0) * (1.0 - smoothstep(0.6, 1.0, abs(vCorner.y))) : tex.a;
    float cool = kind == 2.0 ? mix(1.0, 0.35, t) : 1.0 - t;
    vec3 e = vColor.rgb * mix(vec3(1.0, 0.55, 0.3), vec3(1.0), cool) * vData.y * core * vColor.a * soft * cool;
    outColor = fxFinish(vec3(0.0), 0.0, e, vPos);
    return;
  }
  float dens = dot(tex, vMask);
  float er = t * (kind == 4.0 ? 0.8 : 0.5);
  dens = clamp((dens - er) / (1.0 - er), 0.0, 1.0);
  float a = dens * vColor.a * soft;
  if (a < 0.002) discard;
  vec3 n = normalize(mat3(uCameraWorld) * vec3(vCorner, sqrt(max(1.0 - r2, 0.0)) + 0.3));
  vec3 rd = normalize(vPos - uCameraPos);
  vec3 albedo = vColor.rgb;
  vec3 emis = vec3(0.0);
  if (kind == 1.0) {
    // fire: hot rolling core that cools (white-yellow → orange → red) and turns into dark smoke
    float heat = exp(-t * 3.6);
    float temp = clamp(heat * (0.2 + 0.95 * dens) * (0.55 + 0.8 * tex.g), 0.0, 1.0);
    emis = fxFlame(temp) * vData.y * temp * temp * temp * dens * soft * vColor.a;
    a *= mix(0.45, 1.0, smoothstep(0.05, 0.35, t));
    albedo *= mix(0.3, 1.0, smoothstep(0.1, 0.5, t));
  }
  vec3 lit = fxMediaLight(albedo, vPos, n, rd, dens, kind == 4.0 ? 0.75 : 0.35);
  outColor = fxFinish(lit * a, a, emis, vPos);
}`;
