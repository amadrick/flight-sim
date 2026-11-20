// Lit instanced meshes for combat: missile bodies and debris fragments (one InstancedMesh each → one draw each, on
// LAYERS.MAIN with MeshStandardMaterial so the sun, sky light (IBL) and shadows work like on the aircraft).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Missile airframe in body axes (nose −Z), unit length 1 (scaled per instance to the real length/diameter). */
export function createMissileGeometry() {
  // lathe profile (r, z) from nose tip (z = −0.5) to the nozzle (z = +0.5); radius 1 = body radius (scaled later)
  const R = 1, L = 1;
  const prof = [];
  const add = (r, z) => prof.push(new THREE.Vector2(r, z));
  add(0.0, -0.5); add(0.45, -0.497); add(0.72, -0.488); add(0.9, -0.474); add(1.0, -0.455);   // seeker dome (blunt)
  add(1.0, 0.49); add(0.82, 0.497); add(0.6, 0.5);
  const lathe = new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x * R, v.y * L)), 14);
  // LatheGeometry spins around Y: rotate so the axis is Z
  lathe.rotateX(Math.PI / 2);
  // colour: dark seeker dome, grey body, two thin bands
  const col = [];
  const pos = lathe.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    let c = [0.82, 0.83, 0.82];
    if (z < -0.47) c = [0.12, 0.13, 0.14];
    else if (z > -0.33 && z < -0.315) c = [0.75, 0.62, 0.15];
    else if (z > 0.485) c = [0.18, 0.17, 0.16];
    col.push(...c);
  }
  lathe.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  lathe.deleteAttribute('uv');
  const parts = [lathe];
  // fins: 4 tail fins + 4 canards (thin boxes, in units of body radius × length)
  const fin = (span, chord, z, rot) => {
    const g = new THREE.BoxGeometry(0.12, span, chord);
    g.translate(0, 1 + span / 2 - 0.1, z);
    g.rotateZ(rot);
    const c = []; for (let i = 0; i < g.attributes.position.count; i++) c.push(0.78, 0.79, 0.78);
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    g.deleteAttribute('uv');
    return g;
  };
  for (let k = 0; k < 4; k++) {
    const r = Math.PI / 4 + k * Math.PI / 2;
    parts.push(fin(2.2, 0.075, 0.43, r));
    parts.push(fin(1.6, 0.05, -0.36, r));
  }
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  g.computeVertexNormals();
  return g;
}

export function createMissileMesh(ctx, capacity = 48) {
  const geo = createMissileGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45, metalness: 0.15 });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.name = 'cfx-missiles'; mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ctx.scene.add(mesh);
  return mesh;
}

/** One irregular chunk (flat-shaded, jagged), scaled per instance into plates, spars and lumps. */
export function createDebrisGeometry() {
  const g = new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed();
  const p = g.attributes.position;
  // squash and dent deterministically so pieces look torn rather than round
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + 0.35 * Math.sin(x * 9.1 + y * 4.7) * Math.cos(z * 7.3);
    p.setXYZ(i, x * k, y * k * 0.9, z * k);
  }
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

export function createDebrisMesh(ctx, capacity = 128) {
  const geo = createDebrisGeometry();
  const heat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  heat.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aHeat', heat);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.35, flatShading: true });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vHeat;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.32, 0.07) * vHeat * vHeat * 6.0;\ndiffuseColor.rgb *= 1.0 - 0.75 * clamp(vHeat * 1.5, 0.0, 1.0);');
  };
  mat.customProgramCacheKey = () => 'cfx-debris';
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.name = 'cfx-debris'; mesh.frustumCulled = false; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.heat = heat;
  ctx.scene.add(mesh);
  return mesh;
}
