// Ground shadows and contact darkening of every tree in the placement map (out to the impostor range), one instanced
// draw of small ground-hugging grids, multiplied into the lit scene (blend dst * src):
//   - the crown's cast shadow: the crown ellipsoid projected along the sun onto the ground (soft, its density
//     depends on the species: conifers are darker), long at low sun;
//   - contact occlusion: a soft dark disc around the trunk (sky blocked by the crown).
// Where the engine's sun shadow map covers the ground the near trees already cast real shadows into it, so only the
// contact term is kept there; the terrain shadow of the tree's cell removes the cast shadow inside mountain shade.
// Instances of empty cells collapse to degenerate triangles in the vertex shader. URL vegShadow=0 turns it off.
import * as THREE from 'three';
import { vegVertexCommon, VEG_SM_COVER_GLSL } from './common.js';
import { SPECIES } from './species.js';

const NX = 4, NY = 3;          // grid vertices across / along the sun

export function createForestShadows(ctx, { L, G, U, info }) {
  const pos = [], idx = [];
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) pos.push(i / (NX - 1) * 2 - 1, j / (NY - 1), 0);
  for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
    const a = j * NX + i, b = a + 1, c = a + NX, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(idx);
  geo.instanceCount = G * G;
  // per species: crown radius (fraction of H), crown centre height, crown half height, shadow density
  const crown = SPECIES.map((s, i) => new THREE.Vector4(info[i].rmax * 0.85, s.base + (1 - s.base) * 0.5, (1 - s.base) * 0.5,
    s.group === 'conifer' ? 0.85 : s.shape === 'dome' ? 0.6 : s.shape === 'palm' ? 0.45 : 0.75));
  const SU = ctx.pipeline?.shadow?.uniforms;
  const smOK = !!(SU && SU.uSunShadowMatrix && SU.uSunShadowRect && SU.uSunShadowParams);
  const uniforms = {
    ...U, uVegCrown: { value: crown },
    ...(smOK ? { uSunShadowMatrix: SU.uSunShadowMatrix, uSunShadowRect: SU.uSunShadowRect, uSunShadowParams: SU.uSunShadowParams } : {}),
  };
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms, transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
    defines: smOK ? { VEG_SM_COVER: 1 } : {},
    vertexShader: /* glsl */`
      precision highp float; precision highp int; precision highp sampler2DArray;
      ${vegVertexCommon(L)}
      uniform vec3 uSunDir;
      uniform vec4 uVegCrown[${SPECIES.length}];
      out vec2 vL; out vec4 vE; out vec3 vW; out float vFade;
      void main() {
        vec2 vt = vec2(float(gl_InstanceID % int(uVegWin.z)), float(gl_InstanceID / int(uVegWin.z)));
        vec2 vCell = uVegWin.xy + mod(vt - mod(uVegWin.xy, uVegWin.z) + uVegWin.z, uVegWin.z);
        vec4 vM = texelFetch(tVegMap, ivec2(vt), 0);
        int vS = int(vM.g + 0.5);
        vec2 vBase = vegCellRXZ(vCell);
        float vDist = distance(vBase, uTerrCam.xz);
        float H = vM.r;
        vec2 vh = vegHash(vCell + 60000.0);
        vec4 cw = uVegCrown[vS];
        float R = cw.x * H * mix(0.86, 1.18, vh.y), zc = cw.y * H, hz = cw.z * H;
        // sun frame on the ground: a = toward the shadow (away from the sun), b = across
        vec2 sh = -uSunDir.xz; float shl = length(sh);
        vec2 a = shl > 1e-3 ? sh / shl : vec2(1.0, 0.0), b = vec2(-a.y, a.x);
        float mu = max(uSunDir.y, 0.12), cot = sqrt(max(1.0 - mu * mu, 0.0)) / mu;
        // shadow ellipse: centre offset zc * cot, half length along a = R / mu-ish (vertical extent hz smears it)
        float off = zc * cot, La = R + hz * cot, Lb = R;
        float back = R * 1.15, front = off + La;
        vec2 p = vBase + a * mix(-back, front, position.y) + b * position.x * max(Lb, R * 1.15);
        float gy = vegGround(p) + 0.12 + vDist * 0.0015;
        vec3 w = vec3(p.x, gy, p.y);
        w.y -= uTerrCurv * curvatureDrop(vDist);
        if (H <= 0.0 || vDist > uVegRange.w) w = vec3(0.0, -1.0e5, 0.0);
        // local coordinates in metres (x across, y along from the base) and the ellipse / disc parameters
        vL = vec2(position.x * max(Lb, R * 1.15), mix(-back, front, position.y));
        vE = vec4(off, La, Lb, R);
        vW = w;
        vFade = (1.0 - smoothstep(uVegRange.z, uVegRange.w, vDist)) * cw.w * mix(0.25, 1.0, vM.b) * smoothstep(0.02, 0.12, uSunDir.y);
        vFade = min(vFade, 1.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      ${smOK ? VEG_SM_COVER_GLSL : ''}
      in vec2 vL; in vec4 vE; in vec3 vW; in float vFade;
      out vec4 outColor;
      void main() {
        // cast shadow: soft ellipse
        vec2 q = vec2(vL.x / vE.z, (vL.y - vE.x) / vE.y);
        float d = length(q);
        float castK = (1.0 - smoothstep(0.45, 1.0, d)) * vFade;
        #ifdef VEG_SM_COVER
          castK *= 1.0 - vegShadowMapCover(vW);
        #endif
        // contact occlusion around the trunk (sky blocked by the crown overhead)
        float r = length(vL) / vE.w;
        float ao = (1.0 - smoothstep(0.1, 1.15, r)) * 0.38;
        float k = 1.0 - max(castK * 0.62, ao);
        outColor = vec4(vec3(k), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'veg-ground-shadow'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
  mesh.renderOrder = -1;
  return { mesh, triangles: G * G * (NX - 1) * (NY - 1) * 2, dispose() { geo.dispose(); mat.dispose(); } };
}
