// Contract guards for the render module (node --test src/render/render.test.js). No GL needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ATMOSPHERE_GLSL, ATM } from './atmosphere-glsl.js';
import { KeyLight, fitShadows, SUN_SHADOW_API_GLSL } from './shadows.js';

test('atmosphere GLSL keeps the contract signatures', () => {
  for (const sig of [
    'vec3 atmSunIlluminance(vec3 renderPos)',
    'vec3 atmSkyRadiance(vec3 dir)',
    'vec4 atmAerialPerspective(vec3 renderPos)',
    'vec3 atmAmbient(vec3 renderPos, vec3 normal)',
  ]) assert.ok(ATMOSPHERE_GLSL.includes(sig), `missing: ${sig}`);
  assert.ok(ATMOSPHERE_GLSL.includes('uniform float uAtmHaze;'));
});

test('atmosphere GLSL is usable in a vertex shader and has no loops', () => {
  const code = ATMOSPHERE_GLSL.replace(/\/\/[^\n]*/g, '');
  for (const bad of ['dFdx', 'dFdy', 'fwidth', 'gl_FragCoord', 'gl_FrontFacing', 'discard', 'textureGrad'])
    assert.ok(!code.includes(bad), `fragment-only construct in the API chunk: ${bad}`);
  assert.ok(!/\b(for|while)\s*\(/.test(code), 'the API must be LUT lookups only');
  // implicit-LOD texture() is fine in a VS only because none of the LUTs has mipmaps; samplers must be highp there too
  assert.equal((code.match(/uniform highp sampler2D/g) || []).length, 3);
});

test('LUT layout constants are consistent', () => {
  assert.equal(ATM.AP_TX * ATM.AP_TY, ATM.AP_N, 'atlas must hold one tile per distance slice');
  assert.equal(ATM.AP_N * ATM.AP_TX, ATM.SKY_W);
});

test('shadow cascades are texel-snapped in world space and nested', () => {
  const light = new KeyLight(true);
  const dir = new THREE.Vector3(0.35, 0.8, 0.45).normalize();
  const origin = new THREE.Vector3(12000, 0, -4000);
  const cameraFwd = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right);
  const sh = light.shadow;
  let prev = null;
  for (let i = 0; i < 40; i++) {
    const focusWorld = new THREE.Vector3(12345.678 + i * 0.0137, 1500 + i * 0.004, -4321.5 - i * 0.021);
    const cameraWorld = focusWorld.clone().add(new THREE.Vector3(0, 6, 30));
    fitShadows({ light, dir, focusWorld, focusRadius: 11.5, agl: 1400, origin, cameraWorld, cameraFwd, mapSize: 2048 });
    sh.updateMatrices();
    for (let c = 0; c < 2; c++) {
      const world = sh.getCamera(c).position.clone().add(origin), t = sh.texel[c];
      const x = world.dot(right) / t, y = world.dot(up) / t;
      assert.ok(Math.abs(x - Math.round(x)) < 2e-3 && Math.abs(y - Math.round(y)) < 2e-3, `cascade ${c} off the texel grid`);
    }
    // cascade 0 (the aircraft) stays inside cascade 1
    const d = sh.fit.center[1].clone().sub(sh.fit.center[0]);
    assert.ok(Math.hypot(d.dot(right), d.dot(up)) + sh.fit.radius[0] <= sh.fit.radius[1] + 1e-6);
    // sub-texel motion of the focus must not move the tight cascade by anything other than whole texels
    const p = sh.getCamera(0).position.clone().add(origin);
    if (prev) {
      const dx = (p.dot(right) - prev.dot(right)) / sh.texel[0];
      assert.ok(Math.abs(dx - Math.round(dx)) < 2e-3);
    }
    prev = p;
  }
  assert.ok(sh.bias > 0 && sh.normalBias > 0);
  assert.equal(light.position.distanceTo(dir) < 1e-6, true, 'sun lights carry their direction in .position');
});

test('raw-shader shadow API is declared', () => {
  assert.ok(SUN_SHADOW_API_GLSL.includes('float sunShadow(vec3 renderPos, vec3 normal)'));
});

test('twilight gain is 1 by day and rises monotonically below the horizon', async () => {
  const { twilightGain } = await import('./index.js');
  assert.equal(twilightGain(0.5), 1);
  assert.equal(twilightGain(0), 1);
  let prev = 1;
  for (let deg = 0.5; deg <= 20; deg += 0.5) {
    const g = twilightGain(-Math.sin(deg * Math.PI / 180));
    assert.ok(g >= prev && g <= 60, `gain at -${deg} deg`);
    prev = g;
  }
  assert.ok(twilightGain(-Math.sin(3.4 * Math.PI / 180)) > 2 && twilightGain(-Math.sin(3.4 * Math.PI / 180)) < 4);
});

test('emissive mask chunk patch is applied once and only to lit materials', async () => {
  const { installEmissiveMaskChunk, NIGHT_GRADE_GLSL } = await import('./nightgrade.js');
  assert.ok(installEmissiveMaskChunk());
  assert.ok(installEmissiveMaskChunk());
  const src = THREE.ShaderChunk.opaque_fragment;
  assert.equal(src.split('SKYWARD_EMISSIVE_MASK').length, 2);
  assert.ok(src.includes('defined( STANDARD )') && src.includes('totalEmissiveRadiance'));
  assert.ok(src.indexOf('totalEmissiveRadiance') > src.indexOf('#ifdef OPAQUE'));
  assert.ok(NIGHT_GRADE_GLSL.includes('vec3 ng_grade(vec3 refl, vec3 total)'));
});
