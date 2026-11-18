// Conformal projection of world DIRECTIONS (points at infinity) through the real camera onto the overlay canvas.
// Uses camera.matrixWorldInverse (rotation part) and camera.projectionMatrix, so zoom / FOV / view offsets all register.

export function createProjector() {
  const P = {
    w: 1, h: 1,
    // rotation world→view (row-major 3×3) and projection terms
    r0: 1, r1: 0, r2: 0, r3: 0, r4: 1, r5: 0, r6: 0, r7: 0, r8: 1,
    p0: 1, p5: 1, p8: 0, p9: 0,
    fx: 1, fy: 1,           // pixels per unit tangent (horizontal / vertical) at the optical centre
    x: 0, y: 0, depth: 0,   // last projection result (screen px, view-space forward component)
    /** Refresh from a three.js camera (call once per frame, after the camera's matrices are updated). */
    set(camera, w, h) {
      const m = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
      // column-major: view = M * world
      P.r0 = m[0]; P.r1 = m[4]; P.r2 = m[8];
      P.r3 = m[1]; P.r4 = m[5]; P.r5 = m[9];
      P.r6 = m[2]; P.r7 = m[6]; P.r8 = m[10];
      P.p0 = p[0]; P.p5 = p[5]; P.p8 = p[8]; P.p9 = p[9];
      P.w = w; P.h = h; P.fx = p[0] * w / 2; P.fy = p[5] * h / 2;
    },
    /** Project world direction (dx,dy,dz). Writes P.x/P.y; returns true if in front of the camera. */
    dir(dx, dy, dz) {
      const vx = P.r0 * dx + P.r1 * dy + P.r2 * dz;
      const vy = P.r3 * dx + P.r4 * dy + P.r5 * dz;
      const vz = P.r6 * dx + P.r7 * dy + P.r8 * dz;
      const wv = -vz;
      P.depth = wv;
      const iw = 1 / (Math.abs(wv) < 1e-9 ? 1e-9 : wv);
      const nx = (P.p0 * vx + P.p8 * vz) * iw;
      const ny = (P.p5 * vy + P.p9 * vz) * iw;
      P.x = (nx + 1) * 0.5 * P.w;
      P.y = (1 - ny) * 0.5 * P.h;
      return wv > 1e-6;
    },
    /** View-space components of a world direction (for "behind camera" handling). */
    view(dx, dy, dz, out) {
      out.x = P.r0 * dx + P.r1 * dy + P.r2 * dz;
      out.y = P.r3 * dx + P.r4 * dy + P.r5 * dz;
      out.z = P.r6 * dx + P.r7 * dy + P.r8 * dz;
      return out;
    },
  };
  return P;
}

/** Rotate a body-axes vector (+X right, +Y up, -Z nose) into world by quaternion q (x,y,z,w). Writes out. */
export function bodyToWorld(q, bx, by, bz, out) {
  const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
  const ix = qw * bx + qy * bz - qz * by;
  const iy = qw * by + qz * bx - qx * bz;
  const iz = qw * bz + qx * by - qy * bx;
  const iw = -qx * bx - qy * by - qz * bz;
  out.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return out;
}

/** World direction for elevation el (rad) and true azimuth az (rad, 0 = north/-Z, + = east/+X). */
export function dirFromElAz(el, az, out) {
  const c = Math.cos(el);
  out.x = c * Math.sin(az); out.y = Math.sin(el); out.z = -c * Math.cos(az);
  return out;
}
