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
 * @param {{extra?:number, dock?:{w,h}, hinge?:{x,y,w,h}}} opts extra: number of extra action buttons for the rail;
 *   dock: size of one block of buttons owned by another module (ctx.input.touch.addDock, e.g. the combat fire grid):
 *   landscape → right edge, bottom-aligned beside the stick zone, the stick zone and rail step left of it;
 *   portrait → right-aligned above the action row (the extra row steps left of it);
 *   hinge: the gap between two viewport segments (dual-screen / foldable spanned), in viewport CSS px. A vertical hinge
 *   (side-by-side screens) puts the left-thumb controls and the HUD on the left screen and the stick zone, rail and
 *   Cam / Menu on the right one; a horizontal hinge (stacked screens) keeps the HUD on the top screen and every control
 *   on the bottom one. Nothing straddles the hinge. Zero-width folds (one continuous panel) are ignored.
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
  const hg = opts.hinge && (opts.hinge.w >= 2 || opts.hinge.h >= 2) ? opts.hinge : null;
  const vHinge = hg && hg.h >= H * 0.5 && hg.w < W * 0.5 ? hg : null;     // side-by-side screens
  const hHinge = hg && hg.w >= W * 0.5 && hg.h < H * 0.5 ? hg : null;     // stacked screens
  const dk = opts.dock && opts.dock.w > 0 && opts.dock.h > 0 ? { w: Math.ceil(opts.dock.w), h: Math.ceil(opts.dock.h) } : null;
  const L = { W, H, portrait, b, g, stickR, safe: { l, r, t, b: bt }, btn: {}, extra: [], dock: null, hinge: vHinge || hHinge || null };

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
    const minZone = 2 * stickR + 2 * g;
    const zoneW = Math.round(clamp(W * 0.4, 4 * b, 440));
    const zx0 = vHinge ? Math.max(vHinge.x + vHinge.w + g, gridR + g * 2) : gridR + g * 2;   // spanned: the whole right screen
    const rail = (y0, x1) => {          // extra-button columns from the right edge x1, starting at y0
      const perCol = Math.max(1, Math.floor((H - bt - y0 + g) / (b + g)));
      const cols = nExtra ? Math.ceil(nExtra / perCol) : 0;
      return { perCol, cols, w: cols ? cols * b + (cols - 1) * g : 0, y0, x1 };
    };
    let rl = rail(zy, W - r - (dk ? dk.w + g : 0));
    let zoneTop = zy, zoneRight = rl.x1 - (rl.w ? rl.w + g : 0);
    if (dk) {
      const avail = H - bt - zy;
      if (zoneRight - zx0 >= minZone) {
        // dock beside the stick zone at the right edge, bottom-aligned (thumb reach; the top of the right edge stays free
        // for overlay panels such as the combat radar)
        L.dock = R(W - r - dk.w, zy + Math.max(0, avail - dk.h), dk.w, Math.min(dk.h, avail));
      } else {
        // narrow (square-ish) screens: dock at the top of the right column, stick zone and rail below it
        L.dock = R(W - r - dk.w, zy, dk.w, dk.h);
        zoneTop = zy + dk.h + g;
        rl = rail(zoneTop, W - r);
        zoneRight = W - r - (rl.w ? rl.w + g : 0);
      }
    }
    let zx = vHinge ? zx0 : Math.max(zoneRight - zoneW, zx0);
    // with a dock, keep room for the rudder beside the grid when the stick zone can spare it
    const rudX = zx0 - g * 2 + Math.round(g * 1.5) + Math.ceil(2.6 * b) + Math.round(g * 1.5);
    if (dk && !vHinge && zx < rudX && zoneRight - rudX >= minZone) zx = rudX;
    L.zone = R(zx, zoneTop, zoneRight - zx, H - bt - zoneTop);
    const leftEnd = vHinge ? vHinge.x - g : L.zone.x - g;            // right edge of the left-thumb side
    for (let i = 0; i < nExtra; i++) L.extra.push(R(rl.x1 - b - Math.floor(i / rl.perCol) * (b + g), rl.y0 + (i % rl.perCol) * (b + g), b, b));
    // rudder between the grid and the stick zone, or above the grid when that gap is too narrow
    let rx = gridR + Math.round(g * 1.5), rw = Math.min(L.zone.x - Math.round(g * 1.5), leftEnd) - rx;
    let hudBottom = Math.min(L.thr.y, gy) - g;
    if (rw >= 2.6 * b) {
      const w = Math.min(rw, 5 * b);
      L.rud = R(rx + (rw - w) / 2, H - bt - rudH, w, rudH);
    } else {
      L.rud = R(gx, gy - g - rudH, gridR - gx, rudH);
      hudBottom = Math.min(L.thr.y, L.rud.y) - g;
    }
    L.hud = R(l, t, leftEnd - l, hudBottom - t);
    // area free of visible controls, for a centred conformal HUD (the stick zone is invisible, so it counts as free)
    // (spanned across a vertical hinge: only the right screen, so a conformal HUD centred on the hinge falls back to the strip)
    const cx0 = vHinge ? L.zone.x : gridR + g, cx1 = Math.min(zoneRight, L.dock ? L.dock.x - g : W);
    const bottomRud = L.rud.y > gy - g;
    L.clear = R(cx0, zy, cx1 - cx0, (bottomRud ? L.rud.y : H - bt) - g - zy);
  } else {
    // bottom block: throttle left, stick zone right with the rudder below it
    let thrH = Math.round(clamp(H * 0.32, 3 * b + 2 * g, 300));
    // the dock sits beside the stick zone (above the rudder), or right-aligned above the action row when that leaves the
    // stick zone too narrow
    const zx = l + thrW + Math.round(g * 1.5);
    const dockBeside = dk && W - r - dk.w - g - zx >= 2 * stickR;
    // dock above the action row: the extras go left of it, or in a row above it when they do not fit beside it
    const exBeside = !dk || dockBeside || nExtra * (b + g) <= W - l - r - dk.w - g;
    const topBlock = dk && !dockBeside ? dk.h + (exBeside || !nExtra ? 0 : g + b) : (nExtra ? b : 0);
    if (dockBeside) thrH = Math.max(thrH, dk.h + g + rudH);
    if (hHinge) {
      // every control on the bottom screen: shrink the throttle column if the block would reach the hinge
      const avail0 = W - l - r, rows0 = Math.floor((avail0 - 5 * g) / 6) < MIN_TARGET ? 2 : 1;
      const above = Math.round(g * 1.5) + rows0 * b + (rows0 - 1) * g + (topBlock ? g + topBlock : 0);
      const room = H - bt - (hHinge.y + hHinge.h + g) - above;
      thrH = Math.max(3 * b + 2 * g, dockBeside ? dk.h + g + rudH : 0, Math.min(thrH, room));
    }
    L.thr = R(l, H - bt - thrH, thrW, thrH);
    L.rud = R(zx, H - bt - rudH, W - r - zx, rudH);
    const zR = dockBeside ? W - r - dk.w - g : W - r;
    if (dockBeside) L.dock = R(W - r - dk.w, L.rud.y - g - dk.h, dk.w, dk.h);
    L.zone = R(zx, L.thr.y, zR - zx, L.rud.y - g - L.thr.y);
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
    if (dk && !dockBeside) L.dock = R(W - r - dk.w, rowY - g - dk.h, dk.w, dk.h);
    const ex1 = W - r - (L.dock && !dockBeside && exBeside ? dk.w + g : 0);
    const exY = exBeside ? rowY - g - b : L.dock.y - g - b;
    if (nExtra) for (let i = 0; i < nExtra; i++) L.extra.push(R(ex1 - b - i * (b + g), exY, b, b));
    if (topBlock) top = rowY - g - topBlock;
    const hy = L.menu.y + L.menu.h + g;
    const hb = hHinge ? Math.min(top, hHinge.y) : top;                            // HUD stays on the top screen
    L.hud = R(l, hy, W - l - r, hb - g - hy);
    L.clear = R(l, hy, W - l - r, hb - g - hy);
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
  if (L.dock) out.push(['dock', L.dock]);
  return out;
}

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
