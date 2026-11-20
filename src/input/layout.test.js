import test from 'node:test';
import assert from 'node:assert/strict';
import { touchLayout, layoutRects, overlaps, MIN_TARGET, BUTTON_IDS, isPortrait } from './layout.js';

// CSS viewports of real devices (portrait and landscape), the 360×640 / 640×360 minimums, tablets
const SIZES = [
  [360, 640], [640, 360], [320, 568], [568, 320], [390, 664], [750, 340], [390, 844], [844, 390], [412, 839], [863, 360],
  [430, 932], [932, 430], [768, 1024], [1024, 768], [820, 1180], [1180, 820], [1366, 1024], [600, 600],
];
const INSETS = [{}, { t: 47, b: 34 }, { l: 47, r: 47, b: 21 }];

for (const [W, H] of SIZES) for (const ins of INSETS) {
  for (const extra of [0, 2, 4]) {
    test(`touch layout ${W}x${H} insets ${JSON.stringify(ins)} extra ${extra}: no overlaps, in the safe area, ≥44 px`, () => {
      const L = touchLayout(W, H, ins, { extra });
      const rects = layoutRects(L);
      const l = Math.max(16, ins.l || 0), r = Math.max(16, ins.r || 0), t = Math.max(10, ins.t || 0), b = Math.max(12, ins.b || 0);
      for (const [n, q] of rects) {
        assert.ok(q && q.w > 0 && q.h > 0, `${n} has a size`);
        assert.ok(q.x >= l - 0.5 && q.y >= t - 0.5 && q.x + q.w <= W - r + 0.5 && q.y + q.h <= H - b + 0.5, `${n} inside the safe area: ${JSON.stringify(q)}`);
        if (n !== 'hud' && n !== 'zone') assert.ok(Math.min(q.w, q.h) >= MIN_TARGET, `${n} at least ${MIN_TARGET}px: ${JSON.stringify(q)}`);
      }
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
        assert.ok(!overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} overlaps ${rects[j][0]}`);
      assert.equal(L.extra.length, extra);
    });
  }
}

test('stick under the right thumb, throttle under the left', () => {
  for (const [W, H] of SIZES) {
    const L = touchLayout(W, H);
    assert.ok(L.zone.x + L.zone.w / 2 > W / 2, `${W}x${H} stick zone right of centre`);
    assert.ok(L.thr.x + L.thr.w / 2 < W / 2, `${W}x${H} throttle left of centre`);
    // the idle stick ring fits inside its zone
    assert.ok(L.home.x - L.home.r >= L.zone.x && L.home.x + L.home.r <= L.zone.x + L.zone.w, `${W}x${H} stick ring inside the zone`);
    assert.ok(L.zone.w >= 2 * L.stickR && L.zone.h >= 2 * L.stickR, `${W}x${H} zone fits a full stick throw`);
  }
});

test('HUD box is usable on every size', () => {
  for (const [W, H] of SIZES) {
    const L = touchLayout(W, H, { l: 47, r: 47, b: 21 }, { extra: 2 });
    assert.ok(L.hud.w >= 180, `${W}x${H} hud width ${L.hud.w}`);
    assert.ok(L.hud.h >= 80, `${W}x${H} hud height ${L.hud.h}`);
  }
});

test('every action button is placed', () => {
  const L = touchLayout(640, 360);
  for (const id of BUTTON_IDS) assert.ok(L.btn[id], id);
});

test('portrait', () => {
  assert.equal(isPortrait(390, 844), true);
  assert.equal(isPortrait(844, 390), false);
  assert.equal(isPortrait(600, 600), false);
});
