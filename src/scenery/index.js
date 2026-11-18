// STUB scenery — the airports agent replaces this. API: createScenery(ctx) -> { update(dt) }
// Must register a surface provider so runways report type 'runway' to physics.
import * as THREE from 'three';
import { AIRPORTS, runwayLocal } from '../data/airports.js';
import { DEG } from '../core/constants.js';
export async function createScenery(ctx) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  for (const a of AIRPORTS) for (const r of a.runways) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(r.width, r.length).rotateX(-Math.PI / 2), mat);
    m.rotation.y = -r.heading * DEG; m.receiveShadow = true;
    ctx.world.anchor(m, new THREE.Vector3(r.center.x, a.elevation + 0.15, r.center.z));
    ctx.scene.add(m);
  }
  ctx.world.addSurfaceProvider((x, z, out) => {
    for (const a of AIRPORTS) {
      if (Math.abs(x - a.position.x) > 6000 || Math.abs(z - a.position.z) > 6000) continue;
      for (const r of a.runways) { const l = runwayLocal(r, x, z); if (Math.abs(l.along) < r.length / 2 && Math.abs(l.cross) < r.width / 2) { out.type = 'runway'; return; } }
    }
  });
  return { update() {} };
}
