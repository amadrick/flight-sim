// Ground decals for crashes: scorch / crater, ejecta, belly-scrape and skid marks, torn turf, foam on water.
// Deferred projection: each decal is an oriented box (yaw only); its fragments reconstruct the scene position from
// the depth buffer and draw where that position falls inside the box. One instanced draw on LAYERS.POST, drawn
// after the composite, so a decal REPLACES the fogged ground colour with its own lit, fogged colour
// (premultiplied: rgb = lit * a * T_ap + inscatter * a, alpha = a).
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { premulMaterialOpts } from './fxglsl.js';

export const DECAL = { SCORCH: 0, CRATER: 1, SCRAPE: 2, TURF: 3, FOAM: 4, SKID: 5, FIRELIGHT: 6 };
const STRIDE = 12;

export class Decals {
  constructor(ctx, shared, header, anchor, capacity = 768) {
    this.ctx = ctx; this.anchor = anchor; this.capacity = capacity;
    this.array = new Float32Array(capacity * STRIDE);
    this.count = 0; this.head = 0;
    const buf = this.buffer = new THREE.InstancedInterleavedBuffer(this.array, STRIDE, 1);
    buf.setUsage(THREE.DynamicDrawUsage);
    const box = new THREE.BoxGeometry(2, 2, 2);
    const g = new THREE.InstancedBufferGeometry();
    g.index = box.index; g.setAttribute('position', box.getAttribute('position'));
    g.setAttribute('d0', new THREE.InterleavedBufferAttribute(buf, 4, 0));   // centre (anchored local), yaw
    g.setAttribute('d1', new THREE.InterleavedBufferAttribute(buf, 4, 4));   // half length, half width, half height, type
    g.setAttribute('d2', new THREE.InterleavedBufferAttribute(buf, 4, 8));   // birth time, seed, strength, fade time
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = { ...shared };
    this.material = new THREE.ShaderMaterial({
      ...premulMaterialOpts(), side: THREE.BackSide, depthTest: false, uniforms: this.uniforms,
      vertexShader: header + VERT, fragmentShader: '#define FX_FRAG\n' + header + FRAG,
    });
    const m = this.mesh = new THREE.Mesh(g, this.material);
    m.frustumCulled = false; m.layers.set(LAYERS.POST); m.renderOrder = 5; m.name = 'fx-decals'; m.visible = false;
    ctx.scene.add(m);
    this._unreg = anchor.register(this);
    this._v = new THREE.Vector3();
  }
  /** Add a decal at a WORLD position. yaw = heading of the long axis (rad, 0 = north / -Z). */
  add(worldPos, yaw, halfLen, halfWid, type, strength = 1, fade = 0, halfH = 0) {
    const a = this.array, i = this.head, o = i * STRIDE;
    const l = this.anchor.toLocal(worldPos, this._v);
    a[o] = l.x; a[o + 1] = l.y; a[o + 2] = l.z; a[o + 3] = yaw;
    a[o + 4] = halfLen; a[o + 5] = halfWid; a[o + 6] = halfH || Math.max(2.5, 0.5 * Math.max(halfLen, halfWid)); a[o + 7] = type;
    a[o + 8] = this.ctx.time.now; a[o + 9] = Math.random(); a[o + 10] = strength; a[o + 11] = fade;
    this.head = (i + 1) % this.capacity; this.count = Math.min(this.count + 1, this.capacity);
    this.geometry.instanceCount = this.count; this.mesh.visible = true;
    this.buffer.needsUpdate = true;
    return i;
  }
  rebase(d) { const a = this.array; for (let o = 0; o < a.length; o += STRIDE) { a[o] -= d.x; a[o + 2] -= d.z; } this.buffer.needsUpdate = true; }
  clear() { this.count = 0; this.head = 0; this.geometry.instanceCount = 0; this.mesh.visible = false; }
  dispose() { this._unreg(); this.ctx.scene.remove(this.mesh); this.geometry.dispose(); this.material.dispose(); }
}

const VERT = /* glsl */`
in vec4 d0; in vec4 d1; in vec4 d2;
flat out vec4 vD0; flat out vec4 vD1; flat out vec4 vD2; out vec3 vPos;
void main() {
  vD0 = d0; vD1 = d1; vD2 = d2;
  float c = cos(d0.w), s = sin(d0.w);
  // local: x = across (right), z = along (heading), y = up
  vec3 l = position * vec3(d1.y, d1.z, d1.x);
  vec3 along = vec3(s, 0.0, -c), across = vec3(c, 0.0, s);
  vec3 p = d0.xyz + uFxAnchor + across * l.x + vec3(0.0, l.y, 0.0) + along * l.z;
  vPos = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
flat in vec4 vD0; flat in vec4 vD1; flat in vec4 vD2; in vec3 vPos;
out vec4 outColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float d = sceneDepthRaw(uv);
  if (depthIsSky(d)) discard;
  vec3 P = renderPosFromDepth(uv, d);
  vec3 o = vD0.xyz + uFxAnchor;
  float c = cos(vD0.w), s = sin(vD0.w);
  vec3 along = vec3(s, 0.0, -c), across = vec3(c, 0.0, s);
  vec3 r = P - o;
  vec3 q = vec3(dot(r, across) / vD1.y, r.y / vD1.z, dot(r, along) / vD1.x);
  if (any(greaterThan(abs(q), vec3(1.0)))) discard;
  float type = vD1.w, seed = vD2.y, age = uTime - vD2.x;
  float fadeT = vD2.w;
  float life = fadeT > 0.0 ? clamp(1.0 - age / fadeT, 0.0, 1.0) : 1.0;
  if (life <= 0.0) discard;
  vec2 wxz = P.xz - uFxAnchor.xz;               // anchored world xz (stable noise)
  vec4 n = fxNoise(vec3(wxz * 0.11, seed * 7.0));
  vec4 n2 = fxNoise(vec3(wxz * 0.47, seed * 3.0 + 0.5));
  float rr = length(q.xz);
  if (type > 5.5) {            // fire light sheen: glossy reflection of the fire (fx light) on the ground around it
    // The engine's ground is a rough diffuse surface, so a low fire at night lit it only at grazing incidence and the
    // runway stayed black; real pavement and grass have a broad specular lobe at grazing angles (GGX, roughness
    // ~0.55, F0 0.04, Schlick Fresnel), which is the orange sheen under a fire in night footage.
    vec3 Nf = normalize(cross(dFdy(P), dFdx(P))); if (Nf.y < 0.0) Nf = -Nf;
    vec3 Ld = uFxLightPos - P; float dl2 = dot(Ld, Ld); Ld *= inversesqrt(dl2);
    vec3 V = normalize(uCameraPos - P), H = normalize(Ld + V);
    float nl = max(dot(Nf, Ld), 0.0), nv = max(dot(Nf, V), 1e-3), nh = max(dot(Nf, H), 0.0), vh = max(dot(V, H), 0.0);
    float al = 0.3, a2 = al * al;
    float dd = nh * nh * (a2 - 1.0) + 1.0, Dg = a2 / (FX_PI * dd * dd);
    float k = al * 0.5, Gv = nv / (nv * (1.0 - k) + k), Gl = nl / (nl * (1.0 - k) + k);
    float F = 0.04 + 0.96 * pow(1.0 - vh, 5.0);
    vec3 E = 2.0 * uFxLightColor / (dl2 + 25.0);
    vec3 spec = E * Dg * F * Gv * Gl / (4.0 * nv) * vD2.z * (1.0 - smoothstep(0.7, 1.0, rr));
    // + a little diffuse wrap: the fire is a volume tens of metres across, not a point, so ground near it is lit
    // closer to normal incidence than the point light gives
    spec += E * 0.12 / FX_PI * max(0.35 - nl, 0.0) * (1.0 - smoothstep(0.0, 0.5, rr)) * vD2.z;
    if (dot(spec, vec3(1.0)) * uFxExposure < 1e-4) discard;
    vec4 ap = fxAP(P);
    outColor = vec4(spec * ap.a, 0.0);
    return;
  }
  float a = 0.0; vec3 alb = vec3(0.05);
  float yFade = 1.0 - smoothstep(0.6, 1.0, abs(q.y));
  if (type < 0.5) {            // scorch: soot-blackened ground, ragged edge, darker centre
    float edge = 1.0 - smoothstep(0.55 + 0.35 * n.x, 1.0, rr + 0.25 * (n2.x - 0.5));
    a = edge * (0.75 + 0.25 * n2.y);
    alb = mix(vec3(0.035, 0.032, 0.03), vec3(0.09, 0.075, 0.06), smoothstep(0.3, 0.95, rr) * n.y);
  } else if (type < 1.5) {     // crater: dark pit + brown ejecta ring with streaks
    float ang = atan(q.z, q.x);
    float streak = 0.6 + 0.4 * fxNoise(vec3(ang * 1.6, seed * 5.0, 0.3)).x;
    float pit = 1.0 - smoothstep(0.22, 0.42 + 0.08 * n.x, rr);
    float ring = smoothstep(0.25, 0.45, rr) * (1.0 - smoothstep(0.5, 1.0 * streak, rr + 0.2 * (n2.x - 0.5)));
    a = max(pit, ring * 0.9);
    alb = mix(vec3(0.20, 0.16, 0.11) * (0.7 + 0.5 * n2.y), vec3(0.03, 0.028, 0.025), pit);
  } else if (type < 2.5) {     // belly scrape on pavement: grey-black abrasion, streaky along the slide
    float acrossF = 1.0 - smoothstep(0.55, 1.0, abs(q.x) + 0.2 * (n2.x - 0.5));
    float st = 0.55 + 0.45 * fxNoise(vec3(q.x * 3.0 + seed, wxz.y * 0.02, 0.7)).x;
    float ends = 1.0 - smoothstep(0.85, 1.0, abs(q.z));
    a = acrossF * st * ends * 0.85;
    alb = vec3(0.07, 0.07, 0.072) * (0.8 + 0.4 * n2.y);
  } else if (type < 3.5) {     // torn turf / ploughed earth: brown furrow with clods
    float acrossF = 1.0 - smoothstep(0.45, 1.0, abs(q.x) + 0.35 * (n.x - 0.5));
    float ends = 1.0 - smoothstep(0.8, 1.0, abs(q.z));
    a = acrossF * ends * (0.7 + 0.3 * n2.x);
    alb = mix(vec3(0.16, 0.12, 0.08), vec3(0.10, 0.08, 0.055), n2.y);
  } else if (type < 4.5) {     // foam / slick on water
    float edge = 1.0 - smoothstep(0.5 + 0.3 * n.x, 1.0, rr);
    float f = smoothstep(0.35, 0.75, n2.x + 0.3 * n.y);
    a = edge * f * 0.8;
    alb = vec3(0.75, 0.78, 0.8);
  } else {                     // tyre skid: two narrow dark lines
    float l1 = 1.0 - smoothstep(0.0, 0.18, abs(abs(q.x) - 0.7));
    a = l1 * (1.0 - smoothstep(0.85, 1.0, abs(q.z))) * 0.7;
    alb = vec3(0.03);
  }
  a *= yFade * vD2.z * life;
  if (a < 0.003) discard;
  // lighting of a flat patch: sun (+ moon) on the reconstructed normal, ambient, the fire light
  vec3 N = normalize(cross(dFdy(P), dFdx(P)));
  if (N.y < 0.0) N = -N;
  vec3 sun = fxSun(P) * max(dot(N, uFxKeyDir), 0.0) / FX_PI;
  vec3 amb = atmAmbient(P, N);
  vec3 lit = alb * (sun + amb + fxLocal(P) * max(dot(N, normalize(uFxLightPos - P)), 0.0) / FX_PI);
  outColor = fxFinish(lit * a, a, vec3(0.0), P);
}`;
