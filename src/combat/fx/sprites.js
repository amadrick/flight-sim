// Emissive / impostor sprite batch — ONE instanced draw for everything small and bright in combat:
//   GLOW   round hot core + soft halo           (flares, motor glow, nav/strobe lights, AB glow, hit flashes)
//   STREAK velocity-aligned motion-blur streak  (tracers: length = distance travelled during a ~1/50 s exposure)
//   FLAME  axis-aligned exhaust flame           (missile motor, afterburner, damage fire tongue) — becomes a round,
//          brighter disc when seen down its axis (optically thin flame: radiance ∝ path length)
//   FLASH  star-shaped muzzle flash             (re-randomised every frame)
//   DOT    far-aircraft impostor                (dark silhouette dot + sun glint, faded in only when the real model
//          spans under ~4 px, so bandits never vanish below a pixel)
// Rebuilt from scratch every frame in RENDER space (no history → nothing to rebase). Sub-pixel sprites are clamped to a
// minimum on-screen size with their energy conserved (intensity × area ratio), so far tracers and burners stay
// visible as dim points instead of shimmering. Linear HDR, premultiplied alpha (emitters write alpha 0), manual
// occlusion against the scene depth, aerial perspective, exposure-aware soft limit.
import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import { premulMaterialOpts } from '../../effects/fxglsl.js';

export const SPR = { GLOW: 0, STREAK: 1, FLAME: 2, FLASH: 3, DOT: 4 };
const STRIDE = 16;

export function createSprites(ctx, sharedU, header, capacity = 2048) {
  const array = new Float32Array(capacity * STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(array, STRIDE, 1);
  buf.setUsage(THREE.DynamicDrawUsage);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (let k = 0; k < 4; k++) g.setAttribute('s' + k, new THREE.InterleavedBufferAttribute(buf, 4, k * 4));
  g.instanceCount = 0;
  const uniforms = { ...sharedU, uSoftLimit: { value: 40 } };
  const material = new THREE.ShaderMaterial({ ...premulMaterialOpts(), uniforms, vertexShader: header + VERT, fragmentShader: '#define FX_FRAG\n' + header + FRAG });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false; mesh.layers.set(LAYERS.POST); mesh.renderOrder = 20; mesh.name = 'cfx-sprites'; mesh.visible = false;
  ctx.scene.add(mesh);
  let n = 0;
  const sys = {
    mesh, uniforms, capacity,
    get count() { return n; },
    begin() { n = 0; },
    /**
     * Add one sprite (render-space position p). kind SPR.*; size = half width / radius (m);
     * (r, g, b) = emitted radiance (or, for DOT, albedo); dir = axis vector in metres (STREAK: head → tail,
     * FLAME: nozzle → tip, DOT: body up vector); a = DOT coverage / FLAME flicker seed / free; minPx minimum radius px;
     * e = extra (DOT: model span m; FLAME: diamonds 0..1; GLOW: halo strength).
     */
    add(kind, px, py, pz, size, r, g2, b, dx, dy, dz, a, minPx, e) {
      if (n >= capacity) return false;
      const o = n * STRIDE;
      array[o] = px; array[o + 1] = py; array[o + 2] = pz; array[o + 3] = size;
      array[o + 4] = r; array[o + 5] = g2; array[o + 6] = b; array[o + 7] = kind;
      array[o + 8] = dx; array[o + 9] = dy; array[o + 10] = dz; array[o + 11] = a;
      array[o + 12] = minPx; array[o + 13] = e; array[o + 14] = Math.random(); array[o + 15] = 0;
      n++;
      return true;
    },
    flush() {
      g.instanceCount = n;
      mesh.visible = n > 0;
      if (!n) return;
      buf.clearUpdateRanges(); buf.addUpdateRange(0, n * STRIDE); buf.needsUpdate = true;
    },
    clear() { n = 0; g.instanceCount = 0; mesh.visible = false; },
    dispose() { ctx.scene.remove(mesh); g.dispose(); material.dispose(); },
  };
  return sys;
}

const VERT = /* glsl */`
in vec4 s0; in vec4 s1; in vec4 s2; in vec4 s3;
out vec2 vC;            // quad corner (-1..1) in sprite space
out float vS;           // along-axis coordinate (streak / flame)
out vec3 vPos;
flat out vec4 vCol;     // rgb, kind
flat out vec4 vP;       // per-kind params
flat out vec4 vAP;
flat out float vDist;
flat out vec3 vLit;     // DOT: lit albedo + glint
void main() {
  float kind = s1.w;
  vec3 p = s0.xyz;
  float size = s0.w;
  vec3 col = s1.rgb;
  vec4 vc = viewMatrix * vec4(p, 1.0);
  float z = max(-vc.z, 0.05);
  float pxPerM = projectionMatrix[1][1] * uResolution.y * 0.5 / z;     // pixels per metre at this depth
  float minPx = s3.x;
  vec2 c = position.xy;
  vC = c;
  vP = vec4(0.0);
  vLit = vec3(0.0);
  vS = 0.0;
  float pxR = size * pxPerM;
  if (kind == 1.0 || kind == 2.0) {
    // STREAK / FLAME: quad from the head (p) along dir; widened to minPx with energy kept
    vec3 dv = mat3(viewMatrix) * s2.xyz;
    float w = size;
    if (pxR < minPx) { col *= pxR / minPx; w = minPx / pxPerM; }
    vec3 mid = vc.xyz + dv * 0.5;
    vec3 vd = normalize(mid);
    vec3 ap = dv - dot(dv, vd) * vd;           // axis projected on the screen plane
    float Lp = length(ap), L = length(dv);
    vec3 ua = Lp > 1e-5 ? ap / Lp : normalize(cross(vd, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 side = normalize(cross(vd, ua));
    float halfLen = max(Lp * 0.5 + w, w * 1.2);
    float K = kind == 2.0 ? 1.6 : 2.6;
    vc.xyz = mid + ua * c.y * halfLen + side * c.x * w * K;
    vS = (0.5 * Lp + c.y * halfLen) / max(Lp, 1e-4);   // 0 at the head / nozzle, 1 at the tail / tip
    vP = vec4(Lp / max(L, 1e-4), Lp / w, s2.w, K);
    vLit = vec3(s3.y, 0.0, 0.0);
  } else if (kind == 4.0) {
    // DOT: far-aircraft impostor, fixed ~1.3 px radius, only while the real model is smaller than ~4 px
    float spanPx = s3.y * pxPerM;
    float fadeIn = 1.0 - smoothstep(2.5, 4.5, spanPx);
    float r = 1.35 / pxPerM;
    vc.xy += c * r;
    // lit silhouette (grey airframe): sun + sky ambient; glint: specular of the up/down skin toward the camera
    vec3 nUp = normalize(s2.xyz + vec3(0.0, 1e-4, 0.0));
    vec3 V = normalize(uCameraPos - p);
    vec3 sun = fxSun(p);
    float ndl = abs(dot(nUp, uFxKeyDir));
    vec3 amb = atmAmbient(p, vec3(0.0, 1.0, 0.0));
    vec3 lit = col * (sun * ndl * 0.6 / 3.14159 + amb);
    vec3 nG = dot(nUp, V) < 0.0 ? -nUp : nUp;
    vec3 H = normalize(V + uFxKeyDir);
    float glint = pow(max(dot(nG, H), 0.0), 120.0) * 40.0 + pow(max(dot(nG, H), 0.0), 12.0) * 0.6;
    vLit = lit;
    vP = vec4(s2.w * fadeIn, glint * (1.0 - uFxNight), 0.0, 0.0);
    col = sun * glint / 3.14159;
  } else {
    // GLOW / FLASH: camera-facing, clamped to minPx
    float r = size;
    if (pxR < minPx) { col *= (pxR * pxR) / (minPx * minPx); r = minPx / pxPerM; }
    float ang = s3.z * 6.2832;
    vec2 rc = vec2(cos(ang) * c.x - sin(ang) * c.y, sin(ang) * c.x + cos(ang) * c.y);
    vc.xy += c * r;
    vC = kind == 3.0 ? rc : c;
    vP = vec4(s3.y, r, 0.0, s2.w);
  }
  vCol = vec4(col, kind);
  vAP = fxAP(p);
  vDist = length(vc.xyz);
  vPos = p;
  gl_Position = projectionMatrix * vc;
}`;

const FRAG = /* glsl */`
uniform float uSoftLimit;
in vec2 vC; in float vS; in vec3 vPos;
flat in vec4 vCol; flat in vec4 vP; flat in vec4 vAP; flat in float vDist; flat in vec3 vLit;
out vec4 outColor;
void main() {
  float kind = vCol.w;
  float sd = fxSceneDist();
  // own-geometry bias: a sprite on an aircraft must not be hidden by that aircraft
  float bias = kind == 4.0 ? 30.0 : 1.5;
  if (vDist > sd + bias) discard;
  vec3 e = vec3(0.0); float a = 0.0;
  if (kind == 0.0) {
    float r2 = dot(vC, vC);
    if (r2 >= 1.0) discard;
    float core = exp(-r2 * 14.0);
    float halo = exp(-r2 * 3.5) * 0.25 * vP.x;
    e = vCol.rgb * (core + halo);
  } else if (kind == 1.0) {
    // tracer: hot white core, warm glow; brightest at the head, fading along the streak, round caps
    float x = vC.x * vP.w, sa = vS;
    float dh = sa < 0.0 ? -sa * vP.y : (sa > 1.0 ? (sa - 1.0) * vP.y : 0.0);   // distance beyond the ends, in widths
    float caps = exp(-dh * dh * 1.5);
    float alongK = mix(1.0, 0.2, clamp(sa, 0.0, 1.0)) * caps;
    float core = exp(-x * x * 4.0), glow = exp(-x * x * 0.7) * 0.22;
    e = (vCol.rgb * glow + mix(vCol.rgb, vec3(dot(vCol.rgb, vec3(0.333))), 0.35) * core * 1.3) * alongK;
    if (dot(e, e) < 1e-10) discard;
  } else if (kind == 2.0) {
    // exhaust flame: white-hot core at the nozzle → yellow → orange → fading red tip; flicker; shock diamonds
    float x = vC.x * vP.w, sa = vS;
    float fore = vP.x;                               // projected / true length (1 = side view, ~0 = down the axis)
    float sc = clamp(sa, 0.0, 1.0);
    float width = mix(0.6, 1.0, sqrt(sc)) * (1.0 - 0.45 * sc * sc);
    float r = abs(x) / max(width, 0.05);
    float dh = sa < 0.0 ? -sa * vP.y : 0.0;
    float ends = exp(-dh * dh * 3.0) * (1.0 - smoothstep(0.6, 1.05, sa));
    float fl = 0.82 + 0.18 * sin(uTime * 61.0 + vP.z * 40.0 + sa * 9.0) * sin(uTime * 37.0 + vP.z * 13.0);
    float body = exp(-r * r * 2.0) * ends * (1.0 - 0.5 * sc);
    float core = exp(-r * r * 9.0) * exp(-sc * 4.0) * ends;
    float dia = vLit.x * pow(max(cos(sa * 6.2832 * 3.0), 0.0), 8.0) * exp(-sc * 2.2) * exp(-r * r * 7.0) * step(0.0, sa);
    vec3 hot = vec3(1.0, 0.93, 0.82), mid = vec3(1.0, 0.58, 0.22), cool = vec3(0.85, 0.22, 0.06);
    vec3 cc = mix(mix(hot, mid, smoothstep(0.0, 0.3, sc)), cool, smoothstep(0.3, 0.9, sc));
    float axial = 1.0 / max(fore, 0.25);             // looking down the axis integrates more flame
    float endOn = 1.0 - smoothstep(0.12, 0.4, fore);
    float disc = exp(-dot(vC, vC) * 4.5);            // seen end-on the quad is a round glow
    float shape = mix(body, disc, endOn), cshape = mix(core * 2.0 + dia, disc * disc * 2.0, endOn);
    e = vCol.rgb * (cc * shape + hot * cshape) * fl * axial;
    if (dot(e, e) < 1e-10) discard;
  } else if (kind == 3.0) {
    // muzzle flash: bright core with 5 ragged spikes
    float r = length(vC);
    if (r >= 1.0) discard;
    float ang = atan(vC.y, vC.x);
    float spikes = pow(max(cos(ang * 2.5 + vP.w * 6.0), 0.0), 8.0) * exp(-r * 3.0);
    float core = exp(-r * r * 18.0) * 2.0 + exp(-r * r * 4.0) * 0.4;
    e = vCol.rgb * (core + spikes) * mix(vec3(1.0, 0.75, 0.5), vec3(1.0), exp(-r * 6.0));
  } else {
    // far-aircraft dot
    float r2 = dot(vC, vC);
    if (r2 >= 1.0) discard;
    float cov = exp(-r2 * 2.5) * vP.x;
    if (cov < 0.003) discard;
    a = cov * 0.85;
    e = vCol.rgb * cov;
    outColor = fxFinishAP(vLit * a, a, e, vAP);
    return;
  }
  // exposure-aware soft limit on display brightness (blooms without clipping to flat white blobs)
  float lum = max(dot(e, vec3(0.2126, 0.7152, 0.0722)), 1e-6);
  float d = lum * uFxExposure;
  e /= 1.0 + d / uSoftLimit;        // display value saturates smoothly at uSoftLimit
  outColor = fxFinishAP(vec3(0.0), 0.0, e, vAP);
}`;
