// Aircraft kit — the skin material: what makes painted metal read as painted metal instead of plastic.
//
// The atlas paints four canvases (colour, height, roughness/metalness, optional emissive + occlusion). This module
//   * packs them on the GPU into two textures:  DETAIL  (full res)   RG = tangent-space normal, B = roughness, A = metalness
//                                               AUX     (1/4 res)    R = baked ambient occlusion, G = cavity (dirt in gaps)
//   * builds a MeshPhysicalMaterial whose fragment shader adds, per finish class and in OBJECT space (so it also works on
//     flat swatch cells and costs no atlas texels or build time):
//       gloss paint      clearcoat over a duller pigment layer, orange peel in the clearcoat, rain streaks in its roughness
//       matt paint       patchy sheen (handled / walked-on areas go glossier), chalking on sun-facing surfaces, grime below
//       bare metal       brushed micro-normal along the airflow, roughness breakup, heat tint on warm (titanium) colours
//       every skin       "oil canning": the skin pulled between frames and stringers, visible in grazing reflections
//       cavities         per-vertex occlusion (wheel wells, ducts) and the atlas occlusion layer darken ambient light
// Everything is keyed on the roughness / metalness the pens already paint, so existing aircraft get it without changes.
import * as THREE from 'three';

/** Defaults of the `skin` options (createAtlas({ skin }) or atlas.material(ctx, { skin })). */
export const SKIN_DEFAULTS = {
  weathering: 0.5,     // 0 factory fresh … 1 hard-used: sheen patches, streaks, chalking, grime, dirt in panel gaps
  waviness: 1,         // oil-canning strength (1 ≈ 0.3° of skin slope); 0 for thick machined or composite skins
  framePitch: 0.45,    // metres between frames (airliners ≈ 0.5, fighters ≈ 0.3 – 0.4)
  orangePeel: 1,       // clearcoat texture on gloss paint
  clearcoat: 1,        // 0 disables the second specular lobe (it is also off at quality 'low')
  heatTint: 1,         // straw / purple / blue tint on warm-coloured bare metal
  cavity: 1,           // dirt in panel gaps and around fasteners, derived from the height layer
  mipBias: -0.35,      // sharper markings and stencils at glancing angles (anisotropic filtering does the rest)
  detail: true,        // false: no procedural detail at all (plain packed PBR)
};

let _noise3 = null;
/** Shared 32³ RGBA noise volume (four independent channels, tileable, mip-mapped). */
export function noiseVolume() {
  if (_noise3) return _noise3;
  const N = 32, d = new Uint8Array(N * N * N * 4);
  let a = 0x9e3779b9 | 0;
  for (let i = 0; i < d.length; i++) { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; d[i] = (t ^ (t >>> 14)) & 255; }
  const t = new THREE.Data3DTexture(d, N, N, N);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.unpackAlignment = 1; t.needsUpdate = true;
  return (_noise3 = t);
}

// ---- GPU packing ---------------------------------------------------------------------------------------------------------
let _bake = null;
function bakeRig() {
  if (_bake) return _bake;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, fog: false,
    uniforms: { tH: { value: null }, tO: { value: null }, tA: { value: null }, uTexel: { value: new THREE.Vector2() }, uP: { value: new THREE.Vector4() } },
    vertexShader: 'in vec3 position; out vec2 vUv; void main() { vUv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5); gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */`precision highp float; precision highp sampler2D;
      uniform sampler2D tH, tO, tA; uniform vec2 uTexel; uniform vec4 uP;   // x: normal strength, y: mode (0 detail, 1 aux), z: cavity gain
      in vec2 vUv; out vec4 o;
      float H(vec2 d) { return textureLod(tH, vUv + d * uTexel, 0.0).r; }
      void main() {
        if (uP.y < 0.5) {
          float l = H(vec2(-1, 0)), r = H(vec2(1, 0)), d = H(vec2(0, -1)), u = H(vec2(0, 1));
          float dl = H(vec2(-1, -1)), dr = H(vec2(1, -1)), ul = H(vec2(-1, 1)), ur = H(vec2(1, 1));
          vec2 g = vec2((ur + 2.0 * r + dr) - (ul + 2.0 * l + dl), (dl + 2.0 * d + dr) - (ul + 2.0 * u + ur)) * 0.25 * uP.x;   // inputs are sampled upside down (unflipped canvases)
          vec3 n = normalize(vec3(-g, 1.0));
          vec4 orm = texture(tO, vUv);
          o = vec4(n.xy * 0.5 + 0.5, orm.g, orm.b);
        } else {
          // cavity: how far the surface lies below its blurred neighbourhood (grooves, fastener rows, recesses)
          float wide = (textureLod(tH, vUv, 2.0).r + textureLod(tH, vUv, 3.0).r + textureLod(tH, vUv, 4.0).r) / 3.0;
          float cav = clamp((0.5 - wide) * uP.z, 0.0, 1.0);
          o = vec4(texture(tA, vUv).r, cav, 0.0, 1.0);
        }
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false;
  const scene = new THREE.Scene(); scene.add(mesh);
  const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); white.needsUpdate = true;
  return (_bake = { scene, mat, cam: new THREE.Camera(), white });
}

/** Render targets that will hold the packed maps. */
export function packTargets(size, aniso) {
  const mk = (s, a) => {
    const rt = new THREE.WebGLRenderTarget(s, s, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, stencilBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, colorSpace: THREE.NoColorSpace });
    rt.texture.anisotropy = a; rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    return rt;
  };
  return { detail: mk(size, aniso), aux: mk(Math.max(64, size >> 2), 1) };
}

/** Pack the painted canvases into the two render targets (one draw each). Renderer state is restored. */
export function packOnGPU(renderer, layers, targets, o = {}) {
  const B = bakeRig(), u = B.mat.uniforms;
  const tex = (canvas, mips) => { const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = mips; t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.flipY = false; t.premultiplyAlpha = true; return t; };
  const tH = tex(layers.height.canvas, true); tH.format = THREE.RedFormat;      // one channel: a quarter of the upload
  const tO = tex(layers.orm.canvas, false), tA = layers.ao ? tex(layers.ao.canvas, false) : B.white;
  const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear, prevShadow = renderer.shadowMap.autoUpdate, prevXR = renderer.xr.enabled;
  renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false; renderer.autoClear = true;
  try {
    u.tH.value = tH; u.tO.value = tO; u.tA.value = tA; u.uTexel.value.set(1 / layers.height.canvas.width, 1 / layers.height.canvas.height);
    u.uP.value.set(o.strength ?? 2.2, 0, (o.cavity ?? 1) * 9, 0);
    renderer.setRenderTarget(targets.detail); renderer.render(B.scene, B.cam);
    u.uP.value.y = 1;
    renderer.setRenderTarget(targets.aux); renderer.render(B.scene, B.cam);
  } finally {
    renderer.setRenderTarget(prevRT); renderer.autoClear = prevAuto; renderer.shadowMap.autoUpdate = prevShadow; renderer.xr.enabled = prevXR;
    u.tH.value = u.tO.value = u.tA.value = null;
    tH.dispose(); tO.dispose(); if (tA !== B.white) tA.dispose();
  }
}

/** Same packing on the CPU (no renderer available): returns { detail, aux } DataTextures. */
export function packOnCPU(layers, o = {}) {
  const hc = layers.height.canvas, S = hc.width, src = layers.height.ctx.getImageData(0, 0, S, S).data;
  const oc = layers.orm.canvas, So = oc.width, orm = layers.orm.ctx.getImageData(0, 0, So, So).data, k = (o.strength ?? 2.2) / 255, q = So / S;
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    const yu = y > 0 ? y - 1 : y, yd = y < S - 1 ? y + 1 : y, row = (S - 1 - y) * S * 4, oy = Math.min(So - 1, Math.floor(y * q)) * So;
    for (let x = 0; x < S; x++) {
      const xl = x > 0 ? x - 1 : x, xr = x < S - 1 ? x + 1 : x;
      const dx = (src[(y * S + xr) * 4] - src[(y * S + xl) * 4]) * k, dy = (src[(yd * S + x) * 4] - src[(yu * S + x) * 4]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = row + x * 4, j = (oy + Math.min(So - 1, Math.floor(x * q))) * 4;
      out[i] = (-dx * inv * 0.5 + 0.5) * 255; out[i + 1] = (dy * inv * 0.5 + 0.5) * 255; out[i + 2] = orm[j + 1]; out[i + 3] = orm[j + 2];
    }
  }
  const detail = new THREE.DataTexture(out, S, S, THREE.RGBAFormat, THREE.UnsignedByteType); detail.flipY = false;
  const aux = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1); aux.needsUpdate = true;
  return { detail, aux };
}

// ---- the material ---------------------------------------------------------------------------------------------------------
const VERT_PARS = /* glsl */`
attribute float kitOcc;
varying vec3 vKitP; varying vec3 vKitN; varying float vKitOcc;`;
const VERT_MAIN = /* glsl */`
vKitP = position; vKitN = normal; vKitOcc = kitOcc;`;

const FRAG_PARS = /* glsl */`
varying vec3 vKitP; varying vec3 vKitN; varying float vKitOcc;
uniform vec4 uKitSkin;    // x: waviness slope, y: frame pitch (m), z: weathering, w: orange peel slope
uniform vec4 uKitSkin2;   // x: clearcoat, y: colour mip bias, z: heat tint, w: cavity dirt
uniform sampler2D tKitAux;
#ifndef USE_NORMALMAP_OBJECTSPACE
  uniform mat3 normalMatrix;
#endif
#ifdef KIT_DETAIL
  uniform highp sampler3D tKitNoise;
#endif
vec3 kitTangential( vec3 v, vec3 n ) { return v - n * dot( v, n ); }`;

const FRAG_MAP = /* glsl */`
#ifdef USE_MAP
  diffuseColor *= texture2D( map, vMapUv, uKitSkin2.y );
#endif`;

// replaces <roughnessmap_fragment>: one fetch gives normal.xy, roughness and metalness
const FRAG_ROUGH = /* glsl */`
vec4 kitD = texture2D( normalMap, vNormalMapUv );
vec4 kitA = texture2D( tKitAux, vNormalMapUv );
float roughnessFactor = roughness * kitD.b;`;
const FRAG_METAL = /* glsl */`
float metalnessFactor = metalness * kitD.a;`;

// replaces <normal_fragment_maps>
const FRAG_NORMAL = /* glsl */`
vec3 kitMapN = vec3( ( kitD.rg * 2.0 - 1.0 ) * normalScale, 0.0 );
kitMapN.z = sqrt( saturate( 1.0 - dot( kitMapN.xy, kitMapN.xy ) ) );
normal = normalize( tbn * kitMapN );
float kitR0 = roughnessFactor, kitM0 = metalnessFactor;
float kitRubber = ( 1.0 - kitM0 ) * smoothstep( 0.84, 0.9, kitR0 );
float kitGloss = ( 1.0 - kitM0 ) * smoothstep( 0.36, 0.24, kitR0 );
float kitMetal = smoothstep( 0.55, 0.9, kitM0 );
float kitCav = kitA.g * uKitSkin2.w;
float kitAO = ( 1.0 - vKitOcc ) * kitA.r;
float kitCC = 0.0, kitCCR = 0.1;
vec3 kitCCN = normal;
{
  vec3 kC = diffuseColor.rgb; float kR = kitR0, kW = uKitSkin.z * mix( 1.0, 0.6, kitGloss ), kSkin = 1.0 - kitRubber;
  #ifdef KIT_DETAIL
    vec3 kP = vKitP, kN = normalize( vKitN );
    float kUp = kN.y, kSide = 1.0 - abs( kUp );
    vec4 nA = texture( tKitNoise, kP * vec3( 0.085, 0.085, 0.05 ) );                      // half-metre blotches
    vec4 nB = texture( tKitNoise, kP * vec3( 0.9, 0.9, 0.22 ) + 0.37 );                   // 4 cm x 14 cm, along the airflow
    vec4 nS = texture( tKitNoise, vec3( kP.x * 1.1, kP.y * 0.09, kP.z * 1.1 ) + 0.61 );   // vertical run-off streaks, 3 cm x 35 cm
    float kStreak = smoothstep( 0.62, 0.92, nS.r ) * smoothstep( 0.35, 0.7, nA.a + ( nS.g - 0.5 ) * 0.5 ) * kSide * kSide;
    float kLum = dot( kC, vec3( 0.3, 0.59, 0.11 ) );
    // tone: slow mottling, chalking where the sun hits, grime where water runs and underneath
    kC *= 1.0 + kW * kSkin * ( ( nA.r - 0.5 ) * 0.11 + ( nB.g - 0.5 ) * 0.05 );
    kC = mix( kC, vec3( kLum ) * 1.05 + 0.012, kW * 0.2 * max( kUp, 0.0 ) * nA.g * ( 1.0 - kitMetal ) * kSkin );
    kC *= 1.0 - kW * kSkin * ( 0.14 * kStreak + 0.14 * max( - kUp, 0.0 ) * nB.b );
    // sheen: patchy, handled areas of matt paint go glossier, dried streaks go matt
    kR += kW * kSkin * ( ( nB.r - 0.5 ) * 0.16 + ( nA.b - 0.5 ) * 0.12 + 0.16 * kStreak );
    kR -= kW * 0.22 * smoothstep( 0.58, 0.85, nA.a ) * ( 1.0 - kitM0 ) * smoothstep( 0.45, 0.62, kitR0 ) * kSkin;
    // heat tint on warm bare metal (titanium, hot sections): straw, purple, blue
    float kHeat = kitMetal * smoothstep( 0.03, 0.12, kC.r - kC.b ) * uKitSkin2.z;
    float kHt = fract( nA.r * 1.7 + nB.a * 0.6 );
    vec3 kPal = kHt < 0.5 ? mix( vec3( 1.22, 0.98, 0.62 ), vec3( 0.86, 0.62, 0.96 ), kHt * 2.0 ) : mix( vec3( 0.86, 0.62, 0.96 ), vec3( 0.62, 0.82, 1.22 ), kHt * 2.0 - 1.0 );
    kC *= mix( vec3( 1.0 ), kPal, kHeat * 0.42 );
    // oil canning: each bay between frames (z) and stringers / ribs (x on wings and crowns, y on body sides) pulls in or out
    float kL = uKitSkin.y, kTop = step( 0.6, abs( kUp ) );
    vec2 kUV = vec2( kP.z / kL, mix( kP.y, kP.x, kTop ) / ( kL * 0.55 ) ), kCell = floor( kUV ), kF = kUV - kCell;
    float kAmp = textureLod( tKitNoise, vec3( ( kCell + 0.5 ) / 32.0, 0.5 / 32.0 ), 0.0 ).r * 1.6 - 0.55;
    float kFade = ( 1.0 - smoothstep( kL * 0.12, kL * 0.45, length( fwidth( kP ) ) ) ) * smoothstep( 0.0, 0.12, abs( abs( kUp ) - 0.6 ) );
    vec2 kSn = sin( 3.14159265 * kF ), kS2 = sin( 6.2831853 * kF );
    vec2 kSl = vec2( kS2.x * kSn.y * kSn.y, kSn.x * kSn.x * kS2.y ) * kAmp * kFade;
    vec3 kG = vec3( kSl.y * kTop, kSl.y * ( 1.0 - kTop ), kSl.x ) * uKitSkin.x + ( nA.gba - 0.5 ) * uKitSkin.x * 0.9;
    // brushed bare metal: fine grain along the airflow
    vec4 nM = texture( tKitNoise, kP * vec3( 9.0, 9.0, 0.3 ) + 0.13 );
    kG += ( nM.rgb - 0.5 ) * 0.11 * kitMetal * smoothstep( 0.12, 0.3, kitR0 );
    normal = normalize( normal + kitTangential( normalMatrix * kG, normal ) * kSkin );
    // orange peel lives in the clear coat (or in the paint itself when there is no coat)
    vec3 kPeel = ( texture( tKitNoise, kP * 13.0 + 0.29 ).rgb - 0.5 ) * uKitSkin.w * kitGloss;
    kitCCN = normalize( normal + kitTangential( normalMatrix * kPeel, normal ) );
    #ifndef USE_CLEARCOAT
      normal = kitCCN;
    #endif
  #endif
  // dirt collects in panel gaps and around fasteners
  kC *= 1.0 - ( 0.22 + 0.5 * kW ) * kitCav * kSkin;
  kR = mix( kR, max( kR, 0.78 ), kitCav );
  kR = clamp( kR, 0.03, 1.0 );
  #ifdef USE_CLEARCOAT
    kitCC = kitGloss * uKitSkin2.x * ( 1.0 - 0.6 * kitCav );
    kitCCR = clamp( kR * 0.5, 0.035, 0.3 );
    kR = mix( kR, max( kR, 0.42 ), kitCC );
  #endif
  // specular anti-aliasing for the normal map (three only accounts for the geometric normal)
  vec3 kDn = max( abs( dFdx( normal ) ), abs( dFdy( normal ) ) );
  kR = min( 1.0, kR + 0.5 * max( kDn.x, max( kDn.y, kDn.z ) ) );
  diffuseColor.rgb = kC; roughnessFactor = kR;
}`;

const FRAG_CC_NORMAL = /* glsl */`
#ifdef USE_CLEARCOAT
  vec3 clearcoatNormal = kitCCN;
#endif`;

const FRAG_LIGHTS = /* glsl */`
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat = kitCC;
  material.clearcoatRoughness = min( max( kitCCR, 0.0525 ) + geometryRoughness, 1.0 );
#endif`;

const FRAG_AO = /* glsl */`
{
  float kAOd = mix( 1.0, kitAO, 0.6 );
  reflectedLight.indirectDiffuse *= kitAO;
  reflectedLight.directDiffuse *= kAOd; reflectedLight.directSpecular *= kAOd;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= kitAO; clearcoatSpecularDirect *= kAOd;
  #endif
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), kitAO, material.roughness );
  #else
    reflectedLight.indirectSpecular *= kitAO;
  #endif
}`;

/**
 * The atlas material. tex = { map, normalMap (packed DETAIL), auxMap, emissiveMap }.
 * opts: { envMapIntensity, normalScale, emissiveIntensity, skin: { …SKIN_DEFAULTS } }
 */
export function skinMaterial(ctx, tex, opts = {}) {
  const level = ctx?.quality?.level || 'high', sk = { ...SKIN_DEFAULTS, ...(opts.skin || {}) };
  const detail = sk.detail !== false && level !== 'low', coat = detail && sk.clearcoat > 0;
  const params = { map: tex.map, normalMap: tex.normalMap, roughness: 1, metalness: 1 };
  const m = coat ? new THREE.MeshPhysicalMaterial({ ...params, clearcoat: 1, clearcoatRoughness: 0.1 }) : new THREE.MeshStandardMaterial(params);
  m.normalScale.setScalar(opts.normalScale ?? 1);
  if (opts.envMapIntensity !== undefined) m.envMapIntensity = opts.envMapIntensity;
  if (tex.emissiveMap) { m.emissiveMap = tex.emissiveMap; m.emissive.setRGB(1, 1, 1); m.emissiveIntensity = opts.emissiveIntensity ?? 0; }
  const u = {
    uKitSkin: { value: new THREE.Vector4(0.0052 * sk.waviness, Math.max(0.1, sk.framePitch), sk.weathering, 0.02 * sk.orangePeel) },
    uKitSkin2: { value: new THREE.Vector4(sk.clearcoat, sk.mipBias, sk.heatTint, sk.cavity) },
    tKitAux: { value: tex.auxMap },
  };
  if (detail) u.tKitNoise = { value: noiseVolume() };
  m.userData.kitSkin = u; m.userData.skin = sk;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>' + VERT_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>' + VERT_MAIN);
    shader.fragmentShader = (detail ? '#define KIT_DETAIL\n' : '') + shader.fragmentShader
      .replace('#include <common>', '#include <common>' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', FRAG_ROUGH)
      .replace('#include <metalnessmap_fragment>', FRAG_METAL)
      .replace('#include <normal_fragment_maps>', FRAG_NORMAL)
      .replace('#include <clearcoat_normal_fragment_begin>', FRAG_CC_NORMAL)
      .replace('#include <lights_physical_fragment>', FRAG_LIGHTS)
      .replace('#include <aomap_fragment>', FRAG_AO);
  };
  m.customProgramCacheKey = () => 'kit-skin|' + (detail ? 'd' : '') + (coat ? 'c' : '');
  return m;
}
