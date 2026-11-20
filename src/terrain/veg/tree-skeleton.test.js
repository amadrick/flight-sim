// Procedural tree generator: skeletons obey the pipe model and stay in the crown, every species fits its vertex
// budget, the baked visibility is physical (open sky = 1, crown interiors darker than the outer leaves).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { growSkeleton, leafGrid, bakeVisibility } from './tree-skeleton.js';
import { buildTreeMeshes, VMAX, VTEXELS } from './treegen.js';
import { SPECIES, rng32 } from './species.js';

test('space colonisation: radii shrink toward the tips, nodes stay near the crown', () => {
  const sp = SPECIES.find((s) => s.id === 'oak');
  const { nodes, tips } = growSkeleton(sp, rng32(7), { attract: 600, shell: 0.5, seg: 0.03, infl: 0.2, kill: 0.05, trunkUp: 0.15, trunkR: 0.03 });
  assert.ok(tips.length > 50, `tips ${tips.length}`);
  for (const n of nodes) {
    if (n.parent >= 0) assert.ok(nodes[n.parent].r >= n.r * 0.999, 'parent at least as thick as child');
    assert.ok(n.y <= 1.1 && Math.hypot(n.x, n.z) < sp.rad * 1.3, 'inside the crown envelope');
  }
});

test('visibility bake: open sky is 1, a point inside a dense leaf ball is shaded', () => {
  const cards = [];
  for (let i = 0; i < 400; i++) cards.push({ c: [Math.sin(i) * 0.2, 0.5 + Math.cos(i * 1.7) * 0.2, Math.sin(i * 2.3) * 0.2], area: 0.02 });
  const g = leafGrid(cards, [-0.3, 0.2, -0.3, 0.3, 0.8, 0.3], 16);
  const open = bakeVisibility(leafGrid([], [-1, 0, -1, 1, 2, 1], 8), [0, 1, 0]);
  assert.ok(Math.abs(open[0] - 1) < 1e-9 && Math.abs(open[2]) < 1e-9);
  const inside = bakeVisibility(g, [0, 0.5, 0]), edge = bakeVisibility(g, [0.28, 0.5, 0]);
  assert.ok(inside[0] < 0.5 && inside[0] < edge[0], `inside ${inside[0]} edge ${edge[0]}`);
  assert.ok(edge[1] > 0.05, 'the outer side of the ball sees more sky outward');
});

test('tree meshes: every species within budget, visibility in range, tops at unit height', () => {
  const m = buildTreeMeshes();
  const d = m.texture.image.data;
  for (const [si, s] of m.info.entries()) {
    assert.ok(s.vcount > 300 && s.vcount <= VMAX && s.vcount % 3 === 0, `${s.id} ${s.vcount}`);
    assert.ok(Math.abs(s.ymax - 1) < 1e-6, `${s.id} top ${s.ymax}`);
    for (let v = 0; v < s.vcount; v += 7) {
      const k = (si * VMAX + v) * VTEXELS * 4;
      assert.ok(d[k + 12] >= 0 && d[k + 12] <= 1.0001, `${s.id} c0 ${d[k + 12]}`);
    }
  }
});
