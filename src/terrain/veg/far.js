// Far trees: hemi-octahedral impostors (impostor.js), one instanced draw of camera-facing quads over the whole
// placement map. Each pixel intersects its view ray with the 4 nearest baked views (per-frame parallax) and blends
// albedo, normal, crown height and crown depth, then is lit like the meshes (sun + shadow map + IBL, crown light
// transfer, translucency). Alpha-tested with depth write; a dithered hand-over from the near meshes and a dithered
// fade at the map edge (resolved by TAA) avoid popping.
import * as THREE from 'three';
import { vegVertexCommon, VEG_LIGHT_GLSL, FRAG_DECL_GLSL, transGLSL, vegDebug, VEG_DBG_GLSL } from './common.js';
import { OCT_GLSL, IMP_COLS } from './impostor.js';
import { NSPECIES, SPECIES } from './species.js';

export function createFarTrees(ctx, { L, G, U, imp, neuralGLSL, blend = true }) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.instanceCount = G * G;
  const IU = {
    tVegImpA: { value: imp.atlasA }, tVegImpB: { value: imp.atlasB },
    uVegImp: { value: new THREE.Vector4(imp.N, imp.F, imp.W, imp.H) },
    uVegBaseH: { value: SPECIES.map((s) => s.base) },
    uVegProj: { value: ctx.camera.projectionMatrix }, uDepthReversed: ctx.uniforms.frame.uDepthReversed,
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, metalness: 0 });
  mat.defines = { VEG_IMP_BLEND: blend ? 1 : 0, VEG_SPEC_DIRECT: '0.3', VEG_SPEC_SKY: '0.1' };
  if (vegDebug.mode) mat.defines.VEG_DBG = vegDebug.mode;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U, IU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        ${vegVertexCommon(L)}
        uniform vec3 uSunDir;
        varying vec3 vVegHD; varying vec4 vVegMisc; varying vec3 vVegTrans; varying vec3 vVegWorld;
        varying vec3 vVegAlb; varying vec3 vVegP; varying vec2 vVegRot; varying vec2 vVegFade; varying float vVegSize; flat varying int vVegS;
        ${transGLSL()}`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
        vec2 vt = vec2(float(gl_InstanceID % int(uVegWin.z)), float(gl_InstanceID / int(uVegWin.z)));
        vec2 vCell = uVegWin.xy + mod(vt - mod(uVegWin.xy, uVegWin.z) + uVegWin.z, uVegWin.z);
        vec4 vM = texelFetch(tVegMap, ivec2(vt), 0);
        int vS = int(vM.g + 0.5);
        vec2 vBase = vegCellRXZ(vCell);
        float vDist = distance(vBase, uTerrCam.xz);
        float vSize = vM.r;
        if (vDist < uVegRange.x - uVegRange.y - 2.0 || vDist > uVegRange.w) vSize = 0.0;
        vec2 vh = vegHash(vCell + 60000.0), vh2 = vegHash(vCell + 90000.0);
        float vAng = vh.x * 6.2831853;
        float vWide = mix(0.86, 1.18, vh.y);
        float vGround = vegGround(vBase);
        vec3 vB3 = vec3(vBase.x, vGround - 0.25, vBase.y);
        vec4 sp = uVegSp[vS];
        vec3 vC = vB3 + vec3(0.0, sp.x * vSize, 0.0);
        float vR = sp.y * vSize * max(vWide, 1.0);
        vec3 toCam = cameraPosition - vC;
        float vD = length(toCam);
        vec3 vf = toCam / max(vD, 1e-3);
        vec3 vr = normalize(cross(vec3(0.0, 1.0, 0.0), vf) + vec3(1e-5, 0.0, 0.0));
        vec3 vu = cross(vf, vr);
        // the quad sits half a radius in front of the tree (so the ground in front does not clip it) and is scaled to
        // keep its screen size
        float push = min(vR * 0.6, vD * 0.5);
        float k = (vD - push) / max(vD, 1e-3);
        vec3 vegPos = vC + vf * push + (vr * position.x + vu * position.y) * vR * k;
        vec2 vWindOff = vegWind(vC, 0.6, 0.0, vSize, vh.x).xz;
        vegPos.xz += vWindOff * max(position.y + 1.0, 0.0) * 0.5;
        if (vSize <= 0.0) vegPos = vec3(0.0, -1.0e5, 0.0);
        vVegWorld = vegPos;
        // tree-local (unrotated) position of this corner in units of tree height, relative to the base
        vec3 vq = (vegPos - vB3) / max(vSize, 1e-3);
        float c = cos(-vAng), s = sin(-vAng);
        vq.xz = vec2(c * vq.x - s * vq.z, s * vq.x + c * vq.z) / vWide;
        vVegP = vq;
        vVegRot = vec2(vAng, vWide);
        vVegS = vS;
        float vConif = sp.z;
        vec2 vSunC = normalize(uSunDir.xz + 1e-4);
        float vOcc = step(0.01, vegMapAt(vCell + floor(vSunC + 0.5)).r) + step(0.01, vegMapAt(vCell + floor(vSunC * 2.3 + 0.5)).r);
        float vOcc4 = 0.25 * (step(0.01, vegMapAt(vCell + vec2(1.0, 0.0)).r) + step(0.01, vegMapAt(vCell - vec2(1.0, 0.0)).r)
                            + step(0.01, vegMapAt(vCell + vec2(0.0, 1.0)).r) + step(0.01, vegMapAt(vCell - vec2(0.0, 1.0)).r));
        // stand density seen by this tree: open sides (forest edges, clearings) and an open side toward the sun
        float vCover = vM.a * mix(0.3, 1.0, vOcc4) * mix(1.0, mix(0.25, 1.0, vOcc * 0.5), 1.0 - max(uSunDir.y, 0.0));
        vVegAlb = vegTreeColour(vS, vh, vh2) / max(uVegLeaf[vS], vec3(1e-3));          // per-tree tint (ratio)
        vVegTrans = vegTransRatio(vConif);
        vVegMisc = vec4(mix(0.25, 1.0, vM.b), vCover, vConif, 1.0);
        vVegHD = vec3(0.0);
        vVegFade = vec2(vDist, vh2.x);
        vVegSize = max(vSize, 1e-3);
        vec3 objectNormal = vf;
        vegPos.y -= uTerrCurv * curvatureDrop(vDist);`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vegPos;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <dithering_fragment>', VEG_DBG_GLSL)
      .replace('#include <common>', `#include <common>
        ${FRAG_DECL_GLSL}
        ${neuralGLSL}
        ${OCT_GLSL}
        uniform sampler2D tVegImpA; uniform sampler2D tVegImpB; uniform vec4 uVegImp; uniform vec4 uVegRange;
        uniform vec4 uVegSp[${NSPECIES}];
        uniform float uVegBaseH[${NSPECIES}]; uniform mat4 uVegProj; uniform float uDepthReversed;
        varying vec3 vVegAlb; varying vec3 vVegP; varying vec2 vVegRot; varying vec2 vVegFade; varying float vVegSize; flat varying int vVegS;
        // sample one baked view (fx, fy) for the tree-local ray (P, v): returns albedo.rgb + coverage, and B channels
        void vegView(vec2 f, vec3 P, vec3 v, vec3 cc, float R, int s, float lod, out vec4 a, out vec4 b) {
          vec3 d = vegOctDec(f / (uVegImp.x - 1.0) * 2.0 - 1.0);
          vec3 r, u; vegFrameBasis(d, r, u);
          float t = dot(cc + d * (0.45 * R) - P, d) / dot(v, d);    // plane through the typical visible crown surface (not the centre): less misregistration between views
          vec3 q = P + v * t - cc;
          vec2 l = vec2(dot(q, r), dot(q, u)) / R;
          if (max(abs(l.x), abs(l.y)) > 0.995) { a = vec4(0.0); b = vec4(0.5); return; }
          int bx = s % ${IMP_COLS}, by = s / ${IMP_COLS};
          vec2 px = (vec2(float(bx) * uVegImp.x + f.x, float(by) * uVegImp.x + f.y) + 0.5 + 0.5 * l * (1.0 - 1.0 / uVegImp.y)) * uVegImp.y;
          vec2 uv = px / uVegImp.zw;
          a = textureLod(tVegImpA, uv, lod); b = textureLod(tVegImpB, uv, lod);
          float ia = 1.0 / max(a.a, 1e-3); a.rgb *= ia; b *= ia;      // un-premultiply (atlases are cleared to 0)
        }`)
      .replace('#include <map_fragment>', /* glsl */`
        int vS = vVegS;
        vec4 sp = uVegSp[vS];
        vec3 cc = vec3(0.0, sp.x, 0.0);
        float R = sp.y;
        vec3 vW = normalize(cameraPosition - vVegWorld);
        float ca = cos(-vVegRot.x), sa = sin(-vVegRot.x);
        vec3 v = vec3(ca * vW.x - sa * vW.z, vW.y, sa * vW.x + ca * vW.z);
        v.xz /= vVegRot.y; v = normalize(v);
        vec3 P = vVegP;
        vec2 g = (vegOctEnc(v) * 0.5 + 0.5) * (uVegImp.x - 1.0);
        // mip level from the screen footprint of a frame texel
        vec2 dp = vec2(length(dFdx(P)), length(dFdy(P))) / (2.0 * R) * uVegImp.y;
        float lod = max(0.0, log2(max(dp.x, dp.y)));
        vec4 A, B;
        #if VEG_IMP_BLEND
          vec2 g0 = min(floor(g), uVegImp.x - 2.0), fg = g - g0;
          vec4 a00, b00, a10, b10, a01, b01, a11, b11;
          vegView(g0, P, v, cc, R, vS, lod, a00, b00);
          vegView(g0 + vec2(1.0, 0.0), P, v, cc, R, vS, lod, a10, b10);
          vegView(g0 + vec2(0.0, 1.0), P, v, cc, R, vS, lod, a01, b01);
          vegView(g0 + vec2(1.0, 1.0), P, v, cc, R, vS, lod, a11, b11);
          vec4 w = vec4((1.0 - fg.x) * (1.0 - fg.y), fg.x * (1.0 - fg.y), (1.0 - fg.x) * fg.y, fg.x * fg.y);
          vec4 wa = w * vec4(a00.a, a10.a, a01.a, a11.a);
          float cov = wa.x + wa.y + wa.z + wa.w;
          A.a = dot(w, vec4(a00.a, a10.a, a01.a, a11.a));
          float iw = 1.0 / max(cov, 1e-4);
          A.rgb = (a00.rgb * wa.x + a10.rgb * wa.y + a01.rgb * wa.z + a11.rgb * wa.w) * iw;
          B = (b00 * wa.x + b10 * wa.y + b01 * wa.z + b11 * wa.w) * iw;
        #else
          vegView(floor(g + 0.5), P, v, cc, R, vS, lod, A, B);
        #endif
        A.a *= 1.0 + 0.7 * lod;
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + vVegFade.y);
        float vis = smoothstep(uVegRange.x - uVegRange.y, uVegRange.x, vVegFade.x) * (1.0 - smoothstep(uVegRange.z, uVegRange.w, vVegFade.x));
        if (A.a < 0.5 || ign >= vis) discard;
        vec3 alb = A.rgb * A.rgb;
        diffuseColor.rgb = alb * vVegAlb;
        vec3 nL = vegNrmDec(B.xy);
        float cr = cos(vVegRot.x), sr = sin(vVegRot.x);
        vec3 nWo = normalize(vec3(cr * nL.x - sr * nL.z, nL.y, sr * nL.x + cr * nL.z));
        float vegH = B.z, vegD = B.w;
        // azimuth of the visible point around the trunk (the crown network's input, as on the meshes): the view ray's
        // first hit on a sphere of 0.85 R about the crown centre (closest approach at the rim)
        vec3 oc = P - cc;
        float bq = dot(oc, v), disc = bq * bq - dot(oc, oc) + 0.72 * R * R;
        vec3 X = oc - v * (disc > 0.0 ? bq - sqrt(disc) : bq);
        vec2 Xw = vec2(cr * X.x - sr * X.z, sr * X.x + cr * X.z);
        vec2 sunH = normalize(uSunDir.xz + 1e-4);
        float xl = length(Xw);
        vec3 vegHD = vec3(vegH, vegD, xl > 1e-3 ? dot(Xw / xl, sunH) : 0.0);
        vec3 vegTransCol = diffuseColor.rgb * vVegTrans;
        // per-pixel depth of the visible crown surface (its height from h_rel, found along the view ray), so where
        // crowns overlap the higher foliage wins as it does on the meshes (quad depth alone would let a neighbour's
        // low crown edge cover a crown top)
        {
          float bh = uVegBaseH[vS];
          float yS = bh + vegH * (1.0 - bh);
          float sH = clamp((P.y - yS) / max(v.y, 0.05), 0.0, 2.0 * R);
          float sAl = mix(0.35 * R, sH, smoothstep(0.25, 0.6, v.y));
          vec3 pv = -vViewPosition;
          vec4 cl = uVegProj * vec4(pv * (1.0 + sAl * vVegSize / max(length(pv), 1e-3)), 1.0);
          float zn = cl.z / cl.w;
          gl_FragDepth = uDepthReversed > 0.5 ? zn : zn * 0.5 + 0.5;
        }`)
      .replace('#include <normal_fragment_maps>', 'normal = normalize(mat3(viewMatrix) * nWo);')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.6, 0.8, vVegMisc.z);')
      .replace('#include <aomap_fragment>', VEG_LIGHT_GLSL.replace(/vVegHD/g, 'vegHD').replace(/vVegTrans/g, 'vegTransCol'));
  };
  mat.customProgramCacheKey = () => 'skyward-veg-far-' + (blend ? 1 : 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-far'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.castShadow = false; mesh.receiveShadow = true;
  return { mesh, dispose() { geo.dispose(); mat.dispose(); } };
}
