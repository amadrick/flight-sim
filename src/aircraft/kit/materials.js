// Aircraft kit — non-atlas materials: glass and emissive lamps.
// (Painted / metal / rubber surfaces all live in the atlas material — see atlas.js FINISH.)
import * as THREE from 'three';

/**
 * Canopy / windshield glass that reads correctly without the transmission pass:
 *   - alpha rises towards grazing angles (Fresnel), so the rim of a bubble canopy looks solid and the centre clear,
 *   - reflections (IBL and sun glint) are ADDED on top instead of being faded by the opacity,
 *   - falls back to an analytic sky/ground reflection and its own sun glint when the pass it is drawn in has no
 *     environment map or no lights (e.g. LAYERS.POST in a pipeline that only lights layer 0).
 * opts: { tint = '#1c2a33', opacity = 0.16, edgeOpacity = 0.72, metalness = 0 (raise for gold / mirrored coatings),
 *         roughness = 0.03, reflect = 1 }
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
  };
  m.userData.glassUniforms = u;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uGlassEdge; uniform vec3 uGlassSky; uniform vec3 uGlassGround; uniform vec3 uGlassSunDir; uniform vec3 uGlassSunColor; uniform float uGlassReflect;`)
      .replace('#include <opaque_fragment>', `
        {
          vec3 gN = normalize( normal );
          vec3 gV = normalize( vViewPosition );
          float gNV = clamp( abs( dot( gN, gV ) ), 0.0, 1.0 );
          float gFr = pow( 1.0 - gNV, 5.0 );
          vec3 gF0 = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
          vec3 gF = gF0 + ( 1.0 - gF0 ) * gFr;
          vec3 gSpec = totalSpecular;
          #ifndef USE_ENVMAP
            vec3 gRw = inverseTransformDirection( reflect( -gV, gN ), viewMatrix );
            vec3 gEnv = mix( uGlassGround, uGlassSky * 1.6, smoothstep( -0.12, 0.3, gRw.y ) );
            gSpec += gEnv * gF * uGlassReflect;
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
  hud: { tint: '#7fae8a', opacity: 0.08, edgeOpacity: 0.5, roughness: 0.02, reflect: 0.6 },
};

/** HDR emissive material for lamps; set `material.color.setRGB(r, g, b)` (linear radiance, may exceed 1) each frame. */
export function lampMaterial() {
  return new THREE.MeshBasicMaterial({ color: 0x000000, vertexColors: true, fog: false });
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
  const dispose = m.dispose.bind(m); m.dispose = () => { map.dispose(); dispose(); };
  return m;
}
