// GPU height clipmap: a camera-centred pyramid of L toroidal N x N layers (texture arrays), texel spacing t0 * 2^l.
//   tH (RGBA16F): r + g = height (r = multiple of 4 m, g = remainder: exact to ~1 mm, and linearly filterable),
//                 b = aridity, a = special surface (> 0 river water, < 0 playa)
//   tD (RGBA8):   rg = world normal xz (signed-sqrt encoded), b = curvature (Laplacian), a = concavity (wide AO)
// Texel (i, j) of level l holds the terrain at world (i, j) * t_l and lives at texture address (i mod N, j mod N), so a
// REPEAT-wrapped lookup at uv = world / (N t_l) + 0.5 / N addresses it directly ("toroidal" clipmap, Losasso &
// Hoppe 2004 / Asirvatham & Hoppe 2005). When the window slides only the new L-shaped strip is generated — by the
// fragment shader that runs the world function (height.glsl.js) — so there is no CPU tile generation, no worker
// traffic and no hitch even at Mach 2. Each level is band-limited to its own texel spacing (prefiltered, not aliased).
import * as THREE from 'three';
import { FULLSCREEN_VERT, fullscreenTriangle } from '../core/glsl.js';
import { AIRPORTS } from '../data/airports.js';
import { GLOBALS_GLSL, HASH_GLSL, WORLD_GLSL, airportsCode } from './height.glsl.js';

export const SNAP = 8;       // window centre snaps to multiples of SNAP texels
export const EDGE = 5;       // outer texels of a window that are not trusted (derivative stencil reach + filter)

export function createClipmap(renderer, { N, L, t0 }) {
  const opts = (type) => ({
    type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, depthBuffer: false, stencilBuffer: false,
    generateMipmaps: false, colorSpace: THREE.NoColorSpace,
  });
  const rtH = new THREE.WebGLArrayRenderTarget(N, N, L, opts(THREE.HalfFloatType));
  const rtD = new THREE.WebGLArrayRenderTarget(N, N, L, opts(THREE.UnsignedByteType));
  rtH.scissorTest = true; rtD.scissorTest = true;

  const genMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { uGenOffset: { value: new THREE.Vector2() }, uSpacing: { value: 1 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int;
      out vec4 outColor;
      uniform vec2 uGenOffset; uniform float uSpacing;
      ${GLOBALS_GLSL}
      ${HASH_GLSL}
      ${WORLD_GLSL.replace('//@AIRPORTS@', airportsCode(AIRPORTS))}
      void main() {
        vec2 idx = floor(gl_FragCoord.xy) + uGenOffset;
        gLod = uSpacing;
        float h = terrain(idx.x * uSpacing, idx.y * uSpacing);
        float hi = floor(h * 0.25 + 0.5) * 4.0;
        outColor = vec4(hi, h - hi, gArid, gSpec);
      }`,
  });
  const derMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { tH: { value: rtH.texture }, uLayer: { value: 0 }, uSpacing: { value: 1 }, uMask: { value: N - 1 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      precision highp float; precision highp int; precision highp sampler2DArray;
      out vec4 outColor;
      uniform sampler2DArray tH; uniform int uLayer; uniform float uSpacing; uniform int uMask;
      float H(ivec2 p) { vec4 t = texelFetch(tH, ivec3(p & uMask, uLayer), 0); return t.x + t.y; }
      float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        float hc = H(p), hl = H(p + ivec2(-1, 0)), hr = H(p + ivec2(1, 0)), hd = H(p + ivec2(0, -1)), hu = H(p + ivec2(0, 1));
        vec3 n = normalize(vec3(hl - hr, 2.0 * uSpacing, hd - hu));
        float curv = (hl + hr + hd + hu - 4.0 * hc) / uSpacing;                 // slope change per texel
        float ring = (H(p + ivec2(4, 0)) + H(p + ivec2(-4, 0)) + H(p + ivec2(0, 4)) + H(p + ivec2(0, -4))
                    + H(p + ivec2(3, 3)) + H(p + ivec2(-3, 3)) + H(p + ivec2(3, -3)) + H(p + ivec2(-3, -3))) * 0.125;
        float conc = (ring - hc) / (4.0 * uSpacing);                            // mean rise toward the surroundings
        vec2 e = sign(n.xz) * sqrt(abs(n.xz));
        vec4 o = vec4(e * 0.5 + 0.5, curv * 1.25 + 0.5, conc * 1.5 + 0.5);
        outColor = o + (hash(gl_FragCoord.xy) - 0.5) / 255.0;                   // dither the 8-bit quantisation
      }`,
  });
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tri = fullscreenTriangle();
  const genScene = new THREE.Scene(), derScene = new THREE.Scene();
  const genMesh = new THREE.Mesh(tri, genMat), derMesh = new THREE.Mesh(tri, derMat);
  genMesh.frustumCulled = derMesh.frustumCulled = false; genScene.add(genMesh); derScene.add(derMesh);

  const levels = [];
  for (let l = 0; l < L; l++) levels.push({ t: t0 * 2 ** l, cx: 0, cz: 0, valid: false });
  const rects = [];   // scratch: [x0, z0, w, h] in world texel indices
  const mod = (a) => ((a % N) + N) % N;
  let texels = 0;

  function drawRects(rt, scene, layer, list) {
    for (let i = 0; i < list.length; i += 4) {
      const x0 = list[i], z0 = list[i + 1], w = list[i + 2], h = list[i + 3];
      if (w <= 0 || h <= 0) continue;
      // split at the toroidal wrap
      const u0 = mod(x0), v0 = mod(z0);
      const w1 = Math.min(w, N - u0), h1 = Math.min(h, N - v0);
      for (let px = 0; px < 2; px++) for (let pz = 0; pz < 2; pz++) {
        const pw = px ? w - w1 : w1, ph = pz ? h - h1 : h1;
        if (pw <= 0 || ph <= 0) continue;
        const pu = px ? 0 : u0, pv = pz ? 0 : v0;
        const wx = px ? x0 + w1 : x0, wz = pz ? z0 + h1 : z0;
        genMat.uniforms.uGenOffset.value.set(wx - pu, wz - pv);
        rt.viewport.set(pu, pv, pw, ph); rt.scissor.set(pu, pv, pw, ph);
        renderer.setRenderTarget(rt, layer);
        renderer.render(scene, cam);
        texels += pw * ph;
      }
    }
  }

  const clip = {
    N, L, t0, rtH, rtD, levels,
    textureH: rtH.texture, textureD: rtD.texture,
    /** Invalidate everything (e.g. after a context restore). */
    invalidate() { for (const lv of levels) lv.valid = false; },
    /**
     * Bring level l up to date for a camera at world (camX, camZ). Returns the number of texels generated.
     * allowFull = false defers a complete refill (returns -1 and leaves the level as it was).
     */
    update(l, camX, camZ, allowFull) {
      const lv = levels[l], t = lv.t, half = N >> 1;
      const cx = Math.round(camX / (t * SNAP)) * SNAP, cz = Math.round(camZ / (t * SNAP)) * SNAP;
      if (lv.valid && cx === lv.cx && cz === lv.cz) return 0;
      const dx = cx - lv.cx, dz = cz - lv.cz;
      rects.length = 0;
      const full = !lv.valid || Math.abs(dx) >= N || Math.abs(dz) >= N;
      if (full) {
        if (!allowFull) return -1;
        rects.push(cx - half, cz - half, N, N);
      } else {
        if (dx > 0) rects.push(lv.cx + half, cz - half, dx, N); else if (dx < 0) rects.push(cx - half, cz - half, -dx, N);
        // rows: only the columns that were already present (the new columns above cover the corner)
        const ox0 = Math.max(cx, lv.cx) - half, ow = N - Math.abs(dx);
        if (dz > 0) rects.push(ox0, lv.cz + half, ow, dz); else if (dz < 0) rects.push(ox0, cz - half, ow, -dz);
      }
      const prevTarget = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      texels = 0;
      genMat.uniforms.uSpacing.value = t;
      drawRects(rtH, genScene, l, rects);
      // derived data: redo the new texels plus the ring of old texels whose stencil reached into unknown data
      derMat.uniforms.uSpacing.value = t; derMat.uniforms.uLayer.value = l;
      if (!full) {
        const E = EDGE - 1, wx0 = cx - half, wz0 = cz - half;
        for (let i = 0; i < rects.length; i += 4) {
          const x0 = Math.max(rects[i] - E, wx0), z0 = Math.max(rects[i + 1] - E, wz0);
          const x1 = Math.min(rects[i] + rects[i + 2] + E, wx0 + N), z1 = Math.min(rects[i + 1] + rects[i + 3] + E, wz0 + N);
          rects[i] = x0; rects[i + 1] = z0; rects[i + 2] = x1 - x0; rects[i + 3] = z1 - z0;
        }
      }
      const gen = texels;
      drawRects(rtD, derScene, l, rects);
      renderer.setRenderTarget(prevTarget); renderer.autoClear = prevAuto;
      lv.cx = cx; lv.cz = cz; lv.valid = true;
      return gen;
    },
    dispose() { rtH.dispose(); rtD.dispose(); genMat.dispose(); derMat.dispose(); tri.dispose(); },
  };
  return clip;
}
