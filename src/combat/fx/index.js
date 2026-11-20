// COMBAT EFFECTS — placeholder implementation written by the integrator so the rest of combat runs:
// tracers and missiles as bright points/lines only. The effects agent replaces it; API (COMBAT.md §10):
// createCombatFx(combat) -> { update(dt) }.
import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';

export async function createCombatFx(combat) {
  const ctx = combat.ctx, W = combat.weapons;
  const MAXB = 512, MAXM = 64;
  const tracerGeo = new THREE.BufferGeometry();
  const tpos = new Float32Array(MAXB * 6);
  tracerGeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
  const tracers = new THREE.LineSegments(tracerGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(60, 30, 6), toneMapped: false, fog: false, depthWrite: false }));
  tracers.frustumCulled = false; tracers.layers.set(LAYERS.POST); ctx.scene.add(tracers);
  const ptGeo = new THREE.BufferGeometry();
  const ppos = new Float32Array(MAXM * 3);
  ptGeo.setAttribute('position', new THREE.BufferAttribute(ppos, 3));
  const points = new THREE.Points(ptGeo, new THREE.PointsMaterial({ color: new THREE.Color(90, 60, 30), size: 6, sizeAttenuation: false, toneMapped: false, fog: false, depthWrite: false }));
  points.frustumCulled = false; points.layers.set(LAYERS.POST); ctx.scene.add(points);
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  combat.events.on('kill', ({ victim }) => { if (victim.kind === 'aircraft' && !victim.isPlayer) victim.hidden = false; });
  return {
    update() {
      let n = 0;
      if (combat.active) for (let i = 0; i < W.bullets.n && n < MAXB; i++) {
        const bl = W.bullets.items[i]; if (!bl.tracer) continue;
        ctx.world.toRender(bl.position, a); b.copy(bl.velocity).normalize().multiplyScalar(-40).add(a);
        tpos.set([a.x, a.y, a.z, b.x, b.y, b.z], n * 6); n++;
      }
      tracerGeo.setDrawRange(0, n * 2); tracerGeo.attributes.position.needsUpdate = true;
      let m = 0;
      if (combat.active) for (const e of combat.world.entities) {
        if ((e.kind !== 'missile' && e.kind !== 'flare') || m >= MAXM) continue;
        ctx.world.toRender(e.state.position, a); ppos.set([a.x, a.y, a.z], m * 3); m++;
      }
      ptGeo.setDrawRange(0, m); ptGeo.attributes.position.needsUpdate = true;
    },
  };
}
