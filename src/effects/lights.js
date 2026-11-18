// Aircraft lights: navigation (red/green sectors, white tail), white double-flash strobes, red beacon(s), landing-lamp
// glare — HDR sprites with a soft halo and a star-like diffraction flare at distance (one instanced draw call),
// plus ONE THREE.SpotLight for landing/taxi lights that lights the runway at night (kept in the scene permanently so
// the light count never changes) and an optional faint beam shaft in rain/fog.
import * as THREE from 'three';
import { LAYERS } from '../core/constants.js';
import { premulMaterialOpts } from './fxglsl.js';

const MAX = 12;
const STRIDE = 12; // pos.xyz, size | color.rgb, intensity | axis.xz, cosHalf, kind

export function createAircraftLights(ctx, shared, header) {
  const spot = new THREE.SpotLight(0xfff1dc, 0, 1500, 14 * Math.PI / 180, 0.45, 2);
  spot.name = 'fx-landing-light'; spot.castShadow = false;
  ctx.scene.add(spot, spot.target);

  const array = new Float32Array(MAX * STRIDE);
  const buf = new THREE.InstancedInterleavedBuffer(array, STRIDE, 1); buf.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('l0', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  geo.setAttribute('l1', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  geo.setAttribute('l2', new THREE.InterleavedBufferAttribute(buf, 4, 8));
  geo.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    ...premulMaterialOpts(),
    depthTest: true,
    uniforms: { ...shared },
    vertexShader: header + /* glsl */`
      in vec4 l0; in vec4 l1; in vec4 l2;
      out vec2 vC; out vec3 vCol; out float vI; out float vHalo; out vec3 vPos; out float vDist; out float vCore;
      void main() {
        vec4 w = modelMatrix * vec4(l0.xyz, 1.0);
        vec3 toCam = cameraPosition - w.xyz; float dist = length(toCam); toCam /= max(dist, 1e-3);
        // azimuth sector test in body space
        vec3 tb = transpose(mat3(modelMatrix)) * toCam;
        float vis = 1.0;
        if (l2.w > 0.5) {
          vec2 h = tb.xz; float hl = length(h);
          float c = hl > 1e-4 ? dot(h / hl, l2.xy) : 1.0;
          vis = smoothstep(l2.z - 0.06, l2.z + 0.03, c);
          vis = mix(vis, 1.0, smoothstep(0.85, 1.0, abs(tb.y)) * 0.5);   // seen from directly above/below: partial
        }
        float I = l1.w * vis;
        if (I <= 1e-3) { gl_Position = vec4(0.0); return; }
        vec4 vc = viewMatrix * w;
        vc.xyz += normalize(-vc.xyz) * min(0.6, dist * 0.5);             // pull toward camera: don't clip into the skin
        float pxPerM = projectionMatrix[1][1] * 0.5 * uResolution.y / max(-vc.z, 0.1);
        float corePx = l0.w * pxPerM;
        float minPx = 1.6;
        float energy = corePx < minPx ? (corePx * corePx) / (minPx * minPx) : 1.0;
        corePx = max(corePx, minPx);
        // halo / flare size in pixels grows with night and brightness, independent of distance (eye/lens glare)
        float haloPx = corePx * 3.0 + (3.0 + 9.0 * uFxNight) * clamp(sqrt(I * energy) * 0.1, 0.0, 2.5);
        float sizePx = max(haloPx, corePx * 1.5);
        vec2 off = position.xy * sizePx / pxPerM;
        vc.xy += off;
        vC = position.xy; vCore = corePx / sizePx;
        vCol = l1.rgb; vI = I * energy; vHalo = l2.w;
        vPos = w.xyz; vDist = dist;
        gl_Position = projectionMatrix * vc;
      }`,
    fragmentShader: '#define FX_FRAG\n' + header + /* glsl */`
      in vec2 vC; in vec3 vCol; in float vI; in float vHalo; in vec3 vPos; in float vDist; in float vCore;
      out vec4 outColor;
      void main() {
        float sd = fxSceneDist();
        if (vDist - 0.8 > sd) discard;
        float r = length(vC);
        float core = exp(-pow(r / max(vCore, 1e-3), 2.0) * 2.0);
        float halo = exp(-r * 8.0) * (0.006 + 0.02 * uFxNight);
        float spikes = (exp(-abs(vC.y) * 70.0) * exp(-abs(vC.x) * 2.8) + exp(-abs(vC.x) * 70.0) * exp(-abs(vC.y) * 2.8)) * 0.03 * uFxNight;
        float k = core + (halo + spikes) * (1.0 - smoothstep(0.85, 1.0, r));
        vec3 e = vCol * vI * k;
        vec3 white = mix(vCol, vec3(1.0), 0.55);
        e = mix(e, white * vI * k, core * 0.6);        // hot white centre on coloured lights
        outColor = fxFinish(vec3(0.0), 0.0, e, vPos);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.set(LAYERS.POST); mesh.frustumCulled = false; mesh.renderOrder = 30; mesh.name = 'fx-lights';

  // faint beam shaft (rain / fog), additive cone in the landing light's frame
  const coneGeo = new THREE.ConeGeometry(1, 1, 24, 1, true); coneGeo.translate(0, -0.5, 0); coneGeo.rotateX(-Math.PI / 2); // apex at 0, opening to -z
  const beamMat = new THREE.ShaderMaterial({
    ...premulMaterialOpts(), side: THREE.DoubleSide,
    uniforms: { ...shared, uBeam: { value: 0 }, uLen: { value: 120 }, uRad: { value: 25 } },
    vertexShader: header + /* glsl */`
      uniform float uLen; uniform float uRad;
      out vec3 vW; out float vAlong; out vec3 vN;
      void main() {
        vec3 p = position * vec3(uRad, uRad, uLen);
        vAlong = -position.z;
        vec4 w = modelMatrix * vec4(p, 1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normalize(vec3(position.xy, 0.15)));
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: '#define FX_FRAG\n' + header + /* glsl */`
      uniform float uBeam;
      in vec3 vW; in float vAlong; in vec3 vN;
      out vec4 outColor;
      void main() {
        float sd = fxSceneDist(); float d = length(vW - uCameraPos);
        if (d > sd) discard;
        float soft = clamp((sd - d) / 6.0, 0.0, 1.0);
        vec3 v = normalize(uCameraPos - vW);
        float edge = pow(abs(dot(normalize(vN), v)), 1.5);
        float fall = (1.0 - vAlong) * (1.0 - vAlong) * smoothstep(0.0, 0.05, vAlong);
        vec3 e = vec3(1.0, 0.95, 0.85) * uBeam * edge * fall * soft;
        outColor = fxFinish(vec3(0.0), 0.0, e, vW);
      }`,
  });
  const beam = new THREE.Mesh(coneGeo, beamMat);
  beam.layers.set(LAYERS.POST); beam.frustumCulled = false; beam.renderOrder = 4; beam.name = 'fx-beam';

  let lamps = [], player = null, group = null;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion();
  let t = 0;

  function add(pos, color, size, kind, axisDeg, halfDeg) {
    if (!pos || lamps.length >= MAX) return;
    const a = (axisDeg ?? 0) * Math.PI / 180;
    lamps.push({ pos, color, size, kind, ax: axisDeg == null ? 0 : Math.sin(a), az: axisDeg == null ? 0 : -Math.cos(a), cosH: Math.cos((halfDeg ?? 180) * Math.PI / 180), sector: axisDeg != null });
  }

  return {
    attach(pl, grp) {
      player = pl; group = grp; lamps = [];
      const L = pl.def.geometry?.lights || {}, g = pl.def.geometry || {};
      const big = (g.span || 10) > 20;
      // nav: left red sector = nose → 110° left (centre 55° left), right green mirror, tail white ±70° aft
      add(L.navLeft, [1.0, 0.06, 0.03], 0.12, 'nav', -55, 55);
      add(L.navRight, [0.05, 1.0, 0.25], 0.12, 'nav', 55, 55);
      add(L.tail, [1.0, 0.95, 0.88], 0.1, 'nav', 180, 70);
      // strobes: wingtips (slightly outboard/aft of nav) + tail
      if (L.navLeft) add([L.navLeft[0] - 0.05, L.navLeft[1], L.navLeft[2] + 0.15], [1, 1, 1], 0.14, 'strobe');
      if (L.navRight) add([L.navRight[0] + 0.05, L.navRight[1], L.navRight[2] + 0.15], [1, 1, 1], 0.14, 'strobe');
      if (L.strobe) add(L.strobe, [1, 1, 1], 0.14, 'strobeTail');
      // beacon (top) + belly beacon on large aircraft
      if (L.beacon) add([L.beacon[0], L.beacon[1] + 0.08, L.beacon[2]], [1.0, 0.04, 0.02], 0.12, 'beacon');
      if (L.beacon && big) add([L.beacon[0], -(g.cgHeight || 3) * 0.72, L.beacon[2] + 2], [1.0, 0.04, 0.02], 0.12, 'beacon2');
      // landing lamp glare (forward sector)
      if (L.landing) add(L.landing, [1, 0.96, 0.9], big ? 0.25 : 0.16, 'landing', 0, 40);
      for (let i = 0; i < lamps.length; i++) {
        const l = lamps[i], o = i * STRIDE;
        array[o] = l.pos[0]; array[o + 1] = l.pos[1]; array[o + 2] = l.pos[2]; array[o + 3] = l.size;
        array[o + 4] = l.color[0]; array[o + 5] = l.color[1]; array[o + 6] = l.color[2]; array[o + 7] = 0;
        array[o + 8] = l.ax; array[o + 9] = l.az; array[o + 10] = l.cosH; array[o + 11] = l.sector ? 1 : 0;
      }
      geo.instanceCount = lamps.length;
      buf.clearUpdateRanges(); buf.needsUpdate = true;
      grp.add(mesh); grp.add(beam);
    },
    detach() {
      mesh.removeFromParent(); beam.removeFromParent();
      player = null; group = null; lamps = []; geo.instanceCount = 0; spot.intensity = 0;
    },
    update(dt, s, night) {
      t += dt;
      if (!player || !s) { spot.intensity = 0; return; }
      const Ls = s.lights || {};
      let elec = !s.crashed && !(s.engines?.length > 0);
      if (!s.crashed && s.engines) for (let i = 0; i < s.engines.length; i++) if (s.engines[i].running !== false) elec = true;
      const dayK = 0.25 + 0.75 * night;   // apparent brightness relative to surroundings is handled by exposure;
      for (let i = 0; i < lamps.length; i++) {
        const l = lamps[i]; let I = 0;
        if (l.kind === 'nav') I = Ls.nav !== false ? 22 : 0;
        else if (l.kind === 'strobe' || l.kind === 'strobeTail') {
          if (Ls.strobe !== false) { const ph = (t + (l.kind === 'strobeTail' ? 0.05 : 0)) % 1.25; I = (ph < 0.05 || (ph > 0.16 && ph < 0.21)) ? 650 : 0; }
        } else if (l.kind === 'beacon' || l.kind === 'beacon2') {
          if (Ls.beacon !== false) { const ph = (t * 0.95 + (l.kind === 'beacon2' ? 0.5 : 0)) % 1; I = 45 * Math.pow(Math.max(0, Math.sin(ph * Math.PI)), 8); }
        } else if (l.kind === 'landing') I = (Ls.landing ? 700 : 0) + (Ls.taxi ? 200 : 0);
        array[i * STRIDE + 7] = elec ? I * (l.kind === 'nav' ? dayK : 1) : 0;
      }
      buf.clearUpdateRanges(); buf.addUpdateRange(0, lamps.length * STRIDE); buf.needsUpdate = true;
      // landing / taxi spot light (night only)
      const lampPos = player.def.geometry?.lights?.landing || [0, -1, (player.def.geometry?.noseZ || -6) * 0.5];
      const want = elec && (Ls.landing || Ls.taxi) ? Math.max(0, (night - 0.15) / 0.85) : 0;
      if (want > 0.001) {
        group.updateWorldMatrix(true, false);
        tmp.fromArray(lampPos).applyMatrix4(group.matrixWorld);
        spot.position.copy(tmp);
        // aim 4° below the body axis (taxi light: 10° below, wider)
        const down = Ls.landing ? 0.07 : 0.18;
        tmp2.set(0, -down, -1).normalize().transformDirection(group.matrixWorld);
        spot.target.position.copy(tmp).addScaledVector(tmp2, 100);
        spot.target.updateMatrixWorld();
        spot.angle = Ls.landing ? 13 * Math.PI / 180 : 30 * Math.PI / 180;
        spot.intensity = want * (Ls.landing ? 9000 : 2500);
      } else spot.intensity = 0;
      // beam shaft visible in precipitation / fog at night
      const murk = Math.min(1, (ctx.weather.precipitation || 0) + Math.max(0, 1 - (ctx.weather.visibility || 1e5) / 15000));
      const bI = want * murk * (Ls.landing ? 1 : 0);
      beam.visible = bI > 0.01;
      if (beam.visible) {
        beam.position.fromArray(lampPos);
        beam.quaternion.setFromAxisAngle(tmp.set(1, 0, 0), -0.07);
        beamMat.uniforms.uBeam.value = 0.05 * bI;
      }
    },
    dispose() { ctx.scene.remove(spot, spot.target); geo.dispose(); mat.dispose(); coneGeo.dispose(); beamMat.dispose(); },
  };
}
