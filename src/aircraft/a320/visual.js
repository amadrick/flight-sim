// Airbus A320neo — procedural visual model built with the aircraft kit (src/aircraft/kit).
// Body axes: origin = CG, +X right wing, +Y up, -Z nose. Ground is at y = -geometry.cgHeight (-3.2) when parked.
//
// Reference numbers (docs/aircraft/a320.md, Airbus AC A320, photos), body axes, d = distance aft of the nose tip (z = d - 17.7):
//   length 37.57 m (nose z -17.7 … APU exhaust z 19.87), span 35.8 m over the sharklets, height 11.76 m (fin tip y 8.56).
//   Fuselage 3.95 m wide × 4.14 m high: half-width 1.975, crown y 2.03, belly y -2.11, widest at y -0.05; constant from
//   d 8 to d 28; nose tip on y -0.42; radome joint d 1.8; blunt Airbus nose, windshield bottom d 2.0 (y 0.55), top d 2.8.
//   Six flight-deck windows: two flat windshields, two sliding side windows, two aft side windows whose upper rear
//   corner is notched. Cabin windows at a 0.533 m pitch; doors 1L/R d 4.75–5.6, 2L/R d 27.85–28.65, two overwing
//   exits per side. Cockpit floor y -0.35, pilot eye y 0.85 (4.05 m above the ground).
//   Wing: root LE (fuselage side x 1.98) z -3.7, root chord 6.3; Yehudi kink at x 6.4 (unswept inboard trailing edge);
//   tip x 16.9 chord 1.25; LE sweep 26.6°; dihedral 5.5° from y -0.75 at the root LE; 2.4 m sharklets bring the span to
//   35.8 m. Slats: inboard x 2.4–5.1, outboard 6.4–16.5 (four panels painted); single-slotted Fowler flaps x 2.2–5.45,
//   6.05–14.1; ailerons 14.3–16.6; five spoilers per wing (1 inboard, 2–5 outboard).
//   Tailplane span 12.45 m, root LE z 14.2, chord 4.2 → 1.25, LE sweep 34°, dihedral 6°. Fin root LE z 10.8 (y 2.0),
//   root chord 7.0, tip chord 2.2 at y 8.56, LE sweep 40°, small dorsal fillet.
//   LEAP-1A nacelles: centre x ±5.75, y -1.5; highlight z -5.0, max Ø 2.38, fan Ø 1.98, fan cowl + reverser 3.35 m,
//   core nozzle exit z -0.45; 0.5 m ground clearance; round intake.
//   Gear (geometry.js, unchanged): nose twin r 0.38 at z -11.5 retracting forward; main twin r 0.57 at x ±3.8, z 1.14,
//   legs hinged in the wing at x ±3.65 retracting inward, wheels stowed in open wells in the belly fairing (as on the
//   real aeroplane, the outboard tyre and hub stay visible from below).
// The airline liveries are invented for this simulator: they do not reproduce any real operator's name or marks.
import * as THREE from 'three';
import geometry from './geometry.js';
import * as K from '../kit/index.js';

const DEG = Math.PI / 180;
export const LIVERIES = ['meridia', 'orvanta', 'house'];

const SCHEMES = {
  meridia: { name: 'Meridia', title: 'MERIDIA', reg: 'ZZ-MRD', body: '#f6f7f8', belly: '#cdd1d5', accent: '#a8123c', tail: '#a8123c', engine: '#f3f4f5', lipBand: '#a8123c', sharklet: '#a8123c', titleColor: '#a8123c', font: 'wide', style: 'cheat' },
  orvanta: { name: 'Orvanta', title: 'orvanta', reg: 'ZZ-ORV', body: '#f5f6f4', belly: '#0d4a57', accent: '#e8b23a', tail: '#0d4a57', engine: '#0d4a57', lipBand: '#e8b23a', sharklet: '#e8b23a', titleColor: '#0d4a57', font: 'round', style: 'sweep' },
  house: { name: 'Skyward demonstrator', title: 'SKYWARD', reg: 'ZZ-NEO', body: '#f2f3f4', belly: '#9aa2a9', accent: '#2d6fd0', tail: '#f2f3f4', engine: '#f2f3f4', lipBand: '#2d6fd0', sharklet: '#2d6fd0', titleColor: '#1c2b3d', font: 'wide', style: 'house', logoGlow: '#b8bcc0' },
};

// ---- fuselage station table ---------------------------------------------------------------------------------------------
//  d (from the nose)   y of the top   y of the belly   half-width   y of the widest point
const NOSE = [
  [0.00, -0.42, -0.42, 0.00, -0.42], [0.10, -0.15, -0.66, 0.30, -0.42], [0.32, 0.06, -0.86, 0.55, -0.41], [0.68, 0.24, -1.05, 0.80, -0.40],
  [1.10, 0.37, -1.21, 1.01, -0.38], [1.50, 0.46, -1.34, 1.18, -0.36], [2.00, 0.60, -1.49, 1.36, -0.33], [2.45, 1.00, -1.60, 1.51, -0.30],
  [2.85, 1.33, -1.69, 1.63, -0.27], [3.40, 1.58, -1.80, 1.76, -0.22], [4.20, 1.79, -1.93, 1.87, -0.15], [5.20, 1.93, -2.03, 1.94, -0.09],
  [6.50, 2.01, -2.09, 1.97, -0.06], [8.00, 2.03, -2.11, 1.975, -0.05],
];
//  z     top     belly   half-width  widest
const TAIL = [
  [10.00, 2.03, -2.11, 1.975, -0.05], [12.30, 2.02, -1.80, 1.88, 0.05], [14.00, 1.94, -1.40, 1.66, 0.22], [15.80, 1.83, -0.85, 1.33, 0.45],
  [17.60, 1.65, -0.20, 0.92, 0.65], [19.00, 1.37, 0.27, 0.52, 0.75], [19.70, 1.10, 0.50, 0.30, 0.78], [19.87, 1.02, 0.55, 0.26, 0.78],
];
// flight-deck glazing region (cut out of the loft and rebuilt with openings), extra rings for a smooth window outline
const NACZ = -5.0, NACL = 3.35, NACU0 = NACZ - 1.5, NACU1 = NACZ + NACL + 0.75;
const FD = { z0: -15.95, z1: -13.5, t0: 0.31, rings: [-15.75, -15.55, -15.4, -15.2, -15.0, -14.8, -14.6, -14.4, -14.2, -14.0, -13.8, -13.65] };

/** Sutherland–Hodgman: keep the part of a convex or concave polygon on the left (keepIn) or right of the line a→b, in 2D. */
function clipHalf(poly, a, b, keepIn) {
  const out = [], sg = keepIn ? 1 : -1, side = (p) => sg * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  for (let k = 0; k < poly.length; k++) {
    const P = poly[k], Q = poly[(k + 1) % poly.length], sp = side(P), sq = side(Q);
    if (sp >= 0) out.push(P);
    if ((sp >= 0) !== (sq >= 0)) { const f = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * f, P[1] + (Q[1] - P[1]) * f]); }
  }
  return out.filter((p, i) => { const q = out[(i + 1) % out.length]; return out.length < 2 || Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-9; });
}
const area2 = (w) => { let a = 0; for (let i = 0; i < w.length; i++) { const p = w[i], q = w[(i + 1) % w.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

export function createVisual(ctx, opts = {}) {
  const livery = LIVERIES.includes(opts.livery) ? opts.livery : 'meridia', SC = SCHEMES[livery];
  const { detail, atlas: atlasSize } = K.detailFor(ctx);
  const G = geometry, F = K.FINISH, lap = K.stopwatch();
  const rig = K.createRig(ctx, { geometry: G, name: 'a320', glassLayer: opts.glassLayer, cockpitRadius: 1.4 });

  // ---- atlases: A = fuselage + belly + gear + flight deck, B = wings, tail, nacelles ------------------------------------------
  // gloss airline paint: clear coat + orange peel from the gloss finish, frame / stringer oil-canning at the A320's 0.53 m frame pitch
  const A = K.createAtlas({ size: atlasSize, base: F.gloss(SC.body), skin: { weathering: SC.wx ?? 0.35, framePitch: 0.53, waviness: 1.15 } });
  const cFus = A.chart('fus', { type: 'unwrap', z: [G.noseZ - 0.05, G.tailZ + 0.03], girth: 12.8, vScale: 0.78, strips: 2 });
  const cFair = A.chart('fair', { type: 'unwrap', z: [-6.75, 8.65], girth: 7.6, vScale: 0.8, density: 0.72 });
  const cPanel = A.chart('panel', { type: 'rect', w: 2.0, h: 0.55, density: 2.2 });
  const cOver = A.chart('overhead', { type: 'rect', w: 0.7, h: 0.8, density: 1.6 });
  const cPed = A.chart('pedestal', { type: 'rect', w: 0.36, h: 0.9, density: 1.6 });
  A.pack();
  const UA = {
    body: A.swatch('body', F.gloss(SC.body)), fair: A.swatch('fair', F.gloss(SC.style === 'sweep' ? SC.belly : SC.belly)), dark: A.swatch('dark', F.darkGrey), black: A.swatch('black', F.black),
    well: A.swatch('well', { color: '#7a7f78', rough: 0.7, metal: 0 }), liner: A.swatch('liner', { color: '#8c949b', rough: 0.85, metal: 0 }), post: A.swatch('post', { color: '#5f6870', rough: 0.75, metal: 0 }), fcu: A.swatch('fcu', { color: '#3c4147', rough: 0.6, metal: 0 }),
    floor: A.swatch('floor', { color: '#34383d', rough: 0.9, metal: 0 }), shield: A.swatch('shield', { color: '#2c3137', rough: 0.85, metal: 0 }), console: A.swatch('console', { color: '#566069', rough: 0.75, metal: 0 }),
    seat: A.swatch('seat', { color: '#4c5157', rough: 0.9, metal: 0 }), cushion: A.swatch('cushion', { color: '#3b4a63', rough: 1, metal: 0 }), stick: A.swatch('stick', { color: '#17181a', rough: 0.5, metal: 0 }),
    exhaust: A.swatch('exhaust', F.exhaust), steel: A.swatch('steel', F.steel), antenna: A.swatch('antenna', F.gloss('#e9eaea')), lens: A.swatch('lens', F.lens),
    frame: A.swatch('frame', { color: '#2a2d31', rough: 0.55, metal: 0.2 }),
  };
  const B = K.createAtlas({ size: atlasSize, base: F.semigloss('#bcc1c6'), skin: { weathering: (SC.wx ?? 0.35) + 0.15, framePitch: 0.5, waviness: 0.8 } });
  const cWT = B.chart('wingTop', { type: 'plan', x: [0.9, 17.0], z: [-4.3, 5.2], view: 'top', mirror: true, density: 1.15 });
  const cWB = B.chart('wingBot', { type: 'plan', x: [0.9, 17.0], z: [-4.3, 5.2], view: 'bottom', mirror: true, density: 0.82 });
  const cSh = B.chart('sharklet', { type: 'side', z: [3.5, 6.6], y: [0.45, 3.25], view: 'right', density: 1.3 });
  const cSt = B.chart('stab', { type: 'plan', x: [0.2, 6.6], z: [14.0, 19.8], view: 'top', mirror: true, density: 0.95 });
  const cFin = { L: B.chart('finL', { type: 'side', z: [8.2, 18.9], y: [1.8, 8.7], view: 'left' }), R: B.chart('finR', { type: 'side', z: [8.2, 18.9], y: [1.8, 8.7], view: 'right' }) };
  // both nacelles share one chart: u runs from deep in the inlet (NACU0) round the lip and aft to the reverser exit and back
  // inside it (NACU1); t = 0 bottom, 0.25 outboard, 0.5 top, 0.75 inboard
  const cNac = B.chart('nac', { type: 'unwrap', z: [NACU0, NACU1], girth: 7.5, vScale: 0.85, density: 0.95 });
  B.pack();
  const UB = {
    grey: B.swatch('grey', F.semigloss('#bcc1c6')), engine: B.swatch('engine', F.gloss(SC.engine)), lip: B.swatch('lip', F.polished), band: B.swatch('band', F.gloss(SC.lipBand)),
    duct: B.swatch('duct', { color: '#26282b', rough: 0.55, metal: 0.3 }), acoustic: B.swatch('acoustic', { color: '#7f8386', rough: 0.6, metal: 0.55 }), core: B.swatch('core', F.titanium),
    plug: B.swatch('plug', F.heatStained), blade: B.swatch('blade', { color: '#3b3e44', rough: 0.3, metal: 0.9 }), spinner: B.swatch('spinner', { color: '#1d1f22', rough: 0.35, metal: 0.4 }),
    swirl: B.swatch('swirl', { color: '#f2f2f0', rough: 0.3, metal: 0 }), inner: B.swatch('inner', F.primer), pylon: B.swatch('pylon', F.gloss(SC.style === 'sweep' ? SC.engine : '#e9ebec')),
    tail: B.swatch('tail', F.gloss(SC.tail)), cascade: B.swatch('cascade', { color: '#3a3c3f', rough: 0.6, metal: 0.7 }), wick: B.swatch('wick', F.black), canoe: B.swatch('canoe', F.semigloss('#c3c7cb')),
    sharklet: B.swatch('sharkletEdge', F.gloss(SC.sharklet)), heat: B.swatch('heat', { color: '#8e8a84', rough: 0.4, metal: 0.85 }),
  };

  // ---- fuselage ---------------------------------------------------------------------------------------------------------------
  const st = (z, top, bot, w, yc, extra) => ({ z, y: yc, w, top: Math.max(0, top - yc), bot: Math.max(0, yc - bot), ...extra });
  const FS = [
    ...NOSE.map(([d, top, bot, w, yc]) => st(G.noseZ + d, top, bot, w, yc, {})),
    ...TAIL.map(([z, top, bot, w, yc]) => st(z, top, bot, w, yc, z > 15 ? { kBot: 0.6 } : {})),
  ];
  const fseg = Math.max(32, Math.round(96 * detail / 4) * 4);
  const fus = K.loft({
    stations: FS, segments: fseg, step: 1.3 / detail, chart: cFus, capEnd: 'flat', capUV: UA.exhaust,
    cutouts: [{ name: 'ngf', z: [-13.85, -12.15], t: [0, 0.03], mirror: true }, { name: 'nga', z: [-12.1, -11.2], t: [0, 0.03], mirror: true },
      // the skin around the flight-deck windows is rebuilt below with real openings; the empty cut-outs only add rings there
      { name: 'fd', z: [FD.z0, FD.z1], t: [FD.t0, 0.5], mirror: true }, ...FD.rings.map((z, i) => ({ name: 'fdr' + i, z: [z, z + 0.001], t: [0, 0], keep: true }))],
  });
  cFus.body = fus;
  const stA = new K.Mesh(), stB = new K.Mesh();
  stA.add(fus.mesh);
  stA.add(K.well(K.merge(fus.patches.ngfR, fus.patches.ngfL, fus.patches.ngaR, fus.patches.ngaL), 0.95, UA.well, [0, 1, 0]));
  // APU exhaust pipe in the tail cone
  stA.add(K.lathe([[0.13, G.tailZ - 0.25], [0.15, G.tailZ + 0.06, 1], [0.12, G.tailZ + 0.06, 1], [0.1, G.tailZ - 0.3]], { segments: 16, uv: UA.exhaust }).translate(0, 0.78, 0));
  // ring parameter on the upper half (right side) at half-width x
  const tAtX = (z, x) => { let lo = 0.25, hi = 0.5; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (fus.at(z, m).p[0] > x) lo = m; else hi = m; } return (lo + hi) / 2; };

  // wing-to-body ("belly") fairing with the main-wheel wells cut into its flat bottom
  const fairStations = [[-6.7, 1.0, 0.25, 0.45], [-5.5, 1.8, 0.55, 0.95], [-3.9, 2.18, 0.75, 1.2], [-1.0, 2.32, 0.8, 1.24], [2.4, 2.5, 0.8, 1.24], [4.2, 2.24, 0.72, 1.2], [6.0, 1.8, 0.52, 1.08], [7.6, 1.15, 0.3, 0.62], [8.6, 0.6, 0.15, 0.3]]
    .map(r => ({ z: r[0], y: -0.95, w: r[1], top: r[2], bot: r[3], kTop: 0.66, kBot: [0.94, 0.5523] }));
  const fairOpts = { stations: fairStations, segments: Math.max(28, Math.round(44 * detail / 4) * 4), step: 0.7, chart: cFair };
  let fair = K.loft(fairOpts);
  const fAtX = (x) => { let lo = 0, hi = 0.25; for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fair.at(1.14, m).p[0] < x) lo = m; else hi = m; } return (lo + hi) / 2; };
  fair = K.loft({ ...fairOpts, cutouts: [{ name: 'bay', z: [0.44, 1.84], t: [fAtX(0.85), fAtX(2.38)], mirror: true }] });
  cFair.body = fair;
  stA.add(fair.mesh).add(K.well(fair.patches.bayR, 1.1, UA.well, [-0.33, 0.94, 0])).add(K.well(fair.patches.bayL, 1.1, UA.well, [0.33, 0.94, 0]));

  // ---- flight deck: six painted windows, lined inside so the pilot looks out through the gaps -------------------------------
  // windows on the right side in (z, t); the left side is the mirror (t → 1 − t)
  const zy = (z, y) => [z, fus.tAtY(z, y)];
  const WS = { IB: [-15.66, tAtX(-15.66, 0.07)], OB: zy(-15.36, 0.5), OT: zy(-14.88, 1.17), IT: [-14.98, tAtX(-14.98, 0.07)] };
  const S1 = { bf: zy(-15.27, 0.5), br: zy(-14.42, 0.53), tr: zy(-14.42, 1.21), tf: zy(-14.79, 1.18) };
  const S2 = { bf: zy(-14.32, 0.53), br: zy(-13.84, 0.56), rt: zy(-13.84, 0.98), nt: zy(-14.04, 1.2), tf: zy(-14.32, 1.22) };
  const WIN = [[WS.IB, WS.OB, WS.OT, WS.IT], [S1.bf, S1.br, S1.tr, S1.tf], [S2.bf, S2.br, S2.rt, S2.nt, S2.tf]];
  const FLOOR = -0.35, zb = -13.2;
  // Outer skin of the window band: every loft cell of the cut-out is clipped against the (convex) window outlines in
  // (z, t), the remainder becomes skin with the fuselage chart's UVs, the inside becomes glass. Both use the cell's own
  // bilinear map, so skin, glass and the surrounding loft share their edges exactly (no cracks).
  const fdGlass = new K.Mesh(), fdReveal = new K.Mesh();
  {
    const KS = fseg, ja = Math.round(FD.t0 * KS), jb = KS / 2;
    const wins = WIN.map(w => (area2(w) < 0 ? w.slice().reverse() : w));
    for (const s of [1, -1]) {
      const patch = fus.patches[s > 0 ? 'fdR' : 'fdL'];
      const zs = [...new Set(Array.from({ length: patch.vertexCount }, (_, i) => Math.round(patch.p[i * 3 + 2] * 1e5) / 1e5))].sort((a, b) => a - b);
      const tA = (j) => (s > 0 ? j / KS : 1 - j / KS);
      const C = zs.map(z => { const row = []; for (let j = ja; j <= jb; j++) { const q = fus.at(z, tA(j)); row.push({ p: q.p, n: q.n, uv: cFus.uvUnwrap(z, tA(j), 0) }); } return row; });
      const cellOf = (z, t) => { let i = 0; while (i < zs.length - 2 && z > zs[i + 1]) i++; const j = Math.max(0, Math.min(jb - ja - 1, Math.floor(t * KS + 1e-9) - ja)); return [i, j]; };
      const S = (z, t, cell) => {
        const [i, j] = cell || cellOf(z, t), u = (z - zs[i]) / (zs[i + 1] - zs[i]), v = t * KS - (j + ja);
        const a = C[i][j], b = C[i][j + 1], c = C[i + 1][j], d = C[i + 1][j + 1];
        const L = (k, f) => (a[k][f] * (1 - u) + c[k][f] * u) * (1 - v) + (b[k][f] * (1 - u) + d[k][f] * u) * v;
        const n = [L('n', 0), L('n', 1), L('n', 2)], nl = Math.hypot(n[0], n[1], n[2]) || 1;
        return { p: [L('p', 0), L('p', 1), L('p', 2)], n: [n[0] / nl, n[1] / nl, n[2] / nl], uv: [L('uv', 0), L('uv', 1)] };
      };
      const emit = (mesh, poly, cell, off, uv) => {
        if (poly.length < 3 || Math.abs(area2(poly)) < 1e-10) return;
        const pts = poly.map(([z, t]) => { const q = S(z, t, cell); if (off) q.p = [q.p[0] - q.n[0] * off, q.p[1] - q.n[1] * off, q.p[2] - q.n[2] * off]; return q; });
        let nx = 0, ny = 0, nz = 0, ax = 0, ay = 0, az = 0;
        for (let k = 0; k < pts.length; k++) { const p = pts[k].p, q = pts[(k + 1) % pts.length].p; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); ax += pts[k].n[0]; ay += pts[k].n[1]; az += pts[k].n[2]; }
        const flip = nx * ax + ny * ay + nz * az < 0, base = mesh.vertexCount;
        for (const q of pts) mesh.vert(q.p[0], q.p[1], q.p[2], q.n[0], q.n[1], q.n[2], uv ? uv[0] : q.uv[0], uv ? uv[1] : q.uv[1]);
        for (let k = 1; k < pts.length - 1; k++) if (flip) mesh.tri(base, base + k + 1, base + k); else mesh.tri(base, base + k, base + k + 1);
      };
      for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < jb - ja; j++) {
        const t0 = (j + ja) / KS, t1 = (j + ja + 1) / KS, cell = [i, j];
        let polys = [[[zs[i], t0], [zs[i + 1], t0], [zs[i + 1], t1], [zs[i], t1]]];
        for (const w of wins) {
          const next = [];
          for (let poly of polys) {
            for (let k = 0; k < w.length && poly.length >= 3; k++) {
              const a = w[k], b = w[(k + 1) % w.length];
              const out = clipHalf(poly, a, b, false); if (out.length >= 3) next.push(out);
              poly = clipHalf(poly, a, b, true);
            }
            if (poly.length >= 3) emit(fdGlass, poly, cell, 0.018, UA.black);
          }
          polys = next;
        }
        for (const poly of polys) emit(stA, poly, cell, 0);
      }
      // window reveals: the skin's thickness and the frame, from the opening edge to the lining
      for (const w of wins) for (let k = 0; k < w.length; k++) {
        const a = w[k], b = w[(k + 1) % w.length], N = 5;
        for (let m = 0; m < N; m++) {
          const P = (f, d) => { const z = a[0] + (b[0] - a[0]) * f, t = a[1] + (b[1] - a[1]) * f, q = S(z, t); return [q.p[0] - q.n[0] * d, q.p[1] - q.n[1] * d, q.p[2] - q.n[2] * d]; };
          const q = [P(m / N, 0.003), P((m + 1) / N, 0.003), P((m + 1) / N, 0.075), P(m / N, 0.075)];
          const e1 = q[1].map((v, i) => v - q[0][i]), e2 = q[3].map((v, i) => v - q[0][i]);
          let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(...n) || 1; n = n.map(v => v / l);
          for (const sg of [1, -1]) { const base = fdReveal.vertexCount; for (const p of q) fdReveal.vert(p[0], p[1], p[2], n[0] * sg, n[1] * sg, n[2] * sg, UA.frame[0], UA.frame[1]); if (sg > 0) fdReveal.quad(base, base + 1, base + 2, base + 3); else fdReveal.quad(base, base + 3, base + 2, base + 1); }
        }
      }
    }
    stA.add(fdReveal.occlude(0.35));
  }
  const cab = new K.Mesh();
  {
    const L = (c, uv, nu = 3, nv = 3) => cab.add(K.liner(fus, c, { uv, nu, nv, mirror: true, inset: 0.05 }));
    const lo = (z) => [z, fus.tAtY(z, FLOOR + 0.04)], hi = (z) => [z, 0.5];
    L([WS.IB, WS.OB, lo(WS.OB[0]), lo(WS.IB[0])], UA.liner, 2, 5);                     // below the windshield
    L([WS.IB, hi(WS.IB[0]), hi(WS.IT[0]), WS.IT], UA.post, 4, 1);                       // centre post
    L([hi(WS.IT[0]), WS.IT, WS.OT, hi(WS.OT[0])], UA.liner, 3, 2);                      // roof above the windshield
    L([WS.OB, S1.bf, S1.tf, WS.OT], UA.post, 1, 4);                                      // corner post
    L([WS.OT, S1.tf, hi(S1.tf[0]), hi(WS.OT[0])], UA.liner, 1, 3);
    L([lo(WS.OB[0]), lo(S1.bf[0]), S1.bf, WS.OB], UA.liner, 1, 3);
    L([lo(S1.bf[0]), lo(S1.br[0]), S1.br, S1.bf], UA.liner, 4, 3);                      // sills
    L([S1.tf, S1.tr, hi(S1.tr[0]), hi(S1.tf[0])], UA.liner, 3, 3);                      // headers
    L([S1.br, S2.bf, S2.tf, S1.tr], UA.post, 1, 4);                                      // post between the side windows
    L([lo(S1.br[0]), lo(S2.bf[0]), S2.bf, S1.br], UA.liner, 1, 3);
    L([S1.tr, S2.tf, hi(S2.tf[0]), hi(S1.tr[0])], UA.liner, 1, 3);
    L([lo(S2.bf[0]), lo(S2.br[0]), S2.br, S2.bf], UA.liner, 3, 3);
    L([S2.tf, S2.nt, hi(S2.nt[0]), hi(S2.tf[0])], UA.liner, 2, 3);
    L([S2.nt, S2.rt, hi(S2.br[0]), hi(S2.nt[0])], UA.liner, 2, 3);                     // the notched corner
    L([lo(S2.br[0]), lo(zb), hi(zb), hi(S2.br[0])], UA.liner, 3, 6);                   // aft side wall
    const fy = FLOOR;
    cab.add(K.deck(fus, WS.IB[0] - 0.02, zb, fy, { uv: UA.floor, n: 8 }));
    cab.add(K.bulkhead(fus, zb, { uv: UA.liner, facing: -1 }));                                  // flight-deck door wall
    cab.add(K.bulkhead(fus, WS.IB[0] - 0.02, { uv: UA.shield, facing: 1 }));                     // forward bulkhead
    // glareshield (FCU face painted on the panel chart), main panel with six displays, pedestal, side consoles, overhead
    { const gs = K.prism([[-15.47, 0.545], [-15.16, 0.6], [-15.11, 0.575], [-15.13, 0.5], [-15.47, 0.5]], -0.98, 0.98, UA.shield); for (let i = 0; i < gs.p.length; i += 3) gs.p[i] *= 0.68 + 0.32 * (gs.p[i + 2] + 15.47) / 0.36; cab.add(gs); }
    cab.add(K.box(0.98, 0.065, 0.05, UA.fcu).translate(0, 0.545, -15.105));                                           // FCU
    for (const sx of [-1, 1]) cab.add(K.box(0.3, 0.055, 0.04, UA.fcu).translate(sx * 0.66, 0.55, -15.11));             // EFIS control panels
    { const i0 = cab.vertexCount; for (const [a, b] of [[0, 0.55], [2.0, 0.55], [2.0, 0], [0, 0]]) { const uv = cPanel.uv(a, b); cab.vert(a - 1.0, -0.08 + (0.55 - b), -15.22 + (0.55 - b) * 0.1, 0, 0.18, 1, uv[0], uv[1]); } cab.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    cab.add(K.box(2.0, 0.6, 0.12, UA.shield).translate(0, 0.17, -15.34));                                         // panel body behind the displays
    { // pedestal: sloping top quad mapped to its chart + body
      cab.add(K.box(0.36, 0.42, 0.95, UA.console).translate(0, fy + 0.2, -14.75));
      const i0 = cab.vertexCount; for (const [a, b] of [[0, 0], [0.36, 0], [0.36, 0.9], [0, 0.9]]) { const uv = cPed.uv(a, b); cab.vert(a - 0.18, fy + 0.415 + (0.9 - b) * 0.12, -15.22 + b * 0.95 * 0.99, 0, 1, 0.1, uv[0], uv[1]); } cab.quad(i0, i0 + 3, i0 + 2, i0 + 1);
      for (const sx of [-1, 1]) cab.add(K.box(0.035, 0.11, 0.05, UA.stick).rotateX(-0.35).translate(sx * 0.05, fy + 0.58, -14.86));   // thrust levers
    }
    { const i0 = cab.vertexCount, y = 1.3; for (const [a, b] of [[0, 0], [0.7, 0], [0.7, 0.8], [0, 0.8]]) { const uv = cOver.uv(a, b); cab.vert(a - 0.35, y + b * 0.18, -14.95 + b, 0, -1, -0.2, uv[0], uv[1]); } cab.quad(i0, i0 + 1, i0 + 2, i0 + 3); }
    const eye = G.pilotEye;
    for (const sx of [-1, 1]) {
      const e = [sx * Math.abs(eye[0]), eye[1], eye[2]];
      cab.add(K.crewSeat({ eye: e, uv: { frame: UA.seat, cushion: UA.cushion } }));
      cab.add(K.box(0.26, 0.36, 1.05, UA.console).translate(sx * 1.0, fy + 0.18, -14.75));                            // side console
      cab.add(K.box(0.2, 0.05, 0.5, UA.shield).translate(sx * 0.98, fy + 0.385, -14.85));                              // sidestick armrest pad
      cab.add(K.stick({ base: [sx * 0.98, fy + 0.41, -14.98], height: 0.17, uv: UA.stick }));                          // sidestick
      cab.add(K.box(0.18, 0.025, 0.28, UA.shield).translate(sx * 0.42, fy + 0.04, -15.12));                            // rudder pedals
    }
  }
  stA.add(cab.occlude((x, y, z) => Math.min(0.6, 0.25 + 0.25 * Math.max(0, z + 15.2))));

  // ---- wings ----------------------------------------------------------------------------------------------------------------
  const XR = 1.98, XK = 6.4, XT = 16.9;
  const zLE = (x) => -3.7 + 0.5 * (x - XR), zTE = (x) => (x < XK ? 2.6 + 0.0227 * (x - XR) : 2.7 + 0.219 * (x - XK)), wy = (x) => -0.75 + 0.096 * (x - XR);
  const wst = (x, tc, twist) => ({ x, y: wy(x), z: zLE(x), chord: zTE(x) - zLE(x), tc, twist });
  const sc = K.supercritical();
  const SPOILERS = [[2.5, 5.3], [6.15, 8.05], [8.1, 10.0], [10.05, 11.95], [12.0, 13.9]];
  const wingOf = (side) => K.wing({
    side, airfoil: sc, chordPts: Math.round(14 * Math.min(1, detail)), spanAxis: 'x', tip: 'none',
    stations: [wst(1.0, 0.15, 2.5), wst(XR, 0.145, 2.3), wst(XK, 0.12, 1.0), wst(11.6, 0.11, -0.6), wst(XT, 0.10, -2.2)],
    lines: { slat: [[1.0, 0.1], [XK, 0.12], [XT, 0.14]], spoil: [[1.0, 0.6], [XK, 0.585], [XT, 0.6]], flap: [[1.0, 0.765], [XK, 0.745], [XT, 0.76]] },
    controls: [
      { name: 'flapIn', type: 'flap', span: [2.2, 5.45], from: 'flap', nose: 1 },
      { name: 'flapOut', type: 'flap', span: [6.05, 14.1], from: 'flap', nose: 1 },
      { name: 'aileron', type: 'flap', span: [14.3, 16.6], from: 'flap', nose: 1 },
      { name: 'slatIn', type: 'flap', span: [2.4, 5.1], to: 'slat', tail: 0.4, cove: true },
      { name: 'slatOut', type: 'flap', span: [6.4, 16.5], to: 'slat', tail: 0.4, cove: true },
      ...SPOILERS.map((s, i) => ({ name: 'sp' + (i + 1), type: 'panel', surface: 'upper', span: s, from: 'spoil', to: 'flap', hinge: 'front' })),
    ],
    charts: { upper: cWT, lower: cWB }, innerUV: UB.inner, edgeUV: UB.grey,
  });
  const W = { R: wingOf(1), L: wingOf(-1) };
  stB.add(W.R.mesh).add(W.L.mesh);
  // sharklets: a tight upward curve into a tall, swept, slightly canted blade
  const tipSt = wst(XT, 0.10, -2.2);
  const shSt = [tipSt, ...K.blendedWinglet(tipSt, { height: 2.38, cant: 9, radius: 0.62, sweep: 40, tipChord: 0.34, tc: 0.08, n: 6, dihedral: 5.5, taperPow: 0.9 })];
  for (const side of [1, -1]) stB.add(K.wing({ side, airfoil: sc, chordPts: 8, spanAxis: 'u', tip: 'round', tipLength: 0.5, charts: { upper: cSh, lower: cSh }, edgeUV: UB.sharklet, stations: shSt }).mesh);
  const shTip = shSt[shSt.length - 1];
  // flap-track fairings ("canoes"): front half fixed to the wing, rear half rides on the flap
  const canoeAt = (x, len, side) => {
    const zf = W.R.at(x, 0.75, 'lower'), z0 = zf[2] - len * 0.42, y = zf[1] - 0.05;
    const s = [[0, 0.01, 0.01], [0.12, 0.11, 0.14], [0.35, 0.17, 0.27], [0.6, 0.17, 0.28], [0.85, 0.11, 0.19], [1, 0.01, 0.02]].map(r => ({ z: z0 + r[0] * len, x: side * x, y: y - r[2] * 0.5 + (r[0] > 0.6 ? (r[0] - 0.6) * 0.3 : 0), w: r[1], top: r[2] * 0.6, bot: r[2] }));
    const split = zf[2] + 0.12;
    return { front: K.loft({ stations: s, segments: 12, step: 0.3, uv: UB.canoe, zRange: [z0, split] }).mesh, rear: K.loft({ stations: s, segments: 12, step: 0.3, uv: UB.canoe, zRange: [split, z0 + len], capStart: 'flat' }).mesh };
  };

  // ---- tail -------------------------------------------------------------------------------------------------------------------
  const sy = (x) => 0.58 + x * Math.tan(6 * DEG);
  const stabOf = (side) => K.wing({
    side, airfoil: K.naca4('0011'), chordPts: Math.round(10 * Math.min(1, detail)), spanAxis: 'x', tip: 'round', tipLength: 0.5,
    stations: [{ x: 0.3, y: sy(0.3), z: 14.2, chord: 4.2, tc: 0.11 }, { x: 6.22, y: sy(6.22), z: 14.2 + 5.92 * Math.tan(34 * DEG), chord: 1.25, tc: 0.09 }],
    lines: { hinge: [[0.3, 0.7], [6.22, 0.7]] },
    controls: [{ name: 'elevator', type: 'flap', span: [1.35, 6.05], from: 'hinge', nose: 1 }],
    charts: { upper: cSt, lower: cSt }, edgeUV: UB.grey,
  });
  const stab = { R: stabOf(1), L: stabOf(-1) };
  stB.add(stab.R.mesh).add(stab.L.mesh);
  const finLE = (y) => 10.8 + Math.tan(40 * DEG) * (y - 2.0);
  const fin = K.wing({
    airfoil: K.naca4('0010'), chordPts: Math.round(12 * Math.min(1, detail)), spanAxis: 'y', tip: 'round', tipLength: 0.35,
    stations: [{ x: 0, y: 1.4, z: finLE(1.4), chord: 7.62, tc: 0.105 }, { x: 0, y: 8.5, z: finLE(8.5), chord: 2.2, tc: 0.09 }],
    lines: { hinge: [[1.4, 0.71], [8.5, 0.69]] },
    controls: [{ name: 'rudder', type: 'flap', span: [2.15, 8.35], from: 'hinge', nose: 1 }],
    charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,
  });
  stB.add(fin.mesh);
  stB.add(K.wing({ airfoil: K.naca4('0008'), chordPts: 6, spanAxis: 'y', tip: 'flat', charts: { upper: cFin.L, lower: cFin.R }, edgeUV: UB.tail,       // dorsal fillet
    stations: [{ x: 0, y: 1.9, z: 8.3, chord: 4.2, tc: 0.03 }, { x: 0, y: 2.85, z: finLE(2.85) - 0.12, chord: 1.6, tc: 0.07 }] }).mesh);

  // ---- engines ----------------------------------------------------------------------------------------------------------------
  const eng = [];
  const NAC = { len: NACL, rHi: 1.0, rMax: 1.19, rThroat: 0.965, rFan: 0.985, zFan: 0.78, rExit: 0.9, sleeve: 0.5 };
  // core cowl: light painted cowl, then the heat-stained core nozzle (gradient strip along the lathe)
  const coreStrip = B.strip('coreStrip', 8, (g, layer) => {
    const orm = B.ormStyle;
    if (layer === 'color') { const gr = g.createLinearGradient(0, 0, 1, 0); gr.addColorStop(0, '#b9bcbe'); gr.addColorStop(0.55, '#a9acae'); gr.addColorStop(0.62, '#77746f'); gr.addColorStop(0.8, '#5f5850'); gr.addColorStop(0.92, '#4b4038'); gr.addColorStop(1, '#2b2724'); g.fillStyle = gr; g.fillRect(0, 0, 1, 1); g.fillStyle = 'rgba(30,30,32,0.6)'; g.fillRect(0.58, 0, 0.01, 1); g.fillRect(0.3, 0, 0.006, 1); }
    else if (layer === 'orm') { g.fillStyle = orm(0.35, 0.55); g.fillRect(0, 0, 0.58, 1); g.fillStyle = orm(0.42, 0.9); g.fillRect(0.58, 0, 0.42, 1); }
    else { g.fillStyle = '#404040'; g.fillRect(0.58, 0, 0.01, 1); g.fillRect(0.3, 0, 0.006, 1); }
  });
  const plugStrip = B.strip('plugStrip', 4, (g, layer) => {
    if (layer === 'color') { const gr = g.createLinearGradient(0, 0, 1, 0); gr.addColorStop(0, '#3b342f'); gr.addColorStop(0.25, '#6d6153'); gr.addColorStop(0.6, '#8a8178'); gr.addColorStop(1, '#a29d97'); g.fillStyle = gr; g.fillRect(0, 0, 1, 1); }
    else if (layer === 'orm') { g.fillStyle = B.ormStyle(0.45, 0.85); g.fillRect(0, 0, 1, 1); }
  });
  const byZ = (m, z0, z1, strip) => { if (!strip) return m; for (let v = 0; v < m.vertexCount; v++) { const uv = strip.uv((m.p[v * 3 + 2] - z0) / (z1 - z0)); m.uv[v * 2] = uv[0]; m.uv[v * 2 + 1] = uv[1]; } return m; };
  // re-map the cowl / sleeve onto the shared nacelle chart (see cNac), splitting triangles that straddle the t = 0 seam
  const nacMap = (m, c, sx, sleeve) => {
    const cz = c[2], tv = [], uOf = [];
    for (let v = 0; v < m.vertexCount; v++) {
      const dx = m.p[v * 3] - c[0], dy = m.p[v * 3 + 1] - c[1], z = m.p[v * 3 + 2], r = Math.hypot(dx, dy) || 1;
      const nr = (m.n[v * 3] * dx + m.n[v * 3 + 1] * dy) / r;
      let u;
      if (sleeve) u = nr > 0 ? z : 2 * (cz + NACL) - z;
      else u = r >= NAC.rHi - 0.001 && (nr > 0 || z - cz < 0.02) ? z + Math.min(0.05, r - NAC.rHi) : cz - (z - cz) - Math.max(0, NAC.rHi - r);
      let t = Math.atan2(sx * dx, -dy) / (Math.PI * 2); if (t < 0) t += 1;
      tv.push(t); uOf.push(Math.min(NACU1 - 0.002, Math.max(NACU0 + 0.002, u)));
    }
    const setUV = (v, t) => { const uv = cNac.uvUnwrap(uOf[v], t, 0); m.uv[v * 2] = uv[0]; m.uv[v * 2 + 1] = uv[1]; };
    for (let v = 0; v < tv.length; v++) setUV(v, tv[v]);
    const dup = new Map();
    for (let i = 0; i < m.idx.length; i += 3) {
      const ids = [m.idx[i], m.idx[i + 1], m.idx[i + 2]], ts = ids.map(v => tv[v]);
      if (Math.max(...ts) - Math.min(...ts) < 0.5) continue;
      for (let k = 0; k < 3; k++) if (ts[k] < 0.5) {
        const v = ids[k]; let d = dup.get(v);
        if (d === undefined) { d = m.vert(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2], m.n[v * 3], m.n[v * 3 + 1], m.n[v * 3 + 2], 0, 0); uOf[d] = uOf[v]; setUV(d, 0.9999); if (m.occ) m.occ[d] = m.occ[v]; dup.set(v, d); }
        m.idx[i + k] = d;
      }
    }
    return m;
  };
  for (const [i, sx] of [[0, -1], [1, 1]]) {
    const c = [sx * 5.75, -1.5, NACZ];
    const n = K.nacelle({ centre: c, length: NAC.len, rHi: NAC.rHi, rMax: NAC.rMax, rThroat: NAC.rThroat, rFan: NAC.rFan, zFan: NAC.zFan, rExit: NAC.rExit, flat: 0, droop: 0, sleeve: NAC.sleeve,
      core: { r0: 0.66, r1: 0.43, length: 1.2 }, plug: { r: 0.25, length: 0.62 }, segments: Math.max(32, Math.round(48 * detail / 4) * 4),
      uv: UB.engine, uvLip: UB.lip, uvInner: UB.acoustic, uvSleeve: UB.engine, uvCore: UB.core, uvPlug: UB.plug, uvCascade: UB.cascade });
    nacMap(n.cowl, c, sx, false); nacMap(n.sleeve, c, sx, true);
    const zx = c[2] + NAC.len;
    byZ(n.core, zx - 1.0, zx + 1.2, coreStrip); byZ(n.plug, zx + 0.55, zx + 1.2 + 0.62, plugStrip);
    stB.add(n.cowl).add(n.cascade).add(n.core).add(n.plug);
    stB.add(K.fanBackdrop(NAC.rFan, 0.42, UB.duct).translate(c[0], c[1], n.fanZ));
    // fan-case rub strip and the dark bypass duct: the fan sits deep in a liner, not in a bright tube
    stB.add(K.lathe([[NAC.rFan + 0.004, n.fanZ - c[2] - 0.12], [NAC.rFan + 0.004, n.fanZ - c[2] + 0.3]], { segments: 40, uv: UB.duct }).occlude(0.55).translate(c[0], c[1], c[2]));
    // pylon: deep strut over the nacelle, sloping aft fairing over the core, blended into the wing lower surface
    stB.add(K.pylon([{ y: -1.02, z0: -4.3, z1: -0.35, x: c[0], tc: 0.11 }, { y: -0.62, z0: -4.05, z1: 0.35, x: c[0], tc: 0.1 }, { y: -0.18, z0: -3.55, z1: 1.0, x: c[0], tc: 0.075 }], { uv: UB.pylon }));
    stB.add(K.plate([c[0] - sx * 0.98, c[1] + 0.55, c[2] + 0.75], [c[0] - sx * 0.98, c[1] + 0.55, c[2] + 1.6], [c[0] - sx * 1.24, c[1] + 0.7, c[2] + 1.65], [c[0] - sx * 1.21, c[1] + 0.68, c[2] + 0.95], 0.012, UB.engine));   // inboard nacelle strake
    const fanMesh = K.fan({ radius: NAC.rFan - 0.01, hub: 0.32, blades: 18, chord: 0.36, staggerRoot: 30, staggerTip: 60, sweep: 0.12, uvBlade: UB.blade, uvSpinner: UB.spinner });
    // white spiral on the spinner (ground crews see at a glance that the fan turns)
    { const sl = (NAC.rFan - 0.01) * 0.55, hub = 0.32, prof = [[0, -sl], [hub * 0.35, -sl * 0.82], [hub * 0.72, -sl * 0.42], [hub, 0.02]];
      const rAt = (z) => { for (let k = 0; k < prof.length - 1; k++) { const [r0, z0] = prof[k], [r1, z1] = prof[k + 1]; if (z <= z1) return r0 + (r1 - r0) * (z - z0) / (z1 - z0); } return hub; };
      const sw = new K.Mesh(), N = 14;
      for (let k = 0; k <= N; k++) {
        const f = 0.08 + 0.9 * k / N, z = -sl + (sl + 0.0) * f, r = rAt(z) + 0.004, ph = 1.1 * Math.PI * f, hw = (0.012 + 0.03 * f) / Math.max(0.05, r);
        for (const d of [-hw, hw]) sw.vert(r * Math.cos(ph + d), r * Math.sin(ph + d), z, Math.cos(ph), Math.sin(ph), -0.5, UB.swirl[0], UB.swirl[1]);
        if (k) { const b = sw.vertexCount - 4; sw.quad(b, b + 2, b + 3, b + 1); sw.quad(b, b + 1, b + 3, b + 2); }
      }
      fanMesh.add(sw); }
    eng.push({ c, n, fanMesh });
  }

  // ---- small details ----------------------------------------------------------------------------------------------------------
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(-8.5) - 0.02, -8.5], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.topAt(4.0) - 0.02, 4.0], height: 0.3, chord: 0.42, sweep: 0.2, uv: UA.antenna }));
  stA.add(K.ellipsoid(0.45, 0.12, 1.0, { segments: 12, rings: 6, uv: UA.antenna }).translate(0, fus.topAt(-4.5) - 0.02, -4.5));      // satcom / ADS-B fairing
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-9.6) + 0.02, -9.6], height: 0.25, chord: 0.38, sweep: 0.18, down: true, uv: UA.antenna }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(8.8) + 0.02, 8.8], height: 0.25, chord: 0.38, sweep: 0.18, down: true, uv: UA.antenna }));
  for (const sx of [-1, 1]) for (const [z, y] of [[-14.95, -0.2], [-14.55, -0.55], [-14.2, -0.05]]) {        // pitot / AoA probes
    const t = fus.tAtY(z, y), p = fus.at(z, sx > 0 ? t : 1 - t).p; stA.add(K.probe(p, [p[0] + sx * 0.12, p[1] - 0.01, p[2] - 0.17], 0.012, UA.steel));
  }
  // drain masts (forward and aft belly), TCAS / GPS / ATC antennas, ice detector, TAT probe
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(-9.4) + 0.02, -9.4], height: 0.16, chord: 0.13, sweep: 0.1, down: true, uv: UA.steel }));
  stA.add(K.bladeAntenna({ pos: [0, fus.botAt(8.0) + 0.02, 8.0], height: 0.16, chord: 0.13, sweep: 0.1, down: true, uv: UA.steel }));
  stA.add(K.ellipsoid(0.11, 0.035, 0.13, { segments: 10, rings: 4, uv: UA.antenna }).translate(0, fus.topAt(-11.2) - 0.005, -11.2));          // TCAS
  stA.add(K.ellipsoid(0.08, 0.03, 0.1, { segments: 10, rings: 4, uv: UA.antenna }).translate(0, fus.topAt(-1.0) - 0.005, -1.0));            // GPS
  stA.add(K.ellipsoid(0.1, 0.03, 0.12, { segments: 10, rings: 4, uv: UA.antenna }).translate(0, fus.botAt(-6.2) + 0.005, -6.2));            // ATC / radio altimeter
  stA.add(K.ellipsoid(0.1, 0.03, 0.12, { segments: 10, rings: 4, uv: UA.antenna }).translate(0, fus.botAt(-5.2) + 0.005, -5.2));
  for (const [sx, z, y, len] of [[-1, -13.6, 0.35, 0.07], [1, -13.95, -0.85, 0.09]]) { const t = fus.tAtY(z, y), p = fus.at(z, sx > 0 ? t : 1 - t).p; stA.add(K.probe(p, [p[0] + sx * len, p[1], p[2] - 0.03], 0.018, UA.steel)); }
  // windshield wipers, parked along the bottom of each windshield
  for (const s of [1, -1]) {
    const m = (q) => (s > 0 ? q : 1 - q), w = WIN[0], bz = (f) => w[0][0] + (w[1][0] - w[0][0]) * f, bt = (f) => w[0][1] + (w[1][1] - w[0][1]) * f;
    const at = (f, dy) => { const z = bz(f), q = fus.at(z, m(fus.tAtY(z, fus.at(z, bt(f)).p[1] + dy))); return [q.p[0] + q.n[0] * 0.03, q.p[1] + q.n[1] * 0.03, q.p[2] + q.n[2] * 0.03]; };
    const piv = at(0.82, -0.05), mid = at(0.5, 0.05), tip = at(0.1, 0.09);
    stA.add(K.tube(piv, mid, 0.011, 0.009, { segments: 5, uv: UA.black })).add(K.tube(mid, tip, 0.009, 0.008, { segments: 5, uv: UA.black }));
    stA.add(K.ellipsoid(0.03, 0.03, 0.03, { segments: 6, rings: 3, uv: UA.black }).translate(piv[0], piv[1], piv[2]));
  }
  { const wicks = []; for (const sx of [-1, 1]) { for (const x of [14.6, 15.6, 16.4]) { const p = W.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } for (const x of [3.6, 4.9, 5.9]) { const p = stab.R.at(x, 1, 'mid'); wicks.push([sx * p[0], p[1], p[2]]); } } for (const y of [6.8, 8.0]) { const p = fin.at(y, 1, 'mid'); wicks.push(p); } stB.add(K.staticWicks(wicks, 0.2, UB.wick)); }

  lap('geometry');
  // ---- paint + materials ------------------------------------------------------------------------------------------------------
  paintFuselage(A, { SC, fus, cFus, cFair, cPanel, cOver, cPed, WIN });
  paintSurfaces(B, { SC, W: W.R, fin, stab: stab.R, cWT, cWB, cSh, cSt, cFin, cNac, SPOILERS });
  lap('paint');
  const matA = A.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 }), matB = B.material(ctx, { envMapIntensity: 1, emissiveIntensity: 0 });
  lap('textures');
  rig.material('paint', matA, { shared: true }); rig.material('wing', matB, { shared: true });
  rig.disposables.push(A, B);
  rig.glass('fdglass', K.glassMaterial(ctx, { ...K.GLASS.airliner, opacity: 0.32, edgeOpacity: 0.88, reflect: 1, dust: 0.03 }));
  rig.addStatic(fdGlass, 'fdglass');

  // ---- moving surfaces --------------------------------------------------------------------------------------------------------
  const drop = (ctrl, d, aft = 0) => { const u = ctrl.up, h = ctrl.hinge, o = [-u[0] * d, -u[1] * d, -u[2] * d + aft]; return { a: [h.a[0] + o[0], h.a[1] + o[1], h.a[2] + o[2]], b: [h.b[0] + o[0], h.b[1] + o[1], h.b[2] + o[2]] }; };
  const hingeOn = (name, mesh, line, ref, toward, parent) => { const node = rig.part(name, mesh, { key: 'wing', pivot: line.a, parent }); return rig.hinge(node, line.a, line.b, { ref, toward }); };
  const DOWN = [0, -1, 0], UP = [0, 1, 0];
  const wingAnim = [];
  for (const [key, sx] of [['R', 1], ['L', -1]]) {
    const C = W[key].controls, a = {};
    for (const [nm, xs] of [['In', [4.1]], ['Out', [7.0, 9.6, 12.2]]]) {
      const main = C['flap' + nm], mesh = main.mesh.clone();
      for (const x of xs) { const cn = canoeAt(x, nm === 'In' ? 2.6 : 2.45 - (x - 7) * 0.08, sx); stB.add(cn.front); mesh.add(cn.rear); }
      a['flap' + nm] = hingeOn(`flap${nm}${key}`, mesh, drop(main, 0.95, -0.1), main.ref, DOWN);
    }
    a.aileron = rig.hingePart('aileron' + key, C.aileron, { key: 'wing' }).set;
    a.slatIn = hingeOn('slatIn' + key, C.slatIn.mesh, drop(C.slatIn, 0.4, 0.15), C.slatIn.ref, DOWN);
    a.slatOut = hingeOn('slatOut' + key, C.slatOut.mesh, drop(C.slatOut, 0.34, 0.12), C.slatOut.ref, DOWN);
    // spoilers: 1 (ground only), 2–4 (roll, speedbrake, ground), 5 (roll, ground); each group moves as one part
    const grp = (name, ids) => { const m = new K.Mesh(); for (const i of ids) m.add(C['sp' + i].mesh); const c0 = C['sp' + ids[0]], c1 = C['sp' + ids[ids.length - 1]]; return hingeOn(name + key, m, { a: c0.hinge.a, b: c1.hinge.b }, c0.ref, UP); };
    a.sp1 = grp('spoiler1', [1]); a.sp24 = grp('spoiler2to4', [2, 3, 4]); a.sp5 = grp('spoiler5', [5]);
    a.elev = rig.hingePart('elevator' + key, stab[key].controls.elevator, { key: 'wing' }).set;
    a.key = key; wingAnim.push(a);
  }
  const rud = rig.hingePart('rudder', fin.controls.rudder, { key: 'wing', toward: [1, 0, 0] });
  const fans = [], sleeves = [];
  eng.forEach((e, i) => {
    fans.push(rig.part('fan' + i, e.fanMesh.translate(e.c[0], e.c[1], e.n.fanZ), { key: 'wing', pivot: [e.c[0], e.c[1], e.n.fanZ] }));
    sleeves.push({ node: rig.part('reverser' + i, e.n.sleeve, { key: 'wing', pivot: e.c }), travel: e.n.sleeveTravel });
  });
  rig.addStatic(stA, 'paint'); rig.addStatic(stB, 'wing');

  // ---- landing gear -----------------------------------------------------------------------------------------------------------
  const gp = G.gear, gearUV = { strut: A.swatch('gear.strut', F.gearWhite), hub: A.swatch('gear.hub', { color: '#aeb2b4', rough: 0.38, metal: 0.55 }) };
  const doorOf = (patch, edge) => ({ mesh: K.thicken(patch, 0.025, UA.well), hinge: { a: edge[0], b: edge[1] }, ref: K.centroid(patch) });
  // light bar on the nose strut: taxi and take-off lights in the middle, runway turn-off lights either side
  const noseExtra = new K.Mesh();
  noseExtra.add(K.box(0.34, 0.05, 0.05, gearUV.strut).translate(0, -1.8, -11.63));
  for (const [x, y, r] of [[0, -1.86, 0.05], [0, -1.74, 0.045], [-0.13, -1.8, 0.04], [0.13, -1.8, 0.04]]) noseExtra.add(K.lathe([[r, 0.0], [r, -0.06, 1], [0, -0.06]], { segments: 10, uv: UA.dark }).translate(x, y, -11.62));
  noseExtra.add(K.pipe([[0.06, -1.1, -11.5], [0.07, -1.5, -11.52], [0.05, -1.78, -11.6]], 0.008, { uv: UA.black, segments: 5 }));
  K.buildGear(rig, A, {
    name: 'nose', index: 0, contact: gp[0].pos, wheels: [-0.25, 0.25], wheelRadius: gp[0].wheelRadius, wheelWidth: 0.22, pivot: [0, -1.05, -11.55], stroke: 0.32, staticFrac: 0.4,
    strutR: 0.075, steer: true, links: 'front', retract: { to: [0, -1.45, -13.3] }, window: [0.2, 0.88], brace: [0, -1.05, -12.45], uv: gearUV,
    doors: [
      { name: 'noseDoorFR', ...doorOf(fus.patches.ngfR, fus.edges.ngfR.tHi), open: 85, closes: true }, { name: 'noseDoorFL', ...doorOf(fus.patches.ngfL, fus.edges.ngfL.tLo), open: 85, closes: true },
      { name: 'noseDoorAR', ...doorOf(fus.patches.ngaR, fus.edges.ngaR.tHi), open: 80 }, { name: 'noseDoorAL', ...doorOf(fus.patches.ngaL, fus.edges.ngaL.tLo), open: 80 },
    ],
    extra: noseExtra,
    lamps: [{ kind: 'taxi', pos: [0, -1.86, -11.69], size: 0.055, color: [1, 0.96, 0.9] }, { kind: 'landing', pos: [0, -1.74, -11.69], size: 0.05, color: [1, 0.97, 0.92] },
      { kind: 'taxi', pos: [-0.13, -1.8, -11.67], size: 0.04, color: [1, 0.97, 0.92] }, { kind: 'taxi', pos: [0.13, -1.8, -11.67], size: 0.04, color: [1, 0.97, 0.92] }],
  });
  // leg-mounted main gear door: a slightly curved panel outboard of the strut (belly colour outside, well grey inside)
  const legDoor = (P, Cx, sx) => {
    const f = (k, dx, dz) => [P[0] + (Cx[0] - P[0]) * k + sx * dx, P[1] + (Cx[1] - P[1]) * k, P[2] + (Cx[2] - P[2]) * k + dz];
    const m = new K.Mesh();
    for (const [dx, uv] of [[0.19, UA.fair], [0.165, UA.well]]) {
      const rows = [[0.05, -0.52, 0.44], [0.33, -0.48, 0.4], [0.6, -0.4, 0.34]];
      const quadRow = (r0, r1) => { const [k0, a0, b0] = r0, [k1, a1, b1] = r1; return [f(k0, dx, a0), f(k0, dx + 0.04, (a0 + b0) / 2), f(k0, dx, b0), f(k1, dx, a1), f(k1, dx + 0.04, (a1 + b1) / 2), f(k1, dx, b1)]; };
      for (let r = 0; r < 2; r++) { const q = quadRow(rows[r], rows[r + 1]); m.add(K.plate(q[0], q[1], q[4], q[3], 0.012, uv)).add(K.plate(q[1], q[2], q[5], q[4], 0.012, uv)); }
    }
    return m;
  };
  const mains = [];
  for (const [i, sx, key] of [[1, -1, 'L'], [2, 1, 'R']]) {
    const c = gp[i].pos, P = [sx * 3.5, -0.62, c[2]], to = [sx * 1.45, -1.55, c[2]];
    const sw = K.swing(P, [c[0], c[1] + gp[i].wheelRadius, c[2]], to);
    mains.push({ sw, g: K.buildGear(rig, A, {
      name: 'main' + key, index: i, contact: c, wheels: [-0.46, 0.46], wheelRadius: gp[i].wheelRadius, wheelWidth: 0.36, pivot: P, stroke: 0.4, staticFrac: 0.4,
      strutR: 0.11, links: 'rear', retract: { to }, window: [0.18, 0.92], brace: [sx * 2.45, -0.75, c[2] + 0.1], uv: gearUV, wheelSegments: 28,
      doors: [{ name: 'mainDoor' + key, onLeg: true, mesh: legDoor(P, [c[0], c[1] + gp[i].wheelRadius, c[2]], sx) }],
    }) });
  }
  // the A320 has no main-wheel doors: keep the stowed legs (and their wheels) visible in the open belly wells
  rig.onUpdate((S) => {
    if (S.sf.gear > 0.012) return;
    for (const m of mains) { m.g.leg.visible = true; m.g.leg.quaternion.setFromAxisAngle({ x: m.sw.axis[0], y: m.sw.axis[1], z: m.sw.axis[2] }, m.sw.angle * DEG); }
  });

  // ---- lamps ------------------------------------------------------------------------------------------------------------------
  const L = G.lights;
  rig.lamp('nav', L.navLeft, { color: [1, 0.04, 0.02], size: 0.06, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.navRight, { color: [0.02, 1, 0.25], size: 0.06, squash: [0.6, 0.6, 1.5] });
  rig.lamp('nav', L.tail, { color: [1, 1, 1], size: 0.05 });
  for (const sx of [-1, 1]) rig.lamp('strobe', [sx * L.navRight[0], L.navRight[1] + 0.06, L.navRight[2] + 0.12], { color: [1, 1, 1], size: 0.05 });
  rig.lamp('strobe', L.strobe, { color: [1, 1, 1], size: 0.05 });
  rig.lamp('beacon', [0, fus.topAt(-1.5) + 0.03, -1.5], { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  rig.lamp('beacon', L.beacon, { color: [1, 0.05, 0.03], size: 0.08, squash: [1, 0.6, 1] });
  for (const sx of [-1, 1]) rig.lamp('landing', [sx * Math.abs(L.landing[0]), L.landing[1], L.landing[2]], { color: [1, 0.97, 0.9], size: 0.09, squash: [1.4, 0.8, 0.5] });
  // logo lights on the stabiliser tops, lighting the fin; wing-scan lights on the fuselage sides
  const logoP = [1, -1].map(sx => { const p = stab.R.at(1.6, 0.35, 'upper'); return [sx * p[0], p[1] + 0.04, p[2]]; });
  for (const p of logoP) rig.lamp('nav', p, { color: [1, 0.98, 0.92], size: 0.05 });
  const scanP = [1, -1].map(sx => { const z = -6.2, t = fus.tAtY(z, 0.25), p = fus.at(z, sx > 0 ? t : 1 - t).p; return [p[0] + sx * 0.02, p[1], p[2]]; });
  for (const p of scanP) rig.lamp('landing', p, { color: [1, 0.97, 0.9], size: 0.045 });

  // ---- night halos: at chase distance the lenses are a pixel or two, so every external light also gets a soft additive
  //      sprite (one Points draw call) driven by the same switches and flash timing as the lamps
  const navTip = (p, sx) => [p[0] + sx * 0.05, p[1], p[2]];
  const HALO = [
    { p: navTip(L.navLeft, -1), c: [1, 0.05, 0.03], k: 'nav', s: 2.2 }, { p: navTip(L.navRight, 1), c: [0.05, 1, 0.3], k: 'nav', s: 2.2 },
    { p: [L.tail[0], L.tail[1], L.tail[2] + 0.06], c: [1, 1, 1], k: 'nav', s: 1.8 },
    ...[-1, 1].map(sx => ({ p: [sx * (L.navRight[0] + 0.05), L.navRight[1] + 0.06, L.navRight[2] + 0.12], c: [1, 1, 1], k: 'strobe', s: 3.4 })),
    { p: [L.strobe[0], L.strobe[1], L.strobe[2] + 0.06], c: [1, 1, 1], k: 'strobe', s: 3.0 },
    { p: [0, fus.topAt(-1.5) + 0.08, -1.5], c: [1, 0.08, 0.04], k: 'beacon', s: 2.6 }, { p: [L.beacon[0], L.beacon[1] - 0.06, L.beacon[2]], c: [1, 0.08, 0.04], k: 'beacon', s: 2.6 },
    ...[-1, 1].map(sx => ({ p: [sx * Math.abs(L.landing[0]), L.landing[1] - 0.06, L.landing[2] - 0.1], c: [1, 0.95, 0.85], k: 'landing', s: 3.2, gear: true })),
    { p: [0, -1.86, -11.75], c: [1, 0.95, 0.85], k: 'taxi', s: 2.4, gear: true }, { p: [0, -1.74, -11.75], c: [1, 0.95, 0.85], k: 'landing', s: 2.4, gear: true },
    ...logoP.map(p => ({ p: [p[0], p[1] + 0.05, p[2]], c: [1, 0.95, 0.85], k: 'nav', s: 1.2 })),
  ];
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(HALO.flatMap(h => h.p), 3));
  haloGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(HALO.length * 3).fill(0), 3));
  haloGeo.setAttribute('size', new THREE.Float32BufferAttribute(HALO.map(h => h.s), 1));
  const haloMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, fog: false,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = clamp(size * 0.5 * projectionMatrix[1][1] * 360.0 / max(0.5, -mv.z), 2.0, 96.0); }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; float a = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4) * (1.0 - r2); gl_FragColor = vec4(vC * a, 1.0); }',
  });
  const halo = new THREE.Points(haloGeo, haloMat); halo.name = 'halos'; halo.frustumCulled = false; halo.renderOrder = 6;
  const haloCol = haloGeo.attributes.color;
  rig.onUpdate((S) => {
    const lt = S.lights || {}, nf = Math.max(0, Math.min(1, (S.night ?? 0) * 1.4 - 0.2)), t = S.t || 0;
    HALO.forEach((h, i) => {
      let on = 0;
      if (h.k === 'nav') on = lt.nav ? 1 : 0;
      else if (h.k === 'strobe') { const ph = t % 1.1; on = lt.strobe && (ph < 0.055 || (ph > 0.16 && ph < 0.215)) ? 1 : 0; }
      else if (h.k === 'beacon') { const ph = (t + 0.45) % 1.25; on = lt.beacon ? (ph < 0.16 ? Math.sin(ph / 0.16 * Math.PI) : 0) : 0; }
      else on = lt[h.k] && (!h.gear || S.sf.gear > 0.98) ? 1 : 0;
      const I = on * nf * 0.9; haloCol.setXYZ(i, h.c[0] * I, h.c[1] * I, h.c[2] * I);
    });
    haloCol.needsUpdate = true; halo.visible = nf > 0.01;
  });

  // ---- animation --------------------------------------------------------------------------------------------------------------
  let fanAng = [0, 0];
  rig.onUpdate((S, dt) => {
    const sf = S.sf, f = sf.flaps, sl = Math.max(sf.slats, 0), gnd = S.onGround ? 1 : 0;
    for (const a of wingAnim) {
      const R = a.key === 'R', ail = R ? sf.aileronR : sf.aileronL, sp = R ? sf.spoilerR : sf.spoilerL, el = R ? sf.elevatorR : sf.elevatorL;
      a.flapIn(f * 35 * DEG); a.flapOut(f * 32 * DEG);
      a.aileron((ail * 25 - Math.min(1, f * 3) * 5) * DEG);
      a.slatIn(sl * 23 * DEG); a.slatOut(sl * 27 * DEG);
      const sb = sf.speedbrake, roll = Math.max(0, sp);
      a.sp1((gnd * sb) * 50 * DEG);
      a.sp24(Math.min(1, Math.max(roll, sb * (gnd ? 1 : 0.8))) * 50 * DEG);
      a.sp5(Math.min(1, Math.max(roll, gnd * sb)) * 50 * DEG);
      a.elev((el > 0 ? el * 30 : el * 17) * DEG);
    }
    rud.set(sf.rudder * 25 * DEG);
    for (let i = 0; i < 2; i++) {
      const e = S.eng[i] || {};
      fanAng[i] = (fanAng[i] + (e.n1 || 0) * 24 * dt) % (Math.PI * 2);
      fans[i].quaternion.set(0, 0, Math.sin(fanAng[i] / 2), Math.cos(fanAng[i] / 2));
      sleeves[i].node.position.z = sleeves[i].node.userData.restZ + (e.reverser || 0) * sleeves[i].travel;
    }
    matA.emissiveIntensity = S.night * 2.4;
    matB.emissiveIntensity = S.night * (S.lights && S.lights.nav ? 1.6 : 0);
  });
  for (const s of sleeves) s.node.userData.restZ = s.node.position.z;
  const visual = rig.build();
  visual.object3D.add(halo);
  rig.disposables.push(haloGeo, haloMat);
  lap('rig'); visual.stats.phases = lap.out;
  visual.livery = livery; visual.liveries = LIVERIES; visual.sharkletTip = [shTip.x, shTip.y, shTip.z];
  return visual;
}

// ---- paint: fuselage atlas ---------------------------------------------------------------------------------------------------
function paintFuselage(A, o) {
  const { SC, fus, cFus, cFair, cPanel, cOver, cPed, WIN } = o, F = K.FINISH;
  const B_ORM = (atl, r, m) => atl.ormStyle(r, m);
  const P = A.pen(cFus), body = F.gloss(SC.body), belly = F.gloss(SC.belly), accent = F.gloss(SC.accent), tail = F.gloss(SC.tail);
  const font = SC.font === 'round' ? K.FONT.round : K.FONT.wide, Z0 = -17.75, Z1 = 19.9;
  P.fill('all', body);
  // --- livery ---
  if (SC.style === 'cheat') {            // grey belly, crimson cheat line under the windows fading out toward the nose
    P.band(Z0, Z1, -Infinity, (z) => -0.95 + Math.max(0, z - 10) * 0.12, belly, { step: 0.3, feather: 2 });
    P.band(-12.0, 19.9, (z) => 0.12 + Math.max(0, z - 10) * 0.1, (z) => 0.2 + Math.max(0, z - 10) * 0.1, accent, { step: 0.25 });
    const k = (z) => Math.pow(Math.max(0, (z + 15.4) / 3.42), 1.4);                      // taper to a point toward the nose
    P.band(-15.4, -11.98, (z) => 0.16 - 0.04 * k(z), (z) => 0.16 + 0.04 * k(z), accent, { step: 0.1 });
    P.textOn(SC.title, -6.6, 1.5, 'both', 0.62, { color: SC.titleColor, font, weight: 700, spacing: 0.1 });
  } else if (SC.style === 'sweep') {     // dark belly sweeping up the aft fuselage into the tail, with a gold pin line
    const edge = (z) => (z < 2 ? -0.75 + (z + 17.7) * 0.008 : -0.59 + Math.pow((z - 2) / 9, 2.0) * 3.1);
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.14, accent, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, (z) => edge(z) + 0.07, body, { step: 0.25 });
    P.band(Z0, Z1, -Infinity, edge, belly, { step: 0.25 });
    P.textOn(SC.title, -7.0, 1.42, 'both', 0.85, { color: SC.titleColor, font, weight: 700 });
  } else {                               // 'house': grey belly, blue stripe pair through the windows, big titles
    P.band(Z0, Z1, -Infinity, -0.7, belly, { step: 0.5 });
    P.band(-14.2, 19.9, -0.42, -0.2, accent, { step: 0.5 });
    P.band(-14.2, 19.9, -0.12, -0.06, F.gloss(SC.titleColor), { step: 0.5 });
    // 'SKYWARD neo' must read in that order on both sides: the second word sits aft on the left, forward on the right
    P.textOn(SC.title, -8.6, 1.45, 'L', 0.55, { color: SC.titleColor, font, weight: 700, spacing: 0.12 });
    P.textOn('neo', -4.9, 1.4, 'L', 0.7, { color: SC.accent, font: K.FONT.round, weight: 700 });
    P.textOn(SC.title, -6.9, 1.45, 'R', 0.55, { color: SC.titleColor, font, weight: 700, spacing: 0.12 });
    P.textOn('neo', -10.6, 1.4, 'R', 0.7, { color: SC.accent, font: K.FONT.round, weight: 700 });
  }
  P.textOn(SC.reg, 15.0, 1.35, 'both', 0.3, { color: SC.style === 'sweep' ? '#ffffff' : '#1d2126', font: K.FONT.sans, weight: 700 });
  P.textOn('A320neo', -11.0, -0.45, 'both', 0.14, { color: '#7c8288', font: K.FONT.wide, weight: 700 });
  // radome: joint and lightning diverter strips (faint raised metal lines)
  P.ring(-15.88, 0, 1, { px: 1.4, depth: 0.5, dark: 0.22 });
  for (let k = 0; k < 8; k++) { const t = 0.0625 + k * 0.125; P.stroke((g) => { g.moveTo(-17.55, t); g.lineTo(-15.95, t); }, 0, { color: '#b9bdc1', rough: 0.35, metal: 0.6 }, { px: 1.2, alpha: 0.35 }); }
  // --- flight-deck windows: the openings are real; paint only the black seal / frame round them ---
  for (const s of [1, -1]) {
    const m = (p) => [p[0], s > 0 ? p[1] : 1 - p[1]];
    for (const w of WIN) {
      const pts = w.map(m), path = (g) => { pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); };
      P.stroke(path, 0, { color: '#202326', rough: 0.45, metal: 0 }, { join: 'round', px: 6 });
      P.fill(pts, F.paintedGlass);
      P.groove(path, { px: 1.0, depth: 0.5, dark: 0.15 });
    }
  }
  // centre windshield post
  P.fill([[WIN[0][0][0], WIN[0][0][1]], [WIN[0][3][0], WIN[0][3][1]], [WIN[0][3][0], 1 - WIN[0][3][1]], [WIN[0][0][0], 1 - WIN[0][0][1]]], { color: '#202326', rough: 0.45, metal: 0 });
  // --- cabin windows, doors, hatches ---
  const zs = []; for (let z = -11.55; z < 9.7; z += 0.533) zs.push(z);
  P.windows(zs, 0.55, { w: 0.23, h: 0.33, r: 0.09, frame: SC.style === 'house' ? '#cfd3d6' : '#c4c8cb', lit: 0.75, seed: 31 });
  // passenger / service doors: rounded outline, recessed handle, door window, sill scuff, number stencil, slide-armed placard
  const doorR = (z0, z1, y0, y1, label) => {
    const zc = (z0 + z1) / 2, yc = (y0 + y1) / 2, w = z1 - z0, h = y1 - y0;
    P.decalOn(zc, yc, 'both', { layers: ['color', 'height'] }, (g, layer, side) => {
      g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, 0.12);
      if (layer === 'height') { g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 0.022; g.stroke(); return; }
      g.strokeStyle = 'rgba(12,14,16,0.42)'; g.lineWidth = 0.02; g.stroke();
      g.fillStyle = 'rgba(30,32,36,0.75)'; g.fillRect(-0.12, -0.03, 0.24, 0.06);                                   // handle recess
      g.fillStyle = 'rgba(150,40,30,0.85)'; g.fillRect(-0.04, 0.1, 0.08, 0.035);                                    // red flag window
      g.fillStyle = 'rgba(40,44,48,0.8)'; g.font = `700 0.055px ${K.FONT.sans}`; g.textAlign = 'center';
      g.fillText(label + (side === 'L' ? 'L' : 'R'), 0, -h / 2 + 0.16);
      g.fillStyle = 'rgba(110,116,122,0.45)'; g.fillRect(-w / 2 + 0.05, h / 2 - 0.05, w - 0.1, 0.03);                // sill kick plate
    });
    P.windows([zc], 0.85, { w: 0.18, h: 0.22, r: 0.08, lit: 0 });
  };
  doorR(-12.95, -12.1, -0.33, 1.52, '1'); doorR(10.15, 10.95, -0.33, 1.52, '2');
  const door = { px: 1.2, depth: 0.55, dark: 0.3 };
  for (const zc of [-2.49, -1.42]) {                                                                                    // overwing exits
    P.decalOn(zc, 0.52, 'both', { layers: ['color', 'height'] }, (g, layer) => {
      g.beginPath(); g.roundRect(-0.255, -0.5, 0.51, 1.0, 0.1);
      if (layer === 'height') { g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 0.02; g.stroke(); return; }
      g.strokeStyle = 'rgba(12,14,16,0.35)'; g.lineWidth = 0.018; g.stroke();
      g.fillStyle = 'rgba(170,30,24,0.9)'; g.fillRect(-0.06, -0.42, 0.12, 0.05);                                    // red pull handle flap
      g.fillStyle = 'rgba(40,44,48,0.75)'; g.font = `700 0.045px ${K.FONT.sans}`; g.textAlign = 'center'; g.fillText('EXIT', 0, 0.36);
    });
  }
  P.doorOn(-9.7, -7.9, -1.95, -0.62, { ...door, side: 'R' }); P.doorOn(3.9, 5.7, -1.95, -0.62, { ...door, side: 'R' }); P.doorOn(7.3, 8.1, -1.75, -0.95, { ...door, side: 'R' });   // cargo doors
  for (const [z0, z1] of [[-9.7, -7.9], [3.9, 5.7]]) P.decalOn((z0 + z1) / 2, -1.85, 'R', (g) => { g.fillStyle = 'rgba(30,32,36,0.7)'; g.fillRect(-0.1, -0.025, 0.2, 0.05); g.fillRect(0.25, -0.025, 0.2, 0.05); });
  P.doorOn(-14.9, -14.25, -1.65, -1.05, { px: 1, depth: 0.4, dark: 0.15, side: 'L' });                                // avionics access
  P.doorOn(-13.95, -13.55, -1.0, -0.55, { px: 1, depth: 0.35, dark: 0.12, side: 'R' });                              // oxygen service panel
  P.doorOn(12.6, 13.0, -1.35, -0.95, { px: 1, depth: 0.35, dark: 0.12, side: 'L' });                                  // potable water service panel
  P.doorOn(13.6, 14.0, -1.2, -0.85, { px: 1, depth: 0.35, dark: 0.12, side: 'R' });                                   // toilet service panel
  // skin joints: circumferential butt joints with double rivet rows, longitudinal lap joints along the crown and window belt
  const ringZ = [-15.0, -13.25, -11.85, -9.85, -7.75, -5.75, -3.65, -0.8, 1.55, 3.55, 5.85, 7.9, 9.95, 11.6, 13.4, 15.25, 17.1, 18.6];
  for (const z of ringZ) {
    P.ring(z, 0.04, 0.96, { px: 1, depth: 0.25, dark: 0.055 });
    for (const dz of [-0.035, 0.035]) { P.rivets(z + dz, 0.06, z + dz, 0.47, 0.0045, { px: 1, depth: 0.12, dark: 0.025 }); P.rivets(z + dz, 0.53, z + dz, 0.94, 0.0045, { px: 1, depth: 0.12, dark: 0.025 }); }
  }
  for (const y of [1.55, 0.18, -0.95]) P.yLine(-14.5, 19.2, (z) => Math.min(fus.topAt(z) - 0.25, Math.max(fus.botAt(z) + 0.2, y + Math.max(0, z - 10) * 0.08)), { px: 1, depth: 0.25, dark: 0.06 });
  for (const y of [1.55, 0.18]) for (const sd of ['L', 'R']) { const tA = fus.tAtY(0, y), t = sd === 'L' ? 1 - tA : tA; P.rivets(-11.8, t + 0.002, 9.9, t + 0.002, 0.06, { px: 1, depth: 0.1, dark: 0.02 }); }
  P.line([[-15.5, 0.5], [19.8, 0.5]], { px: 1, depth: 0.2, dark: 0.05 });
  // static ports, AoA / pitot zones, APU intake / exhaust, ram air, grime
  for (const z of [-14.1, -13.75]) P.decalOn(z, -0.25, 'both', (g) => { g.fillStyle = '#9aa0a5'; g.beginPath(); g.arc(0, 0, 0.05, 0, Math.PI * 2); g.fill(); g.fillStyle = '#5b6066'; g.beginPath(); g.arc(0, 0, 0.012, 0, Math.PI * 2); g.fill(); });
  P.decalOn(-13.92, -0.25, 'both', (g) => { g.strokeStyle = '#c42a1e'; g.lineWidth = 0.012; g.strokeRect(-0.3, -0.1, 0.6, 0.2); g.fillStyle = '#c42a1e'; g.font = `700 0.035px ${K.FONT.sans}`; g.textAlign = 'center'; g.fillText('KEEP CLEAR', 0, 0.16); });
  for (const [z, y] of [[-14.95, -0.2], [-14.55, -0.55], [-14.2, -0.05]]) P.decalOn(z, y, 'both', (g) => { g.fillStyle = 'rgba(70,74,78,0.55)'; g.beginPath(); g.arc(0, 0, 0.06, 0, Math.PI * 2); g.fill(); });
  P.decalOn(17.4, 0.95, 'R', (g) => { g.fillStyle = '#3a3d40'; g.fillRect(-0.3, -0.12, 0.6, 0.24); g.fillStyle = '#26282b'; for (let i = 0; i < 6; i++) g.fillRect(-0.27 + i * 0.095, -0.1, 0.05, 0.2); g.strokeStyle = '#8b9095'; g.lineWidth = 0.015; g.strokeRect(-0.33, -0.15, 0.66, 0.3); });
  P.decalOn(15.8, -0.55, 'L', (g) => { g.fillStyle = '#4a4e52'; g.beginPath(); g.ellipse(0, 0, 0.16, 0.1, 0, 0, Math.PI * 2); g.fill(); });     // outflow valve
  // APU exhaust: soot round the outlet and up the tail cone
  P.fill([[19.0, 0], [19.95, 0], [19.95, 1], [19.0, 1]], { color: '#2c2a28', rough: 0.7, metal: 0 }, { alpha: 0.35, feather: 6 });
  P.fill([[19.45, 0], [19.95, 0], [19.95, 1], [19.45, 1]], { color: '#1f1d1c', rough: 0.8, metal: 0 }, { alpha: 0.5, feather: 4 });
  const rnd = (() => { let a = 11; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  for (let i = 0; i < 34; i++) { const z = -12 + rnd() * 27, t = rnd() < 0.5 ? rnd() * 0.08 : 1 - rnd() * 0.08; P.streak(z, t, z + 0.8 + rnd() * 2.2, t, 0.004 + rnd() * 0.01, { alpha: 0.05 + rnd() * 0.09 }); }
  for (let i = 0; i < 8; i++) { const z = 16.5 + rnd() * 3; P.streak(z, 0.62 + rnd() * 0.04, z + 1.2, 0.6 + rnd() * 0.04, 0.01, { alpha: 0.08 }); }
  for (const zd of [-9.4, 8.0]) for (let k = 0; k < 4; k++) { const t = (rnd() - 0.5) * 0.03; P.streak(zd, t < 0 ? 1 + t : t, zd + 3 + rnd() * 3, t < 0 ? 1 + t * 1.5 : t * 1.5, 0.012, { alpha: 0.12 + rnd() * 0.08, rough: 0.05 }); }   // drain-mast streaks
  for (const s of [1, -1]) for (const zc of [-12.5, 10.55]) for (let k = 0; k < 3; k++) { const t0 = fus.tAtY(zc, -0.4); const t = s > 0 ? t0 : 1 - t0; P.streak(zc + (k - 1) * 0.25, t, zc + (k - 1) * 0.25 + 0.6, t - s * 0.02, 0.02, { alpha: 0.06 }); }   // door-sill grime
  P.noise({ alpha: 0.03, scale: 3, stretch: [2, 1] });
  P.noise({ alpha: 0.025, scale: 9, stretch: [2, 1] });

  // --- belly fairing: panels, ram-air inlets, pack outlets, landing-light recesses, grime from the wells ---
  {
    const Q = A.pen(cFair), fb = F.gloss(SC.fair || SC.belly);
    Q.fill('all', fb);
    for (const z of [-5.5, -3.9, -2.3, -1.0, 0.3, 2.0, 2.4, 4.2, 6.0, 7.4]) for (const [t0, t1] of [[0.0, 0.42], [0.58, 1.0]]) Q.ring(z, t0, t1, { px: 1, depth: 0.3, dark: 0.07 });
    for (const t of [0.07, 0.17, 0.3, 0.7, 0.83, 0.93]) Q.line([[-6.4, t], [8.3, t]], { px: 1, depth: 0.3, dark: 0.07 });
    for (const t of [0.07, 0.17, 0.83, 0.93]) Q.rivets(-6.0, t + 0.004, 8.0, t + 0.004, 0.08, { px: 1, depth: 0.1, dark: 0.02 });
    // ram-air inlets (NACA ducts) and the pack exhaust louvres, both sides of the forward fairing
    for (const t of [0.075, 0.925]) {
      Q.decalT(-4.9, t, { layers: ['color', 'orm', 'height'] }, (g, layer) => {
        const path = () => { g.beginPath(); g.moveTo(-0.45, -0.03); g.bezierCurveTo(-0.1, -0.05, 0.2, -0.17, 0.42, -0.18); g.lineTo(0.42, 0.18); g.bezierCurveTo(0.2, 0.17, -0.1, 0.05, -0.45, 0.03); g.closePath(); };
        path();
        if (layer === 'color') { g.fillStyle = '#1a1c1e'; g.fill(); g.strokeStyle = 'rgba(20,22,24,0.5)'; g.lineWidth = 0.02; g.stroke(); }
        else if (layer === 'orm') { g.fillStyle = B_ORM(A, 0.6, 0.2); g.fill(); }
        else { g.fillStyle = 'rgba(0,0,0,0.8)'; g.fill(); }
      });
      Q.decalT(-2.9, t < 0.5 ? t - 0.035 : t + 0.035, { layers: ['color', 'height'] }, (g, layer) => {
        g.fillStyle = layer === 'color' ? '#2a2c2f' : 'rgba(0,0,0,0.6)'; g.fillRect(-0.35, -0.2, 0.7, 0.4);
        g.fillStyle = layer === 'color' ? '#121314' : 'rgba(0,0,0,0.9)'; for (let i = 0; i < 7; i++) g.fillRect(-0.32 + i * 0.095, -0.17, 0.05, 0.34);
      });
      Q.streak(-2.5, t < 0.5 ? t - 0.035 : t + 0.035, 1.0, t < 0.5 ? t - 0.05 : t + 0.05, 0.03, { alpha: 0.12 });
    }
    // grime streaking aft from the wheel wells and the drain at the fairing's tail
    for (const s of [1, -1]) for (let k = 0; k < 6; k++) { const t = 0.06 + k * 0.025, tt = s > 0 ? t : 1 - t; Q.streak(1.9, tt, 4.2 + k * 0.4, tt, 0.012, { alpha: 0.1, rough: 0.04 }); }
    Q.streak(5.0, 0.0, 8.4, 0.0, 0.03, { alpha: 0.12 });
    Q.noise({ alpha: 0.03, scale: 2.5, stretch: [2, 1] });
  }
  // --- flight-deck panels: six displays, FCU strip, ECAM control, pedestal, overhead ---
  {
    const Q = A.pen(cPanel); Q.fill('all', { color: '#59616a', rough: 0.7, metal: 0 });
    const scr = (a, b, w, h, col, fn) => { Q.fill((g) => g.rect(a, b, w, h), { color: '#08090a', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(a + 0.012, b + 0.012, w - 0.024, h - 0.024), { color: col, rough: 0.15, metal: 0, emissive: col }); if (fn) Q.decal(a + w / 2, b + h / 2, { layers: ['color', 'emis'] }, fn); };
    const pfd = (g) => { g.fillStyle = '#2d6fbf'; g.fillRect(-0.06, -0.075, 0.12, 0.07); g.fillStyle = '#8a5a2a'; g.fillRect(-0.06, -0.005, 0.12, 0.07); g.strokeStyle = '#f2d23a'; g.lineWidth = 0.006; g.beginPath(); g.moveTo(-0.04, 0); g.lineTo(0.04, 0); g.stroke(); };
    const nd = (g) => { g.strokeStyle = '#e8e8e8'; g.lineWidth = 0.004; g.beginPath(); g.arc(0, 0.05, 0.075, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); g.strokeStyle = '#3ad16a'; g.beginPath(); g.moveTo(0, 0.05); g.lineTo(0.03, -0.04); g.lineTo(0.05, -0.07); g.stroke(); };
    const ecam = (g) => { g.strokeStyle = '#3ad16a'; g.lineWidth = 0.004; for (const x of [-0.04, 0.04]) { g.beginPath(); g.arc(x, -0.03, 0.026, Math.PI, Math.PI * 1.75); g.stroke(); } g.fillStyle = '#e8e8e8'; g.fillRect(-0.06, 0.02, 0.12, 0.004); g.fillRect(-0.06, 0.035, 0.08, 0.004); };
    for (const [x0, flip] of [[0.1, 0], [1.46, 1]]) { scr(flip ? x0 + 0.22 : x0, 0.14, 0.2, 0.2, '#0c1322', pfd); scr(flip ? x0 : x0 + 0.22, 0.14, 0.2, 0.2, '#0b1220', nd); }
    scr(0.9, 0.06, 0.2, 0.2, '#0b1120', ecam); scr(0.9, 0.29, 0.2, 0.2, '#0b1120', ecam);
    Q.fill((g) => g.rect(0.2, 0.0, 1.6, 0.06), { color: '#3a3f45', rough: 0.6, metal: 0 });                     // FCU on the glareshield face
    for (let i = 0; i < 8; i++) Q.fill((g) => g.rect(0.3 + i * 0.18, 0.015, 0.1, 0.03), { color: '#0a0a0a', rough: 0.2, metal: 0, emissive: i % 3 ? '#3a2408' : '#000000' });
    Q.fill((g) => g.rect(0.75, 0.44, 0.05, 0.1), { color: '#c8c8c4', rough: 0.4, metal: 0 });                    // gear lever
    for (let i = 0; i < 6; i++) Q.fill((g) => g.arc(0.5 + (i % 3) * 0.05, 0.42 + Math.floor(i / 3) * 0.05, 0.016, 0, Math.PI * 2), { color: '#0b0c0d', rough: 0.2, metal: 0 });
  }
  {
    const Q = A.pen(cOver); Q.fill('all', { color: '#69717a', rough: 0.7, metal: 0 });
    for (let j = 0; j < 8; j++) for (let i = 0; i < 7; i++) Q.fill((g) => g.rect(0.04 + i * 0.093, 0.04 + j * 0.093, 0.07, 0.07), { color: (i + j * 2) % 5 ? '#4a5057' : '#24272b', rough: 0.6, metal: 0, emissive: (i * 3 + j) % 7 === 0 ? '#1c1403' : undefined });
  }
  {
    const Q = A.pen(cPed); Q.fill('all', { color: '#5d646c', rough: 0.7, metal: 0 });
    for (const b of [0.32, 0.5]) { Q.fill((g) => g.rect(0.04, b, 0.13, 0.12), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(0.19, b, 0.13, 0.12), { color: '#0b0c0d', rough: 0.2, metal: 0 }); Q.fill((g) => g.rect(0.055, b + 0.015, 0.1, 0.05), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); Q.fill((g) => g.rect(0.205, b + 0.015, 0.1, 0.05), { color: '#0d1a12', rough: 0.2, metal: 0, emissive: '#0d2414' }); }
    Q.fill((g) => g.rect(0.06, 0.02, 0.24, 0.24), { color: '#2b2e32', rough: 0.6, metal: 0 });
  }
}

// ---- paint: wings, tail, nacelles ------------------------------------------------------------------------------------------------
function paintSurfaces(B, o) {
  const { SC, W, fin, stab, cWT, cWB, cSh, cSt, cFin, cNac, SPOILERS } = o, F = K.FINISH;
  const grey = F.semigloss('#bcc1c6'), dgrey = F.semigloss('#a5abb0'), metal = { color: '#c9ccce', rough: 0.26, metal: 0.9 };
  const line = { px: 1, depth: 0.35, dark: 0.13 }, gap = { px: 1.8, depth: 0.8, dark: 0.5 };
  const at = (x, f) => { const p = W.at(x, f); return [p[0], p[2]]; };
  const L = (name, x) => W.lines[name].at(W.spanToU(x));
  for (const [chart, top] of [[cWT, true], [cWB, false]]) {
    const Q = B.pen(chart); Q.fill('all', grey);
    Q.fill([at(1.9, L('slat', 1.9) + 0.04), at(16.6, L('slat', 16.6) + 0.04), at(16.6, L('spoil', 16.6) - 0.03), at(1.9, L('spoil', 1.9) - 0.03)], dgrey);
    Q.fill([at(1.9, 0), at(16.9, 0), at(16.9, L('slat', 16.9)), at(1.9, L('slat', 1.9))], metal);
    const seg = (name, xs, op) => Q.line(xs.map(x => at(x, L(name, x))), op);
    seg('slat', [2.4, 5.1], gap); seg('slat', [6.4, 16.5], gap);
    for (const x of [2.4, 5.1, 6.4, 8.9, 11.4, 13.95, 16.5]) Q.line([at(x, 0), at(x, L('slat', x))], gap);   // slat 1 | slats 2–5
    if (top) for (const [x0, x1] of SPOILERS) { Q.line([at(x0, L('spoil', x0)), at(x1, L('spoil', x1)), at(x1, L('flap', x1)), at(x0, L('flap', x0)), at(x0, L('spoil', x0))], gap); }
    seg('flap', [2.2, 5.45], gap); seg('flap', [6.05, 14.1], gap); seg('flap', [14.3, 16.6], gap);
    for (const x of [2.2, 5.45, 6.05, 14.1, 14.3, 16.6]) Q.line([at(x, L('flap', x)), at(x, 1)], gap);
    for (const f of [0.18, 0.3, 0.45]) Q.line([at(1.9, f), at(16.8, f)], line);
    for (let x = 2.6; x < 16.8; x += 1.25) Q.line([at(x, L('slat', x) + 0.01), at(x, L('spoil', x) - 0.01)], line);
    for (const f of [0.18, 0.45]) { const a = at(2, f + 0.006), b = at(16.8, f + 0.006); Q.rivets(a[0], a[1], b[0], b[1], 0.06, { px: 1.2, depth: 0.16, dark: 0.05 }); }
    if (top) {
      const a = at(2.1, 0.22), b = at(2.1, 0.57), c = at(4.4, 0.57), d = at(4.4, 0.22);     // walkway
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); }, 0.04, F.matte('#2a2c2e'));
      Q.stroke((g) => { g.moveTo(a[0], a[1]); g.lineTo(d[0], d[1]); }, 0.04, F.matte('#2a2c2e'));
      for (const x of [3.3, 9.5, 13.0]) { const p = at(x, 0.35); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#3c4044'; g.beginPath(); g.arc(0, 0, 0.09, 0, Math.PI * 2); g.fill(); }); }   // fuel caps
      // no-step border along the spoiler / flap hinge line (stencil text would read mirrored on the shared chart)
      Q.stroke((g) => { const xs = [6.1, 13.9]; xs.forEach((x, i) => { const p = at(x, L('spoil', x) - 0.025); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); }, 0.025, F.semigloss('#8a3a32'), { alpha: 0.8 });
      Q.wear((g) => { const p0 = at(2.4, 0.01), p1 = at(16.5, 0.01); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); }, 0.05, { color: '#d6d9db', rough: 0.25, metal: 0.9 }, { alpha: 0.35 });
      for (let i = 0; i < 9; i++) { const x = 3 + i * 1.5, a = at(x, L('flap', x) + 0.02); Q.streak(a[0], a[1], a[0], a[1] + 0.9, 0.08, { alpha: 0.06 }); }
    } else {
      // core exhaust soot on the flap undersides behind each engine, fuel vent, drain stains
      { const a = at(4.6, L('flap', 4.6)), b = at(6.9, L('flap', 6.9)), c = at(6.9, 1), d = at(4.6, 1); Q.fill([a, b, c, d], { color: '#3a3532', rough: 0.7, metal: 0 }, { alpha: 0.22, feather: 14 }); }
      { const p = at(15.2, 0.45); Q.decal(p[0], p[1], (g) => { g.fillStyle = '#1e2022'; g.beginPath(); g.moveTo(-0.05, -0.2); g.lineTo(0.05, -0.2); g.lineTo(0.1, 0.2); g.lineTo(-0.1, 0.2); g.closePath(); g.fill(); }); }
      for (const x of [4.0, 8.0, 12.5]) { const p = at(x, 0.5); Q.streak(p[0], p[1], p[0], p[1] + 1.5, 0.04, { alpha: 0.12 }); }
      for (let i = 0; i < 12; i++) { const x = 3 + i * 1.1, a = at(x, 0.62); Q.streak(a[0], a[1], a[0], a[1] + 1.2, 0.05, { alpha: 0.1 }); }
      for (const x of [7.5, 10.5, 13.5]) { const p = at(x, 0.4); Q.panel(p[0] - 0.25, p[1] - 0.2, p[0] + 0.25, p[1] + 0.2, { r: 0.05 }); }
    }
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2.5], rough: 0.04 });
  }
  // --- nacelles (shared chart: u along the cowl, t = 0 bottom, 0.25 outboard, 0.5 top, 0.75 inboard) ---
  {
    const Q = B.pen(cNac), cz = NACZ, L = NACL, zS = cz + L * 0.5, eng = F.gloss(SC.engine);
    const rect = (u0, u1, t0, t1, fin, o) => Q.fill((g) => g.rect(u0, t0, u1 - u0, t1 - t0), fin, o);
    Q.fill('all', eng);
    rect(NACU0, cz - 0.1, 0, 1, { color: '#7d8184', rough: 0.5, metal: 0.45 });                                   // inlet barrel acoustic liner
    for (const u of [cz - 0.45, cz - 0.95]) Q.ring(u, 0, 1, { px: 1.2, depth: 0.4, dark: 0.25 });
    for (let k = 0; k < 8; k++) Q.line([[NACU0, k / 8], [cz - 0.1, k / 8]], { px: 1, depth: 0.3, dark: 0.18 });
    rect(cz - 0.12, cz + 0.11, 0, 1, { color: '#cdd0d2', rough: 0.18, metal: 1 });                                // polished lip
    Q.ring(cz + 0.11, 0, 1, { px: 1.3, depth: 0.5, dark: 0.18 });
    if (SC.lipBand) rect(cz + 0.2, cz + 0.32, 0, 1, F.gloss(SC.lipBand));
    if (SC.style === 'sweep') { rect(cz + 2.25, cz + 2.4, 0, 1, F.gloss(SC.accent)); }
    if (SC.style === 'house') { for (const t of [0.25, 0.75]) Q.decalT(cz + 1.35, t, { girth: 7.5 }, (g) => { g.fillStyle = SC.accent; g.beginPath(); g.arc(0, 0, 0.26, 0, Math.PI * 2); g.fill(); g.fillStyle = '#f2f3f4'; g.beginPath(); g.arc(0.06, 0, 0.2, 0, Math.PI * 2); g.fill(); }); }
    if (SC.style === 'cheat') { for (const t of [0.25, 0.75]) Q.decalT(cz + 1.35, t, { girth: 7.5 }, (g) => drawStar(g, 0.24, SC.accent)); }
    // inlet cowl / fan cowl / reverser joints, fan cowl hinge (top) and latch line (bottom), access doors
    Q.ring(cz + 1.05, 0, 1, { px: 1.3, depth: 0.55, dark: 0.22 });
    Q.ring(zS, 0, 1, { px: 1.6, depth: 0.7, dark: 0.35 });
    for (const t of [0.5, 0.012, 0.988]) Q.line([[cz + 1.05, t], [cz + L, t]], { px: 1.2, depth: 0.5, dark: t === 0.5 ? 0.2 : 0.28 });
    for (const u of [cz + 1.2, cz + 1.4, cz + 1.6]) Q.decalT(u, 0.02, { girth: 7.5, layers: ['color', 'height'] }, (g, layer) => { g.fillStyle = layer === 'color' ? 'rgba(40,42,46,0.6)' : 'rgba(0,0,0,0.5)'; g.fillRect(-0.06, -0.03, 0.12, 0.05); });
    for (const [u, t, w, h] of [[cz + 1.3, 0.32, 0.36, 0.022], [cz + 1.32, 0.66, 0.3, 0.02], [cz + 0.6, 0.14, 0.25, 0.018]]) Q.panel(u - w / 2, t - h, u + w / 2, t + h, { px: 1, depth: 0.35, dark: 0.12, r: 0.02 });
    Q.rivets(cz + 1.08, 0.03, cz + 1.08, 0.47, 0.006, { px: 1, depth: 0.12, dark: 0.03 }); Q.rivets(cz + 1.08, 0.53, cz + 1.08, 0.97, 0.006, { px: 1, depth: 0.12, dark: 0.03 });
    // reverser sleeve: soot and grime toward the exit, darker underneath; the inside of the bypass duct is dark grey
    Q.fill((g) => g.rect(cz + L - 0.5, 0, 0.5, 1), { color: '#4a4846', rough: 0.6, metal: 0 }, { alpha: 0.12, feather: 10 });
    Q.fill((g) => g.rect(cz + L - 0.35, 0.85, 0.35, 0.15), { color: '#3a3836', rough: 0.6, metal: 0 }, { alpha: 0.16, feather: 8 });
    Q.fill((g) => g.rect(cz + L - 0.35, 0, 0.35, 0.15), { color: '#3a3836', rough: 0.6, metal: 0 }, { alpha: 0.16, feather: 8 });
    rect(cz + L + 0.005, NACU1, 0, 1, { color: '#3b3e41', rough: 0.55, metal: 0.2 });
    for (let k = 0; k < 10; k++) { const t = 0.9 + k * 0.02, tt = t >= 1 ? t - 1 : t; Q.streak(cz + 1.2, tt, cz + L, tt, 0.004, { alpha: 0.07 }); }
    Q.noise({ alpha: 0.03, scale: 2, stretch: [2, 1], rough: 0.03 });
  }
  { const Q = B.pen(cSh); Q.fill('all', F.gloss(SC.sharklet));
    if (SC.style === 'cheat') Q.decal(5.2, 2.3, (g) => drawStar(g, 0.36, '#ffffff'));
    if (SC.style === 'sweep') Q.fill((g) => g.rect(3.5, 0.45, 3.1, 0.55), F.gloss(SC.belly));
    if (SC.style === 'house') Q.fill((g) => g.rect(3.5, 0.45, 3.1, 0.5), F.gloss('#f2f3f4'));
  }
  {
    const Q = B.pen(cSt); Q.fill('all', grey);
    const sa = (x, f) => { const p = stab.at(x, f); return [p[0], p[2]]; };
    Q.fill([sa(0.9, 0), sa(6.2, 0), sa(6.2, 0.07), sa(0.9, 0.07)], metal);
    Q.line([sa(1.35, 1), sa(1.35, 0.7), sa(6.05, 0.7), sa(6.05, 1)], gap);
    for (const f of [0.25, 0.48]) Q.line([sa(0.9, f), sa(6.1, f)], line);
    for (const x of [2.3, 3.4, 4.5, 5.5]) Q.line([sa(x, 0.08), sa(x, 0.69)], line);
    Q.noise({ alpha: 0.045, scale: 2.5, stretch: [1, 2], rough: 0.04 });
  }
  for (const key of ['L', 'R']) {
    const Q = B.pen(cFin[key]); Q.fill('all', F.gloss(SC.tail));
    const fa = (y, f) => { const p = fin.at(y, f); return [p[2], p[1]]; };
    const c = fa(5.4, 0.42);
    if (SC.style === 'cheat') {           // white eight-point compass star inside a ring
      Q.decal(c[0], c[1], (g) => { g.strokeStyle = '#ffffff'; g.lineWidth = 0.14; g.beginPath(); g.arc(0, 0, 1.25, 0, Math.PI * 2); g.stroke(); drawStar(g, 1.05, '#ffffff'); });
    } else if (SC.style === 'sweep') {    // gold sun disc crossed by a stylised gliding bird
      Q.decal(c[0] + 0.2, c[1], (g) => {
        g.fillStyle = SC.accent; g.beginPath(); g.arc(0.25, -0.55, 0.95, 0, Math.PI * 2); g.fill();
        g.fillStyle = SC.tail; g.beginPath(); g.moveTo(-1.9, 0.1); g.quadraticCurveTo(-0.9, -1.0, 0.05, -0.1); g.quadraticCurveTo(1.1, -1.25, 2.2, -0.75);
        g.quadraticCurveTo(1.0, -0.65, 0.1, 0.45); g.quadraticCurveTo(-0.8, -0.35, -1.9, 0.1); g.closePath(); g.fill();
        g.strokeStyle = SC.accent; g.lineWidth = 0.14; g.lineCap = 'round'; g.beginPath(); g.moveTo(-1.6, 0.75); g.quadraticCurveTo(0.2, 0.05, 1.9, 0.35); g.stroke();
      });
    } else {                              // house: blue band along the root, grey "neo" mark
      Q.fill([fa(1.9, 0), fa(3.3, 0), fa(3.3, 1), fa(1.9, 1)], F.gloss(SC.accent));
      Q.text('neo', c[0] + 0.4, c[1] + 0.6, 1.1, { color: SC.accent, font: K.FONT.round, weight: 700 });
    }
    // floodlit by the logo lights at night (emissive layer, driven by the nav-light switch)
    { const e = fa(4.4, 0.45); Q.fill((g) => g.ellipse(e[0], e[1], 2.3, 2.0, 0, 0, Math.PI * 2), { emissive: SC.logoGlow || SC.tail }, { alpha: 0.55, feather: 60 }); }
    Q.fill([fa(2.0, 0), fa(8.5, 0), fa(8.5, 0.03), fa(2.0, 0.03)], metal);
    Q.line([fa(2.15, 1), fa(2.15, 0.71), fa(8.35, 0.69), fa(8.35, 1)], gap);
    for (const y of [4.2, 6.2]) Q.line([fa(y, 0.7), fa(y, 1)], line);
    for (const f of [0.25, 0.47]) Q.line([fa(2.2, f), fa(8.4, f)], line);
    Q.noise({ alpha: 0.03, scale: 3 });
  }
}

/** Eight-point compass star centred on the origin (canvas units = metres). */
function drawStar(g, r, col) {
  g.fillStyle = col; g.beginPath();
  for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.24 : i % 4 ? r * 0.55 : r; const x = Math.cos(a) * rr, y = Math.sin(a) * rr; if (i) g.lineTo(x, y); else g.moveTo(x, y); }
  g.closePath(); g.fill();
}
