// Touch flight-control layout (pure, DOM-free; unit-tested in layout.test.js).
//
// Every flight-time element gets its own rectangle, so nothing overlaps at any phone / tablet size:
//
//   LANDSCAPE (primary)                                     PORTRAIT
//   ┌──────────────────────────────────────────┐           ┌──────────────────────┐
//   │ HUD box (strip / airliner deck)  [Cam][Menu]          │             [Cam][Menu]
//   │                                  [x1]  rail│           │ HUD box               │
//   │                                  [x2]      │           │                       │
//   │ ┌─┐ [Gear][AP ]         stick zone         │           │        [x2][x1] rail  │
//   │ │T│ [Flp-][Flp+]  [ rudder ]  (right thumb)│           │ [Gear][AP][F-][F+][SB][Brk]
//   │ └─┘ [SpBk][Brk]                            │           │ ┌─┐  stick zone       │
//   └──────────────────────────────────────────┘           │ │T│  [  rudder  ]     │
//                                                            └──────────────────────┘
// Throttle under the left thumb, the floating stick under the right thumb. `extra` buttons (ctx.input.touch.addButton)
// go in the rail. All sizes in CSS px; `ins` are the safe-area insets (notch, home indicator).

export const MIN_TARGET = 44;
export const BUTTON_IDS = ['gear', 'ap', 'flapUp', 'flapDn', 'sb', 'brake'];
export const MAX_EXTRA = 4;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const R = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });

/** Portrait when taller than wide (square-ish tablets count as landscape). */
export const isPortrait = (W, H) => H > W * 1.05;

/**
 * @param {number} W viewport width (CSS px)   @param {number} H viewport height
 * @param {{t?:number,r?:number,b?:number,l?:number}} ins safe-area insets
 * @param {{extra?:number}} opts number of extra action buttons to place in the rail
 */
export function touchLayout(W, H, ins = {}, opts = {}) {
  const portrait = isPortrait(W, H);
  const short = Math.min(W, H);
  const b = Math.round(clamp(short * 0.13, MIN_TARGET, 58));          // button size
  const g = Math.max(6, Math.round(b * 0.17));                          // gap
  const l = Math.max(16, ins.l || 0), r = Math.max(16, ins.r || 0);
  const t = Math.max(10, ins.t || 0), bt = Math.max(12, ins.b || 0);
  const nExtra = clamp(opts.extra | 0, 0, MAX_EXTRA);
  const stickR = clamp(Math.round(short * 0.13), 44, 64);
  const L = { W, H, portrait, b, g, stickR, safe: { l, r, t, b: bt }, btn: {}, extra: [] };

  // top-right cluster: camera + menu (menu pauses the sim)
  const camW = Math.round(b * 1.2), menuW = Math.round(b * 1.55);
  L.menu = R(W - r - menuW, t, menuW, b);
  L.cam = R(L.menu.x - g - camW, t, camW, b);
  const thrW = Math.round(b * 1.3), rudH = Math.max(MIN_TARGET, Math.round(b * 0.95));

  if (!portrait) {
    // left thumb: throttle + 2×3 action grid, bottom-aligned
    const bw = Math.round(b * 1.25);
    const gridH = 3 * b + 2 * g;
    const thrH = Math.round(clamp(Math.max(gridH, H * 0.5), gridH, 320));
    L.thr = R(l, H - bt - thrH, thrW, thrH);
    const gx = L.thr.x + thrW + Math.round(g * 1.5), gy = H - bt - gridH;
    const order = [['gear', 'ap'], ['flapUp', 'flapDn'], ['sb', 'brake']];
    order.forEach((row, ri) => row.forEach((id, ci) => { L.btn[id] = R(gx + ci * (bw + g), gy + ri * (b + g), bw, b); }));
    const gridR = gx + 2 * bw + g;
    // right thumb: stick zone (with the extra-button rail along the right edge)
    const zy = L.menu.y + L.menu.h + g;
    const perCol = Math.max(1, Math.floor((H - bt - zy + g) / (b + g)));
    const railCols = nExtra ? Math.ceil(nExtra / perCol) : 0;
    const railW = railCols ? railCols * b + (railCols - 1) * g : 0;
    const zoneW = Math.round(clamp(W * 0.4, 4 * b, 440));
    const zoneRight = W - r - (railW ? railW + g : 0);
    const zx = Math.max(zoneRight - zoneW, gridR + g * 2);
    L.zone = R(zx, zy, zoneRight - zx, H - bt - zy);
    for (let i = 0; i < nExtra; i++) L.extra.push(R(W - r - b - Math.floor(i / perCol) * (b + g), zy + (i % perCol) * (b + g), b, b));
    // rudder between the grid and the stick zone, or above the grid when that gap is too narrow
    let rx = gridR + Math.round(g * 1.5), rw = L.zone.x - Math.round(g * 1.5) - rx;
    let hudBottom = Math.min(L.thr.y, gy) - g;
    if (rw >= 2.6 * b) {
      const w = Math.min(rw, 5 * b);
      L.rud = R(rx + (rw - w) / 2, H - bt - rudH, w, rudH);
    } else {
      L.rud = R(gx, gy - g - rudH, gridR - gx, rudH);
      hudBottom = Math.min(L.thr.y, L.rud.y) - g;
    }
    L.hud = R(l, t, L.zone.x - g - l, hudBottom - t);
  } else {
    // bottom block: throttle left, stick zone right with the rudder below it
    const thrH = Math.round(clamp(H * 0.32, 3 * b + 2 * g, 300));
    L.thr = R(l, H - bt - thrH, thrW, thrH);
    const zx = L.thr.x + thrW + Math.round(g * 1.5);
    L.rud = R(zx, H - bt - rudH, W - r - zx, rudH);
    L.zone = R(zx, L.thr.y, W - r - zx, L.rud.y - g - L.thr.y);
    // action buttons: one row of six, or two rows of three on very narrow phones
    const avail = W - l - r;
    let per = Math.floor((avail - 5 * g) / 6), rows = 1, cols = 6;
    if (per < MIN_TARGET) { cols = 3; rows = 2; per = Math.floor((avail - 2 * g) / 3); }
    const rowY = L.thr.y - Math.round(g * 1.5) - rows * b - (rows - 1) * g;
    BUTTON_IDS.forEach((id, i) => {
      const ci = i % cols, ri = Math.floor(i / cols);
      L.btn[id] = R(l + ci * (per + g), rowY + ri * (b + g), per, b);
    });
    let top = rowY;
    if (nExtra) { top = rowY - g - b; for (let i = 0; i < nExtra; i++) L.extra.push(R(W - r - b - i * (b + g), top, b, b)); }
    const hy = L.menu.y + L.menu.h + g;
    L.hud = R(l, hy, W - l - r, top - g - hy);
  }
  // idle position of the floating stick (its hint ring): low in the zone, where the thumb rests
  const zr = L.zone;
  L.home = { x: Math.round(zr.x + zr.w / 2), y: Math.round(zr.y + zr.h - Math.min(zr.h / 2, stickR + 2 * g)), r: stickR };
  return L;
}

/** Every rectangle of a layout with a name (for overlap checks and debugging). */
export function layoutRects(L) {
  const out = [['menu', L.menu], ['cam', L.cam], ['thr', L.thr], ['rud', L.rud], ['zone', L.zone], ['hud', L.hud]];
  for (const id of BUTTON_IDS) out.push([id, L.btn[id]]);
  L.extra.forEach((e, i) => out.push(['extra' + i, e]));
  return out;
}

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
