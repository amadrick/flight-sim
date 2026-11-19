// CDLOD-style quadtree selection (Strugar 2009) over a world-aligned grid. Level l nodes are P * s_l metres wide
// (s_l = s0 * 2^l = vertex spacing) and are used out to r_l = k * s_l. The LOD metric is
//     d = sqrt(horizontal distance^2 + Hd^2),
// where Hd is one per-frame scalar (the camera's clearance from the ground). The vertex shader evaluates exactly the
// same expression, so node selection and vertex morphing can never disagree => no cracks, no popping.
// Output: instance records for one instanced draw call.
//   whole node at level l            -> grid level l,   texture level l
//   quarter of a level-l node that is outside r_(l-1) -> grid level l-1 forced fully morphed (= level-l triangles)

const PLANES = 5;

export function createLodSelector({ P, s0, L, k, maxInstances, heightAt }) {
  const iA = new Float32Array(maxInstances * 4);   // render x, render z, vertex spacing, texture level
  const iB = new Float32Array(maxInstances * 4);   // grid level, force-morph flag, 0, 0
  const planes = new Float32Array(PLANES * 4);
  const bounds = new Map();                        // node key -> packed min/max height
  const boundsMin = [], boundsMax = [];
  let count = 0, tris = 0;
  let camX = 0, camY = 0, camZ = 0, orgX = 0, orgZ = 0, Hd2 = 0, minLevel = 0;
  const rho2 = new Float64Array(L + 1);

  function nodeBounds(level, ix, iz, size) {
    if (size > 9000) return -1;                      // huge nodes: use global bounds
    const key = level + 32 * ((ix + 524288) + (iz + 524288) * 1048576);
    let id = bounds.get(key);
    if (id === undefined) {
      if (bounds.size > 60000) { bounds.clear(); boundsMin.length = 0; boundsMax.length = 0; }
      const x0 = ix * size, z0 = iz * size, n = size > 1500 ? 4 : 2;
      let lo = 1e9, hi = -1e9;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const h = heightAt(x0 + (i / n) * size, z0 + (j / n) * size);
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
      const m = Math.min(size * 0.3, 450) + 4;
      id = boundsMin.length; boundsMin.push(lo - m); boundsMax.push(hi + m);
      bounds.set(key, id);
    }
    return id;
  }

  function visible(level, ix, iz, size) {
    const id = nodeBounds(level, ix, iz, size);
    const x0 = ix * size - orgX, z0 = iz * size - orgZ, x1 = x0 + size, z1 = z0 + size;
    // earth-curvature drop lowers far geometry: extend the box downward by the drop at its farthest corner
    const fx = Math.max(Math.abs(x0 - camX), Math.abs(x1 - camX)), fz = Math.max(Math.abs(z0 - camZ), Math.abs(z1 - camZ));
    const drop = (fx * fx + fz * fz) / 12742000;
    const y0 = (id < 0 ? -3500 : boundsMin[id]) - drop, y1 = id < 0 ? 5200 : boundsMax[id];
    for (let p = 0; p < PLANES; p++) {
      const a = planes[p * 4], b = planes[p * 4 + 1], c = planes[p * 4 + 2], d = planes[p * 4 + 3];
      // positive vertex
      if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? y1 : y0) + c * (c > 0 ? z1 : z0) + d < 0) return false;
    }
    return true;
  }

  function hitsDisc(x0, z0, size, r2) {
    const cx = camX + orgX, cz = camZ + orgZ;
    const dx = Math.max(x0 - cx, 0, cx - (x0 + size)), dz = Math.max(z0 - cz, 0, cz - (z0 + size));
    return dx * dx + dz * dz < r2;
  }

  function emit(x0, z0, size, gridLevel, texLevel, force) {
    if (count >= maxInstances) return;
    const o = count * 4;
    iA[o] = x0 - orgX; iA[o + 1] = z0 - orgZ; iA[o + 2] = size / P; iA[o + 3] = texLevel;
    iB[o] = gridLevel; iB[o + 1] = force; iB[o + 2] = 0; iB[o + 3] = 0;
    count++;
  }

  function select(level, ix, iz) {
    const size = P * s0 * 2 ** level;
    if (!visible(level, ix, iz, size)) return;
    const x0 = ix * size, z0 = iz * size;
    if (level <= minLevel || !hitsDisc(x0, z0, size, rho2[level - 1])) { emit(x0, z0, size, level, level, 0); return; }
    const half = size / 2;
    // nearest child first: roughly front-to-back draw order, so early-z rejects hidden fragments of the costly shader
    const ni = camX + orgX > x0 + half ? 1 : 0, nj = camZ + orgZ > z0 + half ? 1 : 0;
    for (let q = 0; q < 4; q++) {
      const i = q & 1 ? 1 - ni : ni, j = q & 2 ? 1 - nj : nj;
      const cx = x0 + i * half, cz = z0 + j * half;
      if (hitsDisc(cx, cz, half, rho2[level - 1])) select(level - 1, ix * 2 + i, iz * 2 + j);
      else if (visible(level - 1, ix * 2 + i, iz * 2 + j, half)) emit(cx, cz, half, level - 1, level, 1);
    }
  }

  return {
    iA, iB,
    get count() { return count; },
    /**
     * cam: camera position in render space; origin: world origin; Hd: LOD clearance; vp: Matrix4 elements of proj*view;
     * minLvl: finest level that may be used.
     */
    update(cam, origin, Hd, vp, minLvl) {
      camX = cam.x; camY = cam.y; camZ = cam.z; orgX = origin.x; orgZ = origin.z; Hd2 = Hd * Hd; minLevel = minLvl;
      // frustum planes (left, right, bottom, top from the clip matrix; they do not depend on the depth convention) + near-ish
      const m = vp;
      const set = (i, a, b, c, d) => { const n = 1 / Math.hypot(a, b, c); planes[i * 4] = a * n; planes[i * 4 + 1] = b * n; planes[i * 4 + 2] = c * n; planes[i * 4 + 3] = d * n; };
      set(0, m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
      set(1, m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
      set(2, m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
      set(3, m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
      set(4, m[3], m[7], m[11], m[15]);              // w > 0: in front of the camera
      for (let l = 0; l < L; l++) { const r = k * s0 * 2 ** l; rho2[l] = r * r - Hd2; }
      count = 0;
      const top = L - 1;
      if (rho2[top] <= 0) return 0;
      const size = P * s0 * 2 ** top, rho = Math.sqrt(rho2[top]);
      const wx = camX + orgX, wz = camZ + orgZ;
      const i0 = Math.floor((wx - rho) / size), i1 = Math.floor((wx + rho) / size);
      const j0 = Math.floor((wz - rho) / size), j1 = Math.floor((wz + rho) / size);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        if (hitsDisc(i * size, j * size, size, rho2[top])) select(top, i, j);
      }
      tris = count * P * P * 2;
      return count;
    },
    get triangles() { return tris; },
  };
}
