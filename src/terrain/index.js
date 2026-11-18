// STUB terrain — the terrain agent replaces this. API to keep:
//   createTerrain(ctx) -> { heightAt(x, z), update(dt), object3D }
// and it must call ctx.world.setTerrainHeightFn(heightAt).
import * as THREE from 'three';
import { AIRPORTS } from '../data/airports.js';
import { smoothstep } from '../core/math.js';

export function stubHeight(x, z) {
  let h = 60 + 220 * Math.sin(x * 0.00021 + 1.3) * Math.cos(z * 0.00017) + 90 * Math.sin(x * 0.0011) * Math.sin(z * 0.0009 + 0.5)
        + Math.max(0, -z - 30000) * 0.03 - Math.max(0, z - 9000) * 0.02;
  for (const a of AIRPORTS) {
    const d = Math.hypot(x - a.position.x, z - a.position.z);
    const k = 1 - smoothstep(a.flattenRadius, a.flattenRadius * 2.2, d);
    h = h + (a.elevation - h) * k;
  }
  return h;
}

export async function createTerrain(ctx) {
  const N = 256, SIZE = 120000;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; mesh.frustumCulled = false;
  ctx.scene.add(mesh);
  const pos = geo.attributes.position, base = pos.array.slice();
  const col = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3); geo.setAttribute('color', col);
  function rebuild() {
    const o = ctx.world.origin;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3] + o.x, z = base[i * 3 + 2] + o.z, h = stubHeight(x, z);
      pos.array[i * 3 + 1] = h;
      const g = h < 2 ? [0.76, 0.7, 0.5] : h > 900 ? [0.5, 0.48, 0.46] : [0.22 + 0.05 * Math.sin(x * 0.01), 0.36, 0.16];
      col.array.set(g, i * 3);
    }
    pos.needsUpdate = true; col.needsUpdate = true; geo.computeVertexNormals();
  }
  rebuild();
  ctx.events.on('originShift', rebuild);
  ctx.world.setTerrainHeightFn(stubHeight);
  return { object3D: mesh, heightAt: stubHeight, update() {} };
}
