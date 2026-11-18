// STUB clouds — the volumetric-clouds agent replaces this. API to keep:
//   createClouds(ctx) -> { update(dt), render(frame), texture, shadowGLSL, shadowUniforms }
//   render(frame): called by the pipeline after the main scene pass; frame = { renderer, camera, depthTexture, width, height, dt }
//   texture: RGBA16F, rgb = premultiplied in-scattered radiance, a = transmittance (1 = clear). null = no clouds.
export async function createClouds(ctx) {
  return {
    texture: null,
    // GLSL (needs FRAME_UNIFORMS_GLSL): sun transmittance through the cloud layer toward a render-space point. 1 = unshadowed.
    shadowGLSL: 'float cloudShadow(vec3 renderPos) { return 1.0; }',
    shadowUniforms: {},
    update() {}, render() {},
  };
}
