// Aircraft kit — non-atlas materials: glass and emissive lamps.
// (Painted / metal / rubber surfaces all live in the atlas material — see atlas.js FINISH.)
import * as THREE from 'three';
import { noiseVolume } from './skin.js';

/**
 * Canopy / windshield glass that reads correctly without the transmission pass:
 *   - alpha rises towards grazing angles (Fresnel), so the rim of a bubble canopy looks solid and the centre clear,
 *   - reflections (IBL and sun glint) are ADDED on top instead of being faded by the opacity,
 *   - falls back to an analytic sky/ground reflection and its own sun glint when the pass it is drawn in has no
 *     environment map or no lights (e.g. LAYERS.POST in a pipeline that only lights layer 0).
 *   - a pane has two surfaces: the dielectric reflection is that of both (≈ 1.9 × a single interface),
 *   - a thin, uneven film of dust scatters the light that falls on it, so sunlit glass shows a faint haze and reads as a
 *     surface instead of a hole (`dust`, 0 = factory clean).
 * opts: { tint = '#1c2a33', opacity = 0.16, edgeOpacity = 0.72, metalness = 0 (raise for gold / mirrored coatings),
 *         roughness = 0.03, reflect = 1, dust = 0.035 }
 * Presets: GLASS.clear, GLASS.smoke, GLASS.gold, GLASS.airliner
 */
export function glassMaterial(ctx, opts = {}) {
  const env = ctx?.env || {};
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(opts.tint ?? '#1c2a33'), metalness: opts.metalness ?? 0, roughness: opts.roughness ?? 0.03,
    transparent: true, opacity: opts.opacity ?? 0.16, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  m.envMapIntensity = opts.reflect ?? 1;
  const u = {
    uGlassEdge: { value: opts.edgeOpacity ?? 0.72 },
    uGlassSky: { value: env.ambientSky || new THREE.Color(0.3, 0.45, 0.75) },
    uGlassGround: { value: env.ambientGround || new THREE.Color(0.1, 0.09, 0.08) },
    uGlassSunDir: { value: env.sunDir || new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
    uGlassSunColor: { value: env.sunColor || new THREE.Color(4, 4, 4) },
    uGlassReflect: { value: opts.reflect ?? 1 },
    uGlassDust: { value: opts.dust ?? 0.035 },
    tKitNoise: { value: noiseVolume() },
  };
  m.userData.glassUniforms = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlassP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGlassP; uniform float uGlassDust; uniform highp sampler3D tKitNoise;
        uniform float uGlassEdge; uniform vec3 uGlassSky; uniform vec3 uGlassGround; uniform vec3 uGlassSunDir; uniform vec3 uGlassSunColor; uniform float uGlassReflect;`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 gN = normalize( normal );
          vec3 gV = normalize( vViewPosition );
          float gNV = clamp( abs( dot( gN, gV ) ), 0.0, 1.0 );
          float gFr = pow( 1.0 - gNV, 5.0 );
          vec3 gF0 = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
          vec3 gF = gF0 + ( 1.0 - gF0 ) * gFr;
          vec3 gSpec = totalSpecular * mix( 1.9, 1.0, metalnessFactor );   // outer + inner surface
          #ifndef USE_ENVMAP
            vec3 gRw = inverseTransformDirection( reflect( -gV, gN ), viewMatrix );
            vec3 gEnv = mix( uGlassGround, uGlassSky * 1.6, smoothstep( -0.12, 0.3, gRw.y ) );
            gSpec += gEnv * gF * uGlassReflect * mix( 1.9, 1.0, metalnessFactor );
          #endif
          #if NUM_DIR_LIGHTS == 0
            vec3 gL = normalize( ( viewMatrix * vec4( uGlassSunDir, 0.0 ) ).xyz );
            vec3 gH = normalize( gL + gV );
            float gNH = max( dot( gN, gH ), 0.0 ), gNL = max( dot( gN, gL ), 0.0 );
            float gA2 = 0.0004;
            float gD = gA2 / ( 3.14159 * pow( gNH * gNH * ( gA2 - 1.0 ) + 1.0, 2.0 ) );
            gSpec += uGlassSunColor * gF * min( gD, 4000.0 ) * gNL * 0.25 * uGlassReflect;
          #endif
          float gA = mix( opacity, uGlassEdge, pow( 1.0 - gNV, 3.0 ) );
          // dust film: lit like a pale diffuse surface, thicker where the noise says so and where the pane is seen obliquely
          float gDust = uGlassDust * ( 0.3 + 1.4 * texture( tKitNoise, vGlassP * vec3( 0.45, 0.45, 0.2 ) ).r * texture( tKitNoise, vGlassP * 2.1 + 0.3 ).g ) / max( gNV, 0.35 );
          vec3 gIrr = totalDiffuse / max( diffuseColor.rgb * ( 1.0 - metalnessFactor ), vec3( 0.03 ) );
          #if NUM_DIR_LIGHTS == 0
            gIrr += ( uGlassSky + uGlassSunColor * max( dot( gN, normalize( ( viewMatrix * vec4( uGlassSunDir, 0.0 ) ).xyz ) ), 0.0 ) * 0.3183 ) * 0.5;
          #endif
          gSpec += gIrr * 0.55 * gDust;
          gA = min( 1.0, gA + gDust );
          outgoingLight = totalDiffuse * gA + gSpec + totalEmissiveRadiance;
          diffuseColor.a = clamp( gA + dot( gSpec, vec3( 0.3333 ) ), 0.0, 1.0 );
        }
        gl_FragColor = vec4( outgoingLight, diffuseColor.a );`);
  };
  m.customProgramCacheKey = () => 'kit-glass';
  return m;
}

export const GLASS = {
  clear: { tint: '#22303a', opacity: 0.12, edgeOpacity: 0.65 },
  smoke: { tint: '#14181c', opacity: 0.3, edgeOpacity: 0.8 },
  gold: { tint: '#6e5a34', opacity: 0.1, edgeOpacity: 0.7, metalness: 0.4, roughness: 0.04, reflect: 1 },   // ITO / gold-film canopies (F-16, F-22)
  airliner: { tint: '#0d151c', opacity: 0.45, edgeOpacity: 0.85, roughness: 0.04 },
  hud: { tint: '#7fae8a', opacity: 0.08, edgeOpacity: 0.5, roughness: 0.02, reflect: 0.6, dust: 0.015 },
};

/**
 * HDR emissive material for lamps; set `material.color.setRGB(r, g, b)` (linear radiance, may exceed 1) each frame; the
 * vertex colours tint it. It reads as a lamp rather than a flat disc:
 *   - the emitter is hot in the middle and falls off towards the rim of the lens,
 *   - switched off (or by day, when it is dim) the lens is still there: tinted glass that picks up the sky at its rim,
 *   - with the optional vertex attribute `kitLamp` (xyz = lamp centre, w = radius, written by rig.lamp) a lamp never
 *     shrinks below about one pixel, with its energy scaled down accordingly, so small lamps do not flicker out at distance.
 */
export function lampMaterial(ctx) {
  const env = ctx?.env || {};
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, fog: false });
  const u = {
    uLampAmb: { value: env.ambientSky || new THREE.Color(0.3, 0.45, 0.75) },
    uLampRes: ctx?.uniforms?.frame?.uResolution || { value: new THREE.Vector2(1920, 1080) },
    uLampNight: { value: 0 },
  };
  m.userData.lampUniforms = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 kitLamp; uniform vec2 uLampRes; uniform float uLampNight;
        varying vec3 vLampN; varying vec3 vLampV; varying float vLampE;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec4 lc = modelViewMatrix * vec4( kitLamp.xyz, 1.0 );
          float lpx = kitLamp.w * projectionMatrix[1][1] * 0.5 * uLampRes.y / max( - lc.z, 0.05 );
          float lk = max( 1.0, 1.15 / max( lpx, 1e-4 ) );
          transformed = kitLamp.xyz + ( transformed - kitLamp.xyz ) * lk;
          vLampE = max( 1.0 / ( lk * lk ), mix( 0.02, 0.22, uLampNight ) );
          vLampN = normalize( normalMatrix * normal );
        }`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLampV = - mvPosition.xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uLampAmb; varying vec3 vLampN; varying vec3 vLampV; varying float vLampE;`)
      .replace('#include <opaque_fragment>', `
        {
          float lnv = clamp( dot( normalize( vLampN ), normalize( vLampV ) ), 0.0, 1.0 );
          #ifdef USE_COLOR
            vec3 lTint = vColor.rgb;
          #else
            vec3 lTint = vec3( 1.0 );
          #endif
          vec3 lE = diffuseColor.rgb * vLampE;                                         // radiance set by the rig × lens tint
          float lI = max( lE.r, max( lE.g, lE.b ) );
          vec3 lEmit = lE * ( 0.16 + 0.84 * lnv * lnv );
          lEmit = mix( lEmit, vec3( lI ), 0.3 * pow( lnv, 8.0 ) );                       // white-hot filament / LED die
          vec3 lLens = ( lTint * 0.22 + 0.035 ) * uLampAmb * 1.3 + uLampAmb * 0.9 * pow( 1.0 - lnv, 3.0 );
          outgoingLight = lEmit + lLens;
        }
        #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'kit-lamp';
  return m;
}

/**
 * Additive glow material (afterburner interior, engine hot section). The mesh's uv.x selects the falloff: 0 = cool
 * (nozzle exit, dull red) … 1 = hottest (flame holder, full `material.color`). Set material.color to an HDR radiance.
 */
export function glowMaterial() {
  const N = 32, d = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { const u = i / (N - 1), k = 0.05 + 0.95 * u * u; d[i * 4] = 255 * k; d[i * 4 + 1] = 255 * k * (0.45 + 0.55 * u); d[i * 4 + 2] = 255 * k * (0.2 + 0.8 * u * u); d[i * 4 + 3] = 255; }
  const map = new THREE.DataTexture(d, N, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  map.magFilter = map.minFilter = THREE.LinearFilter; map.needsUpdate = true;
  const m = new THREE.MeshBasicMaterial({ color: 0x000000, map, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  // Meshes from afterburnerGlow() carry the angle in uv.y (> 1.5): draw the flame holder (V-gutter rings and radial
  // gutters around a dark tail cone) and a streaky liner instead of a flat disc. Other meshes are unaffected.
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      if ( vMapUv.y > 1.5 ) {
        float ga = fract( vMapUv.y ) * 6.2831853, gx = vMapUv.x;
        float gDisc = smoothstep( 0.89, 0.905, gx ), gr = clamp( ( 1.0 - gx ) / 0.1, 0.0, 1.0 );
        float gRings = 0.4 + 0.6 * pow( abs( sin( gr * 9.42 ) ), 2.5 );
        float gSpokes = 0.62 + 0.38 * pow( abs( cos( ga * 8.0 ) ), 8.0 );
        float gCone = smoothstep( 0.1, 0.34, gr );
        float gLiner = ( 0.74 + 0.26 * sin( ga * 24.0 + gx * 9.0 ) * sin( ga * 7.0 + 1.3 ) ) * ( 0.55 + 0.45 * gx );
        diffuseColor.rgb *= mix( gLiner, gRings * gSpokes * gCone * 1.3, gDisc );
      }`);
  };
  m.customProgramCacheKey = () => 'kit-glow';
  const dispose = m.dispose.bind(m); m.dispose = () => { map.dispose(); dispose(); };
  return m;
}
