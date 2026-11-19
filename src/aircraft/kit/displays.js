// Aircraft kit — cockpit display content: one shared 1024² canvas with 16 tiles of plausible avionics pages (PFD, ND,
// EICAS, fighter MFD pages, HUD symbology, backlit panel legends…). Display faces (cockpit.js display() / instrumentPanel())
// address a tile through displayUV(); the rig draws them with its own 'display' material, whose emissive map is this canvas,
// so the light goes through the material's emissive term (night grade: src/render/INTEGRATION.md, "Emissive contributors").
import * as THREE from 'three';

const N = 4, TS = 256, SIZE = N * TS;
/** Tile names → index (row-major, 4 × 4). */
export const DISPLAY_TILES = {
  pfd: 0, nd: 1, eicas: 2, ecam: 3,
  mfdRadar: 4, mfdSA: 5, mfdStores: 6, mfdEngine: 7,
  hud: 8, cdu: 9, standby: 10, legends: 11,
  annunciators: 12, ufc: 13, clock: 14, off: 15,
};
/** UV inside a tile: u 0..1 left → right, v 0..1 top → bottom. A 3 px inset keeps mip neighbours out. */
export function displayUV(tile, u, v) {
  const i = typeof tile === 'number' ? tile : (DISPLAY_TILES[tile] ?? 15), tx = i % N, ty = Math.floor(i / N), e = 3 / TS;
  const uu = e + Math.min(1, Math.max(0, u)) * (1 - 2 * e), vv = e + Math.min(1, Math.max(0, v)) * (1 - 2 * e);
  return [(tx + uu) / N, 1 - (ty + vv) / N];
}

let shared = null;
/** The shared display texture (created on first use; null without a DOM). */
export function displayTexture() {
  if (shared) return shared;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = SIZE;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, SIZE, SIZE);
  for (const [name, i] of Object.entries(DISPLAY_TILES)) {
    g.save(); g.translate((i % N) * TS, Math.floor(i / N) * TS); g.beginPath(); g.rect(0, 0, TS, TS); g.clip();
    (PAGES[name] || (() => {}))(g); g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  shared = t; return t;
}

// ---- drawing helpers ----------------------------------------------------------------------------------------------------------
const W = '#e8ecef', GRN = '#3cf06a', CY = '#35d8f0', MAG = '#f048e8', AMB = '#f0b030', RED = '#f03a2a', DIM = '#7a8590';
const font = (g, px, bold = true) => { g.font = `${bold ? 'bold ' : ''}${px}px monospace`; };
const txt = (g, s, x, y, col = W, px = 11, align = 'left') => { font(g, px); g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
const line = (g, pts, col = W, w = 1.6) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); };
const box = (g, x, y, w, h, col = W, lw = 1.4) => { g.strokeStyle = col; g.lineWidth = lw; g.strokeRect(x, y, w, h); };
const arc = (g, x, y, r, a0, a1, col = W, w = 1.6) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke(); };
const bezelGlass = (g) => {                                             // faint glass sheen + vignette so a page never looks pasted on
  const r = g.createRadialGradient(TS / 2, TS / 2, TS * 0.2, TS / 2, TS / 2, TS * 0.75); r.addColorStop(0, 'rgba(0,0,0,0)'); r.addColorStop(1, 'rgba(0,0,0,0.45)');
  g.fillStyle = r; g.fillRect(0, 0, TS, TS);
};
const osb = (g, col = W) => {                                           // fighter MFD push-button legends around the edge
  const L = ['MENU', 'SMS', 'RDR', 'HSD', 'TGP', 'FCR', 'DCLT', 'SWAP', 'TEST', 'DTE'];
  for (let i = 0; i < 5; i++) { txt(g, L[i], 30 + i * 49, 12, col, 9, 'center'); txt(g, L[i + 5], 30 + i * 49, TS - 11, col, 9, 'center'); }
  for (let i = 0; i < 4; i++) { line(g, [[3, 60 + i * 42], [12, 60 + i * 42]], col, 2); line(g, [[TS - 12, 60 + i * 42], [TS - 3, 60 + i * 42]], col, 2); }
};

const PAGES = {
  pfd(g) {                                                            // airliner primary flight display
    const cx = 120, cy = 118;
    g.save(); g.beginPath(); g.rect(46, 34, 148, 168); g.clip();
    g.translate(cx, cy); g.rotate(-4 * Math.PI / 180);
    g.fillStyle = '#1f6fd6'; g.fillRect(-160, -200, 320, 200 + 6);
    g.fillStyle = '#8a5a2c'; g.fillRect(-160, 6, 320, 200);
    line(g, [[-160, 6], [160, 6]], W, 2);
    for (let p = -20; p <= 20; p += 2.5) { if (!p) continue; const y = 6 - p * 3.4, w = p % 10 === 0 ? 30 : p % 5 === 0 ? 18 : 8; line(g, [[-w, y], [w, y]], W, 1.4); if (p % 10 === 0) { txt(g, String(Math.abs(p)), -w - 12, y, W, 9, 'center'); txt(g, String(Math.abs(p)), w + 12, y, W, 9, 'center'); } }
    g.restore();
    // aircraft symbol, roll scale, flight director
    g.fillStyle = '#000'; g.fillRect(cx - 3, cy - 3, 6, 6); box(g, cx - 3, cy - 3, 6, 6, '#f2d23a', 1.5);
    for (const s of [-1, 1]) { g.fillStyle = '#000'; g.fillRect(cx + s * 52 - (s > 0 ? 0 : 30), cy - 3, 30, 6); box(g, cx + s * 52 - (s > 0 ? 0 : 30), cy - 3, 30, 6, '#f2d23a', 1.5); }
    line(g, [[cx - 40, cy - 10], [cx + 40, cy - 10]], MAG, 2); line(g, [[cx + 6, cy - 50], [cx + 6, cy + 40]], MAG, 2);
    arc(g, cx, cy, 78, -Math.PI * 0.8, -Math.PI * 0.2, W, 1.5);
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const r = (a - 90) * Math.PI / 180, l = a % 30 === 0 ? 9 : 5; line(g, [[cx + Math.cos(r) * 78, cy + Math.sin(r) * 78], [cx + Math.cos(r) * (78 + l), cy + Math.sin(r) * (78 + l)]], W, 1.5); }
    // speed tape
    g.fillStyle = '#3a4048'; g.fillRect(4, 34, 38, 168);
    for (let i = -4; i <= 4; i++) { const y = cy - i * 19; line(g, [[34, y], [42, y]], W, 1.4); txt(g, String(250 + i * 10), 30, y, W, 10, 'right'); }
    g.fillStyle = '#000'; g.fillRect(2, cy - 10, 42, 20); box(g, 2, cy - 10, 42, 20, '#f2d23a', 1.6); txt(g, '252', 38, cy, W, 13, 'right');
    line(g, [[42, cy - 70], [42, cy - 40]], AMB, 4); line(g, [[42, cy + 60], [42, cy + 90]], RED, 4);
    txt(g, '.782', 22, 214, GRN, 11, 'center');
    // altitude tape + VSI
    g.fillStyle = '#3a4048'; g.fillRect(198, 34, 40, 168);
    for (let i = -4; i <= 4; i++) { const y = cy - i * 19; line(g, [[198, y], [206, y]], W, 1.4); txt(g, String(35000 + i * 100).slice(0, 3), 210, y, W, 10); }
    g.fillStyle = '#000'; g.fillRect(196, cy - 11, 46, 22); box(g, 196, cy - 11, 46, 22, '#f2d23a', 1.6); txt(g, '35000', 238, cy, W, 12, 'right');
    txt(g, '35000', 218, 26, MAG, 11, 'center'); txt(g, '1013', 218, 214, CY, 11, 'center');
    g.fillStyle = '#3a4048'; g.fillRect(242, 50, 12, 136); line(g, [[244, cy], [254, cy - 6]], W, 2);
    // heading strip + FMA
    g.fillStyle = '#3a4048'; g.fillRect(52, 218, 136, 34);
    for (let i = -3; i <= 3; i++) { const x = cx + i * 20; line(g, [[x, 218], [x, 225]], W, 1.4); if (i % 1 === 0) txt(g, String(27 + i).padStart(2, '0'), x, 236, W, 10, 'center'); }
    line(g, [[cx, 216], [cx - 5, 210], [cx + 5, 210], [cx, 216]], '#f2d23a', 2);
    box(g, 50, 2, 140, 22, DIM, 1); txt(g, 'SPEED', 68, 13, GRN, 10, 'center'); txt(g, 'LNAV', 120, 13, GRN, 10, 'center'); txt(g, 'VNAV PTH', 168, 13, GRN, 9, 'center');
    bezelGlass(g);
  },
  nd(g) {                                                             // navigation display, map mode
    const cx = 128, cy = 200;
    txt(g, 'GS 452  TAS 468', 8, 12, W, 10); txt(g, '268°/ 42', 8, 26, W, 10);
    txt(g, 'TOBOS', 248, 12, MAG, 11, 'right'); txt(g, '1245.2z', 248, 26, W, 10, 'right'); txt(g, '38 NM', 248, 40, W, 10, 'right');
    arc(g, cx, cy, 150, -Math.PI * 0.82, -Math.PI * 0.18, W, 1.8);
    for (let a = -50; a <= 50; a += 5) { const r = (a - 90) * Math.PI / 180, l = a % 10 === 0 ? 10 : 5; line(g, [[cx + Math.cos(r) * 150, cy + Math.sin(r) * 150], [cx + Math.cos(r) * (150 - l), cy + Math.sin(r) * (150 - l)]], W, 1.5); if (a % 30 === 0) txt(g, String((27 + a / 10 + 36) % 36), cx + Math.cos(r) * 132, cy + Math.sin(r) * 132, W, 10, 'center'); }
    arc(g, cx, cy, 75, -Math.PI * 0.82, -Math.PI * 0.18, W, 1); g.setLineDash([4, 5]); arc(g, cx, cy, 112, -Math.PI * 0.82, -Math.PI * 0.18, DIM, 1); g.setLineDash([]);
    line(g, [[cx, cy], [cx + 8, cy - 70], [cx + 40, cy - 128], [cx + 92, cy - 180]], MAG, 2.4);
    for (const [x, y, n] of [[cx + 8, cy - 70, 'TOBOS'], [cx + 40, cy - 128, 'RIKAD'], [cx + 92, cy - 180, 'LUMAN']]) { line(g, [[x, y - 5], [x + 5, y], [x, y + 5], [x - 5, y], [x, y - 5]], MAG, 1.8); txt(g, n, x + 9, y, MAG, 9); }
    for (const [x, y, n] of [[cx - 70, cy - 90, 'KOMAR'], [cx + 70, cy - 60, 'ZBV']]) { line(g, [[x, y - 5], [x + 5, y], [x, y + 5], [x - 5, y], [x, y - 5]], CY, 1.4); txt(g, n, x + 8, y, CY, 9); }
    g.fillStyle = 'rgba(40,200,70,0.35)'; g.beginPath(); g.ellipse(cx - 60, cy - 120, 18, 10, 0.5, 0, 7); g.fill();
    g.fillStyle = 'rgba(240,200,40,0.35)'; g.beginPath(); g.ellipse(cx - 56, cy - 122, 8, 5, 0.5, 0, 7); g.fill();
    line(g, [[cx, cy - 8], [cx - 7, cy + 8], [cx + 7, cy + 8], [cx, cy - 8]], W, 2);
    line(g, [[cx, cy - 152], [cx - 6, cy - 162], [cx + 6, cy - 162], [cx, cy - 152]], W, 1.8);
    txt(g, 'VOR L', 8, 238, GRN, 10); txt(g, 'ADF R', 248, 238, CY, 10, 'right');
    bezelGlass(g);
  },
  eicas(g) {                                                          // engine indication: two N1 / EGT dials + memo
    for (const [cx, k] of [[64, 0.86], [192, 0.87]]) {
      for (const [cy, val, lab] of [[52, k, 'N1'], [132, k * 0.92, 'EGT']]) {
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, 34, Math.PI, Math.PI + val * Math.PI * 1.2); g.fill();
        arc(g, cx, cy, 34, Math.PI, Math.PI * 2.2, W, 2); arc(g, cx, cy, 34, Math.PI * 2.05, Math.PI * 2.2, RED, 3);
        const a = Math.PI + val * Math.PI * 1.2; line(g, [[cx, cy], [cx + Math.cos(a) * 34, cy + Math.sin(a) * 34]], W, 2.4);
        g.fillStyle = '#000'; g.fillRect(cx + 2, cy - 22, 40, 16); box(g, cx + 2, cy - 22, 40, 16, W, 1.2); txt(g, (val * (lab === 'N1' ? 100 : 900)).toFixed(lab === 'N1' ? 1 : 0), cx + 40, cy - 14, W, 11, 'right');
        txt(g, lab, cx, cy + 18, CY, 10, 'center');
      }
    }
    txt(g, 'TAT +12c', 8, 186, W, 10); txt(g, 'CRZ', 128, 186, GRN, 10, 'center'); txt(g, '86.4', 248, 186, GRN, 10, 'right');
    line(g, [[8, 198], [248, 198]], DIM, 1);
    txt(g, 'FUEL  QTY 14.2', 8, 212, W, 10); txt(g, 'SEATBELTS', 8, 228, CY, 10); txt(g, 'TO CONFIG NORMAL', 8, 244, GRN, 9);
  },
  ecam(g) {                                                           // systems page (fuel synoptic)
    txt(g, 'FUEL', 128, 14, W, 12, 'center'); line(g, [[100, 22], [156, 22]], W, 1);
    for (const [x, n] of [[40, '4 980'], [128, '7 210'], [216, '4 970']]) { box(g, x - 32, 70, 64, 50, W, 1.6); txt(g, n, x, 95, GRN, 12, 'center'); }
    line(g, [[72, 95], [96, 95]], GRN, 2); line(g, [[160, 95], [184, 95]], GRN, 2);
    for (const x of [40, 216]) { arc(g, x, 150, 10, 0, 7, GRN, 2); line(g, [[x, 120], [x, 140]], GRN, 2); line(g, [[x, 160], [x, 196]], GRN, 2); }
    txt(g, 'ENG 1', 40, 210, W, 10, 'center'); txt(g, 'ENG 2', 216, 210, W, 10, 'center');
    txt(g, 'FOB: 17 160 KG', 128, 238, CY, 11, 'center');
  },
  mfdRadar(g) {                                                       // fighter radar B-scope
    osb(g, GRN);
    box(g, 28, 28, 200, 196, GRN, 1.2);
    for (let i = 1; i < 4; i++) { g.setLineDash([3, 6]); line(g, [[28, 28 + i * 49], [228, 28 + i * 49]], 'rgba(60,240,106,0.6)', 1); line(g, [[28 + i * 50, 28], [28 + i * 50, 224]], 'rgba(60,240,106,0.6)', 1); g.setLineDash([]); }
    for (const [x, y] of [[96, 80], [110, 74], [160, 120], [70, 150]]) { g.fillStyle = GRN; g.fillRect(x - 5, y - 3, 10, 6); }
    line(g, [[110, 74], [116, 66]], GRN, 1.5); line(g, [[160, 120], [168, 112]], GRN, 1.5);
    line(g, [[128, 210], [122, 222], [134, 222], [128, 210]], GRN, 1.6);
    txt(g, '40', 36, 38, GRN, 10); txt(g, 'A4', 36, 214, GRN, 10); txt(g, 'CRM RWS', 128, 38, GRN, 10, 'center');
    g.strokeStyle = GRN; g.lineWidth = 1.4; g.strokeRect(150, 100, 22, 22);
  },
  mfdSA(g) {                                                          // horizontal situation / tactical map
    g.fillStyle = '#05140b'; g.fillRect(0, 0, TS, TS);
    osb(g, W);
    const cx = 128, cy = 170;
    arc(g, cx, cy, 120, 0, 7, CY, 1.2); arc(g, cx, cy, 60, 0, 7, CY, 1);
    line(g, [[cx, cy], [cx + 30, cy - 70], [cx - 20, cy - 130]], W, 1.6);
    for (const [x, y] of [[cx + 30, cy - 70], [cx - 20, cy - 130]]) arc(g, x, y, 5, 0, 7, W, 1.6);
    g.fillStyle = 'rgba(240,58,42,0.35)'; g.beginPath(); g.arc(cx + 70, cy - 110, 34, 0, 7); g.fill(); arc(g, cx + 70, cy - 110, 34, 0, 7, RED, 1.6); txt(g, 'SA-6', cx + 70, cy - 110, RED, 10, 'center');
    for (const [x, y, c] of [[cx - 50, cy - 90, GRN], [cx - 40, cy - 98, GRN], [cx + 20, cy - 150, RED]]) { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 6, Math.PI, 0); g.stroke(); }
    line(g, [[cx, cy - 10], [cx - 8, cy + 8], [cx, cy + 3], [cx + 8, cy + 8], [cx, cy - 10]], CY, 2);
    txt(g, '040', 36, 40, W, 10); txt(g, 'BULL 268/42', 222, 40, W, 10, 'right');
  },
  mfdStores(g) {                                                      // stores management
    osb(g, W);
    txt(g, 'AAM', 128, 40, W, 12, 'center'); txt(g, 'MRM  4 AM120', 128, 58, GRN, 10, 'center');
    line(g, [[30, 150], [128, 120], [226, 150]], W, 1.6); line(g, [[128, 100], [128, 200]], W, 1.6);
    for (const [x, n] of [[38, '1'], [70, '2'], [100, '3'], [156, '7'], [186, '8'], [218, '9']]) { box(g, x - 9, 152, 18, 30, W, 1.2); txt(g, n, x, 192, W, 10, 'center'); txt(g, x === 38 || x === 218 ? '9X' : '120', x, 166, GRN, 8, 'center'); }
    txt(g, 'MASTER ARM', 128, 222, AMB, 10, 'center');
  },
  mfdEngine(g) {                                                      // engine / fuel page with tape gauges
    osb(g, W);
    const bars = [['RPM', 0.92, GRN], ['FTIT', 0.78, GRN], ['NOZ', 0.12, CY], ['OIL', 0.5, GRN]];
    bars.forEach(([n, v, c], i) => { const x = 46 + i * 52; box(g, x - 10, 50, 20, 150, W, 1.2); g.fillStyle = c; g.fillRect(x - 8, 50 + 148 * (1 - v), 16, 148 * v); txt(g, n, x, 212, W, 9, 'center'); txt(g, String(Math.round(v * 100)), x, 40, c, 10, 'center'); });
  },
  hud(g) {                                                            // HUD symbology (drawn additively on the combiner)
    const cx = 128, cy = 128, C = '#5dff7c';
    for (let p = -10; p <= 10; p += 5) { if (!p) continue; const y = cy - p * 7; if (p > 0) { line(g, [[cx - 62, y + 5], [cx - 62, y], [cx - 22, y]], C, 1.6); line(g, [[cx + 22, y], [cx + 62, y], [cx + 62, y + 5]], C, 1.6); } else { g.setLineDash([6, 4]); line(g, [[cx - 62, y - 5], [cx - 62, y], [cx - 22, y]], C, 1.6); line(g, [[cx + 22, y], [cx + 62, y], [cx + 62, y - 5]], C, 1.6); g.setLineDash([]); } txt(g, String(Math.abs(p)), cx - 74, y, C, 9, 'center'); txt(g, String(Math.abs(p)), cx + 74, y, C, 9, 'center'); }
    line(g, [[cx - 96, cy], [cx - 24, cy]], C, 1.8); line(g, [[cx + 24, cy], [cx + 96, cy]], C, 1.8);
    arc(g, cx, cy + 12, 7, 0, 7, C, 1.8); line(g, [[cx - 19, cy + 12], [cx - 7, cy + 12]], C, 1.8); line(g, [[cx + 7, cy + 12], [cx + 19, cy + 12]], C, 1.8); line(g, [[cx, cy + 5], [cx, cy - 2]], C, 1.8);
    line(g, [[cx - 8, cy - 30], [cx, cy - 26], [cx + 8, cy - 30]], C, 1.6);
    box(g, 14, cy - 9, 40, 18, C, 1.4); txt(g, '452', 50, cy, C, 12, 'right');
    box(g, 196, cy - 9, 48, 18, C, 1.4); txt(g, '12,450', 240, cy, C, 11, 'right');
    for (let i = -3; i <= 3; i++) { const x = cx + i * 22; line(g, [[x, 22], [x, i % 1 ? 26 : 30]], C, 1.4); txt(g, String(27 + i).padStart(2, '0'), x, 40, C, 9, 'center'); }
    line(g, [[cx, 14], [cx - 4, 8], [cx + 4, 8], [cx, 14]], C, 1.4);
    txt(g, 'M 0.82', 16, 168, C, 10); txt(g, 'G 1.0', 16, 182, C, 10); txt(g, 'NAV', 16, 220, C, 10); txt(g, '012.4 STPT', 240, 220, C, 10, 'right');
  },
  cdu(g) {                                                            // FMS control display unit
    g.fillStyle = '#020604'; g.fillRect(0, 0, TS, TS);
    txt(g, 'ACT RTE 1 LEGS', 128, 16, W, 12, 'center'); txt(g, '1/3', 246, 16, W, 10, 'right');
    const rows = [['268°', '38NM'], ['TOBOS', '.782/FL350'], ['271°', '52NM'], ['RIKAD', '.782/FL350'], ['265°', '61NM'], ['LUMAN', '280/FL240']];
    rows.forEach(([a, b], i) => { const y = 40 + i * 28; txt(g, a, 10, y, i % 2 ? MAG : W, 12); txt(g, b, 246, y, i % 2 ? GRN : W, 11, 'right'); });
    txt(g, '<RTE 2 LEGS', 10, 232, W, 11); txt(g, 'RTE DATA>', 246, 232, W, 11, 'right');
  },
  standby(g) {                                                        // standby attitude / airspeed / altitude (ISFD)
    g.save(); g.beginPath(); g.arc(128, 128, 110, 0, 7); g.clip();
    g.fillStyle = '#1f6fd6'; g.fillRect(0, 0, TS, 134); g.fillStyle = '#7a4f26'; g.fillRect(0, 134, TS, TS);
    line(g, [[0, 134], [TS, 134]], W, 2);
    for (let p = -20; p <= 20; p += 10) if (p) line(g, [[110, 134 - p * 3], [146, 134 - p * 3]], W, 1.5);
    g.restore();
    line(g, [[84, 130], [116, 130], [128, 140], [140, 130], [172, 130]], '#f2d23a', 3);
    txt(g, '252', 30, 128, W, 14); txt(g, '35000', 226, 128, W, 13, 'right'); txt(g, 'STD', 226, 148, CY, 10, 'right');
  },
  legends(g) {                                                        // backlit panel legends (edge-lit lettering on grey)
    g.fillStyle = '#2a2e33'; g.fillRect(0, 0, TS, TS);
    const L = ['NAV', 'STROBE', 'BCN', 'LDG', 'TAXI', 'APU', 'GEN 1', 'GEN 2', 'BATT', 'PITOT', 'ANTI-ICE', 'FUEL', 'HYD A', 'HYD B', 'BLEED', 'PACK', 'ENG 1', 'ENG 2', 'IGN', 'START'];
    L.forEach((s, i) => { const x = 10 + (i % 4) * 62, y = 18 + Math.floor(i / 4) * 46; txt(g, s, x + 26, y, '#f0f0e0', 9, 'center'); line(g, [[x + 6, y + 10], [x + 46, y + 10]], 'rgba(240,240,224,0.5)', 1); arc(g, x + 26, y + 24, 6, 0, 7, 'rgba(240,240,224,0.7)', 1.2); });
  },
  annunciators(g) {                                                   // caution / warning lights (most off, a few lit)
    const cols = [['#2a0806', '#3a2a04', '#062a10'], [RED, AMB, GRN]];
    for (let i = 0; i < 24; i++) { const x = 6 + (i % 4) * 62, y = 6 + Math.floor(i / 4) * 41, k = i % 3, lit = i === 5 || i === 14 || i === 20; g.fillStyle = lit ? cols[1][k] : cols[0][k]; g.fillRect(x, y, 56, 35); txt(g, ['MASTER', 'FUEL', 'HYD', 'OXY', 'ELEC', 'ENG', 'ANTI ICE', 'DOOR'][i % 8], x + 28, y + 18, lit ? '#111' : 'rgba(255,255,255,0.12)', 9, 'center'); }
  },
  ufc(g) {                                                            // fighter up-front control / data entry display
    g.fillStyle = '#020a04'; g.fillRect(0, 0, TS, TS);
    const rows = ['  STPT  12  AUTO', '  N 36 14.20', '  E 115 02.70', '  ELEV   2140FT', '  TOS 12:45:20'];
    rows.forEach((s, i) => txt(g, s, 10, 40 + i * 40, GRN, 15));
  },
  clock(g) {
    arc(g, 128, 128, 100, 0, 7, W, 3);
    for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; line(g, [[128 + Math.cos(a) * 88, 128 + Math.sin(a) * 88], [128 + Math.cos(a) * 100, 128 + Math.sin(a) * 100]], W, 3); }
    line(g, [[128, 128], [128 + 50, 128 - 30]], W, 4); line(g, [[128, 128], [128 - 20, 128 - 80]], W, 3);
    txt(g, '12:45', 128, 175, GRN, 16, 'center');
  },
  off() {},
};
