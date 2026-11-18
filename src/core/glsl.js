// Shared GLSL chunks + the shared per-frame uniform block. Owned by the integrator.
// Share uniforms BY REFERENCE: `uniforms: { ...ctx.uniforms.frame, myUniform: { value: 1 } }`
// (spreading copies the {value} holders, so core/pipeline updates reach every material automatically).
import * as THREE from 'three';

export function createFrameUniforms() {
  return {
    uTime:          { value: 0 },                      // simulated seconds
    uOrigin:        { value: new THREE.Vector3() },    // world position of the render-space origin (y = 0)
    uCameraPos:     { value: new THREE.Vector3() },    // camera position, render space
    uCameraWorld:   { value: new THREE.Matrix4() },    // camera.matrixWorld (view -> render space)
    uViewMatrix:    { value: new THREE.Matrix4() },    // render space -> view
    uProjMatrix:    { value: new THREE.Matrix4() },
    uProjInverse:   { value: new THREE.Matrix4() },
    uPrevViewProj:  { value: new THREE.Matrix4() },    // last frame's proj*view, already corrected for origin shifts
    uSunDir:        { value: new THREE.Vector3(0, 1, 0) },  // unit vector TOWARD the sun
    uMoonDir:       { value: new THREE.Vector3(0, -1, 0) },
    uSunColor:      { value: new THREE.Color(4, 4, 4) },    // direct sun irradiance at the camera (after atmosphere), linear
    uAmbientSky:    { value: new THREE.Color(0.25, 0.4, 0.7) },  // sky irradiance/π from above (for hemisphere ambient)
    uAmbientGround: { value: new THREE.Color(0.1, 0.09, 0.08) }, // bounce from below
    uResolution:    { value: new THREE.Vector2(1, 1) },     // main HDR target size in pixels
    uNearFar:       { value: new THREE.Vector2(0.5, 600000) },
    uDepthReversed: { value: 1 },                           // 1 = reversed-Z [0..1] depth (EXT_clip_control), 0 = classic GL depth
    tSceneDepth:    { value: null },                        // depth texture of the main scene pass (valid after that pass)
    uFrame:         { value: 0 },
  };
}

// Declarations for the frame uniforms (paste into any shader that needs them).
export const FRAME_UNIFORMS_GLSL = /* glsl */`
uniform float uTime; uniform vec3 uOrigin; uniform vec3 uCameraPos; uniform mat4 uCameraWorld; uniform mat4 uViewMatrix;
uniform mat4 uProjMatrix; uniform mat4 uProjInverse; uniform mat4 uPrevViewProj;
uniform vec3 uSunDir; uniform vec3 uMoonDir; uniform vec3 uSunColor; uniform vec3 uAmbientSky; uniform vec3 uAmbientGround;
uniform vec2 uResolution; uniform vec2 uNearFar; uniform float uDepthReversed; uniform highp sampler2D tSceneDepth; uniform float uFrame;
`;

// Depth helpers. ALWAYS go through these — never assume a depth convention.
export const DEPTH_GLSL = /* glsl */`
float sceneDepthRaw(vec2 uv) { return texture(tSceneDepth, uv).r; }
bool depthIsSky(float d) { return uDepthReversed > 0.5 ? d <= 0.0 : d >= 1.0; }
// View-space position (camera looks down -Z) of the scene surface at screen uv with raw depth d.
vec3 viewPosFromDepth(vec2 uv, float d) {
  float zndc = uDepthReversed > 0.5 ? d : d * 2.0 - 1.0;
  vec4 v = uProjInverse * vec4(uv * 2.0 - 1.0, zndc, 1.0);
  return v.xyz / v.w;
}
// Render-space position of the scene surface.
vec3 renderPosFromDepth(vec2 uv, float d) { return (uCameraWorld * vec4(viewPosFromDepth(uv, d), 1.0)).xyz; }
// Distance from the camera to the scene surface along the view ray (metres); 1e9 for sky.
float sceneDistance(vec2 uv) { float d = sceneDepthRaw(uv); return depthIsSky(d) ? 1e9 : length(viewPosFromDepth(uv, d)); }
// Unit view ray in render space for screen uv.
vec3 viewRay(vec2 uv) {
  vec4 v = uProjInverse * vec4(uv * 2.0 - 1.0, 0.5, 1.0);
  return normalize((uCameraWorld * vec4(normalize(v.xyz / v.w), 0.0)).xyz);
}
`;

// Earth-curvature drop for distant geometry (apply in vertex shaders of terrain/water/scenery far LODs):
// renderPos.y -= curvatureDrop(distance(renderPos.xz, uCameraPos.xz));
export const CURVATURE_GLSL = /* glsl */`
float curvatureDrop(float horizontalDistance) { return horizontalDistance * horizontalDistance / (2.0 * 6371000.0); }
`;

export const FULLSCREEN_VERT = /* glsl */`
out vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
// Fullscreen triangle geometry helper (positions already in clip space; use with FULLSCREEN_VERT).
export function fullscreenTriangle() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
  return g;
}

// Fullscreen pass helper. NOTE: with the reversed depth buffer three.js calls camera.updateProjectionMatrix(),
// so a bare THREE.Camera crashes — always use this helper (or an OrthographicCamera) for screen-space passes.
const _fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
export class FullscreenPass {
  /** material: a ShaderMaterial using FULLSCREEN_VERT (glslVersion: THREE.GLSL3, depthTest/depthWrite false). */
  constructor(material) {
    this.material = material;
    this.mesh = new THREE.Mesh(fullscreenTriangle(), material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
  }
  /** Render into target (null = canvas). Leaves the renderer's render target set to `target`. */
  render(renderer, target = null) {
    const prevAuto = renderer.autoClear; renderer.autoClear = false;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, _fsCam);
    renderer.autoClear = prevAuto;
  }
  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); }
}
