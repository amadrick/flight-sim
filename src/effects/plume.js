// Afterburner plumes + dry-engine nozzle glow. One ray-marched emission volume per engine, body-fixed
// (child of the aircraft group). The analytic emission field has:
//   * a white-yellow potential core cone with SHOCK DIAMONDS (rhombus cells + Mach discs, spacing ∝ nozzle
//     pressure ratio, brightness decaying cell by cell),
//   * a blue-violet sheath ring at the nozzle lip,
//   * a turbulent orange → red-violet flame envelope (3D noise advected downstream at exhaust speed),
//   * flicker; length/brightness with AB stage; HDR radiance (≈ 20–150) so bloom glows.
// Dry thrust draws NOTHING: the aircraft models carry their own nozzle interiors with a dull EGT glow deep inside (kit
// abGlowColor), and a real engine at dry power shows no flame. Afterburner: four layers (potential core with shock
// diamonds + Mach discs, blue lip sheath, turbulent orange mixing layer, wide faint outer plume), physical radiance
// (one value day and night) with an exposure-aware soft limit on the integrated result, so it is restrained by day and
// blooms at dusk / night. ?plume=classic restores the previous look (incl. the dry nozzle-exit glow).
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { premulMaterialOpts } from './fxglsl.js';

export function createPlumeMaterial(shared, header, classic = false) {
  return new THREE.ShaderMaterial({
    defines: classic ? { PLUME_CLASSIC: 1 } : {},
    ...premulMaterialOpts(),
    side: THREE.BackSide,
    uniforms: {
      ...shared,
      uAB: { value: 0 }, uDry: { value: 0 }, uR0: { value: 0.5 }, uLen: { value: 10 }, uRb: { value: 1 },
      uCamLocal: { value: new THREE.Vector3() }, uSeed: { value: 0 }, uSpacing: { value: 1 }, uSteps: { value: 24 },
      uFlicker: { value: 1 }, uExpand: { value: 1 }, uCap: { value: new THREE.Vector2(1.5, 6) },
    },
    vertexShader: header + /* glsl */`
      uniform float uRb; uniform float uLen;
      out vec3 vLocal; out vec3 vWorld;
      void main() {
        vec3 p = position * vec3(uRb, uRb, uLen);
        vLocal = p;
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: '#define FX_FRAG\n' + header + /* glsl */`
      uniform float uAB; uniform float uDry; uniform float uR0; uniform float uLen; uniform float uRb;
      uniform vec3 uCamLocal; uniform float uSeed; uniform float uSpacing; uniform float uSteps;
      uniform float uFlicker; uniform float uExpand; uniform vec2 uCap;
      in vec3 vLocal; in vec3 vWorld;
      out vec4 outColor;
#ifdef PLUME_CLASSIC
      vec4 field(vec3 p) {
        float absorb = 0.0;
        float z = p.z, r = length(p.xy);
        float zn = z / uLen;
        vec3 col = vec3(0.0);
        float ab = uAB;
        if (ab > 0.001) {
          // potential core (tapering cone) with shock diamonds
          float Lc = uLen * 0.55;
          float rc = uR0 * 0.82 * pow(max(1.0 - z / Lc, 0.0), 0.6) * uExpand;
          if (rc > 0.01) {
            float core = exp(-(r * r) / (rc * rc) * 3.2);
            float ph = z / uSpacing + 0.25;
            float n = floor(ph), f = fract(ph);
            float decay = pow(0.8, n);
            float rh = abs(f - 0.5) * 2.0 + r / (rc * 0.8);
            float diamond = smoothstep(1.0, 0.7, rh) * decay;
            float disc = exp(-pow((f - 0.62) / 0.06, 2.0)) * exp(-(r * r) / (rc * rc) * 4.0) * decay;
            col += vec3(1.0, 0.5, 0.2) * core * 3.0 * (0.4 + 0.6 * smoothstep(0.0, uR0 * 1.5, z));
            col += vec3(1.0, 0.74, 0.56) * diamond * 18.0 + vec3(1.0, 0.9, 0.82) * disc * 28.0;
          }
          // sheath ring at the nozzle lip (blue-violet), strongest at full AB
          float sh = exp(-pow((r - uR0 * 0.78) / (uR0 * 0.14), 2.0)) * exp(-z / (uR0 * 1.8));
          col += vec3(0.35, 0.38, 1.0) * sh * 2.2 * (0.4 + 0.6 * ab);
          // turbulent flame envelope
          float re = uR0 * (0.85 + 0.75 * zn) * uExpand;
          vec3 q = vec3(p.xy / (uR0 * 2.2), z * 0.22 - uTime * 6.5) + uSeed;
          vec4 nz = fxNoise(q * vec3(0.5, 0.5, 0.5));
          vec4 nz2 = fxNoise(q * vec3(1.2, 1.2, 1.1) + 0.37);
          float turb = 0.3 + 1.3 * nz.r * (0.6 + 0.8 * nz2.g);
          float env = exp(-(r * r) / (re * re) * 1.8) * pow(max(1.0 - zn, 0.0), 1.3) * turb;
          env *= smoothstep(-0.05, uR0 * 0.5, z);
          vec3 envCol = mix(vec3(1.0, 0.42, 0.1), vec3(0.85, 0.2, 0.1), smoothstep(0.3, 0.9, zn + (nz2.r - 0.5) * 0.3));
                    col += envCol * env * 1.8;
          absorb = env * 0.25 * ab;
          col *= ab * uFlicker;
        }
        if (uDry > 0.001) {
          // hot nozzle interior / turbine seen through the exit: a thin glowing disc just inside the lip
          float g = exp(-max(z, 0.0) / 0.06) * smoothstep(uR0 * 0.92, uR0 * 0.55, r) * (1.0 - 0.35 * smoothstep(0.0, uR0 * 0.7, r));
          col += vec3(1.0, 0.28, 0.06) * g * uDry * 9.0;
        }
        return vec4(col, absorb);
      }
#else
      vec4 field(vec3 p) {
        float z = p.z, r = length(p.xy);
        float zn = z / uLen;
        vec3 col = vec3(0.0);
        float absorb = 0.0;
        float ab = uAB;
        if (ab < 0.001 || z < 0.0) return vec4(0.0);
        vec3 q = vec3(p.xy / (uR0 * 2.2), z * 0.22 - uTime * 6.5) + uSeed;
        vec4 nz = fxNoise(q * 0.5);
        vec4 nz2 = fxNoise(q * vec3(1.2, 1.2, 1.1) + 0.37);
        // 1) potential core: a tapering cone of hot, still-burning gas with the SHOCK DIAMONDS inside it
        float Lc = uLen * (0.34 + 0.12 * ab);
        float rc = uR0 * 0.8 * pow(max(1.0 - z / Lc, 0.0), 0.55) * uExpand;
        if (rc > 0.01) {
          float rr = r * r / (rc * rc);
          float core = exp(-rr * 2.4);
          col += vec3(1.0, 0.56, 0.24) * core * 1.5 * smoothstep(0.0, uR0 * 0.7, z);
          // shock cells: rhombus "diamonds" between oblique shocks, a thin bright Mach disc in each, decaying cell by cell
          float ph = z / uSpacing + 0.12;
          float n = floor(ph), f = fract(ph);
          float decay = pow(0.7, n) * smoothstep(Lc * 1.02, Lc * 0.45, z);
          float rh = abs(f - 0.55) * 2.0 + r / (rc * 0.95 + 0.02);
          float diamond = smoothstep(1.0, 0.45, rh) * decay;
          float disc = exp(-pow((f - 0.62) / 0.045, 2.0)) * exp(-rr * 3.0) * decay;
          col += vec3(1.0, 0.74, 0.5) * diamond * 6.0 + vec3(1.0, 0.9, 0.8) * disc * 14.0;
        }
        // 2) blue-violet sheath at the nozzle lip (hydrocarbon CH / C2 emission), strongest at full afterburner
        float sh = exp(-pow((r - uR0 * 0.8) / (uR0 * 0.13), 2.0)) * exp(-z / (uR0 * 1.6));
        col += vec3(0.32, 0.36, 1.0) * sh * 1.4 * (0.3 + 0.7 * ab);
        // 3) turbulent afterburning mixing layer: orange, breaking up downstream
        float re = uR0 * (0.88 + 0.6 * zn) * uExpand;
        float turb = 0.3 + 1.35 * nz.r * (0.6 + 0.8 * nz2.g);
        float env = exp(-(r * r) / (re * re) * 2.0) * pow(max(1.0 - zn, 0.0), 1.4) * turb * smoothstep(-0.05, uR0 * 0.4, z);
        vec3 envCol = mix(vec3(1.0, 0.44, 0.12), vec3(0.85, 0.2, 0.08), smoothstep(0.25, 0.85, zn + (nz2.r - 0.5) * 0.3));
        col += envCol * env * 1.0;
        // 4) soft outer plume: wide, dim and mostly transparent; only really shows against a dark sky
        float ro = uR0 * (1.15 + 1.45 * zn) * uExpand;
        float outer = exp(-(r * r) / (ro * ro) * 1.6) * smoothstep(1.0, 0.15, zn) * (0.25 + 0.9 * nz2.b) * smoothstep(0.0, uR0 * 1.2, z);
        col += vec3(0.9, 0.32, 0.12) * outer * 0.1;
        absorb = (env * 0.1 + outer * 0.03) * ab;
        col *= ab * uFlicker;
        return vec4(col, absorb);
      }
#endif
      void main() {
        vec3 ro = uCamLocal, rd = normalize(vLocal - uCamLocal);
        // ray vs. capped cylinder (axis z, radius uRb, z in [0, uLen])
        float a = dot(rd.xy, rd.xy), b = dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - uRb * uRb;
        float t0 = 0.0, t1 = 1e9;
        if (a > 1e-8) { float disc = b * b - a * c; if (disc <= 0.0) discard; float s = sqrt(disc); t0 = (-b - s) / a; t1 = (-b + s) / a; }
        else if (c > 0.0) discard;
        if (abs(rd.z) > 1e-6) { float za = -ro.z / rd.z, zb = (uLen - ro.z) / rd.z; t0 = max(t0, min(za, zb)); t1 = min(t1, max(za, zb)); }
        t0 = max(t0, 0.0);
        t1 = min(t1, fxSceneDist());
        if (t1 <= t0) discard;
        float n = uSteps, dt = (t1 - t0) / n;
        float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.618034);
        vec3 acc = vec3(0.0); float tau = 0.0;
        for (int i = 0; i < 48; i++) {
          if (float(i) >= n) break;
          vec3 p = ro + rd * (t0 + (float(i) + j) * dt);
          vec4 f = field(p); acc += f.rgb; tau += f.a;
        }
        acc *= dt;
        float alpha = 1.0 - exp(-tau * dt);
        if (dot(acc, vec3(1.0)) < 1e-5) discard;
#ifndef PLUME_CLASSIC
        // exposure-aware compression (hue preserving), in display units: logarithmic above a knee so the core, the
        // diamonds and the soft outer plume keep their relative structure instead of saturating into one white blob,
        // then a soft ceiling. Knee and ceiling are low by day (restrained) and high at dusk / night (blooms).
        float m = max(acc.r, max(acc.g, acc.b)) * uFxExposure;
        float mc = uCap.x * log(1.0 + m / uCap.x);
        mc = uCap.y * (1.0 - exp(-mc / uCap.y));
        acc *= mc / max(m, 1e-6);
#endif
        outColor = fxFinish(vec3(0.0), alpha, acc, vWorld);
      }`,
  });
}

export function createPlumeGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 20, 1, false);
  g.translate(0, 0.5, 0); g.rotateX(Math.PI / 2);
  return g;
}

/** Per-engine plume controller. */
export class Plume {
  constructor(geo, mat, engine, isAB, lowBypass, seed, classic = false) {
    this.classic = classic;
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.layers.set(LAYERS.POST); this.mesh.frustumCulled = false; this.mesh.renderOrder = 20;
    this.mesh.name = 'fx-plume';
    const nz = engine.nozzle || [0, 0, 0];
    this.mesh.position.set(nz[0], nz[1], nz[2]);
    this.r0 = engine.nozzleRadius || 0.5;
    this.isAB = isAB; this.lowBypass = lowBypass;
    this.u = mat.uniforms; this.u.uSeed.value = seed; this.u.uR0.value = this.r0;
    this.ab = 0; this.flick = 1;
    this._m = new THREE.Matrix4(); this._v = new THREE.Vector3();
  }
  update(en, state, camPos, quality, dt, t, exposure) {
    const abT = this.isAB ? (this.forceAB ?? (en?.afterburner || 0)) : 0;
    // smooth light-off / cut-off (≈ 0.15 s)
    this.ab += (abT - this.ab) * Math.min(1, dt * 10);
    const ab = this.ab;
    const egt = en?.egt ?? 400, n1 = en?.n1 ?? 0;
    const dry = this.classic && this.lowBypass && en && en.running !== false ? Math.max(0, Math.min(1, (egt - 350) / 500)) * 0.6 + Math.max(0, n1 - 0.6) * 1.2 : 0;
    const u = this.u, r0 = this.r0;
    const alt = state?.altitude || 0;
    const expand = 1 + Math.min(0.6, alt / 20000);
    u.uAB.value = ab; u.uDry.value = dry;
    // flame length: min AB ~ 5 D, max ~ 11 D; spacing grows with stage (NPR)
    const D = 2 * r0;
    u.uLen.value = D * (2.6 + 5.8 * Math.sqrt(ab)) * (0.9 + 0.35 * (expand - 1) / 0.6) + 0;
    u.uSpacing.value = D * (0.75 + 0.4 * ab) * expand;
    u.uRb.value = r0 * (this.classic ? 2.2 : 2.8) * expand;
    // compression knee / ceiling in display units: 1.2 / 5 by day (restrained), up to 3 / 14 at dusk / night
    const ex = Math.max(1e-3, exposure || 1);
    const nt = Math.min(1, Math.max(0, Math.log(ex / 2) / Math.log(15)));
    const ns = nt * nt * (3 - 2 * nt);
    u.uCap.value.set(1.2 + 1.8 * ns, 5 + 9 * ns);
    u.uExpand.value = expand;
    u.uSteps.value = Math.round(14 + 18 * (quality ?? 1));
    // flicker: few-Hz pulsing + fast shimmer
    u.uFlicker.value = 1 + 0.06 * Math.sin(t * 31.0 + u.uSeed.value) + 0.04 * Math.sin(t * 73.0) + 0.05 * (Math.random() - 0.5);
    this.mesh.visible = ab > 0.005 || dry > 0.01;
    if (this.mesh.visible) {
      this.mesh.updateWorldMatrix(true, false);
      this._m.copy(this.mesh.matrixWorld).invert();
      u.uCamLocal.value.copy(camPos).applyMatrix4(this._m);
    }
  }
  dispose() { this.mesh.removeFromParent(); this.mesh.material.dispose(); }
}
