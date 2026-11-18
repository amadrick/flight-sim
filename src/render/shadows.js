// Key light (sun by day, moon by night) with two texel-snapped shadow cascades focused on the player aircraft.
//
// three.js 0.187 has renderer-side support for "sun lights": one shadow atlas with one viewport per cascade, and the
// cascade is chosen per fragment (shader chunks `sunShadowMatrix[]`, `sunShadowCascade[]`, `getSunShadow()`).
// We reuse that plumbing — so every built-in material (aircraft, terrain, scenery, other agents' onBeforeCompile
// variants) receives the shadows with no cooperation — but supply our own fitting and our own lookup:
//   cascade 0: a tight box around the aircraft (≈1-4 cm texels: crisp self-shadowing, gear shadows on the runway)
//   cascade 1: a wide box around it (airport buildings, the aircraft's shadow when it leaves cascade 0)
// Selection is by containment (not view depth), both boxes are snapped to their texel grid in WORLD coordinates
// (doubles, so the grid survives floating-origin shifts), and filtering is a 5x5 tent done with 9 hardware-PCF
// taps (Castaño, "Shadow Mapping Summary", The Witness).
import * as THREE from 'three';

const GET_SUN_SHADOW = /* glsl */`
		#if defined( SHADOWMAP_TYPE_PCF )

		// SKYWARD_SUN_SHADOW — 5x5 tent PCF from 9 bilinear comparison taps
		float skywardShadowPCF( sampler2DShadow map, vec2 uvIn, float z, vec2 size ) {
			vec2 uv = uvIn * size;
			vec2 base = floor( uv + 0.5 );
			float s = uv.x + 0.5 - base.x, t = uv.y + 0.5 - base.y;
			base = ( base - 0.5 ) / size;
			float uw0 = 4.0 - 3.0 * s, uw1 = 7.0, uw2 = 1.0 + 3.0 * s;
			float u0 = ( 3.0 - 2.0 * s ) / uw0 - 2.0, u1 = ( 3.0 + s ) / uw1, u2 = s / uw2 + 2.0;
			float vw0 = 4.0 - 3.0 * t, vw1 = 7.0, vw2 = 1.0 + 3.0 * t;
			float v0 = ( 3.0 - 2.0 * t ) / vw0 - 2.0, v1 = ( 3.0 + t ) / vw1, v2 = t / vw2 + 2.0;
			vec2 inv = 1.0 / size;
			float sum = 0.0;
			sum += uw0 * vw0 * texture( map, vec3( base + vec2( u0, v0 ) * inv, z ) );
			sum += uw1 * vw0 * texture( map, vec3( base + vec2( u1, v0 ) * inv, z ) );
			sum += uw2 * vw0 * texture( map, vec3( base + vec2( u2, v0 ) * inv, z ) );
			sum += uw0 * vw1 * texture( map, vec3( base + vec2( u0, v1 ) * inv, z ) );
			sum += uw1 * vw1 * texture( map, vec3( base + vec2( u1, v1 ) * inv, z ) );
			sum += uw2 * vw1 * texture( map, vec3( base + vec2( u2, v1 ) * inv, z ) );
			sum += uw0 * vw2 * texture( map, vec3( base + vec2( u0, v2 ) * inv, z ) );
			sum += uw1 * vw2 * texture( map, vec3( base + vec2( u1, v2 ) * inv, z ) );
			sum += uw2 * vw2 * texture( map, vec3( base + vec2( u2, v2 ) * inv, z ) );
			return sum / 144.0;
		}

		// sunShadowCascade[i] = atlas rectangle of cascade i ( uMin, vMin, uMax, vMax );
		// shadowBias = normalised depth bias of cascade 0, shadowNormalBias = world-space normal offset of cascade 0,
		// shadowRadius = texel-size ratio cascade 1 / cascade 0 (biases of cascade 1 scale with it).
		float getSunShadow( sampler2DShadow shadowMap, SunLightShadow sunLightShadow, int shadowIndex ) {

			int o = shadowIndex * SUN_LIGHT_CASCADES;
			vec3 P = vSunShadowWorldPosition.xyz;
			float nl = length( vSunShadowWorldNormal );
			vec3 N = nl > 1e-5 ? vSunShadowWorldNormal / nl : vec3( 0.0 );
			float ratio = max( sunLightShadow.shadowRadius, 1.0 );
			#ifdef USE_REVERSED_DEPTH_BUFFER
				float bias = sunLightShadow.shadowBias;
			#else
				float bias = - sunLightShadow.shadowBias;
			#endif

			float shadow = 1.0, w0 = 0.0;

			vec4 rect0 = sunShadowCascade[ o ];
			vec3 c0 = ( sunShadowMatrix[ o ] * vec4( P + N * sunLightShadow.shadowNormalBias, 1.0 ) ).xyz;
			vec2 e0 = min( c0.xy - rect0.xy, rect0.zw - c0.xy );
			float in0 = min( e0.x, e0.y ) / ( rect0.w - rect0.y );

			if ( in0 > 0.0 && c0.z > 0.0 && c0.z < 1.0 ) {

				w0 = smoothstep( 0.0, 0.06, in0 );
				shadow = skywardShadowPCF( shadowMap, c0.xy, c0.z + bias, sunLightShadow.shadowMapSize );

			}

			if ( w0 < 1.0 ) {

				vec4 rect1 = sunShadowCascade[ o + 1 ];
				vec3 c1 = ( sunShadowMatrix[ o + 1 ] * vec4( P + N * sunLightShadow.shadowNormalBias * ratio, 1.0 ) ).xyz;
				vec2 e1 = min( c1.xy - rect1.xy, rect1.zw - c1.xy );
				float in1 = min( e1.x, e1.y ) / ( rect1.w - rect1.y );
				float sh1 = 1.0;

				if ( in1 > 0.0 && c1.z > 0.0 && c1.z < 1.0 ) {

					sh1 = mix( 1.0, skywardShadowPCF( shadowMap, c1.xy, c1.z + bias * ratio, sunLightShadow.shadowMapSize ), smoothstep( 0.0, 0.1, in1 ) );

				}

				shadow = mix( sh1, shadow, w0 );

			}

			return mix( 1.0, shadow, sunLightShadow.shadowIntensity );

		}

		#else

		float getSunShadow( sampler2D shadowMap, SunLightShadow sunLightShadow, int shadowIndex ) {

			int o = shadowIndex * SUN_LIGHT_CASCADES;
			vec4 p = vec4( vSunShadowWorldPosition.xyz + vSunShadowWorldNormal * sunLightShadow.shadowNormalBias, 1.0 );
			vec4 rect0 = sunShadowCascade[ o ];
			vec4 c0 = sunShadowMatrix[ o ] * p;
			bool in0 = c0.x > rect0.x && c0.x < rect0.z && c0.y > rect0.y && c0.y < rect0.w;
			vec4 rect1 = sunShadowCascade[ o + 1 ];
			vec4 c1 = sunShadowMatrix[ o + 1 ] * p;
			bool in1 = c1.x > rect1.x && c1.x < rect1.z && c1.y > rect1.y && c1.y < rect1.w;
			if ( ! in0 && ! in1 ) return 1.0;
			return getShadow( shadowMap, sunLightShadow.shadowMapSize, sunLightShadow.shadowIntensity, sunLightShadow.shadowBias, 1.0, in0 ? c0 : c1 );

		}

		#endif
`;

/** Replace three's view-depth cascade selection with ours. Must run before any lit material compiles. */
export function installSunShadowChunk() {
  const key = 'shadowmap_pars_fragment';
  const src = THREE.ShaderChunk[key];
  if (!src) return false;
  if (src.includes('SKYWARD_SUN_SHADOW')) return true;
  const a = src.indexOf('float getSunShadow(');
  const r = a >= 0 ? src.indexOf('return shadow;', a) : -1;
  const b = r >= 0 ? src.indexOf('}', r) : -1;
  if (b < 0 || !src.includes('sunShadowCascade') || !THREE.ShaderChunk.lights_fragment_begin?.includes('getSunShadow')) return false;
  THREE.ShaderChunk[key] = src.slice(0, a) + GET_SUN_SHADOW.trim() + src.slice(b + 1);
  return true;
}

const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _dir = new THREE.Vector3(), _m = new THREE.Matrix4(), _p = new THREE.Vector3();
const KERNEL = 3;   // texels of filter footprint kept clear of the atlas tile edge

/** Two-cascade focus shadow. The pipeline writes `fit` every frame; three calls updateMatrices() in its shadow pass. */
class FocusShadow extends THREE.LightShadow {
  constructor() {
    super(new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 500));
    this.isSunLightShadow = true;
    this.mapSize.set(2048, 2048);
    this._cameras = [new THREE.OrthographicCamera(), new THREE.OrthographicCamera()];
    this._matrices = [new THREE.Matrix4(), new THREE.Matrix4()];
    this._frustums = [new THREE.Frustum(), new THREE.Frustum()];
    this._cascadeData = [new THREE.Vector4(), new THREE.Vector4()];
    this._viewportCount = 2;
    this._frameExtents.set(2, 1);
    this._viewports = [new THREE.Vector4(), new THREE.Vector4()];
    this.fit = {
      lightDir: new THREE.Vector3(0, 1, 0),                          // toward the light
      center: [new THREE.Vector3(), new THREE.Vector3()],            // WORLD space (not render space)
      origin: new THREE.Vector3(),                                   // floating origin (world)
      radius: [12, 300],
      toward: 400, away: 400,                                        // depth range along the light direction, metres from the centre
    };
    this.texel = [0.01, 0.3];
  }
  getCamera(i = 0) { return this._cameras[i]; }
  getMatrix(i = 0) { return this._matrices[i]; }
  getFrustum(i = 0) { return this._frustums[i]; }
  updateMatrices() {
    const fit = this.fit, base = this.camera;
    const insetX = Math.min(0.2, (KERNEL + 1) / this.mapSize.x), insetY = Math.min(0.2, (KERNEL + 1) / this.mapSize.y);
    const resolution = this.mapSize.x * (1 - 2 * insetX);
    _dir.copy(fit.lightDir).normalize();
    _up.set(0, 1, 0); if (Math.abs(_dir.y) > 0.995) _up.set(0, 0, 1);
    _right.crossVectors(_up, _dir).normalize();
    _up.crossVectors(_dir, _right);
    _m.makeBasis(_right, _up, _dir);                                 // camera looks down -Z = away from the light
    for (let i = 0; i < 2; i++) {
      this._viewports[i].set(i + insetX, insetY, 1 - 2 * insetX, 1 - 2 * insetY);
      this._cascadeData[i].set((i + insetX) / 2, insetY, (i + 1 - insetX) / 2, 1 - insetY);
      const radius = fit.radius[i], texel = (2 * radius) / resolution;
      this.texel[i] = texel;
      const c = fit.center[i];
      // snap the box centre to the texel grid, in world space
      const x = Math.round(c.dot(_right) / texel) * texel, y = Math.round(c.dot(_up) / texel) * texel, z = c.dot(_dir) + fit.toward;
      _p.set(0, 0, 0).addScaledVector(_right, x).addScaledVector(_up, y).addScaledVector(_dir, z).sub(fit.origin);
      const cam = this._cameras[i];
      cam.position.copy(_p);
      cam.quaternion.setFromRotationMatrix(_m);
      cam.left = -radius; cam.right = radius; cam.top = radius; cam.bottom = -radius;
      cam.near = 0.5; cam.far = fit.toward + fit.away;
      cam.coordinateSystem = base.coordinateSystem;
      cam._reversedDepth = base.reversedDepth;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld(true);
      this._updateMatrix(cam, this._matrices[i], this._frustums[i], this._viewports[i]);
    }
  }
}

/**
 * The scene's key light. A DirectionalLight (so `ctx.env.sunLight` keeps that type and has a `.target`) that the
 * renderer treats as a cascaded "sun light": its direction is its position (it shines from `position` toward the origin).
 */
export class KeyLight extends THREE.DirectionalLight {
  constructor(csm) {
    super(0xffffff, 1);
    this.name = 'key';
    this.csm = csm;
    if (csm) {
      this.isSunLight = true;
      this.type = 'SunLight';
      this.shadow = new FocusShadow();
    }
    this.position.set(0, 1, 0);
  }
}

const _c = new THREE.Vector3(), _f = new THREE.Vector3(), _v = new THREE.Vector3();

/**
 * Fit the shadow cascades for this frame.
 * o = { light, dir (toward light, unit), focusWorld (Vector3 world), focusRadius, agl, origin, cameraWorld (Vector3), cameraFwd, mapSize }
 */
export function fitShadows(o) {
  const light = o.light, shadow = light.shadow;
  const size = Math.max(256, Math.min(2048, o.mapSize | 0));
  if (shadow.mapSize.x !== size) shadow.mapSize.set(size, size);
  const r0 = o.focusRadius, r1 = Math.max(220, Math.min(420, r0 * 9));
  const sinEl = Math.max(0.06, o.dir.y);
  // far enough along the light to reach the ground under the aircraft (its shadow on the runway / terrain), within reason
  const away = Math.min(Math.max(o.agl, 0) / sinEl * 1.15 + r0 * 2 + 60, 6000);
  const toward = Math.max(2 * r1, 500);
  if (light.csm) {
    const fit = shadow.fit;
    fit.lightDir.copy(o.dir); fit.origin.copy(o.origin);
    fit.radius[0] = r0; fit.radius[1] = r1;
    fit.center[0].copy(o.focusWorld);
    // cascade 1 leans toward what the camera looks at, but always keeps cascade 0 inside
    _f.copy(o.cameraWorld).addScaledVector(o.cameraFwd, r1 * 0.55).sub(o.focusWorld);
    const maxOff = Math.max(0, r1 - r0 * 1.5), len = _f.length();
    if (len > maxOff) _f.multiplyScalar(maxOff / Math.max(len, 1e-6));
    fit.center[1].copy(o.focusWorld).add(_f);
    fit.toward = toward; fit.away = Math.max(away, r1);
    light.position.copy(o.dir);                                       // sun lights: direction = position
    const res = size - 2 * (KERNEL + 1), texel0 = (2 * r0) / res;
    shadow.texel[0] = texel0; shadow.texel[1] = (2 * r1) / res;
    shadow.normalBias = texel0 * 1.6;
    shadow.bias = (texel0 * 1.2) / (fit.toward + fit.away);
    shadow.radius = r1 / r0;
  } else {
    // fallback: one classic directional shadow box around the aircraft, snapped to its texel grid
    const cam = shadow.camera, texel = (2 * r0) / size;
    _c.copy(o.focusWorld);
    _v.copy(o.dir);
    _up.set(0, 1, 0); if (Math.abs(_v.y) > 0.995) _up.set(0, 0, 1);
    _right.crossVectors(_up, _v).normalize(); _up.crossVectors(_v, _right);
    const x = Math.round(_c.dot(_right) / texel) * texel, y = Math.round(_c.dot(_up) / texel) * texel, z = _c.dot(_v);
    _p.set(0, 0, 0).addScaledVector(_right, x).addScaledVector(_up, y).addScaledVector(_v, z).sub(o.origin);
    light.target.position.copy(_p); light.target.updateMatrixWorld(true);
    light.position.copy(_p).addScaledVector(o.dir, toward);
    cam.left = -r0; cam.right = r0; cam.top = r0; cam.bottom = -r0; cam.near = 0.5; cam.far = toward + away;
    cam.updateProjectionMatrix();
    shadow.normalBias = texel * 1.6;
    shadow.bias = -(texel * 1.5) / (toward + away);
    shadow.radius = 1.5;
  }
  light.updateMatrixWorld(true);
}

// The same lookup for raw ShaderMaterials (addition to the contract; needs FRAME_UNIFORMS_GLSL):
//   uniforms: { ...ctx.uniforms.frame, ...ctx.pipeline.shadow.uniforms }   glsl: ctx.pipeline.shadow.glsl
//   float sunShadow(vec3 renderPos, vec3 normal)  → 1 = lit, 0 = in the shadow of the key light (sun or moon)
export const SUN_SHADOW_API_GLSL = /* glsl */`
#ifndef SKYWARD_SUN_SHADOW_API
#define SKYWARD_SUN_SHADOW_API
uniform highp sampler2DShadow tSunShadowMap;
uniform mat4 uSunShadowMatrix[2];
uniform vec4 uSunShadowRect[2];
uniform vec4 uSunShadowParams;    // x: depth bias, y: normal bias (m), z: cascade texel ratio, w: enabled
uniform vec2 uSunShadowSize;
float sunShadowPCF(vec2 uvIn, float z) {
  vec2 size = uSunShadowSize, uv = uvIn * size, base = floor(uv + 0.5);
  float s = uv.x + 0.5 - base.x, t = uv.y + 0.5 - base.y;
  base = (base - 0.5) / size;
  float uw0 = 4.0 - 3.0 * s, uw1 = 7.0, uw2 = 1.0 + 3.0 * s;
  float u0 = (3.0 - 2.0 * s) / uw0 - 2.0, u1 = (3.0 + s) / uw1, u2 = s / uw2 + 2.0;
  float vw0 = 4.0 - 3.0 * t, vw1 = 7.0, vw2 = 1.0 + 3.0 * t;
  float v0 = (3.0 - 2.0 * t) / vw0 - 2.0, v1 = (3.0 + t) / vw1, v2 = t / vw2 + 2.0;
  vec2 inv = 1.0 / size;
  float sum = uw0 * vw0 * texture(tSunShadowMap, vec3(base + vec2(u0, v0) * inv, z)) + uw1 * vw0 * texture(tSunShadowMap, vec3(base + vec2(u1, v0) * inv, z))
    + uw2 * vw0 * texture(tSunShadowMap, vec3(base + vec2(u2, v0) * inv, z)) + uw0 * vw1 * texture(tSunShadowMap, vec3(base + vec2(u0, v1) * inv, z))
    + uw1 * vw1 * texture(tSunShadowMap, vec3(base + vec2(u1, v1) * inv, z)) + uw2 * vw1 * texture(tSunShadowMap, vec3(base + vec2(u2, v1) * inv, z))
    + uw0 * vw2 * texture(tSunShadowMap, vec3(base + vec2(u0, v2) * inv, z)) + uw1 * vw2 * texture(tSunShadowMap, vec3(base + vec2(u1, v2) * inv, z))
    + uw2 * vw2 * texture(tSunShadowMap, vec3(base + vec2(u2, v2) * inv, z));
  return sum / 144.0;
}
float sunShadow(vec3 renderPos, vec3 normal) {
  if (uSunShadowParams.w < 0.5) return 1.0;
  float bias = uDepthReversed > 0.5 ? uSunShadowParams.x : -uSunShadowParams.x, ratio = max(uSunShadowParams.z, 1.0);
  float shadow = 1.0, w0 = 0.0;
  vec4 rect0 = uSunShadowRect[0];
  vec3 c0 = (uSunShadowMatrix[0] * vec4(renderPos + normal * uSunShadowParams.y, 1.0)).xyz;
  vec2 e0 = min(c0.xy - rect0.xy, rect0.zw - c0.xy);
  float in0 = min(e0.x, e0.y) / (rect0.w - rect0.y);
  if (in0 > 0.0 && c0.z > 0.0 && c0.z < 1.0) { w0 = smoothstep(0.0, 0.06, in0); shadow = sunShadowPCF(c0.xy, c0.z + bias); }
  if (w0 < 1.0) {
    vec4 rect1 = uSunShadowRect[1];
    vec3 c1 = (uSunShadowMatrix[1] * vec4(renderPos + normal * uSunShadowParams.y * ratio, 1.0)).xyz;
    vec2 e1 = min(c1.xy - rect1.xy, rect1.zw - c1.xy);
    float in1 = min(e1.x, e1.y) / (rect1.w - rect1.y), sh1 = 1.0;
    if (in1 > 0.0 && c1.z > 0.0 && c1.z < 1.0) sh1 = mix(1.0, sunShadowPCF(c1.xy, c1.z + bias * ratio), smoothstep(0.0, 0.1, in1));
    shadow = mix(sh1, shadow, w0);
  }
  return shadow;
}
#endif
`;
