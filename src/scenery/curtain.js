// Curtain-wall glazing with interior depth ("interior mapping"): each storey behind the glass is ray-traced as a box
// (floor, ceiling with light strips, back wall with shop fronts / gate rooms, side partitions) in the fragment shader,
// so terminals read as buildings with something inside them at every viewing angle. Mullions, transoms and floor-edge
// spandrels are procedural. Glass reflects the environment through the standard PBR path (Fresnel included); the
// interior is added as emitted radiance attenuated by the glass, lit by daylight by day and by fittings at night.
//
// Works on vertical faces built by MultiBuilder (uv in tiles of TILE metres, u along cross(up, normal), v = height).
import * as THREE from 'three';

export const CURTAIN_TILE = [12, 9];

export function makeCurtainMaterial(baseMap) {
  const uniforms = {
    uIntDay: { value: 0.15 },     // interior radiance scale from daylight
    uIntNight: { value: 0 },      // 0..1 artificial lighting
  };
  const mat = new THREE.MeshStandardMaterial({ map: baseMap, color: 0xffffff, roughness: 0.05, metalness: 0.0, vertexColors: true });
  mat.userData.curtain = uniforms;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCwN; varying vec3 vCwP;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 cwp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
          #endif
          vCwP = (modelMatrix * cwp).xyz; vCwN = normalize(mat3(modelMatrix) * objectNormal); }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCwN; varying vec3 vCwP;
        uniform float uIntDay; uniform float uIntNight;
        float cwHash(vec2 p) { return fract(sin(dot(p, vec2(41.37, 289.11))) * 43758.5453); }
        float cwLine(float x, float p, float w) { float fw = max(fwidth(x), 1e-4); float d = abs(fract(x / p + 0.5) - 0.5) * p; return 1.0 - smoothstep(w * 0.5 - fw * 0.5, w * 0.5 + fw * 0.5, d); }
        float gCwFrame; vec3 gCwInterior;`)
      .replace('#include <map_fragment>', `
        {
          vec3 N = normalize(vCwN);
          vec2 fm = vMapUv * vec2(${CURTAIN_TILE[0].toFixed(1)}, ${CURTAIN_TILE[1].toFixed(1)});   // metres: along, up
          const float HS = 4.5;                                   // storey height
          float storeyY = fm.y - floor(fm.y / HS) * HS;
          // frame: mullions every 1.5 m (6 cm), transom at 3.0 m, opaque floor-edge spandrel 3.6–4.5 m of each storey
          float mull = cwLine(fm.x, 1.5, 0.07);
          float tran = cwLine(storeyY - 3.0, 100.0, 0.06);
          float span = step(3.6, storeyY);
          float frame = max(max(mull, tran), span);
          if (abs(N.y) > 0.5) frame = 0.0;
          gCwFrame = frame;
          gCwInterior = vec3(0.0);
          if (abs(N.y) <= 0.5 && span < 0.5) {
            vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), N));
            vec3 V = normalize(vCwP - cameraPosition);
            vec3 d = vec3(dot(V, T), V.y, -dot(V, N));                // ray in room space: x along, y up, z depth
            d.z = max(d.z, 1e-3);
            const float DEPTH = 9.0, CEIL = 3.4, ROOM = 12.0;
            float x0 = floor(fm.x / ROOM) * ROOM;
            vec2 cell = vec2(floor(fm.x / ROOM), floor(fm.y / HS));
            float h = cwHash(cell);
            float tB = DEPTH / d.z;
            float tY = d.y < 0.0 ? -storeyY / d.y : max(CEIL - storeyY, 0.0) / max(d.y, 1e-4);
            float tX = d.x > 0.0 ? (x0 + ROOM - fm.x) / d.x : (x0 - fm.x) / min(d.x, -1e-4);
            float t = min(tB, min(tY, tX));
            vec3 hp = vec3(fm.x, storeyY, 0.0) + d * t;
            vec3 alb; float lightK = 1.0;
            if (t == tY && d.y < 0.0) {                               // floor: polished stone tiles
              float tile = cwHash(floor(hp.xz / 1.2));
              alb = vec3(0.32, 0.31, 0.29) * (0.85 + 0.25 * tile);
            } else if (t == tY) {                                     // ceiling with linear light strips
              float strip = cwLine(hp.z, 2.4, 0.25);
              alb = vec3(0.7) ; lightK = 1.0 + strip * 6.0 * uIntNight;
            } else if (t == tX) {                                     // partitions between rooms
              alb = vec3(0.45, 0.44, 0.42) * (0.8 + 0.3 * h);
            } else {                                                  // back wall: shop fronts / gate rooms / offices
              vec3 c1 = vec3(0.55, 0.5, 0.42), c2 = vec3(0.2, 0.3, 0.45), c3 = vec3(0.6, 0.25, 0.15), c4 = vec3(0.35, 0.36, 0.37);
              alb = h < 0.25 ? c1 : h < 0.5 ? c2 : h < 0.7 ? c3 : c4;
              float sign = step(2.2, hp.y) * step(hp.y, 2.9) * step(0.5, fract(hp.x / 6.0 + h));
              lightK += sign * (2.0 + 6.0 * uIntNight);
            }
            // daylight falls off with depth into the room; artificial light is even, some rooms dark at night
            float day = uIntDay * (0.35 + 0.65 * exp(-hp.z / 4.0));
            float night = uIntNight * 0.55 * step(0.18, cwHash(cell + 7.7));
            gCwInterior = alb * lightK * (day + night) * vec3(1.0, 0.97, 0.9);
            // the near edge of each storey's floor slab, seen through the glass, is dark
            gCwInterior *= 0.55 + 0.45 * smoothstep(0.0, 0.25, t * length(d.xy));
          }
          diffuseColor.rgb *= mix(vec3(0.015, 0.02, 0.022), vec3(0.42, 0.44, 0.46), frame);
        }`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = mix(0.04, 0.45, gCwFrame);`)
      .replace('#include <metalnessmap_fragment>', `float metalnessFactor = mix(0.0, 0.7, gCwFrame);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          float cosT = clamp(abs(dot(normalize(vNormal), Vv)), 0.0, 1.0);
          float Fr = 0.04 + 0.96 * pow(1.0 - cosT, 5.0);
          totalEmissiveRadiance += gCwInterior * (1.0 - gCwFrame) * (1.0 - Fr) * vec3(0.55, 0.63, 0.63);
          // solar-control coating: a few percent extra mirror reflectance on top of the dielectric Fresnel term
          #if defined( USE_ENVMAP ) && defined( ENVMAP_TYPE_PMREM )
          totalEmissiveRadiance += getIBLRadiance(Vv, normalize(vNormal), 0.04) * 0.1 * (1.0 - gCwFrame);
          #endif
        }`);
  };
  mat.customProgramCacheKey = () => 'scn-curtain';
  return mat;
}
