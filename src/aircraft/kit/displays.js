// Aircraft kit — cockpit display content.
//
// Two canvases:
//  * the shared STATIC canvas (2048², made once for every aircraft): navigation displays, systems pages, fighter MFD pages,
//    FMS / UFC screens, mode-control-panel windows, panel legend plates, plain panel-face colours and a set of analogue gauge
//    dials (asi, adi, alt, hsi, vsi, rpm, egt, fuel …);
//  * a small LIVE canvas per rig (1536 × 1024): the pages that follow the aircraft state — Boeing and Airbus PFDs, the HUD,
//    the engine pages (EICAS, E/WD) and the standby instrument. The rig redraws one live page per frame while the camera is
//    in the cockpit and uploads the canvas about 12 times a second.
// Display faces address a page through displayUV(page, u, v); a live page answers v in (1, 2] and the kit materials sample the
// live texture there (rig.js). Pages draw in a 256-unit box whatever their pixel size (a 512 px page is drawn at 2×).
// The light goes through the materials' emissive term (night grade: src/render/INTEGRATION.md, "Emissive contributors").
import * as THREE from 'three';

const SIZE = 2048, SLOT = 512, LIVE_W = 1536, LIVE_H = 1024;
const T = {};
const put = (name, x, y, w, h, live = false) => { T[name] = { name, x, y, w, h, live }; };
// static: 12 big pages (512), 12 small (256), 16 gauge dials (128)
['nd', 'ndA', 'ecam', 'lowerB', 'mfdRadar', 'mfdSA', 'mfdStores', 'mfdEngine', 'mfdHsd', 'mfdTgp', 'mfdTsd', 'mfdFlcs']
  .forEach((n, i) => put(n, (i % 4) * SLOT, Math.floor(i / 4) * SLOT, SLOT, SLOT));
['cdu', 'ufc', 'annunciators', 'mcp', 'clock', 'legendsB', 'legendsA', 'legendsF', 'faces', 'keys', 'off', 'mcpFace']
  .forEach((n, i) => put(n, (i % 6) * 256, 3 * SLOT + Math.floor(i / 6) * 256, 256, 256));
export const GAUGES = ['asi', 'adi', 'alt', 'hsi', 'vsi', 'rpm', 'egt', 'fuel', 'oil', 'hyd', 'gmeter', 'aoa', 'aclock', 'flaps', 'brake', 'cabin'];
GAUGES.forEach((n, i) => put(n, 3 * SLOT + (i % 4) * 128, 3 * SLOT + Math.floor(i / 4) * 128, 128, 128));
// live
const LIVE = ['pfd', 'pfdA', 'hud', 'eicas', 'ewd', 'standby'];
['pfd', 'pfdA', 'hud', 'eicas', 'ewd'].forEach((n, i) => put(n, (i % 3) * SLOT, Math.floor(i / 3) * SLOT, SLOT, SLOT, true));
put('standby', 2 * SLOT, SLOT, 256, 256, true);
const ALIAS = { legends: 'legendsB', sd: 'ecam', eicasA: 'ewd', hsd: 'mfdHsd', sms: 'mfdStores', tgp: 'mfdTgp', radar: 'mfdRadar', engine: 'mfdEngine' };
const OLD_ORDER = ['pfd', 'nd', 'eicas', 'ecam', 'mfdRadar', 'mfdSA', 'mfdStores', 'mfdEngine', 'hud', 'cdu', 'standby', 'legends', 'annunciators', 'ufc', 'clock', 'off'];
const tileOf = (tile) => { const n = typeof tile === 'number' ? OLD_ORDER[tile] : tile; return T[n] || T[ALIAS[n]] || T.off; };

/** Page names → { x, y, w, h, live } (pixels on their canvas). Live pages follow the aircraft state. */
export const DISPLAY_TILES = T;
/** UV inside a page: u 0..1 left → right, v 0..1 top → bottom (a 2.5 px inset keeps mip neighbours out). Live pages return v in (1, 2]. */
export function displayUV(tile, u, v) {
  const t = tileOf(tile), e = t.w > 200 ? 2.5 : 1.5, W = t.live ? LIVE_W : SIZE, H = t.live ? LIVE_H : SIZE;
  const px = t.x + e + Math.min(1, Math.max(0, u)) * (t.w - 2 * e), py = t.y + e + Math.min(1, Math.max(0, v)) * (t.h - 2 * e);
  return [px / W, (t.live ? 2 : 1) - py / H];
}
/** The live page under a UV returned by displayUV (null for static pages). */
export function liveTileAt(u, v) {
  if (!(v > 1)) return null;
  const px = u * LIVE_W, py = (2 - v) * LIVE_H;
  for (const n of LIVE) { const t = T[n]; if (px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h) return n; }
  return null;
}
/** UV of a sub-rectangle [u0, v0, u1, v1] of a page (legend plates, MCP windows). */
export const subUV = (tile, r, u, v) => displayUV(tile, r[0] + (r[2] - r[0]) * u, r[1] + (r[3] - r[1]) * v);

function drawTile(g, t, st) {
  g.save(); g.translate(t.x, t.y); g.beginPath(); g.rect(0, 0, t.w, t.h); g.clip();
  g.fillStyle = '#000'; g.fillRect(0, 0, t.w, t.h);
  g.scale(t.w / 256, t.h / 256);
  try { (PAGES[t.name] || (() => {}))(g, st); } catch (e) { /* a page never breaks the build */ }
  g.restore();
}

let shared = null;
/** The shared static display texture (created on first use; null without a DOM). */
export function displayTexture() {
  if (shared) return shared;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, SIZE, SIZE);
  const st = defaultState();
  for (const t of Object.values(T)) if (!t.live) drawTile(g, t, st);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  shared = t; return t;
}

/** Default (and fallback) cockpit state for the pages: degrees, knots, feet, ft/min, percent. */
export function defaultState() {
  return { pitch: 2.5, roll: -4, ias: 252, tas: 468, gs: 452, mach: 0.782, alt: 35000, vs: 0, hdg: 268, trk: 270, aoa: 3, beta: 0, g: 1,
    n1: [86.4, 86.7, 86.5, 86.6], n2: [93.1, 93.4, 93.2, 93.0], egt: [612, 618, 615, 610], ff: [1.21, 1.24, 1.2, 1.22], ab: 0, engines: 2,
    fuel: 14200, flaps: 0, gear: 0, spdSel: 250, altSel: 35000, hdgSel: 270, t: 0, onGround: false };
}

/**
 * The per-rig live canvas: { texture, state, used: Set(page), step(dt, inCockpit), dispose() }. `used` starts with every live
 * page; the rig narrows it to the pages its screens show. step() redraws one used page per call and flags an upload at ≤ 12 Hz.
 */
export function createLiveDisplays() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = LIVE_W; c.height = LIVE_H;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, LIVE_W, LIVE_H);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  const st = defaultState(), used = new Set(LIVE);
  for (const n of LIVE) drawTile(g, T[n], st);
  let k = 0, since = 1, dirty = false;
  return {
    texture: tex, state: st, used,
    step(dt) {
      const list = LIVE.filter((n) => used.has(n)); if (!list.length) return;
      drawTile(g, T[list[k++ % list.length]], st); dirty = true; since += dt;
      if (since >= 1 / 12) { tex.needsUpdate = true; since = 0; dirty = false; }
    },
    flush() { if (dirty) { tex.needsUpdate = true; dirty = false; } },
    dispose() { tex.dispose(); },
  };
}

// ---- drawing helpers (256-unit page box) -----------------------------------------------------------------------------------
const W = '#eef1f2', GRN = '#3cf06a', CY = '#3ad8f2', MAG = '#f25ef0', AMB = '#f2b430', RED = '#f2402e', DIM = '#7a8590', YEL = '#f6e23c', GREY = '#3a3f46';
const font = (g, px, bold = true) => { g.font = `${bold ? 'bold ' : ''}${px}px "DejaVu Sans Mono", "Consolas", monospace`; };
const txt = (g, s, x, y, col = W, px = 11, align = 'left') => { font(g, px); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
const line = (g, pts, col = W, w = 1.4) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
const poly = (g, pts, col) => { g.fillStyle = col; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.fill(); };
const box = (g, x, y, w, h, col = W, lw = 1.2) => { g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(x, y, w, h); };
const rect = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
const arc = (g, x, y, r, a0, a1, col = W, w = 1.4) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
const disc = (g, x, y, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
const DEG = Math.PI / 180;
const wrap360 = (a) => ((a % 360) + 360) % 360;
const pad = (n, k) => String(Math.round(n)).padStart(k, '0');
const vignette = (g, k = 0.35) => {                                       // CRT/LCD edge fall-off so a page never looks pasted on
  const r = g.createRadialGradient(128, 128, 80, 128, 128, 190); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, `rgba(0,0,0,${k})`);
  g.fillStyle = r; g.fillRect(0, 0, 256, 256);
};
const OSB = {
  radar: ['CRM', 'RWS', '', 'OVRD', 'CNTL', 'FCR', 'DCLT', 'SWAP', 'SMS', 'HSD'], sa: ['SA', 'FOV', 'EXP', 'DEP', 'CPL', 'HSD', 'DCLT', 'SWAP', 'FCR', 'SMS'],
  sms: ['INV', 'AAM', '', 'S-J', 'DTE', 'SMS', 'DCLT', 'SWAP', 'FCR', 'HSD'], eng: ['ENG', 'FUEL', 'BIT', 'HYD', 'ELEC', 'ENG', 'DCLT', 'SWAP', 'FCR', 'SMS'],
  hsd: ['DEP', 'DCPL', 'NORM', 'MSG', 'CNTL', 'HSD', 'DCLT', 'SWAP', 'FCR', 'SMS'], tgp: ['STBY', 'A-G', 'WIDE', 'TGT', 'CNTL', 'TGP', 'DCLT', 'SWAP', 'FCR', 'WPN'],
  flcs: ['FLCS', 'TEST', 'BIT', '', 'RST', 'FLCS', 'DCLT', 'SWAP', 'FCR', 'SMS'], side: [['20', '↑', '↓', 'A4'], ['', 'EXP', 'FZ', 'RTN']],
};
const osb = (g, labels, col = W, side = OSB.side) => {                    // fighter MFD push-button legends around the edge
  for (let i = 0; i < 5; i++) { txt(g, labels[i] || '', 28 + i * 50, 11, col, 9, 'center'); txt(g, labels[i + 5] || '', 28 + i * 50, 245, col, 9, 'center'); }
  for (let i = 0; i < 4; i++) {
    const y = 62 + i * 44;
    txt(g, side[0][i] || '', 4, y, col, 8); txt(g, side[1][i] || '', 252, y, col, 8, 'right');
  }
};

// ---- live pages ---------------------------------------------------------------------------------------------------------------
function attitude(g, st, cx, cy, ppd, sky, gnd, clip, opts = {}) {
  g.save(); clip(); g.clip();
  g.translate(cx, cy); g.rotate(-st.roll * DEG); g.translate(0, st.pitch * ppd);
  rect(g, -260, -520, 520, 520, sky); rect(g, -260, 0, 520, 520, gnd);
  line(g, [[-260, 0], [260, 0]], W, 1.6);
  for (let p = -30; p <= 30; p += 2.5) {
    if (!p) continue; const y = -p * ppd, major = p % 10 === 0, mid = p % 5 === 0, w = major ? 22 : mid ? 12 : 6;
    if (opts.airbus && !mid) continue;
    line(g, [[-w, y], [w, y]], W, 1.3);
    if (major) { txt(g, String(Math.abs(p)), -w - 9, y, W, 9, 'center'); txt(g, String(Math.abs(p)), w + 9, y, W, 9, 'center'); }
  }
  if (opts.heading) for (let a = -60; a <= 60; a += 10) { const x = a * ppd; line(g, [[x, 0], [x, 4]], W, 1.2); }
  g.restore();
}
function rollScale(g, st, cx, cy, r, airbus) {
  arc(g, cx, cy, r, (-90 - 60) * DEG, (-90 + 60) * DEG, W, 1.3);
  for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const q = (a - 90) * DEG, l = Math.abs(a) % 30 === 0 ? 8 : 5;
    line(g, [[cx + Math.cos(q) * r, cy + Math.sin(q) * r], [cx + Math.cos(q) * (r + l), cy + Math.sin(q) * (r + l)]], W, 1.3);
  }
  poly(g, [[cx, cy - r - 1], [cx - 5, cy - r - 9], [cx + 5, cy - r - 9]], airbus ? YEL : W);
  g.save(); g.translate(cx, cy); g.rotate(-st.roll * DEG);
  if (airbus) { line(g, [[0, -r + 1], [-6, -r + 9], [6, -r + 9], [0, -r + 1]], YEL, 1.6); line(g, [[-7, -r + 12], [7, -r + 12]], YEL, 1.6); }
  else { poly(g, [[0, -r + 1], [-5, -r + 9], [5, -r + 9]], W); rect(g, -6, -r + 10, 12, 2.4, W); }
  g.restore();
}
function speedTape(g, st, x, y0, y1, ppk, airbus) {
  const cy = (y0 + y1) / 2, w = 36;
  rect(g, x, y0, w, y1 - y0, GREY);
  g.save(); g.beginPath(); g.rect(x, y0, w + 8, y1 - y0); g.clip();
  const v = st.ias;
  for (let s = Math.floor((v - 80) / 10) * 10; s <= v + 80; s += 10) {
    if (s < 30) continue; const yy = cy - (s - v) * ppk;
    line(g, [[x + w - 7, yy], [x + w, yy]], W, 1.3);
    if (s % 20 === 0) txt(g, String(s), x + w - 9, yy, W, 10, 'right');
  }
  // overspeed barber pole and selected-speed bug
  const vmo = airbus ? 340 : 330, ym = cy - (vmo - v) * ppk;
  for (let yy = ym; yy > y0 - 8; yy -= 8) { rect(g, x + w - 4, yy - 4, 4, 4, RED); rect(g, x + w - 4, yy - 8, 4, 4, airbus ? '#000' : '#000'); }
  const ys = cy - (st.spdSel - v) * ppk;
  if (airbus) poly(g, [[x + w, ys], [x + w + 7, ys - 4], [x + w + 7, ys + 4]], CY);
  else { line(g, [[x + w, ys - 5], [x + w + 6, ys - 5], [x + w + 6, ys + 5], [x + w, ys + 5], [x + w + 3, ys], [x + w, ys - 5]], MAG, 1.6); }
  g.restore();
  if (airbus) {                                                        // Airbus: yellow reference line and index, no digital readout
    line(g, [[x - 2, cy], [x + w + 3, cy]], YEL, 2.2); poly(g, [[x + w + 2, cy], [x + w + 11, cy - 5], [x + w + 11, cy + 5]], YEL);
    const tr = Math.max(-26, Math.min(26, (st.trend || 0) * ppk)); if (Math.abs(tr) > 3) { line(g, [[x + w - 2, cy], [x + w - 2, cy - tr]], YEL, 1.6); }
    txt(g, st.mach >= 0.5 ? '.' + pad(st.mach * 100, 2) : '', x + w / 2, y1 + 10, GRN, 11, 'center');
    txt(g, String(Math.round(st.spdSel)), x + w / 2, y0 - 8, CY, 10, 'center');
  } else {
    poly(g, [[x - 2, cy - 10], [x + w - 2, cy - 10], [x + w - 2, cy - 4], [x + w + 4, cy], [x + w - 2, cy + 4], [x + w - 2, cy + 10], [x - 2, cy + 10]], '#000');
    line(g, [[x - 2, cy - 10], [x + w - 2, cy - 10], [x + w - 2, cy - 4], [x + w + 4, cy], [x + w - 2, cy + 4], [x + w - 2, cy + 10], [x - 2, cy + 10], [x - 2, cy - 10]], W, 1.4);
    txt(g, String(Math.round(v)), x + w - 4, cy, W, 13, 'right');
    txt(g, String(Math.round(st.spdSel)), x + w / 2, y0 - 8, MAG, 11, 'center');
    if (st.mach >= 0.4) txt(g, '.' + pad(st.mach * 1000, 3), x + w / 2, y1 + 10, W, 11, 'center');
  }
}
function altTape(g, st, x, y0, y1, ppf, airbus) {
  const cy = (y0 + y1) / 2, w = 40, a = st.alt;
  rect(g, x, y0, w, y1 - y0, GREY);
  g.save(); g.beginPath(); g.rect(x, y0, w, y1 - y0); g.clip();
  const step = airbus ? 100 : 100;
  for (let h = Math.floor((a - 800) / step) * step; h <= a + 800; h += step) {
    const yy = cy - (h - a) * ppf;
    line(g, [[x, yy], [x + (h % 500 === 0 ? 8 : 5), yy]], W, 1.3);
    if (airbus ? h % 500 === 0 : h % 200 === 0) txt(g, airbus ? pad(h / 100, 3) : String(h), x + 10, yy, W, airbus ? 10 : 8);
  }
  const ys = cy - (st.altSel - a) * ppf;
  if (!airbus) line(g, [[x, ys - 6], [x + 6, ys - 6], [x + 6, ys + 6], [x, ys + 6], [x + 3, ys], [x, ys - 6]], MAG, 1.6);
  g.restore();
  if (airbus) {
    rect(g, x + 4, cy - 10, w + 4, 20, '#000'); box(g, x + 4, cy - 10, w + 4, 20, YEL, 1.6);
    txt(g, pad(a / 100, 3), x + 30, cy, GRN, 12, 'right'); txt(g, pad(Math.abs(a) % 100, 2), x + 46, cy, GRN, 9, 'right');
    txt(g, 'FL' + pad(st.altSel / 100, 3), x + w / 2, y0 - 8, CY, 10, 'center');
    box(g, x + 4, y1 + 3, 30, 13, YEL, 1); txt(g, 'STD', x + 19, y1 + 10, CY, 10, 'center');
  } else {
    poly(g, [[x - 4, cy], [x + 2, cy - 11], [x + w + 6, cy - 11], [x + w + 6, cy + 11], [x + 2, cy + 11]], '#000');
    line(g, [[x - 4, cy], [x + 2, cy - 11], [x + w + 6, cy - 11], [x + w + 6, cy + 11], [x + 2, cy + 11], [x - 4, cy]], W, 1.4);
    txt(g, String(Math.round(a / 100)), x + 28, cy, W, 13, 'right'); txt(g, pad(Math.abs(Math.round(a / 20) * 20) % 100, 2), x + w + 4, cy, W, 10, 'right');
    txt(g, String(Math.round(st.altSel)), x + w / 2, y0 - 8, MAG, 11, 'center');
    txt(g, 'STD', x + w / 2, y1 + 10, GRN, 10, 'center');
  }
}
function vsi(g, st, x, y0, y1, airbus) {
  const cy = (y0 + y1) / 2, h = (y1 - y0) / 2, sc = (v) => Math.sign(v) * h * (1 - Math.exp(-Math.abs(v) / 1800));
  poly(g, [[x, y0 + 10], [x + 10, y0], [x + 16, y0], [x + 16, y1], [x + 10, y1], [x, y1 - 10]], GREY);
  for (const v of [-6000, -2000, -1000, 1000, 2000, 6000]) line(g, [[x + 1, cy - sc(v)], [x + 6, cy - sc(v)]], W, 1.2);
  line(g, [[x, cy], [x + 7, cy]], airbus ? YEL : W, 2);
  const yv = cy - sc(st.vs);
  line(g, [[x + 2, yv], [x + 26, cy]], airbus ? GRN : W, 2);
  if (Math.abs(st.vs) >= 400) txt(g, String(Math.round(Math.abs(st.vs) / 100) * 100), x + 8, st.vs > 0 ? y0 - 6 : y1 + 6, airbus ? GRN : W, 9, 'center');
}

const PAGES = {
  pfd(g, st) {                                                          // Boeing PFD (737NG / 777 style)
    const cx = 120, cy = 112, ppd = 3.3;
    attitude(g, st, cx, cy, ppd, '#1d78e0', '#8c5a2b', () => { g.beginPath(); g.roundRect ? g.roundRect(54, 44, 132, 136, 14) : g.rect(54, 44, 132, 136); });
    rollScale(g, st, cx, cy, 62, false);
    // aircraft symbol: two L-shaped wings and a centre box (black with white outline), magenta flight director
    for (const s of [-1, 1]) {
      const x0 = cx + s * 30, x1 = cx + s * 56, pts = [[x0, cy - 2.5], [x1, cy - 2.5], [x1, cy + 2.5], [x0 + s * 6, cy + 2.5], [x0 + s * 6, cy + 9], [x0, cy + 9]];
      poly(g, pts, '#000'); line(g, [...pts, pts[0]], W, 1.3);
    }
    rect(g, cx - 3, cy - 3, 6, 6, '#000'); box(g, cx - 3, cy - 3, 6, 6, W, 1.3);
    const fdx = Math.max(-30, Math.min(30, -st.roll * 1.2)), fdy = Math.max(-30, Math.min(30, (st.pitch - 2.5) * 2));
    line(g, [[cx - 34, cy + fdy], [cx + 34, cy + fdy]], MAG, 2.2); line(g, [[cx + fdx, cy - 34], [cx + fdx, cy + 34]], MAG, 2.2);
    speedTape(g, st, 6, 44, 180, 1.15, false);
    altTape(g, st, 192, 44, 180, 0.085, false);
    vsi(g, st, 238, 52, 172, false);
    // heading: compass rose arc along the bottom
    const hc = [cx, 330], R = 112;
    g.save(); g.beginPath(); g.rect(40, 196, 160, 60); g.clip();
    disc(g, hc[0], hc[1], R, GREY);
    for (let a = 0; a < 360; a += 5) {
      const q = (a - st.hdg - 90) * DEG, l = a % 10 === 0 ? 8 : 4;
      line(g, [[hc[0] + Math.cos(q) * R, hc[1] + Math.sin(q) * R], [hc[0] + Math.cos(q) * (R - l), hc[1] + Math.sin(q) * (R - l)]], W, 1.2);
      if (a % 30 === 0) txt(g, String(a / 10), hc[0] + Math.cos(q) * (R - 16), hc[1] + Math.sin(q) * (R - 16), W, 10, 'center');
    }
    const qs = (st.hdgSel - st.hdg - 90) * DEG; line(g, [[hc[0] + Math.cos(qs) * R, hc[1] + Math.sin(qs) * R], [hc[0] + Math.cos(qs) * (R + 6), hc[1] + Math.sin(qs) * (R + 6)]], MAG, 4);
    g.restore();
    rect(g, cx - 15, 200, 30, 14, '#000'); box(g, cx - 15, 200, 30, 14, W, 1.2); txt(g, pad(wrap360(st.hdg), 3), cx, 207, W, 11, 'center');
    txt(g, 'MAG', cx + 26, 207, GRN, 9, 'left');
    // FMA and autopilot status
    for (let i = 0; i < 3; i++) line(g, [[54 + i * 44, 4], [54 + i * 44, 26]], DIM, 1);
    txt(g, st.onGround ? 'N1' : 'MCP SPD', 76, 14, GRN, 9, 'center'); txt(g, st.onGround ? 'TO/GA' : 'LNAV', 120, 14, GRN, 9, 'center'); txt(g, st.onGround ? 'TO/GA' : 'VNAV PTH', 164, 14, GRN, 9, 'center');
    txt(g, 'CMD', cx, 34, GRN, 10, 'center');
    txt(g, 'DH200', 214, 196, GRN, 8, 'center');
  },
  pfdA(g, st) {                                                         // Airbus PFD (A320 / A350 style)
    const cx = 116, cy = 116, ppd = 3.4;
    attitude(g, st, cx, cy, ppd, '#3487de', '#8a5626', () => {
      g.beginPath(); g.moveTo(58, 66); g.quadraticCurveTo(cx, 30, 174, 66); g.lineTo(174, 166); g.quadraticCurveTo(cx, 202, 58, 166); g.closePath();
    }, { airbus: true });
    rollScale(g, st, cx, cy, 60, true);
    // aircraft symbol: yellow wings with black outline, centre square
    for (const s of [-1, 1]) {
      const x0 = cx + s * 28, x1 = cx + s * 50, pts = [[x0, cy - 2.5], [x1, cy - 2.5], [x1, cy + 2.5], [x0 + s * 4, cy + 2.5], [x0 + s * 4, cy + 8], [x0, cy + 8]];
      poly(g, pts, '#000'); line(g, [...pts, pts[0]], YEL, 1.6);
    }
    rect(g, cx - 3, cy - 3, 6, 6, '#000'); box(g, cx - 3, cy - 3, 6, 6, YEL, 1.6);
    const fdx = Math.max(-30, Math.min(30, -st.roll * 1.2)), fdy = Math.max(-30, Math.min(30, (st.pitch - 2.5) * 2));
    line(g, [[cx - 30, cy + fdy], [cx + 30, cy + fdy]], GRN, 2); line(g, [[cx + fdx, cy - 30], [cx + fdx, cy + 30]], GRN, 2);
    speedTape(g, st, 8, 54, 180, 1.2, true);
    altTape(g, st, 186, 54, 180, 0.08, true);
    vsi(g, st, 236, 58, 176, true);
    // heading tape across the bottom
    rect(g, 58, 210, 116, 22, GREY);
    g.save(); g.beginPath(); g.rect(58, 210, 116, 22); g.clip();
    for (let a = Math.floor(st.hdg / 5) * 5 - 30; a <= st.hdg + 30; a += 5) {
      const x = cx + (a - st.hdg) * 3.2; line(g, [[x, 210], [x, a % 10 === 0 ? 218 : 215]], W, 1.2);
      if (a % 10 === 0) txt(g, String(wrap360(a) / 10 | 0), x, 225, W, 10, 'center');
    }
    g.restore();
    line(g, [[cx, 206], [cx, 232]], YEL, 2.2);
    // FMA: five columns
    for (let i = 1; i < 5; i++) line(g, [[i * 51, 2], [i * 51, 30]], DIM, 1);
    txt(g, st.onGround ? 'MAN' : 'SPEED', 25, 10, GRN, 9, 'center'); txt(g, st.onGround ? 'FLX 58' : '', 25, 22, CY, 8, 'center');
    txt(g, st.onGround ? 'SRS' : 'ALT CRZ', 76, 10, GRN, 9, 'center'); txt(g, st.onGround ? 'RWY' : 'NAV', 127, 10, GRN, 9, 'center');
    txt(g, 'AP1', 229, 8, W, 9, 'center'); txt(g, '1FD2', 229, 18, W, 9, 'center'); txt(g, 'A/THR', 229, 28, st.onGround ? CY : W, 9, 'center');
  },
  standby(g, st) {                                                      // standby instrument (ISFD)
    const cx = 128, cy = 128, ppd = 4.2;
    attitude(g, st, cx, cy, ppd, '#2a7ad8', '#7c4e24', () => { g.beginPath(); g.rect(52, 30, 152, 196); });
    rollScale(g, st, cx, cy, 70, false);
    for (const s of [-1, 1]) line(g, [[cx + s * 20, cy], [cx + s * 46, cy]], YEL, 4);
    rect(g, cx - 3, cy - 3, 6, 6, YEL);
    rect(g, 0, 30, 50, 196, GREY); rect(g, 206, 30, 50, 196, GREY);
    for (let s = Math.floor((st.ias - 60) / 10) * 10; s <= st.ias + 60; s += 10) { const y = cy - (s - st.ias) * 1.5; if (y > 34 && y < 222) { line(g, [[42, y], [50, y]], W, 1.4); if (s % 20 === 0) txt(g, String(s), 38, y, W, 12, 'right'); } }
    for (let h = Math.floor((st.alt - 500) / 100) * 100; h <= st.alt + 500; h += 100) { const y = cy - (h - st.alt) * 0.18; if (y > 34 && y < 222) { line(g, [[206, y], [212, y]], W, 1.4); if (h % 200 === 0) txt(g, String(h / 100 | 0), 214, y, W, 11); } }
    rect(g, 0, cy - 12, 50, 24, '#000'); box(g, 0, cy - 12, 50, 24, W, 1.6); txt(g, String(Math.round(st.ias)), 46, cy, W, 15, 'right');
    rect(g, 204, cy - 12, 52, 24, '#000'); box(g, 204, cy - 12, 52, 24, W, 1.6); txt(g, String(Math.round(st.alt)), 254, cy, W, 13, 'right');
    txt(g, 'STD', 230, 240, CY, 12, 'center'); txt(g, pad(wrap360(st.hdg), 3), 128, 240, W, 12, 'center');
    vignette(g, 0.3);
  },
  hud(g, st) {                                                          // HUD symbology (additive on the combiner), conformal pitch ladder
    const C = '#62ff82', cx = 128, cy = 116, ppd = 15;
    g.save(); g.beginPath(); g.rect(14, 26, 228, 188); g.clip();
    g.translate(cx, cy); g.rotate(-st.roll * DEG); g.translate(0, st.pitch * ppd);
    line(g, [[-120, 0], [-26, 0]], C, 1.8); line(g, [[26, 0], [120, 0]], C, 1.8);
    for (let p = -90; p <= 90; p += 5) {
      if (!p) continue; const y = -p * ppd; if (Math.abs(y - st.pitch * ppd) > 140) continue;
      const tip = p > 0 ? 5 : -5;
      if (p < 0) g.setLineDash([6, 4]);
      line(g, [[-58, y + tip], [-58, y], [-20, y]], C, 1.6); line(g, [[20, y], [58, y], [58, y + tip]], C, 1.6); g.setLineDash([]);
      txt(g, String(Math.abs(p)), -70, y, C, 9, 'center'); txt(g, String(Math.abs(p)), 70, y, C, 9, 'center');
    }
    g.restore();
    // flight path marker (offset by angle of attack and sideslip), boresight cross
    const fx = cx + Math.max(-60, Math.min(60, -st.beta * ppd)), fy = cy + Math.max(-60, Math.min(80, st.aoa * ppd * 0.6));
    arc(g, fx, fy, 6, 0, Math.PI * 2, C, 1.8); line(g, [[fx - 17, fy], [fx - 6, fy]], C, 1.8); line(g, [[fx + 6, fy], [fx + 17, fy]], C, 1.8); line(g, [[fx, fy - 6], [fx, fy - 12]], C, 1.8);
    line(g, [[cx - 8, cy - 40], [cx, cy - 35], [cx + 8, cy - 40]], C, 1.6);
    // speed / altitude boxes, heading tape
    box(g, 12, cy - 9, 42, 18, C, 1.4); txt(g, String(Math.round(st.ias)), 50, cy, C, 12, 'right');
    box(g, 192, cy - 9, 52, 18, C, 1.4); txt(g, String(Math.round(st.alt)).replace(/(\d)(\d{3})$/, '$1,$2'), 240, cy, C, 11, 'right');
    g.save(); g.beginPath(); g.rect(60, 6, 136, 36); g.clip();
    for (let a = Math.floor(st.hdg / 5) * 5 - 20; a <= st.hdg + 20; a += 5) {
      const x = cx + (a - st.hdg) * 3.4; line(g, [[x, 22], [x, a % 10 === 0 ? 30 : 26]], C, 1.4);
      if (a % 10 === 0) txt(g, pad(wrap360(a) / 10, 2), x, 36, C, 9, 'center');
    }
    g.restore();
    line(g, [[cx, 20], [cx - 4, 13], [cx + 4, 13], [cx, 20]], C, 1.4);
    txt(g, 'M ' + st.mach.toFixed(2), 14, 162, C, 10); txt(g, 'G ' + st.g.toFixed(1), 14, 176, C, 10); txt(g, 'α ' + st.aoa.toFixed(1), 14, 190, C, 10);
    txt(g, 'NAV', 14, 222, C, 10); txt(g, '012.4 STPT', 242, 222, C, 10, 'right');
    txt(g, (st.vs >= 0 ? '+' : '') + Math.round(st.vs), 242, cy + 20, C, 9, 'right');
  },
  eicas(g, st) {                                                        // Boeing upper EICAS (737NG): N1 / EGT dials, N2, fuel flow, fuel
    const n = Math.min(2, st.engines || 2);
    txt(g, 'TAT +12c', 6, 10, W, 9); txt(g, st.onGround ? 'TO' : 'CRZ', 128, 10, GRN, 10, 'center'); txt(g, (st.n1[0] + 0.4).toFixed(1), 250, 10, GRN, 10, 'right');
    const dial = (cx, cy, r, val, max, red, label, fmt) => {
      const f = Math.max(0, Math.min(1.05, val / max)), a0 = Math.PI, a1 = Math.PI + 1.17 * Math.PI;
      g.fillStyle = 'rgba(220,226,232,0.22)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, a0, a0 + f * (a1 - a0)); g.closePath(); g.fill();
      arc(g, cx, cy, r, a0, a1, W, 1.8); arc(g, cx, cy, r, a0 + red * (a1 - a0), a1, RED, 3);
      const a = a0 + f * (a1 - a0); line(g, [[cx, cy], [cx + Math.cos(a) * r, cy + Math.sin(a) * r]], W, 2.2);
      rect(g, cx + 2, cy - r + 2, 40, 15, '#000'); box(g, cx + 2, cy - r + 2, 40, 15, W, 1.1); txt(g, fmt(val), cx + 40, cy - r + 10, W, 11, 'right');
      txt(g, label, cx, cy + 14, CY, 9, 'center');
    };
    for (let i = 0; i < n; i++) {
      const cx = n === 1 ? 128 : 64 + i * 112;
      dial(cx, 62, 32, st.n1[i] ?? st.n1[0], 100, 1, 'N1', (v) => v.toFixed(1));
      dial(cx, 140, 30, st.egt[i] ?? st.egt[0], 950, 0.93, 'EGT', (v) => String(Math.round(v)));
    }
    line(g, [[6, 176], [250, 176]], DIM, 1);
    for (let i = 0; i < n; i++) { const x = n === 1 ? 128 : 64 + i * 112; txt(g, (st.n2[i] ?? 93).toFixed(1), x, 188, W, 11, 'center'); txt(g, (st.ff[i] ?? 1.2).toFixed(2), x, 204, W, 11, 'center'); }
    txt(g, 'N2', 128, 188, CY, 9, 'center'); txt(g, 'FF', 128, 204, CY, 9, 'center');
    const fu = st.fuel / 1000; txt(g, 'FUEL', 128, 222, CY, 9, 'center');
    [[48, fu * 0.28], [128, fu * 0.44], [208, fu * 0.28]].forEach(([x, v]) => { box(g, x - 26, 230, 52, 20, W, 1.1); txt(g, v.toFixed(1), x, 240, W, 11, 'center'); });
  },
  ewd(g, st) {                                                          // Airbus engine / warning display
    const n = Math.min(4, st.engines || 2), sp = n > 2 ? 62 : 120, x0 = 128 - sp * (n - 1) / 2;
    txt(g, st.onGround ? 'FLX' : 'CLB', 214, 10, CY, 10, 'right'); txt(g, (st.n1[0] + 3).toFixed(1) + '%', 252, 22, CY, 10, 'right');
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * sp, r = n > 2 ? 24 : 32, v = st.n1[i] ?? st.n1[0], f = Math.max(0, Math.min(1.05, v / 110));
      const a0 = 0.75 * Math.PI, a1 = 2.25 * Math.PI;
      arc(g, cx, 52, r, a0, a1 - 0.25, W, 1.8); arc(g, cx, 52, r, a1 - 0.25, a1, RED, 3);
      const a = a0 + f * (a1 - a0); line(g, [[cx + Math.cos(a) * r * 0.3, 52 + Math.sin(a) * r * 0.3], [cx + Math.cos(a) * (r + 3), 52 + Math.sin(a) * (r + 3)]], GRN, 2.4);
      box(g, cx - 14, 54, 30, 14, DIM, 1); txt(g, v.toFixed(1), cx + 14, 61, GRN, n > 2 ? 9 : 11, 'right');
      const e = st.egt[i] ?? st.egt[0], fe = Math.max(0, Math.min(1, e / 1000)), re = n > 2 ? 16 : 22;
      arc(g, cx, 112, re, Math.PI, 2 * Math.PI, W, 1.6); arc(g, cx, 112, re, 1.85 * Math.PI, 2 * Math.PI, AMB, 2.6);
      const b = Math.PI + fe * Math.PI; line(g, [[cx, 112], [cx + Math.cos(b) * re, 112 + Math.sin(b) * re]], GRN, 2);
      txt(g, String(Math.round(e)), cx, 122, GRN, n > 2 ? 9 : 11, 'center');
      txt(g, (st.n2[i] ?? 93).toFixed(1), cx, 140, GRN, 10, 'center'); txt(g, String(Math.round((st.ff[i] ?? 1.2) * 3600 / 10) * 10), cx, 154, GRN, 10, 'center');
    }
    txt(g, 'N1', 128, 34, W, 8, 'center'); txt(g, 'EGT', 128, 104, W, 8, 'center'); txt(g, 'N2', 128, 140, W, 8, 'center'); txt(g, 'FF', 128, 154, W, 8, 'center');
    txt(g, 'FOB :', 8, 172, W, 10); txt(g, String(Math.round(st.fuel / 10) * 10), 92, 172, GRN, 11, 'right'); txt(g, 'KG', 96, 172, CY, 9);
    // slats / flaps indicator
    const fl = st.flaps; txt(g, 'S', 150, 168, W, 9, 'center'); txt(g, 'F', 238, 168, W, 9, 'center');
    line(g, [[166, 166], [222, 166]], W, 1.6); line(g, [[166, 166], [160 - fl * 6, 172 + fl * 6]], GRN, 2.4); line(g, [[222, 166], [228 + fl * 10, 172 + fl * 8]], GRN, 2.4);
    line(g, [[4, 184], [252, 184]], W, 1.2); line(g, [[150, 188], [150, 252]], W, 1);
    txt(g, st.onGround ? 'T.O' : 'SEAT BELTS', 8, 198, GRN, 10); txt(g, st.onGround ? 'AUTO BRK.....MAX' : 'NO SMOKING', 8, 212, GRN, 10); txt(g, st.onGround ? 'SIGNS..........ON' : 'GND SPLRS ARMED', 8, 226, GRN, 9);
    txt(g, 'LDG LT', 156, 198, GRN, 10); txt(g, 'ENG A.ICE', 156, 212, GRN, 10);
  },

  // ---- static big pages ----------------------------------------------------------------------------------------------------
  nd(g) {                                                               // Boeing navigation display, MAP mode
    const cx = 128, cy = 206;
    txt(g, 'GS', 6, 10, W, 9); txt(g, '452', 22, 10, W, 12); txt(g, 'TAS', 52, 10, W, 9); txt(g, '468', 72, 10, W, 12);
    txt(g, '268°/ 42', 6, 24, W, 10); line(g, [[18, 34], [26, 46]], W, 1.6); poly(g, [[26, 46], [20, 42], [26, 40]], W);
    txt(g, 'TOBOS', 250, 10, MAG, 11, 'right'); txt(g, '1245.2z', 250, 24, W, 10, 'right'); txt(g, '38.4 NM', 250, 38, W, 10, 'right');
    rect(g, cx - 22, 30, 44, 16, '#000'); box(g, cx - 22, 30, 44, 16, W, 1.2); txt(g, '268', cx, 38, W, 12, 'center'); txt(g, 'TRK', cx - 38, 38, GRN, 9, 'center'); txt(g, 'MAG', cx + 38, 38, GRN, 9, 'center');
    arc(g, cx, cy, 152, -Math.PI * 0.81, -Math.PI * 0.19, W, 1.6);
    for (let a = -54; a <= 54; a += 5) { const r = (a - 90) * DEG, l = a % 10 === 0 ? 10 : 5; line(g, [[cx + Math.cos(r) * 152, cy + Math.sin(r) * 152], [cx + Math.cos(r) * (152 - l), cy + Math.sin(r) * (152 - l)]], W, 1.3); if (a % 30 === 0) txt(g, String((27 + a / 10 + 36) % 36), cx + Math.cos(r) * 136, cy + Math.sin(r) * 136, W, 10, 'center'); }
    g.setLineDash([3, 5]); arc(g, cx, cy, 76, -Math.PI * 0.81, -Math.PI * 0.19, W, 1); g.setLineDash([]); txt(g, '20', cx - 70, cy - 36, W, 9);
    g.setLineDash([2, 6]); line(g, [[cx, cy - 10], [cx, cy - 150]], W, 1); g.setLineDash([]);
    // weather and terrain returns
    for (const [x, y, rx, ry, c] of [[cx - 62, cy - 118, 22, 12, 'rgba(40,200,70,0.42)'], [cx - 58, cy - 120, 10, 6, 'rgba(240,210,40,0.5)'], [cx - 55, cy - 121, 4, 3, 'rgba(240,40,40,0.6)'], [cx + 78, cy - 96, 16, 9, 'rgba(40,200,70,0.38)']]) { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0.5, 0, 7); g.fill(); }
    line(g, [[cx, cy], [cx + 6, cy - 72], [cx + 40, cy - 128], [cx + 96, cy - 182]], MAG, 2.2);
    for (const [x, y, n] of [[cx + 6, cy - 72, 'TOBOS'], [cx + 40, cy - 128, 'RIKAD'], [cx + 96, cy - 182, 'LUMAN']]) { line(g, [[x, y - 5], [x + 4, y - 1.5], [x + 5, y], [x + 4, y + 1.5], [x, y + 5], [x - 4, y + 1.5], [x - 5, y], [x - 4, y - 1.5], [x, y - 5]], x === cx + 6 ? MAG : W, 1.6); txt(g, n, x + 9, y, x === cx + 6 ? MAG : W, 9); }
    for (const [x, y, n] of [[cx - 74, cy - 92, 'KOMAR'], [cx + 70, cy - 52, 'ZBV']]) { arc(g, x, y, 4, 0, 7, CY, 1.3); txt(g, n, x + 7, y, CY, 9); }
    for (const [x, y, n] of [[cx - 30, cy - 46, 'EDDM']]) { arc(g, x, y, 5, 0, 7, CY, 1.3); line(g, [[x - 7, y], [x + 7, y]], CY, 1.2); txt(g, n, x + 8, y + 7, CY, 9); }
    line(g, [[cx, cy - 10], [cx - 8, cy + 10], [cx, cy + 6], [cx + 8, cy + 10], [cx, cy - 10]], W, 1.8);
    txt(g, 'VOR L', 6, 230, GRN, 10); txt(g, 'SFO', 6, 244, GRN, 10); txt(g, 'ADF R', 250, 230, CY, 10, 'right'); txt(g, 'DME 24.6', 250, 244, CY, 10, 'right');
    vignette(g, 0.25);
  },
  ndA(g) {                                                              // Airbus ND, ARC mode
    const cx = 128, cy = 214;
    txt(g, 'GS', 6, 10, W, 9); txt(g, '452', 22, 10, GRN, 11); txt(g, 'TAS', 50, 10, W, 9); txt(g, '468', 70, 10, GRN, 11);
    txt(g, '268/42', 6, 24, GRN, 10); line(g, [[16, 32], [26, 46]], GRN, 1.6);
    txt(g, 'RIKAD', 250, 10, W, 11, 'right'); txt(g, '271°', 214, 24, GRN, 10, 'right'); txt(g, '38', 238, 24, GRN, 10, 'right'); txt(g, 'NM', 252, 24, CY, 8, 'right'); txt(g, '12:45', 250, 38, GRN, 10, 'right');
    arc(g, cx, cy, 160, -Math.PI * 0.8, -Math.PI * 0.2, W, 1.6);
    for (let a = -54; a <= 54; a += 5) { const r = (a - 90) * DEG, l = a % 10 === 0 ? 9 : 5; line(g, [[cx + Math.cos(r) * 160, cy + Math.sin(r) * 160], [cx + Math.cos(r) * (160 + l), cy + Math.sin(r) * (160 + l)]], W, 1.3); if (a % 30 === 0) txt(g, String((27 + a / 10 + 36) % 36), cx + Math.cos(r) * 145, cy + Math.sin(r) * 145, W, 10, 'center'); }
    for (const r of [40, 80, 120]) { g.setLineDash([4, 6]); arc(g, cx, cy, r, -Math.PI * 0.8, -Math.PI * 0.2, W, 1); g.setLineDash([]); }
    txt(g, '20', cx - 54, cy - 70, CY, 9); txt(g, '40', cx - 80, cy - 106, CY, 9);
    line(g, [[cx, cy - 6], [cx, cy - 176]], YEL, 1.8); poly(g, [[cx, cy - 170], [cx - 5, cy - 180], [cx + 5, cy - 180]], YEL);
    line(g, [[cx, cy], [cx + 4, cy - 70], [cx + 36, cy - 126], [cx + 90, cy - 180]], GRN, 2.2);
    for (const [x, y, n] of [[cx + 4, cy - 70, 'TOBOS'], [cx + 36, cy - 126, 'RIKAD'], [cx + 90, cy - 180, 'LUMAN']]) { line(g, [[x, y - 5], [x + 5, y], [x, y + 5], [x - 5, y], [x, y - 5]], n === 'RIKAD' ? W : GRN, 1.6); txt(g, n, x + 8, y, n === 'RIKAD' ? W : GRN, 9); }
    for (const [x, y, n] of [[cx - 66, cy - 98, 'KOMAR'], [cx + 74, cy - 60, 'ZBV']]) { line(g, [[x - 4, y], [x + 4, y]], MAG, 1.4); line(g, [[x, y - 4], [x, y + 4]], MAG, 1.4); txt(g, n, x + 7, y, MAG, 9); }
    g.fillStyle = 'rgba(40,200,70,0.4)'; g.beginPath(); g.ellipse(cx - 70, cy - 140, 18, 9, 0.4, 0, 7); g.fill();
    g.fillStyle = 'rgba(220,40,40,0.5)'; g.beginPath(); g.ellipse(cx - 66, cy - 141, 6, 3, 0.4, 0, 7); g.fill();
    for (const s of [-1, 1]) line(g, [[cx + s * 18, cy - 2], [cx, cy - 2]], YEL, 3); line(g, [[cx, cy - 12], [cx, cy + 10]], YEL, 3); line(g, [[cx - 6, cy + 8], [cx + 6, cy + 8]], YEL, 3);
    txt(g, 'VOR1', 6, 232, W, 10); txt(g, 'SFO', 6, 246, W, 10); txt(g, 'ADF2', 250, 232, GRN, 10, 'right'); txt(g, 'MUN', 250, 246, GRN, 10, 'right');
    vignette(g, 0.25);
  },
  ecam(g) {                                                             // Airbus system display: FUEL page
    txt(g, 'FUEL', 128, 12, W, 12, 'center'); line(g, [[106, 20], [150, 20]], W, 1);
    txt(g, 'F.USED', 8, 30, W, 8); txt(g, '1+2', 8, 40, W, 8); txt(g, '2 860', 54, 40, GRN, 11, 'right'); txt(g, 'KG', 58, 40, CY, 8);
    const tank = (x, y, w, h, v) => { line(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], W, 1.4); txt(g, v, x + w / 2, y + h / 2, GRN, 12, 'center'); };
    tank(8, 92, 40, 34, '1 120'); tank(52, 92, 50, 34, '4 980'); tank(106, 84, 44, 46, '7 210'); tank(154, 92, 50, 34, '4 970'); tank(208, 92, 40, 34, '1 110');
    for (const x of [77, 179]) { arc(g, x, 154, 9, 0, 7, GRN, 1.8); line(g, [[x, 145], [x, 126]], GRN, 2); line(g, [[x, 163], [x, 186]], GRN, 2); line(g, [[x - 6, 154], [x + 6, 154]], GRN, 2); }
    line(g, [[77, 186], [179, 186]], GRN, 2); arc(g, 128, 186, 8, 0, 7, GRN, 1.8);
    txt(g, '1', 77, 200, W, 11, 'center'); txt(g, '2', 179, 200, W, 11, 'center'); txt(g, 'APU', 128, 210, W, 9, 'center');
    txt(g, 'FOB', 92, 228, W, 10, 'right'); txt(g, '19 390', 160, 228, GRN, 12, 'right'); txt(g, 'KG', 164, 228, CY, 9);
    line(g, [[0, 238], [256, 238]], W, 1); line(g, [[86, 238], [86, 256]], W, 1); line(g, [[170, 238], [170, 256]], W, 1);
    txt(g, 'TAT +12 °C', 4, 248, W, 8); txt(g, '12 H 45', 128, 248, GRN, 10, 'center'); txt(g, 'GW 61 240 KG', 252, 248, GRN, 8, 'right');
  },
  lowerB(g) {                                                           // Boeing lower DU: secondary engine page (oil, vibration)
    txt(g, 'SECONDARY ENGINE', 128, 10, W, 9, 'center');
    const col = (cx, lab, vals) => { txt(g, lab, 128, cx, CY, 9, 'center'); vals.forEach((v, i) => { const x = 54 + i * 148; box(g, x - 24, cx - 9, 48, 18, W, 1.1); txt(g, v, x + 20, cx, W, 11, 'right'); }); };
    col(32, 'N2', ['93.1', '93.4']); col(56, 'FF/FU', ['1.21', '1.24']);
    for (const [y, lab, v, red] of [[96, 'OIL PRESS', 0.6, 0.12], [140, 'OIL TEMP', 0.45, 0.85], [184, 'OIL QTY', 0.8, -1], [224, 'VIB', 0.15, 0.9]]) {
      txt(g, lab, 128, y, CY, 9, 'center');
      for (const cx of [54, 202]) {
        arc(g, cx, y + 8, 18, Math.PI, Math.PI * 1.9, W, 1.6); if (red >= 0) arc(g, cx, y + 8, 18, Math.PI + red * Math.PI * 0.9 - 0.06, Math.PI + red * Math.PI * 0.9 + 0.06, RED, 3);
        const a = Math.PI + v * Math.PI * 0.9; line(g, [[cx, y + 8], [cx + Math.cos(a) * 18, y + 8 + Math.sin(a) * 18]], W, 2);
        txt(g, String(Math.round(v * 100)), cx + 30, y + 2, W, 10);
      }
    }
  },
  mfdRadar(g) {                                                         // fighter fire-control radar, B-scope (RWS)
    rect(g, 0, 0, 256, 256, '#010603');
    osb(g, OSB.radar, GRN);
    const x0 = 30, y0 = 30, w = 196, h = 194;
    box(g, x0, y0, w, h, GRN, 1.2);
    for (let i = 1; i < 4; i++) { line(g, [[x0 + i * w / 4, y0 + h], [x0 + i * w / 4, y0 + h - 6]], GRN, 1.2); line(g, [[x0, y0 + i * h / 4], [x0 + 6, y0 + i * h / 4]], GRN, 1.2); }
    g.setLineDash([2, 7]); for (let i = 1; i < 4; i++) line(g, [[x0 + 6, y0 + i * h / 4], [x0 + w, y0 + i * h / 4]], 'rgba(60,240,106,0.35)', 1); g.setLineDash([]);
    line(g, [[x0 + w * 0.5, y0 + h], [x0 + w * 0.5, y0 + h + 4]], GRN, 2);
    for (const x of [0.25, 0.75]) line(g, [[x0 + w * x, y0 + 2], [x0 + w * x, y0 + 10]], GRN, 1);         // azimuth scan limits
    for (const [x, y, hd, filled] of [[96, 80, -0.6, true], [110, 72, -0.5, true], [160, 122, 0.5, false], [70, 152, -2.6, false], [184, 64, 2.9, true]]) {
      if (filled) rect(g, x - 4, y - 4, 8, 8, GRN); else box(g, x - 4, y - 4, 8, 8, GRN, 1.4);
      line(g, [[x, y], [x + Math.sin(hd) * 12, y - Math.cos(hd) * 12]], GRN, 1.4);
    }
    txt(g, '25', 108, 62, GRN, 8); txt(g, '23', 92, 92, GRN, 8);
    for (const dx of [-5, 5]) line(g, [[150 + dx, 104], [150 + dx, 118]], GRN, 1.6);                     // acquisition cursor
    txt(g, '40', x0 + 4, y0 + 8, GRN, 9); txt(g, '+38', x0 + w - 4, y0 + 8, GRN, 8, 'right'); txt(g, '-02', x0 + w - 4, y0 + 18, GRN, 8, 'right');
    txt(g, 'A4', x0 + 4, y0 + h - 8, GRN, 9); txt(g, '8B', x0 + 22, y0 + h - 8, GRN, 9);
    txt(g, '268  42', 128, y0 + h - 8, GRN, 9, 'center');
    line(g, [[128, 224], [123, 232], [133, 232], [128, 224]], GRN, 1.4);
    vignette(g, 0.4);
  },
  mfdSA(g) {                                                            // situation awareness / tactical map with threats
    rect(g, 0, 0, 256, 256, '#030b14');
    osb(g, OSB.sa, W);
    const cx = 128, cy = 164;
    for (const r of [44, 88, 132]) arc(g, cx, cy, r, 0, 7, 'rgba(58,216,242,0.55)', 1);
    for (let a = 0; a < 360; a += 30) { const q = (a - 90) * DEG; line(g, [[cx + Math.cos(q) * 128, cy + Math.sin(q) * 128], [cx + Math.cos(q) * 136, cy + Math.sin(q) * 136]], CY, 1.2); }
    line(g, [[cx, cy], [cx + 30, cy - 70], [cx - 20, cy - 130]], W, 1.6);
    for (const [x, y] of [[cx + 30, cy - 70], [cx - 20, cy - 130]]) arc(g, x, y, 5, 0, 7, W, 1.6);
    g.fillStyle = 'rgba(242,64,46,0.25)'; g.beginPath(); g.arc(cx + 70, cy - 110, 34, 0, 7); g.fill(); arc(g, cx + 70, cy - 110, 34, 0, 7, RED, 1.6); txt(g, '6', cx + 70, cy - 110, RED, 12, 'center');
    g.fillStyle = 'rgba(242,180,48,0.18)'; g.beginPath(); g.arc(cx - 84, cy - 40, 22, 0, 7); g.fill(); arc(g, cx - 84, cy - 40, 22, 0, 7, AMB, 1.4); txt(g, '15', cx - 84, cy - 40, AMB, 10, 'center');
    for (const [x, y, c] of [[cx - 50, cy - 90, GRN], [cx - 40, cy - 98, GRN], [cx + 20, cy - 150, RED], [cx + 34, cy - 144, RED]]) { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); if (c === RED) { g.moveTo(x - 6, y); g.lineTo(x, y - 7); g.lineTo(x + 6, y); } else { g.arc(x, y, 6, Math.PI, 0); } g.stroke(); line(g, [[x, y - 3], [x, y - 13]], c, 1.4); }
    line(g, [[cx, cy - 10], [cx - 8, cy + 8], [cx, cy + 3], [cx + 8, cy + 8], [cx, cy - 10]], CY, 2);
    txt(g, '040', 34, 40, W, 10); txt(g, 'BULL 268/42', 222, 40, W, 10, 'right');
    vignette(g, 0.4);
  },
  mfdStores(g) {                                                        // stores management (SMS inventory)
    rect(g, 0, 0, 256, 256, '#020407');
    osb(g, OSB.sms, W);
    txt(g, 'AAM', 128, 34, W, 12, 'center'); txt(g, 'MRM', 60, 52, W, 10, 'center'); txt(g, 'SRM', 196, 52, W, 10, 'center');
    txt(g, '4 AM120C', 60, 66, GRN, 10, 'center'); txt(g, '2 AIM9X', 196, 66, GRN, 10, 'center');
    // planform with stations
    line(g, [[128, 92], [128, 196]], W, 1.6); line(g, [[30, 150], [128, 120], [226, 150]], W, 1.6); line(g, [[96, 186], [128, 176], [160, 186]], W, 1.6);
    for (const [x, n, w] of [[36, '1', '9X'], [62, '2', '120'], [92, '3', 'TK'], [128, '5', ''], [164, '7', 'TK'], [194, '8', '120'], [220, '9', '9X']]) {
      if (w === 'TK') { g.strokeStyle = W; g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, 168, 6, 15, 0, 0, 7); g.stroke(); }
      else if (w) { box(g, x - 4, 154, 8, 26, W, 1.2); }
      txt(g, n, x, 196, W, 10, 'center'); if (w) txt(g, w, x, 148, w === 'TK' ? CY : GRN, 8, 'center');
    }
    box(g, 70, 206, 116, 18, AMB, 1.2); txt(g, 'MASTER ARM', 128, 215, AMB, 10, 'center');
    txt(g, 'SLAVE', 36, 232, W, 9); txt(g, 'GUN 510', 220, 232, W, 9, 'right');
    vignette(g, 0.35);
  },
  mfdEngine(g) {                                                        // engine / fuel page with tape gauges
    rect(g, 0, 0, 256, 256, '#020407');
    osb(g, OSB.eng, W);
    const bars = [['RPM', 0.92, GRN, '92'], ['FTIT', 0.78, GRN, '785'], ['NOZ', 0.12, CY, '12'], ['OIL', 0.5, GRN, '48'], ['FF', 0.4, GRN, '6.2']];
    bars.forEach(([n, v, c, s], i) => { const x = 40 + i * 44; box(g, x - 9, 54, 18, 140, W, 1.1); rect(g, x - 7, 54 + 138 * (1 - v), 14, 138 * v, c); line(g, [[x - 12, 54 + 140 * 0.1], [x + 12, 54 + 140 * 0.1]], RED, 1.6); txt(g, n, x, 206, W, 9, 'center'); txt(g, s, x, 42, c, 10, 'center'); });
    txt(g, 'FUEL 7400', 64, 226, W, 10, 'center'); txt(g, 'BINGO 2500', 192, 226, AMB, 10, 'center');
    vignette(g, 0.35);
  },
  mfdHsd(g) {                                                           // horizontal situation display (ownship centred, route, threats)
    rect(g, 0, 0, 256, 256, '#020407');
    osb(g, OSB.hsd, W);
    const cx = 128, cy = 158;
    for (const r of [40, 80, 120]) { g.setLineDash(r === 80 ? [] : [3, 5]); arc(g, cx, cy, r, 0, 7, CY, 1); } g.setLineDash([]);
    for (let a = 0; a < 360; a += 10) { const q = (a - 90) * DEG, l = a % 30 === 0 ? 7 : 3; line(g, [[cx + Math.cos(q) * 80, cy + Math.sin(q) * 80], [cx + Math.cos(q) * (80 - l), cy + Math.sin(q) * (80 - l)]], CY, 1.2); if (a % 90 === 0) txt(g, ['N', 'E', 'S', 'W'][a / 90], cx + Math.cos(q) * 68, cy + Math.sin(q) * 68, CY, 9, 'center'); }
    const pts = [[cx - 70, cy + 40], [cx - 30, cy - 10], [cx + 10, cy - 64], [cx + 64, cy - 92], [cx + 96, cy - 136]];
    line(g, pts, W, 1.6); pts.forEach(([x, y], i) => { arc(g, x, y, 4, 0, 7, W, 1.4); txt(g, String(i + 1), x + 7, y - 6, W, 9); });
    g.fillStyle = 'rgba(242,64,46,0.2)'; g.beginPath(); g.arc(cx + 36, cy - 120, 26, 0, 7); g.fill(); arc(g, cx + 36, cy - 120, 26, 0, 7, RED, 1.4); txt(g, '11', cx + 36, cy - 120, RED, 10, 'center');
    arc(g, cx - 80, cy - 70, 14, 0, 7, YEL, 1.4); txt(g, 'A', cx - 80, cy - 70, YEL, 9, 'center');
    line(g, [[cx, cy], [cx - 40, cy - 110]], 'rgba(60,240,106,0.6)', 1); line(g, [[cx, cy], [cx + 40, cy - 110]], 'rgba(60,240,106,0.6)', 1);   // FCR scan volume
    poly(g, [[cx, cy - 9], [cx - 6, cy + 7], [cx, cy + 3], [cx + 6, cy + 7]], W);
    txt(g, '40', 32, 40, W, 10); txt(g, 'DEP', 32, 54, W, 9); txt(g, '012 / 23.4', 222, 40, W, 10, 'right');
    vignette(g, 0.35);
  },
  mfdTgp(g) {                                                           // targeting pod, FLIR white-hot
    const sky = g.createLinearGradient(0, 0, 0, 110); sky.addColorStop(0, '#1d1d1d'); sky.addColorStop(1, '#3b3b3b'); rect(g, 0, 0, 256, 110, sky);
    const gnd = g.createLinearGradient(0, 110, 0, 256); gnd.addColorStop(0, '#5a5a5a'); gnd.addColorStop(1, '#2c2c2c'); rect(g, 0, 110, 256, 146, gnd);
    let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) { const x = rnd() * 256, y = 112 + rnd() * 140, w = 4 + rnd() * 18, h = 3 + rnd() * 10, v = 60 + rnd() * 90 | 0; rect(g, x, y, w, h, `rgb(${v},${v},${v})`); }
    line(g, [[0, 200], [256, 150]], '#8a8a8a', 5); line(g, [[90, 256], [150, 112]], '#7c7c7c', 3);
    rect(g, 138, 160, 16, 9, '#e8e8e8'); rect(g, 141, 157, 8, 3, '#f4f4f4'); rect(g, 152, 166, 6, 4, '#bdbdbd');   // hot vehicle
    const C = '#f4f4f4';
    line(g, [[128, 60], [128, 120]], C, 1.2); line(g, [[128, 200], [128, 230]], C, 1.2); line(g, [[40, 165], [110, 165]], C, 1.2); line(g, [[175, 165], [220, 165]], C, 1.2);
    box(g, 132, 154, 28, 22, C, 1.4);
    osb(g, OSB.tgp, C, [['WHOT', 'NARO', 'CZ', ''], ['', 'TGT', 'AREA', 'PT']]);
    txt(g, 'A-G  CMBT', 128, 28, C, 9, 'center'); txt(g, '-02.3', 34, 230, C, 9); txt(g, '12.4NM', 222, 230, C, 9, 'right'); txt(g, 'L', 128, 214, C, 9, 'center');
  },
  mfdTsd(g) {                                                           // tactical situation display (fused, colour map)
    const bg = g.createLinearGradient(0, 0, 256, 256); bg.addColorStop(0, '#11202a'); bg.addColorStop(1, '#0a141b'); rect(g, 0, 0, 256, 256, bg);
    g.strokeStyle = 'rgba(120,150,120,0.25)'; g.lineWidth = 1; for (let i = 0; i < 8; i++) { g.beginPath(); g.moveTo(0, 30 + i * 30); for (let x = 0; x <= 256; x += 16) g.lineTo(x, 30 + i * 30 + Math.sin(x * 0.05 + i) * 8); g.stroke(); }
    rect(g, 0, 0, 256, 18, '#1d2b36'); txt(g, 'TSD-1', 6, 9, W, 9); txt(g, 'FUEL 12.4', 128, 9, GRN, 9, 'center'); txt(g, '12:45:20', 250, 9, W, 9, 'right');
    const cx = 128, cy = 176; for (const r of [50, 100]) arc(g, cx, cy, r, 0, 7, 'rgba(58,216,242,0.4)', 1);
    line(g, [[cx, cy], [cx + 20, cy - 80], [cx + 70, cy - 140]], W, 1.4);
    g.fillStyle = 'rgba(242,64,46,0.25)'; g.beginPath(); g.arc(cx - 50, cy - 100, 30, 0, 7); g.fill(); arc(g, cx - 50, cy - 100, 30, 0, 7, RED, 1.4);
    for (const [x, y] of [[cx + 40, cy - 110], [cx + 52, cy - 104]]) { poly(g, [[x, y - 6], [x + 6, y], [x, y + 6], [x - 6, y]], RED); }
    for (const [x, y] of [[cx - 20, cy - 60], [cx - 8, cy - 64]]) { g.fillStyle = GRN; g.beginPath(); g.arc(x, y, 5, Math.PI, 0); g.fill(); }
    poly(g, [[cx, cy - 9], [cx - 7, cy + 7], [cx, cy + 3], [cx + 7, cy + 7]], CY);
    rect(g, 0, 238, 256, 18, '#1d2b36'); for (let i = 0; i < 5; i++) txt(g, ['FCS', 'ENG', 'FUEL', 'SMS', 'TWD'][i], 26 + i * 51, 247, W, 9, 'center');
  },
  mfdFlcs(g) {                                                          // flight control system page
    rect(g, 0, 0, 256, 256, '#020407');
    osb(g, OSB.flcs, W);
    txt(g, 'FLCS', 128, 34, W, 12, 'center');
    const cell = (x, y, s, c = GRN) => { box(g, x, y, 40, 20, W, 1); txt(g, s, x + 20, y + 10, c, 9, 'center'); };
    ['A', 'B', 'C', 'D'].forEach((b, i) => { txt(g, b, 44 + i * 48, 56, W, 10, 'center'); for (let j = 0; j < 5; j++) cell(24 + i * 48, 66 + j * 26, j === 3 && i === 2 ? 'FAIL' : 'OK', j === 3 && i === 2 ? AMB : GRN); });
    ['ISA', 'FLAP', 'LEF', 'AOA', 'ADC'].forEach((n, j) => txt(g, n, 6, 76 + j * 26, CY, 7));
    txt(g, 'PWR 2   BIT GO', 128, 214, W, 10, 'center');
    vignette(g, 0.35);
  },

  // ---- small pages ---------------------------------------------------------------------------------------------------------
  cdu(g) {                                                              // FMS control display unit
    rect(g, 0, 0, 256, 256, '#030806');
    txt(g, 'ACT RTE 1 LEGS', 128, 14, W, 13, 'center'); txt(g, '1/3', 250, 14, W, 10, 'right');
    const rows = [['268°', '38NM'], ['TOBOS', '.782/FL350'], ['271°', '52NM'], ['RIKAD', '.782/FL350'], ['265°', '61NM'], ['LUMAN', '280/FL240']];
    rows.forEach(([a, b], i) => { const y = 38 + i * 28; txt(g, a, 8, y, i % 2 ? (i === 1 ? MAG : W) : W, i % 2 ? 14 : 10); txt(g, b, 248, y, i % 2 ? (i === 1 ? MAG : GRN) : W, i % 2 ? 13 : 10, 'right'); });
    txt(g, '-------------------------', 128, 214, W, 9, 'center');
    txt(g, '<RTE 2 LEGS', 8, 234, W, 12); txt(g, 'RTE DATA>', 248, 234, W, 12, 'right');
    vignette(g, 0.25);
  },
  ufc(g) {                                                              // up-front / data entry display
    rect(g, 0, 0, 256, 256, '#020a04');
    const rows = ['  STPT  12  AUTO', '  N 36 14.20', '  E 115 02.70', '  ELEV   2140FT', '  TOS 12:45:20'];
    rows.forEach((s, i) => txt(g, s, 8, 34 + i * 44, GRN, 18));
    box(g, 116, 18, 60, 30, GRN, 1.4);
  },
  annunciators(g) {                                                     // caution / warning lights (most off, a few lit)
    rect(g, 0, 0, 256, 256, '#0b0b0c');
    const cols = [['#2b0a08', '#2e2306', '#082b12'], [RED, AMB, GRN]];
    const L = ['ENG FIRE', 'FLCS', 'HYD/OIL', 'OXY LOW', 'ELEC SYS', 'ENGINE', 'ANTI ICE', 'CANOPY', 'FUEL LOW', 'AVIONICS', 'EQUIP HOT', 'RADAR ALT'];
    for (let i = 0; i < 24; i++) {
      const x = 6 + (i % 4) * 62, y = 6 + Math.floor(i / 4) * 41, k = i % 3, lit = i === 5 || i === 14 || i === 20;
      g.fillStyle = lit ? cols[1][k] : cols[0][k]; g.fillRect(x, y, 56, 35);
      txt(g, L[i % 12], x + 28, y + 18, lit ? '#141414' : 'rgba(255,255,255,0.1)', 8, 'center');
    }
  },
  mcp(g) {                                                              // mode-control-panel / FCU windows (rows of 32 px) + lamp swatches
    rect(g, 0, 0, 256, 256, '#050505');
    const rows = [['COURSE', ' 092', W], ['IAS', ' 250', W], ['HDG', ' 270', W], ['ALT', '35000', W], ['VS', '     ', W], ['FCU SPD', ' 250', AMB], ['FCU HDG', ' ---', AMB], ['FCU ALT', '35000', AMB]];
    rows.forEach(([, s, c], i) => { rect(g, 0, i * 28, 256, 28, '#0a0a08'); txt(g, s, 128, i * 28 + 15, c, 22, 'center'); });
    // lamp swatches (row y 228..256): green, amber, white, off
    [GRN, AMB, '#f4f4ea', '#1a1a1a'].forEach((c, i) => rect(g, i * 64, 228, 64, 28, c));
  },
  clock(g) {                                                            // digital chronometer
    rect(g, 0, 0, 256, 256, '#060606');
    arc(g, 128, 128, 100, 0, 7, W, 3);
    for (let i = 0; i < 60; i++) { const a = i * Math.PI / 30, l = i % 5 === 0 ? 12 : 5; line(g, [[128 + Math.cos(a) * (100 - l), 128 + Math.sin(a) * (100 - l)], [128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100]], W, i % 5 === 0 ? 3 : 1.4); }
    txt(g, '12:45', 128, 104, GRN, 26, 'center'); txt(g, 'UTC', 128, 132, W, 12, 'center'); txt(g, '00:00', 128, 164, AMB, 20, 'center');
    line(g, [[128, 128], [128 + 70, 128 - 60]], W, 2.5);
  },
  legendsB(g) { legendPlates(g, '#5d646b', '#f4efe2'); },
  legendsA(g) { legendPlates(g, '#4c5866', '#f2f4f2', true); },
  legendsF(g) { legendPlates(g, '#2e3236', '#e2f2dc', false, true); },
  faces(g) { [['#5d646b', 0, 0], ['#4c5866', 128, 0], ['#2e3236', 0, 128], ['#141516', 128, 128]].forEach(([c, x, y]) => rect(g, x, y, 128, 128, c)); },
  keys(g) {                                                             // FMS keypad (drawn for the lit panel material)
    rect(g, 0, 0, 256, 256, '#3c4045');
    const K = ['INIT', 'RTE', 'CLB', 'CRZ', 'DES', 'MENU', 'LEGS', 'DEP', 'HOLD', 'PROG', 'EXEC', 'N1'];
    K.forEach((s, i) => { const x = 6 + (i % 6) * 41, y = 6 + Math.floor(i / 6) * 26; rect(g, x, y, 37, 22, '#22252a'); txt(g, s, x + 18.5, y + 11, '#f4efe2', 8, 'center'); });
    for (let i = 0; i < 36; i++) { const x = 6 + (i % 9) * 27.5, y = 66 + Math.floor(i / 9) * 26; rect(g, x, y, 24, 22, '#22252a'); txt(g, i < 26 ? String.fromCharCode(65 + i) : String(i - 26), x + 12, y + 11, '#f4efe2', 11, 'center'); }
    for (let i = 0; i < 12; i++) { const x = 6 + (i % 3) * 30, y = 174 + Math.floor(i / 3) * 20; rect(g, x, y, 26, 17, '#22252a'); txt(g, '123456789.0-'[i], x + 13, y + 9, '#f4efe2', 10, 'center'); }
    rect(g, 110, 176, 140, 70, '#30343a'); txt(g, 'FMC', 180, 196, '#f4efe2', 12, 'center'); rect(g, 196, 220, 40, 12, '#e8c040');
  },
  off(g) { rect(g, 0, 0, 256, 256, '#000'); },
  mcpFace(g) { mcpFace(g); },
};

/** Legend plates per style: [title, row of toggle switches, row of push buttons, footer] — cockpit.js puts 3D switches on them. */
export const PLATES = {
  fighter: [
    ['MASTER ARM', ['ARM', 'OFF', 'SIM'], ['LASER', 'RF'], 'ALT REL'],
    ['LANDING GEAR', ['UP', 'DN'], ['LG', 'HOOK'], 'DN LOCK REL'],
    ['FUEL', ['NORM', 'RSVR'], ['TANK', 'INERT'], 'EXT FUEL TRANS'],
    ['SNSR PWR', ['LEFT', 'RIGHT'], ['FCR', 'RDR ALT'], 'HUD'],
  ],
  airbus: [
    ['EFIS', ['CSTR', 'WPT', 'VOR.D'], ['NDB', 'ARPT'], 'LS  FD'],
    ['A/SKID', ['ON', 'OFF'], ['LO', 'MED'], 'AUTO BRK'],
    ['ECAM', ['ENG', 'BLEED', 'PRESS'], ['ELEC', 'HYD'], 'CLR  STS'],
    ['CLOCK', ['CHR', 'DATE'], ['RUN', 'STP'], 'ET'],
  ],
  boeing: [
    ['MAIN PANEL DUs', ['OUTBD', 'NORM', 'INBD'], ['PFD', 'ENG'], 'LOWER DU'],
    ['AUTO BRAKE', ['RTO', 'OFF', '1'], ['2', '3'], 'MAX'],
    ['FUEL FLOW', ['RATE', 'USED'], ['RESET', 'TEST'], 'N1 SET'],
    ['NOSE WHEEL', ['ALT', 'NORM'], ['STEER', 'OFF'], 'FLT CONTROL'],
  ],
};
/** Plate-space positions (0..1) of a plate's toggles and buttons, as legendPlates() draws them. */
export function plateParts(style, k) {
  const p = PLATES[style][k], r1 = p[1].map((_, j) => [(64 + (j - (p[1].length - 1) / 2) * 36) / 128, 58 / 128]), r2 = p[2].map((_, j) => [(64 + (j - 0.5) * 50) / 128, 94 / 128]);
  return { toggles: r1, buttons: r2 };
}
/**
 * Mode control panel (Boeing MCP / Airbus FCU) in two strips, left and right half of the panel face. u, v: 0..1 over the strip.
 * windows: [u0, v0, u1, v1, row of the 'mcp' page]; knobs: [u, v]; buttons: [u, v, label]; labels: [text, u, v].
 */
export const MCP = {
  boeing: [
    { labels: [['COURSE', 0.085, 0.16], ['IAS/MACH', 0.36, 0.16], ['HEADING', 0.70, 0.16]], windows: [[0.02, 0.27, 0.15, 0.52, 0], [0.28, 0.27, 0.44, 0.52, 1], [0.62, 0.27, 0.78, 0.52, 2]],
      knobs: [[0.085, 0.78], [0.36, 0.78], [0.70, 0.78]], buttons: [[0.2, 0.4, 'N1'], [0.2, 0.76, 'SPEED'], [0.52, 0.4, 'VNAV'], [0.52, 0.76, 'LVL CHG'], [0.89, 0.4, 'LNAV'], [0.89, 0.76, 'HDG SEL']] },
    { labels: [['ALTITUDE', 0.2, 0.16], ['VERT SPEED', 0.57, 0.16]], windows: [[0.07, 0.27, 0.33, 0.52, 3], [0.47, 0.27, 0.67, 0.52, 4]],
      knobs: [[0.2, 0.78], [0.57, 0.78]], buttons: [[0.39, 0.4, 'ALT HLD'], [0.39, 0.76, 'V/S'], [0.76, 0.4, 'CMD A'], [0.9, 0.4, 'CMD B'], [0.76, 0.76, 'CWS A'], [0.9, 0.76, 'CWS B']] },
  ],
  airbus: [
    { labels: [['SPD', 0.1, 0.14], ['MACH', 0.21, 0.14], ['HDG', 0.5, 0.14], ['TRK', 0.6, 0.14]], windows: [[0.04, 0.24, 0.27, 0.5, 5], [0.44, 0.24, 0.67, 0.5, 6]],
      knobs: [[0.155, 0.78], [0.555, 0.78]], buttons: [[0.34, 0.4, 'SPD MACH'], [0.34, 0.76, 'LOC'], [0.8, 0.4, 'AP1'], [0.92, 0.4, 'AP2'], [0.86, 0.76, 'A/THR']] },
    { labels: [['ALT', 0.18, 0.14], ['V/S', 0.64, 0.14], ['FPA', 0.74, 0.14]], windows: [[0.05, 0.24, 0.32, 0.5, 7], [0.55, 0.24, 0.8, 0.5, 4]],
      knobs: [[0.185, 0.78], [0.675, 0.78]], buttons: [[0.42, 0.4, 'APPR'], [0.42, 0.76, 'EXPED'], [0.9, 0.4, 'METRIC'], [0.9, 0.76, 'HDG V/S']] },
  ],
};
const MCP_INK = { boeing: ['#5d646b', '#f4efe2'], airbus: ['#4c5866', '#f2f4f2'] };
function mcpFace(g) {                                                   // 4 strips of 256 × 64: Boeing L, Boeing R, Airbus L, Airbus R
  [['boeing', 0], ['boeing', 1], ['airbus', 0], ['airbus', 1]].forEach(([st, k], i) => {
    const y0 = i * 64, S = MCP[st][k], [face, ink] = MCP_INK[st];
    rect(g, 0, y0, 256, 64, face);
    line(g, [[0, y0 + 1], [256, y0 + 1]], 'rgba(0,0,0,0.5)', 2); line(g, [[0, y0 + 63], [256, y0 + 63]], 'rgba(0,0,0,0.5)', 2);
    for (const [s, u, v] of S.labels) txt(g, s, u * 256, y0 + v * 64, ink, 7, 'center');
    for (const [u0, v0, u1, v1] of S.windows) { rect(g, u0 * 256 - 2, y0 + v0 * 64 - 2, (u1 - u0) * 256 + 4, (v1 - v0) * 64 + 4, '#16181a'); }
    for (const [u, v] of S.knobs) { disc(g, u * 256, y0 + v * 64, 9, 'rgba(0,0,0,0.35)'); }
    for (const [u, v, s] of S.buttons) { rect(g, u * 256 - 13, y0 + v * 64 - 7, 26, 14, '#2a2d31'); txt(g, s, u * 256, y0 + v * 64 + 1, ink, s.length > 5 ? 4.5 : 5.5, 'center'); rect(g, u * 256 - 8, y0 + v * 64 - 6, 16, 2, 'rgba(160,160,150,0.6)'); }
  });
}
/** Four 128-unit legend plates per style (switch groups with labels, screws and lines). */
function legendPlates(g, face, ink, airbus = false, fighter = false) {
  rect(g, 0, 0, 256, 256, face);
  const plates = PLATES[fighter ? 'fighter' : airbus ? 'airbus' : 'boeing'];
  plates.forEach(([title, row1, row2, foot], i) => {
    const x = (i % 2) * 128, y = Math.floor(i / 2) * 128;
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2; g.strokeRect(x + 3, y + 3, 122, 122);
    for (const [sx, sy] of [[9, 9], [119, 9], [9, 119], [119, 119]]) { disc(g, x + sx, y + sy, 3.2, 'rgba(0,0,0,0.35)'); line(g, [[x + sx - 2, y + sy], [x + sx + 2, y + sy]], 'rgba(255,255,255,0.25)', 1); }
    txt(g, title, x + 64, y + 20, ink, 10, 'center');
    line(g, [[x + 14, y + 28], [x + 114, y + 28]], ink, 1);
    row1.forEach((s, k) => { const cx = x + 64 + (k - (row1.length - 1) / 2) * 36; txt(g, s, cx, y + 42, ink, 8, 'center'); disc(g, cx, y + 58, 9, 'rgba(0,0,0,0.35)'); arc(g, cx, y + 58, 9, 0, 7, ink, 1); });
    row2.forEach((s, k) => { const cx = x + 64 + (k - 0.5) * 50; txt(g, s, cx, y + 80, ink, 8, 'center'); rect(g, cx - 9, y + 88, 18, 12, 'rgba(0,0,0,0.4)'); box(g, cx - 9, y + 88, 18, 12, ink, 1); });
    line(g, [[x + 14, y + 108], [x + 114, y + 108]], ink, 1); txt(g, foot, x + 64, y + 116, ink, 8, 'center');
  });
}
/** Legend plate k (0..3) of a style as a sub-rectangle for subUV. */
export const plateRect = (k) => [(k % 2) * 0.5, Math.floor(k / 2) * 0.5, (k % 2) * 0.5 + 0.5, Math.floor(k / 2) * 0.5 + 0.5];
/** Plain face colour cell for a style: 'boeing' | 'airbus' | 'fighter' | 'black'. */
export function faceUV(style) { const k = { boeing: [0.25, 0.25], airbus: [0.75, 0.25], fighter: [0.25, 0.75], black: [0.75, 0.75] }[style] || [0.25, 0.25]; return displayUV('faces', k[0], k[1]); }

// ---- analogue gauge dials (128 px each, drawn in the 256-unit box): black face, white markings, coloured arcs ----------------
function dialFace(g, label) {
  const r = g.createRadialGradient(128, 110, 20, 128, 128, 128); r.addColorStop(0, '#1a1b1d'); r.addColorStop(1, '#070708');
  g.fillStyle = r; g.beginPath(); g.arc(128, 128, 126, 0, 7); g.fill();
  if (label) txt(g, label, 128, 172, '#e8e8e2', 18, 'center');
}
function scale(g, a0, a1, n, major, labels, r = 112, col = '#f0f0ea') {
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * i / n) * DEG, M = i % major === 0, l = M ? 22 : 11;
    line(g, [[128 + Math.cos(a) * r, 128 + Math.sin(a) * r], [128 + Math.cos(a) * (r - l), 128 + Math.sin(a) * (r - l)]], col, M ? 5 : 3);
    if (M && labels) { const s = labels(i / major); if (s !== null) txt(g, s, 128 + Math.cos(a) * (r - 42), 128 + Math.sin(a) * (r - 42), col, 24, 'center'); }
  }
}
function needle(g, a, len = 100, col = '#f4f4ee', w = 7) {
  const q = a * DEG; line(g, [[128 - Math.cos(q) * 18, 128 - Math.sin(q) * 18], [128 + Math.cos(q) * len, 128 + Math.sin(q) * len]], col, w);
  disc(g, 128, 128, 12, '#2a2a2a');
}
const band = (g, a0, a1, col, r = 116, w = 9) => arc(g, 128, 128, r, a0 * DEG, a1 * DEG, col, w);
Object.assign(PAGES, {
  asi(g) { dialFace(g, 'KNOTS'); band(g, -230 + 0.06 * 300, -230 + 0.5 * 300, '#2fbf4a'); band(g, -230 + 0.5 * 300, -230 + 0.7 * 300, '#e8c030'); scale(g, -230, 70, 30, 5, (i) => String(i * 50 + 50)); needle(g, -230 + 0.42 * 300); },
  adi(g) {
    g.save(); g.beginPath(); g.arc(128, 128, 118, 0, 7); g.clip(); g.translate(128, 128); g.rotate(6 * DEG);
    rect(g, -140, -140, 280, 146, '#d9dcdc'); rect(g, -140, 6, 280, 140, '#1b1c1e'); line(g, [[-140, 6], [140, 6]], '#f4f4ee', 5);
    for (const p of [-20, -10, 10, 20]) line(g, [[-30, 6 - p * 3.4], [30, 6 - p * 3.4]], p > 0 ? '#202020' : '#f0f0ea', 4);
    g.restore();
    for (const s of [-1, 1]) line(g, [[128 + s * 30, 128], [128 + s * 78, 128]], '#f2b030', 8);
    disc(g, 128, 128, 7, '#f2b030');
    for (const a of [-60, -30, -20, -10, 0, 10, 20, 30, 60]) { const q = (a - 90) * DEG; line(g, [[128 + Math.cos(q) * 104, 128 + Math.sin(q) * 104], [128 + Math.cos(q) * 122, 128 + Math.sin(q) * 122]], '#f0f0ea', 4); }
    arc(g, 128, 128, 122, 0, 7, '#2a2a2a', 8);
  },
  alt(g) { dialFace(g, 'ALT'); scale(g, -90, 270, 50, 5, (i) => (i < 10 ? String(i) : null)); rect(g, 150, 116, 64, 26, '#0c0c0c'); txt(g, '35', 182, 129, '#f0f0ea', 22, 'center'); needle(g, -90 + 0.0 * 360, 100); needle(g, -90 + 0.5 * 360, 60, '#f0f0ea', 10); },
  hsi(g) {
    dialFace(g); g.save(); g.translate(128, 128); g.rotate(-268 * DEG);
    for (let i = 0; i < 72; i++) { const a = i * 5 * DEG, M = i % 2 === 0; line(g, [[Math.sin(a) * 112, -Math.cos(a) * 112], [Math.sin(a) * (M ? 96 : 104), -Math.cos(a) * (M ? 96 : 104)]], '#f0f0ea', M ? 4 : 2.5); if (i % 6 === 0) { g.save(); g.rotate(a); txt(g, ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33'][i / 6], 0, -80, '#f0f0ea', 20, 'center'); g.restore(); } }
    g.restore();
    line(g, [[128, 40], [128, 216]], '#e8c030', 5); line(g, [[110, 128], [146, 128]], '#f0f0ea', 6); line(g, [[128, 116], [128, 150]], '#f0f0ea', 6);
    poly(g, [[128, 10], [120, 24], [136, 24]], '#f0f0ea');
  },
  vsi(g) { dialFace(g, 'VERT SPEED'); scale(g, -180, 180, 24, 4, (i) => String([0, 1, 2, 4, 6, 4, 2][i] ?? '')); needle(g, -180 + 12); },
  rpm(g) { dialFace(g, '% RPM'); band(g, -225 + 0.8 * 270, -225 + 0.95 * 270, '#2fbf4a'); band(g, -225 + 0.98 * 270, -225 + 1.0 * 270, '#e03a2a'); scale(g, -225, 45, 22, 2, (i) => String(i * 10)); needle(g, -225 + 0.88 * 270); },
  egt(g) { dialFace(g, 'EGT °C x100'); band(g, -225 + 0.4 * 270, -225 + 0.8 * 270, '#2fbf4a'); band(g, -225 + 0.88 * 270, -225 + 1.0 * 270, '#e03a2a'); scale(g, -225, 45, 20, 2, (i) => String(i * 2)); needle(g, -225 + 0.62 * 270); },
  fuel(g) { dialFace(g, 'FUEL LB x1000'); band(g, -225, -225 + 0.12 * 270, '#e8c030'); scale(g, -225, 45, 20, 4, (i) => String(i * 2)); needle(g, -225 + 0.55 * 270); needle(g, -225 + 0.45 * 270, 80, '#e8c030', 5); },
  oil(g) { dialFace(g, 'OIL PSI'); band(g, -225 + 0.3 * 270, -225 + 0.75 * 270, '#2fbf4a'); scale(g, -225, 45, 10, 2, (i) => String(i * 20)); needle(g, -225 + 0.5 * 270); },
  hyd(g) { dialFace(g, 'HYD PSI x1000'); band(g, -225 + 0.65 * 270, -225 + 0.85 * 270, '#2fbf4a'); scale(g, -225, 45, 8, 2, (i) => String(i)); needle(g, -225 + 0.74 * 270); },
  gmeter(g) { dialFace(g, 'G'); band(g, -180 + 0.83 * 360 * 0.75, -180 + 0.92 * 360 * 0.75, '#e03a2a'); scale(g, -180, 90, 15, 1, (i) => (i % 2 ? null : String(i - 4))); needle(g, -180 + 5 * 18); },
  aoa(g) { dialFace(g, 'AOA UNITS'); band(g, -200 + 0.55 * 220, -200 + 0.7 * 220, '#2fbf4a'); scale(g, -200, 20, 30, 5, (i) => String(i * 5)); needle(g, -200 + 0.35 * 220); },
  aclock(g) { dialFace(g); scale(g, -90, 270, 60, 5, (i) => (i < 12 ? String(i === 0 ? 12 : i) : null)); needle(g, -90 + 0.375 * 360, 66, '#f0f0ea', 9); needle(g, -90 + 0.75 * 360, 100); },
  flaps(g) { dialFace(g, 'FLAPS'); scale(g, -200, 20, 8, 1, (i) => (i % 2 ? null : String([0, 1, 2, 5, 10, 15, 25, 30, 40][i]))); needle(g, -200); },
  brake(g) { dialFace(g, 'BRAKE PSI x1000'); band(g, -225 + 0.6 * 270, -225 + 0.9 * 270, '#2fbf4a'); scale(g, -225, 45, 8, 2, (i) => String(i)); needle(g, -225 + 0.74 * 270); },
  cabin(g) { dialFace(g, 'CABIN ALT'); scale(g, -225, 45, 10, 2, (i) => String(i * 10)); needle(g, -225 + 0.24 * 270); },
});
