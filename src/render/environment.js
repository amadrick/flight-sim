// Image-based lighting: scene.environment = GGX-prefiltered (PMREM) capture of the atmosphere LUT sky plus the
// generic sunlit ground below the horizon. The sun/moon discs are NOT in it (the key light provides their specular).
// The capture is refreshed when the light, altitude or weather drift, as a small state machine that does one
// cheap step per frame (equirect render → cube + mips → one prefilter level per frame), so there is no hitch.
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';

const EQUIRECT_FRAG = (atmGLSL) => /* glsl */`
precision highp float; precision highp sampler2D;
in vec2 vUv; out vec4 outColor;
${FRAME_UNIFORMS_GLSL}
${atmGLSL}
uniform vec4 uEnvWeather;     // x: overcast amount at the player (0..1), y: cloud-deck-below amount, z: sky scale, w: unused
uniform vec3 uEnvCloudDeck;   // radiance of a cloud deck seen from above
void main() {
  // inverse of three's equirectUv(): u = atan(z, x) / 2π + 0.5, v = asin(y) / π + 0.5
  float phi = (vUv.x - 0.5) * 6.28318530718, th = (vUv.y - 0.5) * 3.14159265359;
  vec3 dir = vec3(cos(th) * cos(phi), sin(th), cos(th) * sin(phi));
  vec3 c = atmSkyRadiance(dir);
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // under an overcast the "sky" is a grey, fairly uniform cloud base
  float up = smoothstep(-0.05, 0.1, dir.y);
  c = mix(c, vec3(lum) * mix(0.8, 1.25, clamp(dir.y, 0.0, 1.0)), uEnvWeather.x * 0.85 * up);
  // above a cloud deck the lower hemisphere is bright cloud tops
  float down = smoothstep(0.0, -0.12, dir.y);
  c = mix(c, uEnvCloudDeck, uEnvWeather.y * down);
  outColor = vec4(min(c * uEnvWeather.z, vec3(64.0)), 1.0);
}`;

// constants of three r0.187's PMREMGenerator (private there)
const LOD_MIN = 4, INTEGRATION_SIZE = 16, INTEGRATION_LEVELS = 3, GGX_SAMPLES = 256;

export function createEnvironment(ctx, atmosphere, caps) {
  const { renderer, scene } = ctx;
  const cubeSizeFor = () => ({ low: 32, medium: 64, high: 128, ultra: 128 }[ctx.quality.level] || 64);
  let cubeSize = 0, eqRT = null, pmremRT = null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const uniforms = { uEnvWeather: { value: new THREE.Vector4(0, 0, 1, 0) }, uEnvCloudDeck: { value: new THREE.Vector3(0.5, 0.5, 0.5) } };
  const pass = new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, fog: false,
    uniforms: { ...ctx.uniforms.frame, ...atmosphere.uniforms, ...uniforms },
    vertexShader: FULLSCREEN_VERT, fragmentShader: EQUIRECT_FRAG(atmosphere.glsl),
  }));

  let incremental = typeof pmrem._textureToCubemap === 'function' && typeof pmrem._renderCube === 'function' && typeof pmrem._setSize === 'function';
  let step = -1;          // -1 idle; 0 = capture, 1.. = prefilter lod (step-1)
  let lastStart = -1e9;

  function allocate() {
    const size = cubeSizeFor();
    if (size === cubeSize && eqRT) return;
    cubeSize = size;
    eqRT?.dispose();
    eqRT = new THREE.WebGLRenderTarget(size * 4, size * 2, {
      type: caps.hdrType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, colorSpace: THREE.LinearSRGBColorSpace,
    });
    eqRT.texture.name = 'env.equirect';
    const old = pmremRT; pmremRT = null;
    full();
    old?.dispose();
  }

  function withState(fn) {
    const prevRT = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;                 // the PMREM passes go through renderer.render(): don't redo shadow maps
    try { fn(); } finally {
      renderer.shadowMap.autoUpdate = prevShadowAuto;
      renderer.autoClear = prevAuto;
      renderer.setRenderTarget(prevRT);
    }
  }

  /** Synchronous complete refresh (boot, time jumps). */
  function full() {
    withState(() => {
      pass.render(renderer, eqRT);
      pmremRT = pmrem.fromEquirectangular(eqRT.texture, pmremRT);
    });
    scene.environment = pmremRT.texture;
    step = -1;
    lastStart = ctx.time.real;
  }

  function prefilterLod(lod) {
    const maxLod = pmremRT.texture.mipmaps.length - 1;
    const roughness = THREE.PMREMGenerator.lodToRoughness(lod, maxLod);
    const src = pmrem._sourceTarget;
    if (lod > maxLod - INTEGRATION_LEVELS) {
      const u = pmrem._integrationMaterial.uniforms;
      u.envMap.value = src.texture; u.sourceLod.value = Math.log2(cubeSize / INTEGRATION_SIZE); u.roughness.value = roughness;
      pmrem._renderCube(pmremRT, lod, pmrem._integrationMaterial);
    } else {
      const u = pmrem._ggxMaterial.uniforms;
      u.envMap.value = src.texture; u.roughness.value = roughness;
      u.lodBias.value = roughness > 0 ? Math.log2(cubeSize) + 0.5 * Math.log2(6 / (GGX_SAMPLES * Math.pow(roughness, 4))) + 0.5 : 0;
      pmrem._renderCube(pmremRT, lod, pmrem._ggxMaterial);
    }
  }

  /** Advance the incremental refresh by one step. Returns true while a refresh is in flight. */
  function tick() {
    if (step < 0) return false;
    if (!incremental || !pmrem._ggxMaterial || !pmrem._integrationMaterial) { full(); return false; }
    try {
      withState(() => {
        if (step === 0) {
          pass.render(renderer, eqRT);
          pmrem._setSize(eqRT.width / 4);
          pmrem._textureToCubemap(eqRT.texture);
        } else prefilterLod(step - 1);
      });
      step++;
      if (step - 1 > pmremRT.texture.mipmaps.length - 1) step = -1;
    } catch (e) {
      incremental = false; step = -1;
      console.warn('[render] incremental PMREM unavailable, using full refreshes', e);
      full();
    }
    return step >= 0;
  }

  return {
    uniforms,
    get texture() { return pmremRT?.texture || null; },
    get busy() { return step >= 0; },
    get lastStart() { return lastStart; },
    allocate, full, tick,
    /** Start an incremental refresh (no-op if one is running). */
    request() { if (step < 0) { step = 0; lastStart = ctx.time.real; } },
    dispose() { eqRT?.dispose(); pmremRT?.dispose(); pmrem.dispose(); pass.dispose(); },
  };
}

export { LOD_MIN };
