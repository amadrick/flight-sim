// Pure (no three.js / no GL) bookkeeping for the pooled tube trails in ribbons.js — node-testable.
//
// One Float32Array holds every trail point of every trail. It is cut into fixed SLICES (a few "long" ones for missile
// smoke / damage trails / contrails, more "short" ones for wingtips, flares, debris). A slice of n points is stored as
// n + 1 records: record n mirrors record 0, so the ring's wrap-around segment (n-1 → 0) is a contiguous pair. Every
// instance of the GPU draw is the segment record i → record i+1; the shader keeps it only when both records carry the
// same run id (uid) and time increases — so segments across slice boundaries, across separate runs in the same slice
// and from the newest point back to the oldest one in the ring are all rejected without any extra bookkeeping.
//
// Record layout (STRIDE floats):
//   0 x  1 y  2 z  (anchored world, see effects/anchor.js)   3 birth time (s)
//   4 strength (optical-depth scale)  5 uid (run id, > 0)  6 distance along the run (m)  7 initial radius w0 (m)
//   8 heat (emission scale)  9 seed  10 rise (m/s, + = up)  11 style + shade (integer style, fract = darkening 0..0.99)
export const STRIDE = 12;

export class RibbonPool {
  /** classes: [{ name, count, points }] */
  constructor(classes) {
    this.slices = [];
    let base = 0;
    for (const c of classes) {
      for (let i = 0; i < c.count; i++) {
        this.slices.push({ cls: c.name, base, n: c.points, owner: null, freeAt: -1e9, minD: Infinity, maxD: -1 });
        base += c.points + 1;
      }
    }
    this.records = base + 1;                 // + 1: the very last instance needs a successor record
    this.array = new Float32Array(this.records * STRIDE);
    for (let i = 0; i < this.records; i++) this.array[i * STRIDE + 3] = -1e9;
    this.nextUid = 1;
    this.fullDirty = true;
  }
  /** Take a free slice of class `cls` (a slice is free once its last points have expired: freeAt <= now).
   *  When none is free, steal the released slice that expires soonest (its old smoke vanishes early). */
  alloc(cls, owner, now) {
    let best = null;
    for (const s of this.slices) {
      if (s.cls !== cls || s.owner) continue;
      if (s.freeAt <= now) { best = s; break; }
      if (!best || s.freeAt < best.freeAt) best = s;
    }
    if (!best) return null;
    best.owner = owner;
    return best;
  }
  /** Give a slice back; its points stay visible until `now + life`. */
  release(slice, now, life) { if (!slice) return; slice.owner = null; slice.freeAt = now + life; }
  /** Write one record (index within the slice). Keeps the mirror and the per-slice dirty range. */
  write(slice, idx, x, y, z, t, strength, uid, dist, w0, heat, seed, rise, style) {
    const a = this.array;
    let o = (slice.base + idx) * STRIDE;
    a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = t;
    a[o + 4] = strength; a[o + 5] = uid; a[o + 6] = dist; a[o + 7] = w0;
    a[o + 8] = heat; a[o + 9] = seed; a[o + 10] = rise; a[o + 11] = style;
    if (idx < slice.minD) slice.minD = idx;
    if (idx > slice.maxD) slice.maxD = idx;
    if (idx === 0) {
      const m = (slice.base + slice.n) * STRIDE;
      for (let k = 0; k < STRIDE; k++) a[m + k] = a[o + k];
      slice.maxD = slice.n;
    }
  }
  /** Collect the dirty ranges as [startRecord, count] pairs via cb, then reset them. */
  drainDirty(cb) {
    if (this.fullDirty) {
      this.fullDirty = false;
      for (const s of this.slices) { s.minD = Infinity; s.maxD = -1; }
      cb(0, this.records);
      return;
    }
    for (const s of this.slices) {
      if (s.maxD < 0) continue;
      cb(s.base + s.minD, s.maxD - s.minD + 1);
      s.minD = Infinity; s.maxD = -1;
    }
  }
  rebase(dx, dz) {
    const a = this.array;
    for (let o = 0; o < a.length; o += STRIDE) { a[o] -= dx; a[o + 2] -= dz; }
    this.fullDirty = true;
  }
  clear() {
    for (let i = 0; i < this.records; i++) { this.array[i * STRIDE + 3] = -1e9; this.array[i * STRIDE + 5] = 0; }
    for (const s of this.slices) { s.owner = null; s.freeAt = -1e9; }
    this.fullDirty = true;
  }
  /** latest expiry of anything written (for skipping the draw) */
  busyUntil() { let t = -1e9; for (const s of this.slices) t = Math.max(t, s.owner ? 1e9 : s.freeAt); return t; }
}

/**
 * One trail emitter (a run of points following a moving source). Spacing adapts to speed like effects/trails.js:
 * the newest ("live") point moves with the source every frame and is committed once it is `spacing` metres (or
 * maxDt seconds) from the previous committed point, so the trail always reaches the source and bends smoothly.
 */
export class Ribbon {
  constructor(pool, cls, opts = {}) {
    this.pool = pool; this.cls = cls;
    this.life = opts.life ?? 15; this.spacingMin = opts.spacingMin ?? 2; this.spacingMax = opts.spacingMax ?? 40; this.maxDt = opts.maxDt ?? 0.4;
    this.slice = null; this.active = false; this.head = 0; this.uid = 0; this.dist = 0;
    this.lx = 0; this.ly = 0; this.lz = 0; this.lt = 0; this.seed = 0;
  }
  /** wx/wy/wz: anchored world position (float-safe), t: now. style: integer style + shade fraction. */
  emit(wx, wy, wz, t, strength, w0, heat, rise, style) {
    const P = this.pool;
    if (!this.active) {
      if (!this.slice) { this.slice = P.alloc(this.cls, this, t); if (!this.slice) return false; }
      this.active = true; this.dist = 0; this.uid = P.nextUid++; this.seed = (this.uid * 0.61803398875) % 1;
      const n = this.slice.n;
      this.head = (this.head + 1) % n;
      P.write(this.slice, this.head, wx, wy, wz, t, strength, this.uid, 0, w0, heat, this.seed, rise, style);
      this.lx = wx; this.ly = wy; this.lz = wz; this.lt = t;
      this.head = (this.head + 1) % n;
      P.write(this.slice, this.head, wx, wy, wz, t, strength, this.uid, 0, w0, heat, this.seed, rise, style);
      return true;
    }
    const dx = wx - this.lx, dy = wy - this.ly, dz = wz - this.lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const spd = d / Math.max(1e-3, t - this.lt);
    const spacing = Math.min(this.spacingMax, Math.max(this.spacingMin, spd * this.life / (this.slice.n * 0.8)));
    const cur = this.dist + d;
    if (d >= spacing || t - this.lt >= this.maxDt) {
      this.dist = cur;
      P.write(this.slice, this.head, wx, wy, wz, t, strength, this.uid, cur, w0, heat, this.seed, rise, style);
      this.lx = wx; this.ly = wy; this.lz = wz; this.lt = t;
      this.head = (this.head + 1) % this.slice.n;
      P.write(this.slice, this.head, wx, wy, wz, t, strength, this.uid, cur, w0, heat, this.seed, rise, style);
    } else {
      P.write(this.slice, this.head, wx, wy, wz, t, strength, this.uid, cur, w0, heat, this.seed, rise, style);
    }
    return true;
  }
  /** End the run; the slice is kept for a restart until release(). */
  stop() { this.active = false; }
  /** End the run and hand the slice back (its smoke lingers for `life`). */
  release(t) { this.active = false; if (this.slice) { this.pool.release(this.slice, t, this.life); this.slice = null; } }
}
