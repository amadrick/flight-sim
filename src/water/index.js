// STUB water — the ocean agent replaces this. API: createWater(ctx) -> { update(dt), object3D }
import * as THREE from 'three';
export async function createWater(ctx) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400000, 400000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0b3a5c, roughness: 0.25, metalness: 0.1 }));
  mesh.frustumCulled = false; ctx.scene.add(mesh);
  return { object3D: mesh, update() { mesh.position.set(0, 0, 0); } };
}
