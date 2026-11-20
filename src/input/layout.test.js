import test from 'node:test';
import assert from 'node:assert/strict';
import { touchLayout, layoutRects, overlaps, MIN_TARGET, BUTTON_IDS, isPortrait } from './layout.js';

// CSS viewports of real devices (portrait and landscape), the 360×640 / 640×360 minimums, tablets
const SIZES = [
  [360, 640], [640, 360], [320, 568], [568, 320], [390, 664], [750, 340], [390, 844], [844, 390], [412, 839], [863, 360],
  [430, 932], [932, 430], [768, 1024], [1024, 768], [820, 1180], [1180, 820], [1366, 1024], [600, 600],
  [540, 720], [720, 540], [884, 1104], [1104, 884], [1280, 800], [800, 1280], [1114, 720], [720, 1114],
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

// a docked block of buttons from another module (the combat fire grid: 2×3 tall, 2×2 on short screens)
for (const [W, H] of SIZES) for (const ins of INSETS) for (const extra of [0, 2, 4]) {
  const dock = H <= 520 ? { w: 116, h: 116 } : { w: 116, h: 188 };
  // insets as they come in that orientation (notch + home bar top / bottom in portrait, at the sides in landscape)
  if (ins.l && isPortrait(W, H) || ins.t && !isPortrait(W, H)) continue;
  test(`touch layout ${W}x${H} insets ${JSON.stringify(ins)} extra ${extra} + dock: no overlaps, in the safe area`, () => {
    const L = touchLayout(W, H, ins, { extra, dock });
    assert.ok(L.dock, 'dock placed');
    const rects = layoutRects(L);
    const l = Math.max(16, ins.l || 0), r = Math.max(16, ins.r || 0), t = Math.max(10, ins.t || 0), b = Math.max(12, ins.b || 0);
    for (const [n, q] of rects) {
      assert.ok(q.x >= l - 0.5 && q.y >= t - 0.5 && q.x + q.w <= W - r + 0.5 && q.y + q.h <= H - b + 0.5, `${n} inside the safe area: ${JSON.stringify(q)}`);
      if (!['hud', 'zone', 'dock'].includes(n)) assert.ok(Math.min(q.w, q.h) >= MIN_TARGET, `${n} ≥ 44: ${JSON.stringify(q)}`);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
      assert.ok(!overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} overlaps ${rects[j][0]}`);
    assert.ok(L.dock.h >= dock.h - 0.5, 'dock full height');
    assert.ok(L.dock.x + L.dock.w / 2 > W / 2, 'dock on the right');
    assert.ok(L.zone.w >= 2 * L.stickR && L.zone.h >= 2 * L.stickR, `stick zone usable ${JSON.stringify(L.zone)}`);
    if (Math.max(W, H) > 600) assert.ok(L.hud.w >= 180 && L.hud.h >= 70, `hud usable ${JSON.stringify(L.hud)}`);
    for (const [n, q] of rects) if (n !== 'zone' && n !== 'hud') assert.ok(!overlaps(L.clear, q), `clear overlaps ${n}`);
  });
}
for (const [W, H, hinge] of [[1114, 720, { x: 540, y: 0, w: 34, h: 720 }], [720, 1114, { x: 0, y: 540, w: 720, h: 34 }]]) {
  test(`spanned ${W}x${H} + dock: nothing on the hinge`, () => {
    const L = touchLayout(W, H, {}, { extra: 2, dock: { w: 116, h: 188 }, hinge });
    for (const [n, q] of layoutRects(L).concat([['clear', L.clear]])) assert.ok(!overlaps(q, hinge), `${n} on the hinge`);
  });
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

test('clear area (for a conformal HUD) avoids every visible control', () => {
  for (const [W, H] of SIZES) {
    const L = touchLayout(W, H, {}, { extra: 2 });
    for (const [n, q] of layoutRects(L)) {
      if (n === 'zone' || n === 'hud') continue;
      assert.ok(!overlaps(L.clear, q), `${W}x${H} clear overlaps ${n}`);
    }
  }
});

// dual-screen devices spanned across a hinge (Surface Duo style: two 540 px screens, 34 px gap)
const SPANS = [
  [1114, 720, { x: 540, y: 0, w: 34, h: 720 }],
  [720, 1114, { x: 0, y: 540, w: 720, h: 34 }],
  [1200, 800, { x: 580, y: 0, w: 40, h: 800 }],
  [800, 1200, { x: 0, y: 580, w: 800, h: 40 }],
];
for (const [W, H, hinge] of SPANS) for (const extra of [0, 2, 4]) for (const ins of [{}, { t: 24, b: 20 }]) {
  test(`spanned ${W}x${H} hinge ${JSON.stringify(hinge)} extra ${extra}: nothing on or across the hinge`, () => {
    const L = touchLayout(W, H, ins, { extra, hinge });
    const rects = layoutRects(L).concat([['clear', L.clear]]);
    for (const [n, q] of rects) assert.ok(!overlaps(q, hinge), `${n} touches the hinge: ${JSON.stringify(q)}`);
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
      if (rects[i][0] === 'clear' || rects[j][0] === 'clear') continue;
      assert.ok(!overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} overlaps ${rects[j][0]}`);
    }
    for (const [n, q] of rects) if (!['hud', 'zone', 'clear'].includes(n)) assert.ok(Math.min(q.w, q.h) >= MIN_TARGET, n);
    assert.ok(L.hud.w >= 200 && L.hud.h >= 90, 'hud box usable ' + JSON.stringify(L.hud));
    assert.ok(L.zone.w >= 2 * L.stickR && L.zone.h >= 2 * L.stickR, 'stick zone usable');
    assert.ok(L.home.x - L.home.r >= L.zone.x && L.home.x + L.home.r <= L.zone.x + L.zone.w, 'stick ring in its zone');
  });
}
test('a zero-width fold (one continuous panel) is ignored', () => {
  const a = touchLayout(884, 1104, {}, {}), b = touchLayout(884, 1104, {}, { hinge: { x: 442, y: 0, w: 0, h: 1104 } });
  assert.deepEqual(a.zone, b.zone);
});

// in a mission (fire cluster, View, combat HUD region), with and without the rudder slider, mirrored for left-handers
for (const [W, H] of SIZES) for (const ins of INSETS) for (const rudder of [false, true]) for (const lefty of [false, true]) {
  if (ins.l && isPortrait(W, H) || ins.t && !isPortrait(W, H)) continue;     // insets as each orientation has them
  test(`mission layout ${W}x${H} ${JSON.stringify(ins)} rudder ${rudder} lefty ${lefty}: own regions, ≥44 px`, () => {
    const L = touchLayout(W, H, ins, { mission: true, rudder, lefty, extra: rudder ? 1 : 0 });
    assert.ok(L.fire && L.view && L.cbt, 'mission parts placed');
    assert.equal(!!L.rud, rudder);
    const rects = layoutRects(L);
    const sl = lefty ? 'r' : 'l', sr = lefty ? 'l' : 'r';
    const l = Math.max(16, ins[sl] || 0), r = Math.max(16, ins[sr] || 0), t = Math.max(10, ins.t || 0), b = Math.max(12, ins.b || 0);
    for (const [n, q] of rects) {
      assert.ok(q.x >= l - 0.5 && q.y >= t - 0.5 && q.x + q.w <= W - r + 0.5 && q.y + q.h <= H - b + 0.5, `${n} inside the safe area: ${JSON.stringify(q)}`);
      if (!['hud', 'zone', 'cbt'].includes(n)) assert.ok(Math.min(q.w, q.h) >= MIN_TARGET, `${n} ≥ 44: ${JSON.stringify(q)}`);
    }
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++)
      assert.ok(!overlaps(rects[i][1], rects[j][1]), `${rects[i][0]} overlaps ${rects[j][0]}: ${JSON.stringify(rects[i][1])} ${JSON.stringify(rects[j][1])}`);
    assert.ok(L.zone.w >= 2 * L.stickR && L.zone.h >= 2 * L.stickR, `stick zone usable ${JSON.stringify(L.zone)}`);
    // GUN sits next to the stick zone on the thumb's side, below MSL
    const gun = L.fire.gun, zc = L.zone.x + L.zone.w / 2;
    const besideZ = lefty ? gun.x + gun.w <= L.zone.x + 1 : gun.x >= L.zone.x + L.zone.w - 1;
    assert.ok(besideZ || gun.y + gun.h <= L.zone.y + 1, 'gun beside (or on square screens right above) the zone');
    assert.ok(gun.y > L.fire.msl.y, 'gun below msl');
    const tc = L.thr.x + L.thr.w / 2;
    assert.ok(lefty ? zc < tc : zc > tc, 'stick zone on the stick thumb side of the throttle');
    if (!rudder && !ins.l && Math.min(W, H) >= 340 && Math.max(W, H) >= 640) assert.ok(L.cbt.h >= 60 && L.cbt.w >= 200, `combat HUD region usable ${JSON.stringify(L.cbt)}`);
    for (const [n, q] of rects) if (n !== 'zone' && n !== 'hud' && L.clear.h > 0) assert.ok(!overlaps(L.clear, q), `clear overlaps ${n}`);
  });
}
for (const [W, H, hinge] of SPANS) {
  test(`mission spanned ${W}x${H}: nothing on the hinge`, () => {
    const L = touchLayout(W, H, {}, { mission: true, rudder: false, hinge });
    for (const [n, q] of layoutRects(L).concat([['clear', L.clear]])) if (q.w && q.h) assert.ok(!overlaps(q, hinge), `${n} on the hinge ${JSON.stringify(q)}`);
  });
}
test('lefty mirrors the layout', () => {
  const a = touchLayout(844, 390, {}, { mission: true }), b = touchLayout(844, 390, {}, { mission: true, lefty: true });
  assert.equal(b.thr.x, 844 - a.thr.x - a.thr.w);
  assert.equal(b.fire.gun.x, 844 - a.fire.gun.x - a.fire.gun.w);
  assert.equal(b.home.x, 844 - a.home.x);
});
test('no rudder: the slider is gone, the zone reaches the bottom', () => {
  const L = touchLayout(390, 844, {}, { rudder: false });
  assert.equal(L.rud, null);
  assert.equal(L.zone.y + L.zone.h, 844 - 12);
});
