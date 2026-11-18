// Primitive stand-in aircraft so the app runs before real models land. Integrator-owned.
import * as THREE from 'three';
export function createPlaceholderVisual(ctx, g) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.6, roughness: 0.45 });
  const r = g.length * 0.045;
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(r, g.length - 2 * r, 6, 16), mat);
  fus.rotation.x = Math.PI / 2; fus.position.z = (g.noseZ + g.tailZ) / 2; group.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(g.span, r * 0.25, g.length * 0.2), mat); wing.position.z = 0.6; group.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(g.span * 0.38, r * 0.2, g.length * 0.1), mat); tail.position.z = g.tailZ - g.length * 0.07; group.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(r * 0.2, g.height * 0.45, g.length * 0.13), mat); fin.position.set(0, g.height * 0.25, g.tailZ - g.length * 0.08); group.add(fin);
  for (const w of g.gear) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(w.wheelRadius, w.wheelRadius, 0.25, 12), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    m.rotation.z = Math.PI / 2; m.position.set(w.pos[0], w.pos[1] + w.wheelRadius, w.pos[2]); group.add(m);
  }
  group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { object3D: group, update(state, dt) {}, dispose() { group.traverse(o => { o.geometry?.dispose(); }); } };
}
