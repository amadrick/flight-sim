// node --test src/combat/fx/ribbon-pool.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { RibbonPool, Ribbon, STRIDE } from './ribbon-pool.js';

const rec = (pool, slice, i) => pool.array.subarray((slice.base + i) * STRIDE, (slice.base + i + 1) * STRIDE);
// a segment i → i+1 is drawn when both records carry the same uid > 0 and time does not decrease (shader rule)
const segOk = (pool, k) => {
  const a = pool.array, o = k * STRIDE, p = (k + 1) * STRIDE;
  return a[o + 5] > 0 && a[o + 5] === a[p + 5] && a[p + 3] >= a[o + 3];
};

test('slices are laid out with a mirror record and one trailing record', () => {
  const pool = new RibbonPool([{ name: 'long', count: 2, points: 8 }, { name: 'short', count: 3, points: 4 }]);
  assert.equal(pool.slices.length, 5);
  assert.deepEqual(pool.slices.map((s) => s.base), [0, 9, 18, 23, 28]);
  assert.equal(pool.records, 2 * 9 + 3 * 5 + 1);
  assert.equal(pool.array.length, pool.records * STRIDE);
});

test('alloc prefers expired slices, steals the soonest-expiring when full, release delays reuse', () => {
  const pool = new RibbonPool([{ name: 'short', count: 2, points: 4 }]);
  const a = pool.alloc('short', 'A', 0), b = pool.alloc('short', 'B', 0);
  assert.ok(a && b && a !== b);
  assert.equal(pool.alloc('short', 'C', 0), null);           // both owned
  pool.release(a, 0, 10); pool.release(b, 0, 5);
  assert.equal(pool.alloc('short', 'D', 1), b);              // neither expired: steal the one that frees first
  assert.equal(pool.alloc('short', 'E', 11), a);             // expired
  assert.equal(pool.alloc('long', 'F', 11), null);           // unknown class
});

test('a ribbon run connects its own points, never across runs or slices, and wraps through the mirror', () => {
  const pool = new RibbonPool([{ name: 'short', count: 2, points: 4 }]);
  const r = new Ribbon(pool, 'short', { life: 10, spacingMin: 1, spacingMax: 1, maxDt: 10 });
  const other = new Ribbon(pool, 'short', { life: 10, spacingMin: 1, spacingMax: 1, maxDt: 10 });
  let t = 0;
  for (let i = 0; i < 9; i++) { r.emit(i * 2, 0, 0, t, 1, 0.5, 0, 0, 0); other.emit(0, i * 2, 0, t, 1, 0.5, 0, 0, 0); t += 0.1; }
  const s = r.slice;
  // the newest point is at head, the ring wrapped (9 commits into 4 points)
  assert.equal(rec(pool, s, r.head)[0], 16);
  assert.ok(segOk(pool, s.base + ((r.head + 3) % 4)), 'previous → newest drawn');
  assert.ok(!segOk(pool, s.base + r.head) || r.head === 3, 'newest → oldest rejected (time decreases)');
  // mirror record equals record 0
  assert.deepEqual(Array.from(rec(pool, s, 4)), Array.from(rec(pool, s, 0)));
  // no segment from the end of slice 0 into slice 1
  assert.ok(!segOk(pool, s.base + 4) || pool.slices[1].base !== s.base + 5);
  // restart → new uid → old points not connected to new ones
  const uid0 = r.uid; r.stop(); r.emit(100, 0, 0, t, 1, 0.5, 0, 0, 0);
  assert.notEqual(r.uid, uid0);
  const prev = (r.head + 3) % 4;
  assert.ok(!segOk(pool, s.base + prev) || rec(pool, s, prev)[5] === r.uid);
});

test('dirty ranges cover written records; rebase shifts xz of every record (origin-shift survival)', () => {
  const pool = new RibbonPool([{ name: 'short', count: 2, points: 4 }]);
  const ranges = []; pool.drainDirty((s, c) => ranges.push([s, c]));
  assert.deepEqual(ranges, [[0, pool.records]]);             // first upload is full
  const r = new Ribbon(pool, 'short', { life: 10, spacingMin: 5, spacingMax: 5 });
  r.emit(1000, 50, -2000, 0, 1, 0.5, 0, 0, 0);
  ranges.length = 0; pool.drainDirty((s, c) => ranges.push([s, c]));
  assert.equal(ranges.length, 1);
  const [st, n] = ranges[0];
  assert.ok(st <= r.slice.base + r.head && st + n > r.slice.base + r.head);
  const before = Array.from(rec(pool, r.slice, r.head));
  pool.rebase(1024, -2048);
  const after = rec(pool, r.slice, r.head);
  assert.equal(after[0], before[0] - 1024); assert.equal(after[1], before[1]); assert.equal(after[2], before[2] + 2048);
  ranges.length = 0; pool.drainDirty((s, c) => ranges.push([s, c]));
  assert.deepEqual(ranges, [[0, pool.records]]);
});

test('anchored storage: world position = local + anchor, unchanged by a rebase of both', () => {
  // emulate effects/anchor.js: local = world - anchor; after a rebase by d, anchor += d and local -= d
  const pool = new RibbonPool([{ name: 'short', count: 1, points: 4 }]);
  const anchor = { x: 0, z: 0 };
  const r = new Ribbon(pool, 'short', { life: 10 });
  const wx = 123456.789, wz = -98765.432;
  r.emit(wx - anchor.x, 10, wz - anchor.z, 0, 1, 0.5, 0, 0, 0);
  const d = { x: 12288, z: -12288 };
  anchor.x += d.x; anchor.z += d.z; pool.rebase(d.x, d.z);
  const a = rec(pool, r.slice, r.head);
  assert.ok(Math.abs(a[0] + anchor.x - wx) < 0.02);
  assert.ok(Math.abs(a[2] + anchor.z - wz) < 0.02);
});
