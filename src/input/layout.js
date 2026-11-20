// Touch flight-control layout (pure, DOM-free; unit-tested in layout.test.js).
//
// Every flight-time element gets its own rectangle, so nothing overlaps at any phone / tablet size:
//
//   LANDSCAPE, free flight                                   LANDSCAPE, in a mission (opts.mission)
//   ┌──────────────────────────────────────────┐           ┌──────────────────────────────────────────┐
//   │ HUD box (strip / airliner deck)  [Cam][Menu]          │ HUD strip            [View][Cam][Menu]     │
//   │                                  [x1]  rail│           │ combat stack (cbt)                [Tgt][Flr]│
//   │ [Sys]                            [x2]      │           │ [Sys]                             [  MSL  ] │
//   │ ┌─┐ [Gear][AP ]         stick zone         │           │ ┌─┐ [Gear][AP ]   stick zone      [  GUN  ] │
//   │ │T│ [Flp-][Flp+]  [ rudder ]  (right thumb)│           │ │T│ [Flp-][Flp+]  (right thumb)            │
//   │ └─┘ [SpBk][Brk]                            │           │ └─┘ [SpBk][Brk]                            │
//   └──────────────────────────────────────────┘           └──────────────────────────────────────────┘
// Throttle under the left thumb, the floating stick under the right thumb (opts.lefty mirrors everything). The systems
// grid (gear, AP, flaps, speedbrake, brake) is a drawer: [Sys] opens it; touch.js shows only what the moment needs.
// The rudder slider is optional (opts.rudder === false: auto-coordinated rudder, no slider). `extra` buttons
// (ctx.input.touch.addButton) go in the rail. All sizes in CSS px; `ins` are the safe-area insets (notch, home bar).
//
//   PORTRAIT: [View][Cam][Menu] top right; HUD box under them (in a mission: strip, then the combat stack); a row of
//   [Sys] + the systems buttons; throttle bottom-left, stick zone beside it (fire buttons on its right in a mission),
//   rudder (optional) under the zone.

export const MIN_TARGET = 44;
export const BUTTON_IDS = ['gear', 'ap', 'flapUp', 'flapDn', 'sb', 'brake'];
export const FIRE_IDS = ['gun', 'msl', 'tgt', 'flr'];
export const MAX_EXTRA = 4;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const R = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.max(0, w)), h: Math.round(Math.max(0, h)) });

/** Portrait when taller than wide (square-ish tablets count as landscape). */
export const isPortrait = (W, H) => H > W * 1.05;
/** Button edge length for a viewport (the unit every control is sized in). */
export const buttonSize = (W, H) => Math.round(clamp(Math.min(W, H) * 0.13, MIN_TARGET, 58));
/** Estimated height of the flight-data strip docked in a box `w` px wide (one row from ~360 px; the HUD reports the real one). */
export const stripEstimate = (w) => (w >= 370 ? 46 : 86);

/**
 * @param {number} W viewport width (CSS px)   @param {number} H viewport height
 * @param {{t?:number,r?:number,b?:number,l?:number}} ins safe-area insets
 * @param {object} opts
 *   extra: number of extra action buttons for the rail (0–4)
 *   dock: {w,h} one block of buttons owned by another module (ctx.input.touch.addDock): landscape → right edge,
 *     bottom-aligned beside the stick zone; portrait → beside the stick zone, or above the action row on narrow phones
 *   hinge: {x,y,w,h} the gap between two viewport segments (dual-screen / foldable spanned). A vertical hinge puts the
 *     left-thumb controls and the HUD on the left screen and the stick zone, rail and buttons on the right one; a
 *     horizontal hinge keeps the HUD on the top screen and every control on the bottom one. Zero-width folds are ignored.
 *   rudder: false → no rudder slider (L.rud = null)        drawer: false → no [Sys] drawer toggle (L.more = null)
 *   mission: true → a combat mission runs: fire cluster (L.fire: gun, msl, tgt, flr), a View button (L.view), a region
 *     for the combat HUD stack (L.cbt: objectives, stores, kill feed) under the HUD strip, and in landscape L.radar (the
 *     scope, above the fire cluster) and L.subs (radio subtitles, bottom of the clear area, over the invisible zone)
 *   stripH: measured height of the HUD strip (mission layouts stack the combat HUD under it)
 *   lefty: true → mirror image (stick under the left thumb)
 */
export function touchLayout(W, H, ins = {}, opts = {}) {
  if (!opts.lefty) return core(W, H, ins, opts);
  const hg = opts.hinge ? { ...opts.hinge, x: W - opts.hinge.x - opts.hinge.w } : opts.hinge;
  const L = core(W, H, { t: ins.t, b: ins.b, l: ins.r, r: ins.l }, { ...opts, hinge: hg });
  const m = (q) => (q ? { ...q, x: W - q.x - q.w } : q);
  for (const k of ['menu', 'cam', 'view', 'more', 'thr', 'rud', 'zone', 'hud', 'clear', 'dock', 'cbt', 'radar', 'subs', 'hinge']) if (L[k]) L[k] = m(L[k]);
  for (const id in L.btn) L.btn[id] = m(L.btn[id]);
  if (L.fire) for (const id in L.fire) L.fire[id] = m(L.fire[id]);
  L.extra = L.extra.map(m);
  if (L.toast) L.toast = { ...L.toast, x: W - L.toast.x - L.toast.w };
  L.home = { ...L.home, x: W - L.home.x };
  L.safe = { ...L.safe, l: L.safe.r, r: L.safe.l };
  L.lefty = true;
  return L;
}

function core(W, H, ins, opts) {
  const portrait = isPortrait(W, H);
  const short = Math.min(W, H);
  const b = buttonSize(W, H);                                            // button size
  const g = Math.max(6, Math.round(b * 0.17));                          // gap
  const l = Math.max(16, ins.l || 0), r = Math.max(16, ins.r || 0);
  const t = Math.max(10, ins.t || 0), bt = Math.max(12, ins.b || 0);
  const nExtra = clamp(opts.extra | 0, 0, MAX_EXTRA);
  const stickR = clamp(Math.round(short * 0.13), 44, 64);
  const hg = opts.hinge && (opts.hinge.w >= 2 || opts.hinge.h >= 2) ? opts.hinge : null;
  const vHinge = hg && hg.h >= H * 0.5 && hg.w < W * 0.5 ? hg : null;     // side-by-side screens
  const hHinge = hg && hg.w >= W * 0.5 && hg.h < H * 0.5 ? hg : null;     // stacked screens
  const dk = opts.dock && opts.dock.w > 0 && opts.dock.h > 0 ? { w: Math.ceil(opts.dock.w), h: Math.ceil(opts.dock.h) } : null;
  const wantRudder = opts.rudder !== false, drawer = opts.drawer !== false, mission = !!opts.mission;
  const L = { W, H, portrait, b, g, stickR, safe: { l, r, t, b: bt }, btn: {}, extra: [], dock: null, fire: null, view: null, more: null,
    cbt: null, radar: null, subs: null, toast: null, rud: null, hinge: vHinge || hHinge || null, mission };

  // top-right cluster: [View] (missions: padlock / target view) + camera + menu (menu pauses the sim)
  const camW = Math.round(b * 1.2), menuW = Math.round(b * 1.55);
  L.menu = R(W - r - menuW, t, menuW, b);
  L.cam = R(L.menu.x - g - camW, t, camW, b);
  if (mission) L.view = R(L.cam.x - g - camW, t, camW, b);
  const clusterX = (L.view || L.cam).x;
  const thrW = Math.round(b * 1.3), rudH = Math.max(MIN_TARGET, Math.round(b * 0.95));
  // fire cluster (missions): [Tgt][Flr] / [ MSL ] / [ GUN ], GUN lowest, nearest the resting right thumb
  const fw = 2 * b + g;
  const fireH = (gunH, mslH) => gunH + mslH + b + 2 * g;
  const placeFire = (x, bottom, room) => {
    let gunH = Math.round(b * 1.5), mslH = Math.round(b * 1.15);
    if (fireH(gunH, mslH) > room) { gunH = Math.max(b, room - mslH - b - 2 * g); if (fireH(gunH, mslH) > room) { mslH = b; gunH = Math.max(b, room - b - b - 2 * g); } }
    const gy = bottom - gunH, my = gy - g - mslH, ty = my - g - b;
    L.fire = { gun: R(x, gy, fw, gunH), msl: R(x, my, fw, mslH), tgt: R(x, ty, b, b), flr: R(x + b + g, ty, b, b) };
    return ty;
  };

  if (!portrait) {
    // left thumb: throttle (with the [Sys] drawer toggle on top) + 2×3 systems grid, bottom-aligned
    const bw = Math.round(b * 1.25);
    const gridH = 3 * b + 2 * g;
    const blockH = Math.round(clamp(Math.max(gridH, H * 0.5), gridH, 320));
    const blockY = H - bt - blockH;
    if (drawer) { L.more = R(l, blockY, thrW, b); L.thr = R(l, blockY + b + g, thrW, blockH - b - g); }
    else L.thr = R(l, blockY, thrW, blockH);
    const gx = l + thrW + Math.round(g * 1.5), gy = H - bt - gridH;
    const order = [['gear', 'ap'], ['flapUp', 'flapDn'], ['sb', 'brake']];
    order.forEach((row, ri) => row.forEach((id, ci) => { L.btn[id] = R(gx + ci * (bw + g), gy + ri * (b + g), bw, b); }));
    const gridR = gx + 2 * bw + g;
    const leftTop = Math.min(blockY, gy);                                   // top of the left-thumb block
    // right thumb: stick zone (fire cluster, dock and extra-button rail along the right edge)
    const zy = L.menu.y + L.menu.h + g;
    const minZone = 2 * stickR + 2 * g;
    const zx0 = vHinge ? Math.max(vHinge.x + vHinge.w + g, gridR + g * 2) : gridR + g * 2;   // spanned: the whole right screen
    let edge = W - r;                                                       // right edge of the zone column
    let fireTop = false;
    if (mission) {
      if (W - r - fw - g - zx0 - (nExtra ? b + g : 0) - (dk ? dk.w + g : 0) >= minZone) { placeFire(W - r - fw, H - bt, H - bt - zy); edge = W - r - fw - g; }
      else { fireTop = true; placeFire(W - r - fw, zy + fireH(Math.round(b * 1.5), Math.round(b * 1.15)), H - bt - zy); }   // square-ish: fire on top, zone below
    }
    const rail = (y0, x1) => {          // extra-button columns from the right edge x1, starting at y0
      const perCol = Math.max(1, Math.floor((H - bt - y0 + g) / (b + g)));
      const cols = nExtra ? Math.ceil(nExtra / perCol) : 0;
      return { perCol, cols, w: cols ? cols * b + (cols - 1) * g : 0, y0, x1 };
    };
    const zy1 = fireTop ? L.fire.gun.y + L.fire.gun.h + g : zy;
    let rl = rail(zy1, edge - (dk ? dk.w + g : 0));
    let zoneTop = zy1, zoneRight = rl.x1 - (rl.w ? rl.w + g : 0);
    if (dk) {
      const avail = H - bt - zy1;
      if (zoneRight - zx0 >= minZone) {
        // dock beside the stick zone at the right edge, bottom-aligned (thumb reach; the top of the right edge stays free)
        L.dock = R(edge - dk.w, zy1 + Math.max(0, avail - dk.h), dk.w, Math.min(dk.h, avail));
      } else {
        // narrow (square-ish) screens: dock at the top of the right column, stick zone and rail below it
        L.dock = R(edge - dk.w, zy1, dk.w, dk.h);
        zoneTop = zy1 + dk.h + g;
        rl = rail(zoneTop, edge);
        zoneRight = edge - (rl.w ? rl.w + g : 0);
      }
    }
    let zx;
    if (vHinge) zx = zx0;
    else if (mission) {
      // the left column carries the HUD strip and the combat stack: give it up to ~420 px (one-row strip), the zone the rest
      const avail = zoneRight - minZone - g - l;
      zx = Math.max(zx0, l + Math.min(420, Math.max(avail, 0)) + g);
    } else {
      const zoneW = Math.round(clamp(W * 0.4, 4 * b, 440));
      zx = Math.max(zoneRight - zoneW, zx0);
      // with a dock, keep room for the rudder beside the grid when the stick zone can spare it
      const rudX = zx0 - g * 2 + Math.round(g * 1.5) + Math.ceil(2.6 * b) + Math.round(g * 1.5);
      if (dk && wantRudder && zx < rudX && zoneRight - rudX >= minZone) zx = rudX;
    }
    const leftEnd = vHinge ? vHinge.x - g : zx - g;                         // right edge of the left-thumb side
    for (let i = 0; i < nExtra; i++) L.extra.push(R(rl.x1 - b - Math.floor(i / rl.perCol) * (b + g), rl.y0 + (i % rl.perCol) * (b + g), b, b));
    // rudder (optional) between the grid and the stick zone, or above the grid when that gap is too narrow
    let hudBottom = leftTop - g;
    if (wantRudder) {
      const rx = gridR + Math.round(g * 1.5), rw = Math.min(zx - Math.round(g * 1.5), leftEnd) - rx;
      if (rw >= 2.6 * b) {
        const w = Math.min(rw, 5 * b);
        L.rud = R(rx + (rw - w) / 2, H - bt - rudH, w, rudH);
      } else {
        L.rud = R(gx, gy - g - rudH, gridR - gx, rudH);
        if (drawer) { L.more = R(l, Math.min(blockY, L.rud.y), thrW, b); L.thr = R(l, L.more.y + b + g, thrW, H - bt - L.more.y - b - g); }
        hudBottom = Math.min(leftTop, L.rud.y, L.more ? L.more.y : Infinity) - g;
      }
    }
    if (mission) {
      const cbtTop0 = t;                                                    // the strip docks at the top of the HUD box
      const sH = clamp(opts.stripH > 0 ? opts.stripH : stripEstimate(leftEnd - l), 30, 140);
      const hudEnd = Math.min(leftEnd, clusterX - g);                         // the strip stays left of [View][Cam][Menu]
      L.hud = R(l, cbtTop0, hudEnd - l, sH);
      const cy = Math.max(cbtTop0 + sH + g, leftEnd > clusterX - g ? zy : 0);
      L.cbt = R(l, cy, leftEnd - l, hudBottom - cy);
    } else {
      L.hud = R(l, t, leftEnd - l, hudBottom - t);
    }
    // zone below everything above it in its columns (top cluster, and in a mission the combat stack when it reaches over)
    if (mission && L.cbt && L.cbt.x + L.cbt.w > zx) zoneTop = Math.max(zoneTop, L.cbt.y + L.cbt.h + g);
    L.zone = R(zx, zoneTop, zoneRight - zx, H - bt - zoneTop);
    // area free of visible controls, for a centred conformal HUD and toasts (the stick zone is invisible, so it counts as free)
    // (spanned across a vertical hinge: only the right screen, so a conformal HUD centred on the hinge falls back to the strip)
    const cx0 = vHinge ? L.zone.x : gridR + g;
    const cx1 = Math.min(zoneRight, L.dock ? L.dock.x - g : W, L.fire ? L.fire.tgt.x - g : W);
    const bottomRud = L.rud && L.rud.y > gy - g;
    const cy0 = Math.max(zy, L.cbt ? L.cbt.y + L.cbt.h + g : 0);
    L.clear = R(cx0, cy0, cx1 - cx0, (bottomRud ? L.rud.y : H - bt) - g - cy0);
    if (mission) {
      L.toast = { x: L.clear.x, y: L.clear.y, w: L.clear.w };
      // combat scope above the fire cluster (under Cam / Menu) when it fits; radio subtitles at the bottom of the clear area
      const rs = L.fire && !fireTop ? Math.min(fw, L.fire.tgt.y - g - zy) : 0;
      if (rs >= 56) L.radar = R(W - r - rs, zy, rs, rs);
      const sh = Math.min(64, Math.round(L.clear.h * 0.4));
      if (sh >= 30 && L.clear.w >= 160) L.subs = R(L.clear.x, L.clear.y + L.clear.h - sh, L.clear.w, sh);
    }
  } else {
    // bottom block: throttle left, stick zone right (fire cluster / dock beside it), optional rudder below the zone
    let thrH = Math.round(clamp(H * 0.32, 3 * b + 2 * g, 300));
    const zx = l + thrW + Math.round(g * 1.5);
    const rudRoom = wantRudder ? rudH + g : 0;
    const besideW = mission ? fw : dk ? dk.w : 0, besideH = mission ? fireH(Math.round(b * 1.5), Math.round(b * 1.15)) : dk ? dk.h : 0;
    const beside = besideW && W - r - besideW - g - zx >= 2 * stickR;
    // dock above the action row (no room beside the zone): the extras go left of it, or in a row above it
    const exBeside = !dk || beside || mission || nExtra * (b + g) <= W - l - r - dk.w - g;
    const topBlock = dk && !beside && !mission ? dk.h + (exBeside || !nExtra ? 0 : g + b) : (nExtra ? b : 0);
    if (beside) thrH = Math.max(thrH, besideH + rudRoom);
    // the systems row: [Sys] + six buttons, one row, or two when narrow
    const items = drawer ? ['more', ...BUTTON_IDS] : BUTTON_IDS;
    const avail = W - l - r;
    let cols = items.length, rows = 1, per = Math.floor((avail - (cols - 1) * g) / cols);
    if (per < MIN_TARGET) { cols = Math.ceil(items.length / 2); rows = 2; per = Math.floor((avail - (cols - 1) * g) / cols); }
    if (hHinge) {
      // every control on the bottom screen: shrink the throttle column if the block would reach the hinge
      const above = Math.round(g * 1.5) + rows * b + (rows - 1) * g + (topBlock ? g + topBlock : 0);
      const room = H - bt - (hHinge.y + hHinge.h + g) - above;
      thrH = Math.max(3 * b + 2 * g, beside ? besideH + rudRoom : 0, Math.min(thrH, room));
    }
    L.thr = R(l, H - bt - thrH, thrW, thrH);
    const zoneBottom = wantRudder ? H - bt - rudH - g : H - bt;
    if (wantRudder) L.rud = R(zx, H - bt - rudH, W - r - zx, rudH);
    const zR = beside ? W - r - besideW - g : W - r;
    if (beside && mission) placeFire(W - r - fw, zoneBottom, zoneBottom - L.thr.y);
    else if (beside) L.dock = R(W - r - dk.w, zoneBottom - dk.h, dk.w, dk.h);
    L.zone = R(zx, L.thr.y, zR - zx, zoneBottom - L.thr.y);
    const rowY = L.thr.y - Math.round(g * 1.5) - rows * b - (rows - 1) * g;
    items.forEach((id, i) => {
      const ci = i % cols, ri = Math.floor(i / cols);
      const q = R(l + ci * (per + g), rowY + ri * (b + g), per, b);
      if (id === 'more') L.more = q; else L.btn[id] = q;
    });
    let top = rowY;
    if (dk && !beside) L.dock = R(W - r - dk.w, rowY - g - dk.h, dk.w, dk.h);
    if (mission && !beside) placeFire(W - r - fw, rowY - g, besideH);        // very narrow: fire cluster above the row
    const ex1 = W - r - (L.dock && !beside && exBeside ? dk.w + g : 0) - (mission && !beside ? fw + g : 0);
    const exY = exBeside ? rowY - g - b : L.dock.y - g - b;
    if (nExtra) for (let i = 0; i < nExtra; i++) L.extra.push(R(ex1 - b - i * (b + g), exY, b, b));
    if (topBlock) top = rowY - g - topBlock;
    if (mission && !beside) top = Math.min(top, L.fire.tgt.y);
    const hy = L.menu.y + L.menu.h + g;
    const hb = hHinge ? Math.min(top, hHinge.y) : top;                            // HUD stays on the top screen
    if (mission) {
      const sH = Math.min(clamp(opts.stripH > 0 ? opts.stripH : stripEstimate(W - l - r), 30, 140), hb - g - hy);
      L.hud = R(l, hy, W - l - r, sH);
      L.cbt = R(l, hy + sH + g, W - l - r, hb - g - (hy + sH + g));
      L.clear = R(l, L.cbt.y + L.cbt.h, W - l - r, 0);
      L.toast = { x: l, y: L.cbt.y, w: W - l - r };
    } else {
      L.hud = R(l, hy, W - l - r, hb - g - hy);
      L.clear = R(l, hy, W - l - r, hb - g - hy);
    }
  }
  // idle position of the floating stick (its hint ring): low in the zone, where the thumb rests
  const zr = L.zone;
  L.home = { x: Math.round(zr.x + zr.w / 2), y: Math.round(zr.y + zr.h - Math.min(zr.h / 2, stickR + 2 * g)), r: stickR };
  return L;
}

/** Every visible-control rectangle of a layout with a name (for overlap checks and debugging). `cbt` is the combat HUD region. */
export function layoutRects(L) {
  const out = [['menu', L.menu], ['cam', L.cam], ['thr', L.thr], ['zone', L.zone], ['hud', L.hud]];
  if (L.rud) out.push(['rud', L.rud]);
  if (L.more) out.push(['more', L.more]);
  if (L.view) out.push(['view', L.view]);
  for (const id of BUTTON_IDS) out.push([id, L.btn[id]]);
  L.extra.forEach((e, i) => out.push(['extra' + i, e]));
  if (L.dock) out.push(['dock', L.dock]);
  if (L.fire) for (const id of FIRE_IDS) out.push(['fire.' + id, L.fire[id]]);
  if (L.cbt && L.cbt.h > 0) out.push(['cbt', L.cbt]);
  if (L.radar) out.push(['radar', L.radar]);
  return out;
}

export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
