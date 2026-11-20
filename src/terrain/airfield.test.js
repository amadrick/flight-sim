import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRPORTS } from '../data/airports.js';
import { buildLayout } from '../scenery/layout.js';
import { airfieldPrimitives, airfieldDistance, fenceBox } from './airfield.js';

test('airfield distance field: signed distances to pavement and runways', () => {
  const ap = AIRPORTS.find((a) => a.id === 'KHVN');
  const L = buildLayout(ap), P = airfieldPrimitives(L);
  assert.ok(P.length > 20 && P.length <= 1024);
  const r = ap.runways[0], cx = r.center.x - ap.position.x, cz = r.center.z - ap.position.z;
  const [dA, dR] = airfieldDistance(P, cx, cz);
  assert.ok(dA < -20 && dR < -20, `centre of the runway is deep inside: ${dA} ${dR}`);
  // 09L/27R runs east-west, 60 m wide: 10 m outside the paved edge (runway + 7.5 m shoulder) to the north
  const [eA] = airfieldDistance(P, cx + 300, cz - 30 - 7.5 - 10);
  assert.ok(Math.abs(eA - 10) < 0.5, `10 m north of the shoulder: ${eA}`);
  const [fA, fR] = airfieldDistance(P, cx, cz - 2000);
  assert.ok(fA > 50 && fR > 1000);
});
test('airfield fence: perimeter box encloses the runways', () => {
  const ap = AIRPORTS.find((a) => a.id === 'KHVN');
  const fb = fenceBox({ data: ap, layout: buildLayout(ap) });
  assert.ok(fb && fb.hl > 1900 && fb.hw > 300);
  for (const r of ap.runways) {
    const qx = r.center.x - ap.position.x - fb.x, qz = r.center.z - ap.position.z - fb.z;
    assert.ok(Math.abs(qx * fb.dx + qz * fb.dz) < fb.hl && Math.abs(-qx * fb.dz + qz * fb.dx) < fb.hw);
  }
});
