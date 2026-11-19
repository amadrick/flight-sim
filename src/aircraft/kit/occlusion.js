// Aircraft kit — contact occlusion baked into the atlas 'ao' layer.
//
// Shadow maps resolve the sun; nothing resolves the soft darkening where a wing, a tailplane, a pylon or a nacelle sits close
// to the fuselage. rig.build() calls bakeContactAO(): the static skin meshes are voxelised coarsely, and every unwrap chart
// that knows its loft (chart.body) gets a low-resolution occlusion image, computed by marching a small fan of rays through
// the voxels from points just above the skin. The skin material multiplies ambient light (and, partly, direct light) by it.
// Cost: a few milliseconds per aircraft; resolution: about one voxel (10 – 35 cm), smoothed — a soft contact shadow, no more.

/** meshes: kit Mesh objects (occluders). atlases: atlas objects with unwrap charts whose `body` is set. */
export function bakeContactAO(meshes, atlases, o = {}) {
  const todo = [], T0 = performance.now();
  for (const at of atlases) if (at && at.charts && at.paintable && at.layer) for (const c of Object.values(at.charts)) if (c.type === 'unwrap' && c.body && typeof c.body.at === 'function' && c.spec.ao !== false) todo.push([at, c]);
  if (!todo.length || !meshes.length) return 0;
  // ---- bounds and grid ---------------------------------------------------------------------------------------------------
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) { const p = m.p; for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { const v = p[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; } }
  const dim = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  if (!(dim > 0)) return 0;
  const h = Math.min(0.35, Math.max(0.07, dim / 110)) * (o.cell ?? 1), inv = 1 / h;
  const nx = Math.ceil((mx[0] - mn[0]) * inv) + 3, ny = Math.ceil((mx[1] - mn[1]) * inv) + 3, nz = Math.ceil((mx[2] - mn[2]) * inv) + 3;
  if (nx * ny * nz > 6e6) return 0;
  const ox = mn[0] - h, oy = mn[1] - h, oz = mn[2] - h, grid = new Uint8Array(nx * ny * nz), nxy = nx * ny;
  const mark = (x, y, z) => { grid[((x - ox) * inv | 0) + ((y - oy) * inv | 0) * nx + ((z - oz) * inv | 0) * nxy] = 1; };
  const step = h * 1.05, step2 = step * step;
  for (const m of meshes) {
    const p = m.p, ix = m.idx;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const ax = p[a], ay = p[a + 1], az = p[a + 2], ux = p[b] - ax, uy = p[b + 1] - ay, uz = p[b + 2] - az, vx = p[c] - ax, vy = p[c + 1] - ay, vz = p[c + 2] - az;
      const wx = ux - vx, wy = uy - vy, wz = uz - vz, L2 = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz);
      const n = L2 <= step2 ? 1 : Math.min(48, Math.ceil(Math.sqrt(L2) / step));
      if (n === 1) { mark(ax + (ux + vx) / 3, ay + (uy + vy) / 3, az + (uz + vz) / 3); continue; }
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) { const s = i / n, r = j / n; mark(ax + ux * s + vx * r, ay + uy * s + vy * r, az + uz * s + vz * r); }
    }
  }
  const T1 = performance.now(); let points = 0;
  const hit = (x, y, z) => { const i = (x - ox) * inv | 0, j = (y - oy) * inv | 0, k = (z - oz) * inv | 0; return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && grid[i + j * nx + k * nxy] === 1; };
  // ---- ray fan: the normal plus eight directions tilted 55° from it ---------------------------------------------------------
  const STEPS = 6, TILT = 55 * Math.PI / 180, ct = Math.cos(TILT), st = Math.sin(TILT), strength = o.strength ?? 0.85;
  const occAt = (p, n) => {
    // tangent frame
    const ax = Math.abs(n[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0];
    let tx = ax[1] * n[2] - ax[2] * n[1], ty = ax[2] * n[0] - ax[0] * n[2], tz = ax[0] * n[1] - ax[1] * n[0]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const bx = n[1] * tz - n[2] * ty, by = n[2] * tx - n[0] * tz, bz = n[0] * ty - n[1] * tx;
    const sx = p[0] + n[0] * h * 1.7, sy = p[1] + n[1] * h * 1.7, sz = p[2] + n[2] * h * 1.7;
    let occ = 0, wsum = 0;
    for (let r = 0; r < 9; r++) {
      let dx, dy, dz, w;
      if (r === 0) { dx = n[0]; dy = n[1]; dz = n[2]; w = 1; }
      else { const a = (r - 1) * Math.PI / 4, c = Math.cos(a) * st, s = Math.sin(a) * st; dx = n[0] * ct + tx * c + bx * s; dy = n[1] * ct + ty * c + by * s; dz = n[2] * ct + tz * c + bz * s; w = ct; }
      wsum += w;
      for (let k = 0; k < STEPS; k++) { const d = k * h; if (hit(sx + dx * d, sy + dy * d, sz + dz * d)) { occ += w * (1 - k / (STEPS + 1)); break; } }
    }
    return occ / wsum;
  };
  // ---- one small image per chart strip ---------------------------------------------------------------------------------------
  let n = 0;
  for (const [at, c] of todo) {
    const L = at.layer('ao'), g = L.ctx, k = L.scale, body = c.body, zr = body.zRange || [c.z0, c.z1];
    for (const s of c.strips) {
      const z0 = Math.max(s.a0, Math.min(zr[0], zr[1])), z1 = Math.min(s.a1, Math.max(zr[0], zr[1]));
      if (!(z1 > z0)) continue;
      const W = Math.max(4, Math.min(96, Math.round((z1 - z0) / (h * 1.5)))), girth = c.spec.girth ?? 3, H = Math.max(8, Math.min(40, Math.round(girth / (h * 1.5))));
      const val = new Float32Array(W * H), zs = [], K = body.K, fast = typeof body.ring === 'function' && K > 2, P = [0, 0, 0], N = [0, 0, 0];
      for (let i = 0; i < W; i++) zs.push(z0 + (z1 - z0) * (i + 0.5) / W);
      let rings = null;
      if (fast) { try { rings = zs.map(z => body.ring(z)); } catch { rings = null; } }
      for (let i = 0; i < W; i++) {
        const z = zs[i];
        if (rings) {                                                    // one ring per column; the slope along z comes from the neighbouring columns
          const r = rings[i], ia = Math.max(0, i - 1), ib = Math.min(W - 1, i + 1), r1 = rings[ia], r2 = rings[ib], zz = zs[ib] - zs[ia] || 1;
          for (let j = 0; j < H; j++) {
            const f = (j + 0.5) / H * K, j0 = Math.floor(f), g = f - j0, a = (j0 % K) * 3, b = ((j0 + 1) % K) * 3;
            P[0] = r[a] + (r[b] - r[a]) * g; P[1] = r[a + 1] + (r[b + 1] - r[a + 1]) * g; P[2] = z;
            const sx = (r2[a] + (r2[b] - r2[a]) * g) - (r1[a] + (r1[b] - r1[a]) * g), sy = (r2[a + 1] + (r2[b + 1] - r2[a + 1]) * g) - (r1[a + 1] + (r1[b + 1] - r1[a + 1]) * g);
            const tx = r[b] - r[a], ty = r[b + 1] - r[a + 1];
            let nx = ty * zz, ny = -tx * zz, nz = tx * sy - ty * sx; const l = Math.hypot(nx, ny, nz);
            points++;
            if (!(l > 1e-9) || !isFinite(P[0])) continue;
            N[0] = nx / l; N[1] = ny / l; N[2] = nz / l; val[i + j * W] = occAt(P, N);
          }
        } else for (let j = 0; j < H; j++) { let q; try { q = body.at(z, (j + 0.5) / H); } catch { q = null; } points++; val[i + j * W] = q && isFinite(q.p[0]) && isFinite(q.n[0]) ? occAt(q.p, q.n) : 0; }
      }
      // 3 × 3 smoothing (wraps around the ring), then to a canvas that is stretched over the strip
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cg = cv.getContext('2d'), im = cg.createImageData(W, H);
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let a = 0, w = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = (j + dj + H) % H; if (ii < 0 || ii >= W) continue; const ww = (di ? 1 : 2) * (dj ? 1 : 2); a += val[ii + jj * W] * ww; w += ww; }
        const v = Math.round(255 * (1 - strength * Math.min(1, a / w))), q = (i + j * W) * 4;
        im.data[q] = im.data[q + 1] = im.data[q + 2] = v; im.data[q + 3] = 255;
      }
      cg.putImageData(im, 0, 0);
      const x0 = s.tx + z0 * s.sx, x1 = s.tx + z1 * s.sx, y0 = s.ty + 0 * s.sy, y1 = s.ty + 1 * s.sy;
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'multiply'; g.imageSmoothingEnabled = true;
      g.beginPath(); g.rect(s.rect.x * k, s.rect.y * k, s.rect.w * k, s.rect.h * k); g.clip();
      g.drawImage(cv, Math.min(x0, x1) * k, Math.min(y0, y1) * k, Math.abs(x1 - x0) * k, Math.abs(y1 - y0) * k);
      g.restore(); n++;
    }
  }
  return { strips: n, voxMs: Math.round(T1 - T0), rayMs: Math.round(performance.now() - T1), points, grid: [nx, ny, nz], h: +h.toFixed(3) };
}
