// Anchored world storage for effects with history (particles, trails).
// Positions are stored in float32 as (world − anchor). The anchor snaps to the floating origin only when it has
// drifted more than REBASE metres away, so stored values stay small (sub-mm precision) and data survives every
// `originShift` for free: the render offset (anchor − origin) is a single shared uniform (uFxAnchor).
import * as THREE from 'three';

const REBASE = 12288;

export function createAnchor(ctx, uniforms) {
  const world = new THREE.Vector3();
  const systems = new Set();
  const delta = new THREE.Vector3();
  const anchor = {
    world,
    register(sys) { systems.add(sys); return () => systems.delete(sys); },
    /** world → anchored local (float-safe) */
    toLocal(w, out) { return out.set(w.x - world.x, w.y, w.z - world.z); },
    /** call once per frame (after the origin update) */
    update() {
      const o = ctx.world.origin;
      if (Math.abs(o.x - world.x) > REBASE || Math.abs(o.z - world.z) > REBASE) {
        delta.set(o.x - world.x, 0, o.z - world.z);
        world.add(delta);
        for (const s of systems) s.rebase(delta);
      }
      uniforms.uFxAnchor.value.set(world.x - o.x, 0, world.z - o.z);
    },
    /** snap the anchor onto the origin immediately (only when no data is alive, e.g. session start) */
    reset() {
      const o = ctx.world.origin;
      delta.set(o.x - world.x, 0, o.z - world.z);
      world.add(delta);
      for (const s of systems) s.rebase(delta);
      uniforms.uFxAnchor.value.set(0, 0, 0);
    },
  };
  return anchor;
}
