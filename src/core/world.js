// World coordinates, floating origin and ground queries. Owned by the integrator.
//
// WORLD space: metres, +X east, +Y up (y = altitude above mean sea level), +Z south. Flat-earth.
//   JS doubles — precise anywhere. All simulation state (aircraft, airports) lives in world space.
// RENDER space: world minus ctx.world.origin (origin.y is always 0, so render y == altitude MSL).
//   Everything in the three.js scene graph, the camera, and every shader lives in render space.
//   The origin snaps in 1024 m steps to stay within ~2 km of the player, keeping float32 exact.
import * as THREE from 'three';

export function createWorld(ctx) {
  const origin = new THREE.Vector3();
  const anchors = new Set();
  const providers = [];
  let heightFn = () => 0;
  const tmp = {};
  const world = {
    origin,
    seaLevel: 0,
    /** world -> render (allocates only if no out is given) */
    toRender(w, out = new THREE.Vector3()) { return out.set(w.x - origin.x, w.y, w.z - origin.z); },
    /** render -> world */
    toWorld(r, out = new THREE.Vector3()) { return out.set(r.x + origin.x, r.y, r.z + origin.z); },
    /** Pin a static Object3D at a world position; core re-positions it whenever the origin shifts. */
    anchor(obj, worldPos) {
      obj.userData.worldPos = (obj.userData.worldPos || new THREE.Vector3()).copy(worldPos);
      obj.position.set(worldPos.x - origin.x, worldPos.y, worldPos.z - origin.z);
      anchors.add(obj); return obj;
    },
    unanchor(obj) { anchors.delete(obj); },
    /** Terrain module registers its CPU height function (world x,z -> metres MSL; may be < 0 under water). */
    setTerrainHeightFn(fn) { heightFn = fn; },
    /** Raw terrain height (no water clamp, no scenery). */
    terrainHeightAt(x, z) { return heightFn(x, z); },
    /** Scenery (runways, carrier deck...) registers fn(x, z, out) that may overwrite out.height/out.type. */
    addSurfaceProvider(fn) { providers.push(fn); return () => { const i = providers.indexOf(fn); if (i >= 0) providers.splice(i, 1); }; },
    /**
     * What is the solid/liquid surface under world (x, z)?
     * out = { height: m MSL, type: 'terrain'|'water'|'runway'|'taxiway'|'apron'|'deck', friction?: number }
     */
    groundAt(x, z, out = {}) {
      const h = heightFn(x, z);
      if (h < 0) { out.height = 0; out.type = 'water'; } else { out.height = h; out.type = 'terrain'; }
      out.friction = undefined; out.velocity = undefined;
      for (let i = 0; i < providers.length; i++) providers[i](x, z, out);
      return out;
    },
    groundHeightAt(x, z) { return world.groundAt(x, z, tmp).height; },
    groundNormalAt(x, z, out = new THREE.Vector3(), eps = 2) {
      const hl = world.groundHeightAt(x - eps, z), hr = world.groundHeightAt(x + eps, z);
      const hd = world.groundHeightAt(x, z - eps), hu = world.groundHeightAt(x, z + eps);
      return out.set(hl - hr, 2 * eps, hd - hu).normalize();
    },
    /** Called by core once per frame with the player's world position. */
    updateOrigin(p) {
      const dx = p.x - origin.x, dz = p.z - origin.z;
      if (Math.abs(dx) < 2048 && Math.abs(dz) < 2048) return false;
      const nx = Math.round(p.x / 1024) * 1024, nz = Math.round(p.z / 1024) * 1024;
      const delta = new THREE.Vector3(nx - origin.x, 0, nz - origin.z);
      origin.set(nx, 0, nz);
      for (const o of anchors) { const w = o.userData.worldPos; o.position.set(w.x - nx, w.y, w.z - nz); }
      // delta = how far the origin moved in world space; render-space coordinates of static things change by -delta.
      ctx.events.emit('originShift', { delta, origin });
      return true;
    },
  };
  return world;
}
