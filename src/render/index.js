// STUB render pipeline — the render-pipeline agent replaces this file's internals, keeping the exported API.
//   createPipeline(ctx) -> { atmosphere: { uniforms, glsl }, setSize(w, h, dpr), render(dt), sceneTarget, depthTexture }
// Frame: main scene (layer 0) → HDR target with depth → clouds.render(frame) → composite (sky + aerial perspective + clouds
// + tone map) → layer-1 objects.
import * as THREE from 'three';
import { FRAME_UNIFORMS_GLSL, DEPTH_GLSL, FULLSCREEN_VERT, FullscreenPass } from '../core/glsl.js';
import { ATMOSPHERE_GLSL } from './atmosphere-glsl.js';
import { LAYERS, SUN_ILLUMINANCE } from '../core/constants.js';

export async function createPipeline(ctx) {
  const { renderer, scene, camera } = ctx;
  const atmUniforms = { uAtmHaze: { value: 1 / 60000 } };
  const depthTexture = new THREE.DepthTexture(2, 2); depthTexture.type = THREE.FloatType;
  const sceneTarget = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType, depthTexture, colorSpace: THREE.LinearSRGBColorSpace });
  ctx.uniforms.frame.tSceneDepth.value = depthTexture;

  const sun = new THREE.DirectionalLight(0xffffff, SUN_ILLUMINANCE);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 800;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4238, 1.2); scene.add(hemi);
  ctx.env.sunLight = sun;

  const composite = new FullscreenPass(new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, depthTest: false, depthWrite: false,
    uniforms: { ...ctx.uniforms.frame, ...atmUniforms, tScene: { value: sceneTarget.texture }, tClouds: { value: null }, uHasClouds: { value: 0 }, uExposure: { value: 1 } },
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: /* glsl */`
      precision highp float; in vec2 vUv; out vec4 outColor;
      uniform sampler2D tScene; uniform sampler2D tClouds; uniform float uHasClouds; uniform float uExposure;
      ${FRAME_UNIFORMS_GLSL} ${DEPTH_GLSL} ${ATMOSPHERE_GLSL}
      vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
      void main() {
        float d = sceneDepthRaw(vUv);
        vec3 col;
        if (depthIsSky(d)) {
          vec3 dir = viewRay(vUv);
          col = atmSkyRadiance(dir);
          col += uSunColor * 40.0 * smoothstep(0.99996, 0.99999, dot(dir, uSunDir));
        } else {
          col = texture(tScene, vUv).rgb;
          vec4 ap = atmAerialPerspective(renderPosFromDepth(vUv, d));
          col = col * ap.a + ap.rgb;
        }
        if (uHasClouds > 0.5) { vec4 c = texture(tClouds, vUv); col = col * c.a + c.rgb; }
        col = aces(col * uExposure);
        outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
      }`,
  }));
  const quad = composite.mesh;
  const size = new THREE.Vector2(2, 2);
  const tmp = new THREE.Vector3();

  const pipeline = {
    atmosphere: { uniforms: atmUniforms, glsl: ATMOSPHERE_GLSL },
    sceneTarget, depthTexture,
    setSize(w, h, dpr = 1) {
      renderer.setSize(w, h, false);
      const s = ctx.quality.renderScale * dpr;
      size.set(Math.max(2, Math.round(w * s)), Math.max(2, Math.round(h * s)));
      renderer.setDrawingBufferSize?.(w, h, Math.min(dpr, 2) * ctx.quality.renderScale);
      const db = renderer.getDrawingBufferSize(new THREE.Vector2());
      sceneTarget.setSize(db.x, db.y);
      ctx.uniforms.frame.uResolution.value.set(db.x, db.y);
    },
    render(dt) {
      // sun light follows the player
      const focus = ctx.player ? ctx.world.toRender(ctx.player.state.position, tmp) : tmp.set(0, 0, 0);
      const day = THREE.MathUtils.smoothstep(ctx.env.sunDir.y, -0.08, 0.12);
      sun.target.position.copy(focus); sun.position.copy(focus).addScaledVector(ctx.env.sunDir, 400);
      sun.intensity = SUN_ILLUMINANCE * day; hemi.intensity = 0.05 + 1.2 * day;
      ctx.env.sunColor.setScalar(SUN_ILLUMINANCE * day);
      ctx.env.nightFactor = 1 - day;
      atmUniforms.uAtmHaze.value = 1 / Math.max(2000, ctx.weather.visibility);

      camera.layers.set(LAYERS.MAIN);
      renderer.setRenderTarget(sceneTarget); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
      renderer.render(scene, camera);

      const clouds = ctx.clouds;
      const frame = { renderer, camera, depthTexture, width: sceneTarget.width, height: sceneTarget.height, dt };
      clouds?.render?.(frame);
      quad.material.uniforms.tClouds.value = clouds?.texture || null;
      quad.material.uniforms.uHasClouds.value = clouds?.texture ? 1 : 0;

      composite.render(renderer, null);
      // layer-1 (POST) objects: stub draws them without depth occlusion
      camera.layers.set(LAYERS.POST);
      renderer.autoClear = false; renderer.render(scene, camera); renderer.autoClear = true;
      camera.layers.set(LAYERS.MAIN);
    },
  };
  return pipeline;
}
