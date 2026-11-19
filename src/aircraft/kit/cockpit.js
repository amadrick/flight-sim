// Aircraft kit — cockpit furniture: crew figures, ejection / airline seats, HUD, sticks, throttles, yokes, pedals, simple tubs.
// Everything is positioned from the pilot eye point (geometry.pilotEye) so the eye-point camera sits inside the helmet.
//
// Crew and seats share one layout so that a pilot always sits IN the seat built from the same eye point:
//   N = eye + (0, -0.155, +0.10)   base of the neck; the torso and the seat back recline about the X axis through it
//   torso frame (before the recline): y up along the spine, z aft; the seat back surface is the plane z = +0.115,
//   the seat pan surface meets it 0.60 below N. The head stays upright at the eye whatever the recline.
// Colours come from the swatch UVs a visual passes in; the extra colours a believable figure needs (skin, webbing, buckles,
// hazard stripes, headbox fabric…) are kit swatches made on the same atlas (found through the UV's `.atlas` tag) and can be
// overridden through additional optional `uv` keys.
import { Mesh, ellipsoid, tube, box, boxBetween, lathe, prism, shell, rbox, limb } from './mesh.js';
import { displayUV } from './displays.js';

const DEG = Math.PI / 180;
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const NECK = [0, -0.155, 0.10], BACK = 0.115, SRP = -0.60;
/** The atlas behind a swatch UV (atlas.swatch tags its results), or null. */
const atlasOf = (...uvs) => { for (const u of uvs) if (u && u.atlas) return u.atlas; return null; };
const firstUV = (uv) => { for (const k in uv) if (Array.isArray(uv[k])) return uv[k]; return [0, 0]; };
/** A kit swatch on atlas A, or the fallback UV when there is no atlas / no room. */
const ksw = (A, key, finish, fb) => (A && A.kitSwatch(key, finish)) || fb;
const KF = {
  skin: { color: '#b98a6a', rough: 0.62, metal: 0 }, webbing: { color: '#8b8e7a', rough: 0.86, metal: 0 }, buckle: { color: '#9a9da0', rough: 0.32, metal: 0.9 },
  vest: { color: '#4a503a', rough: 0.9, metal: 0 }, mask: { color: '#3c423a', rough: 0.55, metal: 0 }, hose: { color: '#2a2d2a', rough: 0.6, metal: 0 },
  boot: { color: '#161616', rough: 0.5, metal: 0 }, paper: { color: '#d9d5c6', rough: 0.8, metal: 0 }, edge: { color: '#17181a', rough: 0.7, metal: 0 },
  shirt: { color: '#e6e6e2', rough: 0.8, metal: 0 }, trousers: { color: '#1b202b', rough: 0.85, metal: 0 }, hair: { color: '#2a231d', rough: 0.9, metal: 0 },
  headset: { color: '#1d1e20', rough: 0.45, metal: 0 }, gold: { color: '#c9a545', rough: 0.4, metal: 0.8 }, shades: { color: '#0b0c0e', rough: 0.08, metal: 0 },
  fabric: { color: '#4b5040', rough: 0.93, metal: 0 }, pad: { color: '#1b1c1e', rough: 0.85, metal: 0 }, rail: { color: '#7d8184', rough: 0.42, metal: 0.85 },
  yellow: { color: '#d7b319', rough: 0.55, metal: 0 }, black: { color: '#131313', rough: 0.6, metal: 0 }, lens: { color: '#0d2217', rough: 0.05, metal: 0 },
  rubber: { color: '#1a1a1b', rough: 0.9, metal: 0 }, steel: { color: '#8a8d90', rough: 0.35, metal: 0.9 }, red: { color: '#b3261c', rough: 0.5, metal: 0 },
};
const bb = (x0, x1, y0, y1, z0, z1, uv) => boxBetween([Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)], [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)], uv);
/** Flat strap through points (webbing): width along `side`. */
const strap = (pts, w, uv, side = X, t = 0.0045) => limb(pts, pts.map(() => [w / 2, t]), { segments: 4, sub: 2, side, caps: 'none', uv });
/** Tube through points whose spans alternate between two swatches (hazard-striped handles). */
function striped(pts, r, uvA, uvB, per = 2) {
  const m = new Mesh(); let k = 0;
  for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < per; j++, k++) {
    const a = pts[i], b = pts[i + 1], f0 = j / per, f1 = (j + 1) / per, L = (f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    m.add(tube(L(f0), L(f1), r, r, { segments: 6, uv: k % 2 ? uvB : uvA, caps: i === 0 && j === 0 || (i === pts.length - 2 && j === per - 1) }));
  }
  for (let i = 1; i < pts.length - 1; i++) m.add(ellipsoid(r, r, r, { segments: 6, rings: 4, uv: uvA }).translate(...pts[i]));
  return m;
}
/** Two-bone IK: the joint between a (root) and c (tip) for bone lengths l1, l2, bent toward `pole`. */
function elbow(a, c, l1, l2, pole) {
  const d = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], D = Math.hypot(...d) || 1e-6, L = clamp(D, Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const x = (L * L + l1 * l1 - l2 * l2) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - x * x)), u = d.map(q => q / D);
  const pd = pole[0] * u[0] + pole[1] * u[1] + pole[2] * u[2]; let pp = [pole[0] - u[0] * pd, pole[1] - u[1] * pd, pole[2] - u[2] * pd]; const pl = Math.hypot(...pp) || 1; pp = pp.map(q => q / pl);
  const k = D / L;                                                   // an out-of-reach target stretches the chain instead of breaking it
  return [a[0] + (u[0] * x + pp[0] * h) * k, a[1] + (u[1] * x + pp[1] * h) * k, a[2] + (u[2] * x + pp[2] * h) * k];
}

/**
 * Seated crew member. Returns a Mesh with one morph target (head turn; the rig drives it when the mesh becomes a part).
 * opts: {
 *   eye: [x, y, z], kind = 'fighter' | 'airline',
 *   uv: { suit, helmet, visor, dark, glove }   as before; every other colour is optional:
 *        { skin, harness, buckle, vest, mask, hose, boot, paper, shirt, trousers, hair, headset, gold, shades }
 *   stick: 'side' | 'centre' | 'yoke' | [x, y, z]   right hand, relative to the eye;   throttle: [x, y, z]   left hand
 *   recline = 0 (deg, torso and thighs follow the seat),   mask = true (false: full-face pressure helmet),
 *   knee, foot: [x, y, z] (right leg, relative to the eye; mirrored for the left; defaults from the recline),
 *   kneeboard = true (fighter), stripes = 4 (airline epaulettes), headTurn = true, scale = 1 }
 * The figure's head is centred 85 mm behind the eye point; hide the part from the cockpit camera.
 */
export function pilot(o) {
  const e = o.eye, uvIn = o.uv || {}, k = o.scale ?? 1, airline = o.kind === 'airline', m = new Mesh();
  const A = atlasOf(...Object.values(uvIn)), fb = uvIn.suit || uvIn.dark || firstUV(uvIn), dark = uvIn.dark || fb;
  const U = {
    suit: uvIn.suit || fb, helmet: uvIn.helmet || fb, visor: uvIn.visor || dark, dark, glove: uvIn.glove || dark,
    skin: uvIn.skin || ksw(A, 'crew.skin', KF.skin, airline ? fb : uvIn.glove || dark), web: uvIn.harness || ksw(A, 'crew.webbing', KF.webbing, dark),
    buckle: uvIn.buckle || ksw(A, 'crew.buckle', KF.buckle, dark), vest: uvIn.vest || ksw(A, 'crew.vest', KF.vest, uvIn.suit || fb),
    mask: uvIn.mask || ksw(A, 'crew.mask', KF.mask, dark), hose: uvIn.hose || ksw(A, 'crew.hose', KF.hose, dark), boot: uvIn.boot || ksw(A, 'crew.boot', KF.boot, dark),
    paper: uvIn.paper || ksw(A, 'crew.paper', KF.paper, uvIn.helmet || fb), edge: ksw(A, 'crew.edge', KF.edge, dark),
  };
  if (airline) Object.assign(U, {
    shirt: uvIn.shirt || ksw(A, 'crew.shirt', KF.shirt, uvIn.helmet || fb), trousers: uvIn.trousers || uvIn.suit || ksw(A, 'crew.trousers', KF.trousers, dark),
    hair: uvIn.hair || ksw(A, 'crew.hair', KF.hair, dark), headset: uvIn.headset || ksw(A, 'crew.headset', KF.headset, dark),
    gold: uvIn.gold || ksw(A, 'crew.gold', KF.gold, uvIn.helmet || fb), shades: uvIn.shades || ksw(A, 'crew.shades', KF.shades, dark), web: uvIn.harness || ksw(A, 'crew.belt', { color: '#34373b', rough: 0.85, metal: 0 }, dark),
  });
  const th = (o.recline ?? 0) * DEG, cs = Math.cos(th), sn = Math.sin(th);
  const tp = (x, y, z) => [x, NECK[1] + y * cs - z * sn, NECK[2] + y * sn + z * cs];   // torso frame → eye frame
  const H = [0, -0.02, 0.085], hp = (x, y, z) => [H[0] + x, H[1] + y, H[2] + z];
  const cloth = airline ? U.shirt : U.suit;

  // ---- torso (built upright in the torso frame, then reclined about the neck) ------------------------------------------------
  const body = new Mesh(), slim = airline ? 0.93 : 1;
  const TR = [[-0.60, -0.03, 0.095, 0.145, 2.4], [-0.54, -0.03, 0.125, 0.185, 2.6], [-0.45, -0.02, 0.122, 0.178, 2.6], [-0.35, -0.012, 0.112, 0.165, 2.5], [-0.24, -0.015, 0.122, 0.185, 2.6],
    [-0.13, -0.012, 0.118, 0.2, 2.8], [-0.065, 0, 0.098, 0.19, 2.6], [-0.03, 0.01, 0.075, 0.125, 2.2], [0, 0.015, 0.062, 0.068, 2], [0.035, 0.015, 0.058, 0.06, 2]];
  const rings = [{ c: [0, -0.615, -0.03], u: Z, v: X, rx: 0, ry: 0 }];
  for (const [y, cz, d, l, n] of TR) rings.push({ c: [0, y, cz], u: Z, v: X, rx: d * (y < -0.1 ? slim : 1), ry: l * (y < -0.1 && y > -0.5 ? slim : 1), n, uv: airline && y < -0.47 ? U.trousers : cloth });
  body.add(shell(rings, { segments: 14 }));
  const front = (x, y) => {                                           // z of the chest surface at (x, y) in the torso frame
    let i = 0; while (i < TR.length - 2 && TR[i + 1][0] < y) i++;
    const a = TR[i], b = TR[i + 1], f = clamp((y - a[0]) / (b[0] - a[0]), 0, 1), cz = a[1] + (b[1] - a[1]) * f, d = (a[2] + (b[2] - a[2]) * f) * (y < -0.1 ? slim : 1), l = (a[3] + (b[3] - a[3]) * f) * (y < -0.1 && y > -0.5 ? slim : 1), n = a[4] + (b[4] - a[4]) * f;
    return cz - d * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(x) / l), n)), 1 / n);
  };
  const on = (x, y, lift = 0.007) => [x, y, front(x, y) - lift];
  if (!airline) {
    // life preserver lobes around the collar and down the chest, pouches of the survival vest
    for (const sx of [-1, 1]) {
      body.add(limb([[sx * 0.04, 0.0, 0.07], [sx * 0.1, -0.012, 0.03], [sx * 0.128, -0.06, front(0.128, -0.06) + 0.012], [sx * 0.128, -0.15, front(0.128, -0.15) - 0.006], [sx * 0.118, -0.25, front(0.118, -0.25) - 0.004]],
        [[0.03, 0.02], [0.036, 0.022], [0.042, 0.026], [0.044, 0.027], [0.034, 0.02]], { segments: 8, sub: 2, uv: U.vest }));
      body.add(rbox(0.085, 0.1, 0.034, 0.012, { segments: 10, uv: U.vest }).translate(sx * 0.105, -0.345, front(0.105, -0.345) - 0.012));
    }
  }
  // harness: main lift webs, chest strap, shoulder straps running back to the seat's inertia reel, lap belt
  const xs = airline ? 0.075 : 0.06;
  for (const sx of [-1, 1]) {
    body.add(strap([on(sx * (xs + 0.022), -0.055), on(sx * (xs + 0.012), -0.13), on(sx * xs, -0.24), on(sx * xs, -0.35), on(sx * (xs + 0.012), -0.45), on(sx * (xs + 0.03), -0.535)], 0.044, U.web));
    body.add(strap([on(sx * (xs + 0.022), -0.055), [sx * (xs + 0.024), 0.0, -0.03], [sx * (xs + 0.02), 0.014, 0.06], [sx * (xs + 0.008), 0.035, 0.13]], 0.044, U.web));
    if (!airline) body.add(box(0.036, 0.044, 0.02, U.buckle).translate(sx * (xs + 0.022), -0.062, front(xs + 0.022, -0.062) - 0.013));       // riser release fittings
    body.add(strap([[sx * 0.19, -0.5, 0.0], on(sx * 0.15, -0.49), on(sx * 0.07, -0.485), on(0, -0.485)], 0.046, U.web, Y));
  }
  body.add(box(0.05, 0.05, 0.016, U.buckle).translate(0, -0.485, front(0, -0.485) - 0.014));
  if (!airline) {
    body.add(strap([on(-xs, -0.2), on(0, -0.2), on(xs, -0.2)], 0.034, U.web, Y));
    body.add(box(0.03, 0.03, 0.016, U.buckle).translate(0.02, -0.2, front(0.02, -0.2) - 0.014));
    body.add(box(0.036, 0.052, 0.03, U.hose).translate(xs, -0.275, front(xs, -0.275) - 0.02));                                               // oxygen connector on the right chest strap
  } else {
    // tie and epaulettes
    body.add(strap([on(0, -0.045, 0.004), on(0, -0.2, 0.004), on(0, -0.4, 0.004)], 0.042, U.trousers, X, 0.003));
    for (const sx of [-1, 1]) {
      body.add(box(0.1, 0.01, 0.052, U.trousers).rotateZ(-sx * 0.2).translate(sx * 0.14, -0.047, 0.012));
      const ns = o.stripes ?? 4; for (let i = 0; i < ns; i++) body.add(box(0.009, 0.012, 0.053, U.gold).rotateZ(-sx * 0.2).translate(sx * (0.175 - i * 0.017), -0.054 + i * 0.0034, 0.012));
    }
  }
  body.rotateX(th).translate(NECK[0], NECK[1], NECK[2]);
  m.add(body);
  // neck
  m.add(limb([tp(0, 0.02, 0.015), hp(0, -0.075, 0.02)], [0.058, 0.055], { segments: 10, sub: 2, caps: 'none', uv: airline ? U.skin : cloth }));

  // ---- arms -----------------------------------------------------------------------------------------------------------------
  const hands = { side: [0.3, -0.5, -0.3], centre: [0.04, -0.52, -0.38], yoke: [0.16, -0.36, -0.52] };
  const rh = Array.isArray(o.stick) ? o.stick : hands[o.stick || 'centre'], lh = o.throttle || (o.stick === 'yoke' ? [-0.16, -0.36, -0.52] : [-0.3, -0.5, -0.36]);
  for (const [sx, hd] of [[1, rh], [-1, lh]]) {
    const sh = tp(sx * 0.2, -0.085, 0.0), el = elbow(sh, hd, 0.3, 0.29, [sx * 0.55, -0.75, 0.4]);
    const fd = [hd[0] - el[0], hd[1] - el[1], hd[2] - el[2]], fl = Math.hypot(...fd) || 1, wr = [hd[0] - fd[0] / fl * 0.05, hd[1] - fd[1] / fl * 0.05, hd[2] - fd[2] / fl * 0.05];
    if (airline) {                                                    // short sleeves
      const mid = [sh[0] + (el[0] - sh[0]) * 0.62, sh[1] + (el[1] - sh[1]) * 0.62, sh[2] + (el[2] - sh[2]) * 0.62];
      m.add(limb([sh, mid], [0.056, 0.052], { segments: 8, sub: 2, uv: U.shirt }));
      m.add(limb([mid, el, wr], [0.042, 0.04, 0.03], { segments: 8, sub: 3, uv: U.skin }));
    } else m.add(limb([sh, el, wr], [0.056, 0.047, 0.037], { segments: 8, sub: 3, uv: U.suit }));
    const hu = airline ? U.skin : U.glove;
    if (!airline) m.add(limb([[wr[0] - fd[0] / fl * 0.06, wr[1] - fd[1] / fl * 0.06, wr[2] - fd[2] / fl * 0.06], wr], [0.044, 0.041], { segments: 8, sub: 1, caps: 'flat', uv: hu }));   // gauntlet cuff
    m.add(ellipsoid(0.04, 0.036, 0.05, { segments: 8, rings: 5, uv: hu }).aim(fd).translate(hd[0], hd[1], hd[2]));
    m.add(limb([[hd[0] - sx * 0.022, hd[1] + 0.012, hd[2]], [hd[0] - sx * 0.036, hd[1] + 0.04, hd[2] - 0.022]], [0.013, 0.011], { segments: 5, sub: 1, uv: hu }));                           // thumb
  }

  // ---- legs: thighs follow the seat pan, shins run down to the pedals -----------------------------------------------------
  const pan = clamp((o.recline ?? 0) - 13, -6, 20) * 0.8 + 4, pa = pan * DEG;
  const kneeR = o.knee || null, footR = o.foot || null;
  for (const sx of [-1, 1]) {
    const hip = tp(sx * 0.095, -0.535, -0.035);
    const knee = kneeR ? [sx * kneeR[0], kneeR[1], kneeR[2]] : [hip[0] + sx * 0.055, hip[1] + 0.44 * Math.sin(pa) + 0.02, hip[2] - 0.44 * Math.cos(pa)];
    const ank = footR ? [sx * footR[0], footR[1], footR[2]] : [knee[0], knee[1] - 0.36, knee[2] - 0.24];
    m.add(limb([tp(sx * 0.09, -0.52, 0.03), hip, knee, ank], [[0.08, 0.075], [0.086, 0.08], 0.064, 0.05], { segments: 10, sub: 3, uv: airline ? U.trousers : U.suit }));
    m.add(limb([[ank[0], ank[1] + 0.07, ank[2] + 0.025], [ank[0], ank[1] - 0.02, ank[2] + 0.005], [ank[0], ank[1] - 0.07, ank[2] - 0.06], [ank[0], ank[1] - 0.07, ank[2] - 0.2]],
      [0.052, [0.05, 0.054], [0.046, 0.04], [0.041, 0.03]], { segments: 8, sub: 2, side: X, uv: U.boot }));
    if (!airline && sx > 0 && o.kneeboard !== false) {                // kneeboard strapped to the right thigh
      const c = [hip[0] + (knee[0] - hip[0]) * 0.7, hip[1] + (knee[1] - hip[1]) * 0.7 + 0.075, hip[2] + (knee[2] - hip[2]) * 0.7];
      m.add(box(0.125, 0.012, 0.17, U.dark).rotateX(pa).translate(c[0], c[1], c[2]));
      m.add(box(0.105, 0.004, 0.14, U.paper).rotateX(pa).translate(c[0], c[1] + 0.008, c[2]));
    }
  }

  // ---- head (everything from here on turns with the head) --------------------------------------------------------------------
  const head0 = m.vertexCount;
  const patch = (lat, vert, dep, a0, a1, yTop, yBot, na, nv, uv, cy = 0) => {   // band on an ellipsoid about H: azimuth a (0 = forward), from yTop down to yBot(a)
    const g = new Mesh();
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= na; i++) {
      const a = (a0 + (a1 - a0) * i / na) * DEG, yb = typeof yBot === 'function' ? yBot(a / DEG) : yBot, y = yTop + (yb - yTop) * j / nv, q = Math.sqrt(Math.max(0.02, 1 - (y - cy) * (y - cy) / (vert * vert)));
      const x = lat * q * Math.sin(a), z = -dep * q * Math.cos(a), nx = x / (lat * lat), ny = (y - cy) / (vert * vert), nz = z / (dep * dep), l = Math.hypot(nx, ny, nz) || 1;
      g.vert(H[0] + x, H[1] + y, H[2] + z, nx / l, ny / l, nz / l, uv[0], uv[1]);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < na; i++) { const q = j * (na + 1) + i; g.quad(q, q + na + 1, q + na + 2, q + 1); }
    return g;
  };
  if (!airline) {
    // helmet shell
    const HR = [[-0.105, 0.085, 0.078, 0.012], [-0.085, 0.098, 0.092, 0.01], [-0.045, 0.118, 0.106, 0.006], [0, 0.13, 0.112, 0], [0.045, 0.128, 0.11, 0], [0.085, 0.108, 0.094, 0.002], [0.11, 0.075, 0.066, 0.004], [0.124, 0.035, 0.03, 0.004]];
    const hr = [{ c: hp(0, -0.105, 0.012), u: Z, v: X, rx: 0, ry: 0, uv: U.edge }, { c: hp(0, -0.105, 0.012), u: Z, v: X, rx: 0.085, ry: 0.078, uv: U.edge }];
    for (const [y, d, l, cz] of HR) hr.push({ c: hp(0, y, cz), u: Z, v: X, rx: d, ry: l, n: 2.15, uv: y < -0.09 ? U.edge : U.helmet, hard: y === -0.105 });
    hr.push({ c: hp(0, 0.128, 0.004), u: Z, v: X, rx: 0, ry: 0, uv: U.helmet });
    m.add(shell(hr, { segments: 16 }));
    const full = o.mask === false;                                    // pressure helmet: the visor covers the whole face
    m.add(patch(0.1145, 0.123, 0.1345, -82, 82, 0.06, full ? (a) => -0.085 + 0.03 * (a / 82) * (a / 82) : (a) => -0.05 + 0.04 * (a / 82) * (a / 82), 12, 4, U.visor));
    m.add(limb([-82, -41, 0, 41, 82].map((a) => { const q = Math.sqrt(1 - 0.062 * 0.062 / (0.123 * 0.123)); return hp(0.117 * q * Math.sin(a * DEG), 0.062, -0.137 * q * Math.cos(a * DEG)); }), 0.006, { segments: 5, sub: 2, uv: U.edge }));   // visor edge roll
    for (const sx of [-1, 1]) {
      m.add(ellipsoid(0.012, 0.022, 0.022, { segments: 8, rings: 4, uv: U.edge }).translate(...hp(sx * 0.112, 0.03, -0.012)));                 // visor pivot knobs
      m.add(ellipsoid(0.02, 0.05, 0.045, { segments: 8, rings: 5, uv: U.helmet }).translate(...hp(sx * 0.1, -0.04, 0.02)));                    // ear cups
    }
    if (!full) {
      const w = [0, -Math.sin(12 * DEG), -Math.cos(12 * DEG)], v = [0, -Math.cos(12 * DEG), Math.sin(12 * DEG)], c0 = hp(0, -0.06, -0.082);
      const mr = [[0, 0.05, 0.054], [0.03, 0.047, 0.051], [0.056, 0.037, 0.041], [0.072, 0.025, 0.028], [0.078, 0, 0]].map(([t, rx, ry]) => ({ c: [c0[0], c0[1] + w[1] * t, c0[2] + w[2] * t], u: X, v, rx, ry, n: 2.5 }));
      m.add(shell(mr, { segments: 10, uv: U.mask }));
      const vc = (t, d) => [c0[0], c0[1] + w[1] * t + v[1] * d, c0[2] + w[2] * t + v[2] * d];
      m.add(tube(vc(0.062, 0.016), vc(0.09, 0.02), 0.015, 0.013, { segments: 8, uv: U.hose }));                                                 // exhalation valve
      for (const sx of [-1, 1]) m.add(strap([hp(sx * 0.044, -0.058, -0.112), hp(sx * 0.086, -0.056, -0.078), hp(sx * 0.108, -0.052, -0.03)], 0.026, U.edge, Y, 0.004));
    } else m.add(lathe([[0.072, -0.012], [0.086, -0.008, 1], [0.086, 0.008, 1], [0.072, 0.012]], { segments: 14, uv: U.buckle }).rotateX(-Math.PI / 2).translate(...hp(0, -0.108, 0.014)));   // neck ring
  } else {
    m.add(ellipsoid(0.077, 0.1, 0.093, { segments: 14, rings: 9, uv: U.skin }).rotateX(Math.PI / 2).translate(H[0], H[1], H[2]));
    m.add(ellipsoid(0.081, 0.099, 0.099, { segments: 14, rings: 7, z0: -0.12, z1: 1, uv: U.hair }).rotateX(-52 * DEG).translate(...hp(0, 0.004, 0.004)));
    m.add(ellipsoid(0.011, 0.02, 0.018, { segments: 6, rings: 4, uv: U.skin }).translate(...hp(0, -0.012, -0.094)));
    m.add(patch(0.08, 0.103, 0.097, -62, 62, 0.022, -0.006, 8, 1, U.shades));
    for (const sx of [-1, 1]) m.add(tube(hp(sx * 0.07, -0.005, 0.008), hp(sx * 0.098, -0.005, 0.008), 0.036, 0.032, { segments: 10, uv: U.headset }));
    m.add(limb([-78, -39, 0, 39, 78].map((a) => hp(0.09 * Math.sin(a * DEG), 0.107 * Math.cos(a * DEG) - 0.004, 0.008)), [0, 1, 2, 3, 4].map(() => [0.006, 0.012]), { segments: 5, sub: 2, side: Z, uv: U.headset }));
    m.add(limb([hp(-0.09, -0.03, 0.0), hp(-0.08, -0.062, -0.055), hp(-0.03, -0.068, -0.096)], 0.004, { segments: 4, sub: 2, uv: U.headset }));
    m.add(ellipsoid(0.009, 0.009, 0.013, { segments: 6, rings: 4, uv: U.headset }).translate(...hp(-0.024, -0.068, -0.099)));
  }
  const head1 = m.vertexCount;
  // oxygen hose: corrugated, from the mask down to the connector on the chest (bends with the head)
  if (!airline && o.mask !== false) m.add(limb([hp(0, -0.1, -0.128), hp(0.012, -0.15, -0.125), tp(0.05, -0.2, front(0.05, -0.2) - 0.035), tp(xs, -0.262, front(xs, -0.262) - 0.03)], 0.0155, { segments: 6, sub: 4, ripple: 0.1, caps: 'none', uv: U.hose }));
  const hose1 = m.vertexCount;

  if (o.headTurn !== false) {
    // head turn as ONE linear morph target (a small rotation about the neck: influence = angle in radians, either sign)
    m.enableMorph(); m.morphOptional = true;
    const px = 0, pz = 0.07, yLo = tp(0, -0.262, 0)[1], yHi = H[1] - 0.1;
    for (let i = head0; i < hose1; i++) {
      const x = m.p[i * 3], y = m.p[i * 3 + 1], z = m.p[i * 3 + 2], w = i < head1 ? 1 : clamp((y - yLo) / (yHi - yLo), 0, 1) ** 2;
      m.setMorph(i, x + (z - pz) * w, y, z - (x - px) * w);
    }
    m.onPart = (node, rig) => {
      let yaw = 0; const ph = Math.random() * 6;
      rig.onUpdate((S, dt) => {
        if (!node.visible || !node.morphTargetInfluences) return;
        const roll = (S.sf.aileronR - S.sf.aileronL) * 0.5;           // + = rolling right: look into the turn, plus a slow scan
        const want = clamp(roll * 0.3 + 0.05 * Math.sin(S.t * 0.37 + ph) + 0.03 * Math.sin(S.t * 0.83 + ph * 2), -0.3, 0.3);
        yaw += (want - yaw) * (1 - Math.exp(-3 * dt));
        node.morphTargetInfluences[0] = -yaw;                          // positive influence turns the head left
      });
    };
  }
  if (k !== 1) m.scale(k);
  return m.translate(e[0], e[1], e[2]);
}

/**
 * Ejection seat (ACES II-like): bucket with side walls and cushion, back pad, parachute container / headrest with canopy
 * breakers, guide rails, rocket catapult tube, hazard-striped ejection handle(s).
 * opts: { eye, recline = 15 (deg), width = .46, handles = 'centre' | 'side' | 'both' | 'none',
 *         uv: { frame, cushion, accent } as before + optional { fabric (headbox), pad (headrest), rail, black } }
 */
export function ejectionSeat(o) {
  const e = o.eye, uv = o.uv, w = o.width ?? 0.46, hw = w / 2, th = (o.recline ?? 15) * DEG, A = atlasOf(uv.frame, uv.cushion, uv.accent);
  const U = {
    frame: uv.frame, cushion: uv.cushion, fabric: uv.fabric || ksw(A, 'seat.fabric', KF.fabric, uv.cushion), pad: uv.pad || ksw(A, 'seat.pad', KF.pad, uv.frame),
    rail: uv.rail || ksw(A, 'seat.rail', KF.rail, uv.frame), yellow: uv.accent || ksw(A, 'seat.yellow', KF.yellow, uv.frame), black: uv.black || ksw(A, 'seat.black', KF.black, uv.frame),
    web: uv.harness || ksw(A, 'crew.webbing', KF.webbing, uv.cushion),
  };
  const s = new Mesh(), B = BACK;
  // back: structure plate, pad, side beams, guide rails behind, catapult tube
  s.add(bb(-hw, hw, -0.72, 0.03, B + 0.05, B + 0.085, U.frame));
  s.add(rbox(w * 0.76, 0.5, 0.05, 0.02, { uv: U.cushion }).translate(0, -0.33, B + 0.027));
  for (const sx of [-1, 1]) {
    s.add(bb(sx * (hw - 0.004), sx * (hw + 0.026), -0.76, 0.34, B + 0.03, B + 0.12, U.frame));
    s.add(bb(sx * (hw - 0.05), sx * (hw - 0.012), -0.8, 0.46, B + 0.125, B + 0.16, U.rail));
    for (let i = 0; i < 5; i++) s.add(tube([sx * (hw + 0.026), -0.66 + i * 0.22, B + 0.075], [sx * (hw + 0.034), -0.66 + i * 0.22, B + 0.075], 0.018, 0.018, { segments: 8, uv: U.rail }));   // rollers
  }
  s.add(tube([0, -0.76, B + 0.2], [0, 0.3, B + 0.2], 0.05, 0.05, { segments: 12, uv: U.rail }));
  s.add(bb(-hw * 0.7, hw * 0.7, -0.6, -0.2, B + 0.085, B + 0.15, U.frame));
  // parachute container / headrest, canopy breakers, sensor arms
  s.add(rbox(w * 0.92, 0.31, 0.2, 0.028, { uv: U.fabric }).translate(0, 0.175, B + 0.14));
  s.add(rbox(0.23, 0.2, 0.045, 0.016, { uv: U.pad }).translate(0, 0.17, B + 0.034));
  for (const sx of [-1, 1]) {
    s.add(prism([[B + 0.06, 0.32], [B + 0.215, 0.32], [B + 0.215, 0.37], [B + 0.11, 0.45], [B + 0.07, 0.41]], sx * hw * 0.74 - 0.011, sx * hw * 0.74 + 0.011, U.rail));
    s.add(tube([sx * (hw * 0.92 + 0.012), 0.26, B + 0.19], [sx * (hw * 0.92 + 0.012), 0.36, B + 0.17], 0.009, 0.009, { segments: 6, uv: U.rail }));
    s.add(strap([[sx * 0.075, 0.03, B + 0.045], [sx * 0.08, 0.012, B + 0.02], [sx * 0.082, -0.1, B - 0.004], [sx * 0.085, -0.3, B - 0.003]], 0.044, U.web));   // shoulder straps hanging down the pad
  }
  // pan: bucket, side walls, cushion; the seat is rigid, so the pan tips up at the front as the seat reclines past 13°
  const pan = new Mesh();
  pan.add(bb(-hw, hw, -0.19, -0.05, -0.43, 0.07, U.frame));
  for (const sx of [-1, 1]) pan.add(prism([[0.07, -0.05], [0.07, 0.1], [-0.1, 0.085], [-0.38, 0.02], [-0.43, -0.05]], sx * (hw - 0.018), sx * hw, U.frame));
  pan.add(rbox(w - 0.07, 0.056, 0.4, 0.022, { uv: U.cushion }).translate(0, -0.024, -0.19));
  pan.add(bb(-hw * 0.5, hw * 0.5, -0.17, -0.07, -0.445, -0.43, U.black));                                    // survival-kit release panel
  const hd = o.handles ?? 'centre';
  if (hd === 'centre' || hd === 'both') pan.add(striped([[-0.045, -0.04, -0.435], [-0.052, 0.025, -0.45], [-0.03, 0.075, -0.462], [0.03, 0.075, -0.462], [0.052, 0.025, -0.45], [0.045, -0.04, -0.435]], 0.0105, U.yellow, U.black));
  if (hd === 'side' || hd === 'both') for (const sx of [-1, 1]) pan.add(striped([[sx * (hw + 0.004), 0.0, -0.37], [sx * (hw + 0.03), 0.05, -0.31], [sx * (hw + 0.03), 0.085, -0.17], [sx * (hw + 0.004), 0.085, -0.1]], 0.0105, U.yellow, U.black));
  for (const sx of [-1, 1]) pan.add(strap([[sx * (hw - 0.02), 0.06, 0.0], [sx * (hw - 0.05), 0.02, -0.06], [sx * 0.1, 0.008, -0.13], [sx * 0.035, 0.008, -0.15]], 0.046, U.web, Z));   // lap belt halves
  s.add(pan.rotateX(-13 * DEG).translate(0, SRP, B));
  return s.rotateX(th).translate(e[0] + NECK[0], e[1] + NECK[1], e[2] + NECK[2]);
}

/**
 * Airline crew seat: pedestal on floor tracks, pan and back cushions (pass a sheepskin colour as `cushion`), headrest,
 * folding armrests, five-point harness. opts: { eye, recline = 8 (deg), width = .5, armrests = true,
 *   uv: { frame, cushion } + optional { harness, buckle } }
 */
export function crewSeat(o) {
  const e = o.eye, uv = o.uv, w = o.width ?? 0.5, hw = w / 2, th = (o.recline ?? 8) * DEG, A = atlasOf(uv.frame, uv.cushion);
  const U = { frame: uv.frame, cushion: uv.cushion, web: uv.harness || ksw(A, 'crew.belt', { color: '#34373b', rough: 0.85, metal: 0 }, uv.frame), buckle: uv.buckle || ksw(A, 'crew.buckle', KF.buckle, uv.frame) };
  const m = new Mesh(), B = BACK, s = new Mesh();
  // back shell + cushions + headrest (torso frame)
  s.add(rbox(w * 0.94, 0.7, 0.05, 0.02, { n: 5, uv: U.frame }).translate(0, -0.27, B + 0.075));
  s.add(rbox(w * 0.9, 0.44, 0.07, 0.03, { n: 5, uv: U.cushion }).translate(0, -0.2, B + 0.03));
  s.add(rbox(w * 0.9, 0.2, 0.085, 0.035, { n: 5, uv: U.cushion }).translate(0, -0.5, B + 0.03));               // lumbar roll
  for (const sx of [-1, 1]) s.add(rbox(0.07, 0.6, 0.1, 0.03, { segments: 10, uv: U.cushion }).translate(sx * (hw * 0.9 - 0.02), -0.3, B + 0.02));   // side bolsters
  s.add(rbox(0.27, 0.18, 0.09, 0.035, { n: 4, uv: U.cushion }).translate(0, 0.2, B + 0.055));
  for (const sx of [-1, 1]) s.add(tube([sx * 0.07, 0.06, B + 0.07], [sx * 0.07, 0.14, B + 0.07], 0.01, 0.01, { segments: 6, uv: U.frame }));
  for (const sx of [-1, 1]) s.add(strap([[sx * 0.08, 0.075, B + 0.07], [sx * 0.085, 0.05, B - 0.004], [sx * 0.09, -0.2, B - 0.01], [sx * 0.1, -0.42, B - 0.012]], 0.045, U.web));
  if (o.armrests !== false) for (const sx of [-1, 1]) {
    s.add(rbox(0.06, 0.04, 0.36, 0.016, { segments: 10, uv: U.frame }).translate(sx * (hw + 0.035), -0.36, B - 0.17));
    s.add(bb(sx * (hw + 0.02), sx * (hw + 0.05), -0.5, -0.37, B - 0.02, B + 0.04, U.frame));
  }
  m.add(s.rotateX(th).translate(e[0] + NECK[0], e[1] + NECK[1], e[2] + NECK[2]));
  // pan (level), pedestal and floor tracks; the pan surface sits where the hips are
  const sy = e[1] + NECK[1] + SRP * Math.cos(th) - B * Math.sin(th), sz = e[2] + NECK[2] + SRP * Math.sin(th) + B * Math.cos(th), p = new Mesh();
  p.add(rbox(w, 0.1, 0.5, 0.04, { n: 5, uv: U.cushion }).translate(0, -0.045, -0.22));
  p.add(rbox(w * 0.98, 0.07, 0.5, 0.02, { n: 6, uv: U.frame }).translate(0, -0.125, -0.22));
  p.add(bb(-0.17, 0.17, -0.42, -0.15, -0.4, -0.04, U.frame));
  for (const sx of [-1, 1]) {
    p.add(bb(sx * 0.2, sx * 0.24, -0.47, -0.42, -0.62, 0.3, U.frame));                                                                        // floor tracks
    p.add(strap([[sx * (hw - 0.02), -0.01, -0.02], [sx * (hw - 0.07), 0.012, -0.1], [sx * 0.04, 0.012, -0.17]], 0.046, U.web, Z));
    p.add(tube([sx * (hw + 0.005), -0.12, -0.36], [sx * (hw + 0.035), -0.12, -0.36], 0.016, 0.016, { segments: 8, uv: U.buckle }));        // adjustment levers
  }
  p.add(box(0.06, 0.02, 0.06, U.buckle).translate(0, 0.018, -0.18));
  p.add(strap([[0, 0.016, -0.2], [0, 0.008, -0.34], [0, -0.06, -0.47]], 0.04, U.web));                                                        // crotch strap
  return m.add(p.translate(e[0], sy, sz));
}

/**
 * Head-up display: returns { glass, frame }. The combiner is a tilted plate centred on the pilot's forward sight line
 * (draw `glass` with glassMaterial(ctx, GLASS.hud)); `frame` holds the combiner arms and the projector housing with its
 * collimating lens under the glass.
 * opts: { eye, dist = .62 (ahead of the eye), width = .17, height = .15, drop = .03, tilt = 24 (deg, top edge toward the pilot), uv, uvLens }
 */
export function hud(o) {
  const e = o.eye, dist = o.dist ?? 0.62, w = o.width ?? 0.17, h = o.height ?? 0.15, uv = o.uv, y = e[1] - (o.drop ?? 0.03), z = e[2] - dist, tl = (o.tilt ?? 24) * DEG;
  const A = atlasOf(uv), uvLens = o.uvLens || ksw(A, 'hud.lens', KF.lens, uv), ct = Math.cos(tl), st = Math.sin(tl);
  const glass = box(w, h, 0.006, [0, 0]).rotateX(tl).translate(e[0], y, z);
  const frame = new Mesh(), yb = y - h / 2 * ct, zb = z - h / 2 * st;   // bottom edge of the glass
  for (const sx of [-1, 1]) {
    frame.add(box(0.007, h * 1.02, 0.018, uv).rotateX(tl).translate(e[0] + sx * (w / 2 + 0.0035), y, z));
    frame.add(prism([[zb - 0.05, yb - 0.012], [zb + 0.012, yb - 0.012], [zb + 0.012 + h * 0.3 * st, yb + h * 0.3 * ct], [zb + h * 0.22 * st, yb + h * 0.22 * ct]], e[0] + sx * (w / 2 + 0.007), e[0] + sx * (w / 2 + 0.013), uv));   // arm gussets
  }
  frame.add(box(w + 0.026, 0.012, 0.02, uv).rotateX(tl).translate(e[0], yb - 0.004, zb));
  const yT = yb - 0.012, zF = zb - 0.15, zA = zb + 0.05, hx = w * 0.75;
  frame.add(prism([[zF, yT - 0.085], [zF, yT - 0.03], [zF + 0.04, yT], [zA - 0.02, yT], [zA, yT - 0.03], [zA, yT - 0.085]], e[0] - hx, e[0] + hx, uv));
  const rl = Math.min(w * 0.4, 0.07);
  frame.add(lathe([[rl * 1.16, -0.002], [rl * 1.16, 0.007, 1], [rl * 1.03, 0.007, 1], [rl, 0.002]], { segments: 16, uv }).rotateX(-Math.PI / 2).translate(e[0], yT, zb - 0.055));
  frame.add(lathe([[rl, 0.002], [rl * 0.72, 0.008], [rl * 0.36, 0.012], [0, 0.013]], { segments: 16, uv: uvLens }).rotateX(-Math.PI / 2).translate(e[0], yT, zb - 0.055));
  // symbology: drawn additively on the pilot's side of the combiner (kit 'hud' material, POST layer, seen only from the cockpit)
  if (o.symbology !== false) {
    const sym = frame.sidecar('hud'), sw = w * 0.94, sh = h * 0.94, i0 = sym.vertexCount;
    for (const [x, yy, u, v] of [[-sw / 2, -sh / 2, 0, 1], [sw / 2, -sh / 2, 1, 1], [sw / 2, sh / 2, 1, 0], [-sw / 2, sh / 2, 0, 0]]) { const q = displayUV('hud', u, v); sym.vert(x, yy, 0.0045, 0, 0, 1, q[0], q[1]); }
    sym.quad(i0, i0 + 1, i0 + 2, i0 + 3);
    sym.rotateX(tl).translate(e[0], y, z);
  }
  return { glass, frame };
}

/**
 * A display unit (MFD / PFD / ND / EICAS…): bezel and housing in the visual's atlas colour, the screen on the kit 'display'
 * material (emissive page from the shared display texture, dimmed at night by the rig). Faces +Z (toward the pilot) before
 * the tilt. opts: { centre: [x, y, z], width = .2, height = width, tilt = 12 (deg, top leaning away from the pilot), yaw = 0 (deg,
 *   + turns the screen toward +X), page = 'mfdRadar' (see DISPLAY_TILES), bezel = .022, buttons = auto (OSB rows on fighter MFD
 *   pages), uv (bezel), uvButton }
 */
export function display(o) {
  const c = o.centre, w = o.width ?? 0.2, h = o.height ?? w, b = o.bezel ?? Math.max(0.012, w * 0.11), uv = o.uv, A = atlasOf(uv);
  const page = o.page || 'mfdRadar', uvBtn = o.uvButton || ksw(A, 'cockpit.button', { color: '#3a3d40', rough: 0.6, metal: 0 }, uv), m = new Mesh();
  m.add(rbox(w + 2 * b, h + 2 * b, 0.022, 0.006, { segments: 12, n: 8, uv }).translate(0, 0, -0.011));                        // bezel
  m.add(box(w * 0.9, h * 0.9, 0.05, uv).translate(0, 0, -0.045));                                                            // housing
  const btn = o.buttons ?? /^mfd/.test(page);
  if (btn) for (let i = 0; i < 5; i++) {
    const x = (i - 2) * w * 0.19;
    for (const sy of [-1, 1]) m.add(box(w * 0.11, b * 0.45, 0.008, uvBtn).translate(x, sy * (h / 2 + b * 0.5), 0.003));
    if (i < 4) for (const sx of [-1, 1]) m.add(box(b * 0.45, h * 0.1, 0.008, uvBtn).translate(sx * (w / 2 + b * 0.5), (i - 1.5) * h * 0.22, 0.003));
  }
  const scr = m.sidecar('display'), i0 = scr.vertexCount;
  for (const [x, y, u, v] of [[-w / 2, -h / 2, 0, 1], [w / 2, -h / 2, 1, 1], [w / 2, h / 2, 1, 0], [-w / 2, h / 2, 0, 0]]) { const q = displayUV(page, u, v); scr.vert(x, y, 0.0015, 0, 0, 1, q[0], q[1]); }
  scr.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  m.rotateX(-(o.tilt ?? 12) * DEG); if (o.yaw) m.rotateY((o.yaw) * DEG);
  return m.translate(c[0], c[1], c[2]);
}

/** A flat face on the kit 'panel' material (dark-grey panel with backlit legends + night flood), tiled in ~cell-sized squares so
 *  the lettering keeps a real size (≈ 8 mm). Faces +Z before placement. */
function panelFace(w, h, cell = 0.24, legends = true) {
  const m = new Mesh(), f = m.sidecar('panel'), nx = Math.max(1, Math.round(w / cell)), ny = Math.max(1, Math.round(h / cell));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const i0 = f.vertexCount, x0 = -w / 2 + w * i / nx, x1 = -w / 2 + w * (i + 1) / nx, y0 = -h / 2 + h * j / ny, y1 = -h / 2 + h * (j + 1) / ny;
    for (const [x, y, u, v] of [[x0, y0, 0, 1], [x1, y0, 1, 1], [x1, y1, 1, 0], [x0, y1, 0, 0]]) { const q = legends ? displayUV('legends', u, v) : displayUV('legends', 0.02, 0.985); f.vert(x, y, 0, 0, 0, 1, q[0], q[1]); }
    f.quad(i0, i0 + 1, i0 + 2, i0 + 3);
  }
  return m;
}

/**
 * Glareshield: the padded coaming over the instrument panel — a hood whose top follows a shallow arc, a rounded padded lip
 * toward the pilot and side cheeks. opts: { eye (or centre: [x, y, z] of the lip middle), dist = .6 (lip ahead of the eye),
 *   drop = .2 (lip below the eye), width = .62, depth = .22 (hood length, forward from the lip), rise = .03 (crown height),
 *   mcp = false (airliner mode-control panel on the lip face), uv, uvPad }
 */
export function glareshield(o) {
  const e = o.eye || [0, 0, 0], c = o.centre || [e[0], e[1] - (o.drop ?? 0.2), e[2] - (o.dist ?? 0.6)];
  const w = o.width ?? 0.62, dp = o.depth ?? 0.22, rise = o.rise ?? 0.03, uv = o.uv, A = atlasOf(uv), uvP = o.uvPad || ksw(A, 'cockpit.pad', KF.pad, uv), m = new Mesh();
  const nx = 10, nz = 4, hw = w / 2, top = (x, f) => c[1] + 0.02 + rise * (1 - (x / hw) ** 2) * (0.5 + 0.5 * f), i0 = m.vertexCount;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {                                     // hood top (f: 0 lip … 1 windscreen)
    const x = -hw + w * i / nx, f = j / nz, y = top(x, f), z = c[2] - dp * f, s = -2 * rise * x / (hw * hw) * (0.5 + 0.5 * f), l = Math.hypot(s, 1);
    m.vert(c[0] + x, y, z, -s / l, 1 / l, 0, uv[0], uv[1]);
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const q = i0 + j * (nx + 1) + i; m.quad(q, q + 1, q + nx + 2, q + nx + 1); }
  const lip = []; for (let i = 0; i <= nx; i++) { const x = -hw + w * i / nx; lip.push([c[0] + x, top(x, 0) - 0.012, c[2] + 0.004]); }
  m.add(limb(lip, lip.map(() => [0.018, 0.016]), { segments: 8, sub: 1, side: [0, 1, 0], caps: 'round', uv: uvP }));        // padded roll
  for (const sx of [-1, 1]) m.add(prism([[c[2] + 0.01, c[1] - 0.1], [c[2] + 0.01, top(sx * hw, 0)], [c[2] - dp, top(sx * hw, 1)], [c[2] - dp, c[1] - 0.1]], c[0] + sx * hw - 0.008, c[0] + sx * hw + 0.008, uv));
  const face = panelFace(w - 0.02, 0.07, 0.07, !!o.mcp);
  face.translate(c[0], c[1] - 0.03, c[2] + 0.011); m.add(face);                                                                // lip face
  m.add(box(w - 0.01, 0.075, 0.012, uv).translate(c[0], c[1] - 0.03, c[2] + 0.004));
  if (o.mcp) {                                                                                                                 // MCP knobs and windows
    const sc = m.sidecar('display');
    for (let i = 0; i < 6; i++) {
      const x = c[0] + (i - 2.5) * (w - 0.1) / 6;
      m.add(tube([x + 0.035, c[1] - 0.03, c[2] + 0.012], [x + 0.035, c[1] - 0.03, c[2] + 0.03], 0.011, 0.01, { segments: 10, uv: ksw(A, 'stick.boot', KF.rubber, uv) }));
      const j0 = sc.vertexCount;
      for (const [dx, dy, u, v] of [[-0.022, -0.009, 0.05, 0.3], [0.022, -0.009, 0.95, 0.3], [0.022, 0.009, 0.95, 0.12], [-0.022, 0.009, 0.05, 0.12]]) { const q = displayUV('ufc', u, v); sc.vert(x + dx - 0.01, c[1] - 0.012 + dy, c[2] + 0.0125, 0, 0, 1, q[0], q[1]); }
      sc.quad(j0, j0 + 1, j0 + 2, j0 + 3);
    }
  }
  return m;
}

/**
 * Instrument panel with displays, placed from the eye point(s): fighter = two MFDs either side of an up-front control
 * display under the HUD, a standby instrument and a caution panel; airline = per pilot a PFD (outboard) and ND (inboard),
 * EICAS + standby in the centre, an MCP glareshield across. Panel faces use the kit 'panel' material (backlit legends and a dim
 * flood at night), screens the kit 'display' material; the visual registers nothing extra.
 * opts: { eye: [x, y, z] | eyes: [[x, y, z], …], kind = 'fighter' | 'airline', dist = .68 / .78 (panel ahead of the eye),
 *   drop = .3 / .34 (panel centre below the eye), width = .6 / auto, height = .3 / .32, tilt = 14 (deg), glareshield = true,
 *   mfd = .135 / .2 (screen size), pages: [left, right] (fighter MFD pages), uv (structure / bezels), uvPad }
 * Returns a Mesh; add it to the static mesh with the rest of the cockpit.
 */
export function instrumentPanel(o) {
  const eyes = o.eyes || [o.eye], airline = o.kind === 'airline', uv = o.uv, m = new Mesh(), tl = (o.tilt ?? 14) * DEG;
  const dist = o.dist ?? (airline ? 0.78 : 0.68), drop = o.drop ?? (airline ? 0.34 : 0.3), H = o.height ?? (airline ? 0.32 : 0.3);
  const xs = eyes.map(q => q[0]), cx = (Math.min(...xs) + Math.max(...xs)) / 2, ey = eyes[0][1], ez = eyes[0][2];
  const W = o.width ?? (airline ? Math.max(0.9, Math.max(...xs) - Math.min(...xs) + 0.75) : 0.6);
  const y0 = ey - drop, z0 = ez - dist;                                       // panel face centre
  const onFace = (x, y, dz = 0) => [x, y0 + y * Math.cos(tl), z0 - y * Math.sin(tl) + dz];
  // board: housing box behind, panel face in front
  m.add(box(W, H, 0.05, uv).rotateX(-tl).translate(cx, y0, z0 - 0.03));
  const face = panelFace(W, H, 0.24, true); face.rotateX(-tl).translate(cx, y0, z0 - 0.004); m.add(face);
  const S = o.mfd ?? (airline ? 0.2 : 0.135), tdeg = o.tilt ?? 14;
  if (!airline) {
    const pages = o.pages || ['mfdRadar', 'mfdSA'];
    for (const [k, sx] of [[0, -1], [1, 1]]) m.add(display({ centre: onFace(cx + sx * (W / 2 - S * 0.68), -H * 0.08, 0.004), width: S, page: pages[k], tilt: tdeg, yaw: -sx * 8, uv, uvButton: o.uvButton }));
    m.add(display({ centre: onFace(cx, H * 0.24, 0.004), width: S * 0.95, height: S * 0.42, page: 'ufc', tilt: tdeg, uv, bezel: 0.012, buttons: false }));
    m.add(display({ centre: onFace(cx, -H * 0.12, 0.004), width: S * 0.55, page: 'standby', tilt: tdeg, uv, bezel: 0.01 }));
    m.add(display({ centre: onFace(cx, -H * 0.38, 0.004), width: S * 0.62, height: S * 0.32, page: 'annunciators', tilt: tdeg, uv, bezel: 0.008 }));
  } else {
    for (const e of eyes) {
      const out = e[0] < cx ? -1 : 1;                                         // PFD outboard, ND inboard
      m.add(display({ centre: onFace(e[0] + out * S * 0.56, 0.0, 0.004), width: S, page: 'pfd', tilt: tdeg, uv }));
      m.add(display({ centre: onFace(e[0] - out * S * 0.56, 0.0, 0.004), width: S, page: 'nd', tilt: tdeg, uv }));
    }
    if (eyes.length > 1 || o.centre) {
      m.add(display({ centre: onFace(cx, 0.0, 0.004), width: S, page: 'eicas', tilt: tdeg, uv }));
      m.add(display({ centre: onFace(cx, -H * 0.36, 0.004), width: S * 0.42, page: 'standby', tilt: tdeg, uv, bezel: 0.008 }));
    }
  }
  if (o.glareshield !== false) {
    const lipY = y0 + H / 2 * Math.cos(tl) + 0.03, lipZ = z0 - H / 2 * Math.sin(tl) + 0.06;
    m.add(glareshield({ centre: [cx, lipY, lipZ], width: W + 0.04, depth: airline ? 0.34 : 0.24, rise: airline ? 0.015 : 0.035, mcp: airline, uv, uvPad: o.uvPad }));
  }
  return m;
}

/**
 * Control stick with a moulded grip: shaft, rubber boot at the base, hand rest, head with trigger, hat switch and buttons.
 * opts: { base: [x, y, z], height = .22, uv, uvGrip, lean = 6 (deg forward), boot = true (off automatically for short side-sticks) }
 */
export function stick(o) {
  const b = o.base, h = o.height ?? 0.22, m = new Mesh(), uvG = o.uvGrip || o.uv, A = atlasOf(o.uv, uvG);
  const uvB = ksw(A, 'stick.boot', KF.rubber, o.uv), uvR = ksw(A, 'stick.red', KF.red, uvG), uvS = ksw(A, 'stick.steel', KF.steel, o.uv);
  const g = Math.min(h * 0.92, 0.135), s0 = h - g, ln = (o.lean ?? 6) * DEG;      // grip length, shaft length
  if (s0 > 0.02) m.add(tube([0, 0, 0], [0, s0 + 0.01, 0], 0.011, 0.011, { segments: 8, uv: o.uv }));
  if ((o.boot ?? s0 > 0.08)) m.add(lathe([[0.05, 0], [0.046, 0.012], [0.036, 0.016], [0.038, 0.03], [0.026, 0.034], [0.028, 0.048], [0.016, 0.054], [0.013, 0.07]], { segments: 12, uv: uvB }).rotateX(-Math.PI / 2));
  // grip: an oval handle that swells into a hand rest at the bottom and a head at the top
  const gr = new Mesh(), R = [[0, 0.019, 0.022], [0.012, 0.027, 0.032], [0.024, 0.022, 0.026], [0.05, 0.019, 0.023], [0.08, 0.02, 0.024], [0.098, 0.026, 0.03], [0.118, 0.027, 0.03], [0.132, 0.02, 0.022]];
  const sc = g / 0.135, rings = [{ c: [0, 0, 0], u: Z, v: X, rx: 0, ry: 0 }];
  for (const [y, rx, rz] of R) rings.push({ c: [0, y * sc, y > 0.09 ? -0.006 * sc : 0], u: Z, v: X, rx: rz * sc, ry: rx * sc, n: 2.6 });
  rings.push({ c: [0, 0.135 * sc, -0.006 * sc], u: Z, v: X, rx: 0, ry: 0 });
  gr.add(shell(rings, { segments: 10, uv: uvG }));
  gr.add(prism([[-0.028 * sc, 0.104 * sc], [-0.05 * sc, 0.094 * sc], [-0.046 * sc, 0.076 * sc], [-0.024 * sc, 0.084 * sc]], -0.006 * sc, 0.006 * sc, uvR));              // trigger
  gr.add(tube([-0.012 * sc, 0.13 * sc, -0.008 * sc], [-0.012 * sc, 0.142 * sc, -0.012 * sc], 0.007 * sc, 0.009 * sc, { segments: 8, uv: uvS }));                        // trim hat
  gr.add(ellipsoid(0.007 * sc, 0.004 * sc, 0.007 * sc, { segments: 6, rings: 3, uv: uvR }).translate(0.013 * sc, 0.134 * sc, -0.004 * sc));                              // weapon release
  gr.add(tube([-0.03 * sc, 0.108 * sc, 0.004 * sc], [-0.038 * sc, 0.11 * sc, 0.004 * sc], 0.006 * sc, 0.006 * sc, { segments: 6, uv: uvS }));                            // thumb switch
  m.add(gr.rotateX(-ln).translate(0, s0, 0));
  return m.translate(b[0], b[1], b[2]);
}

/**
 * Throttle quadrant grip(s) on a lever. opts: { base: [x, y, z] (lever pivot), height = .12, twin = false (two side-by-side grips),
 *   angle = 0 (deg, lever leaning forward), uv, uvGrip }
 */
export function throttle(o) {
  const b = o.base, h = o.height ?? 0.12, m = new Mesh(), uvG = o.uvGrip || o.uv, A = atlasOf(o.uv, uvG), uvS = ksw(A, 'stick.steel', KF.steel, o.uv), n = o.twin ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const x = n > 1 ? (i - 0.5) * 0.058 : 0, g = new Mesh();
    g.add(bb(x - 0.006, x + 0.006, 0, h - 0.02, -0.012, 0.012, o.uv));
    g.add(limb([[x - 0.004, h - 0.03, 0.03], [x, h, 0.012], [x, h + 0.004, -0.03], [x - 0.004, h - 0.012, -0.058]], [[0.024, 0.02], [0.026, 0.021], [0.025, 0.02], [0.02, 0.016]], { segments: 8, sub: 2, uv: uvG }));
    g.add(tube([x + 0.022, h, -0.02], [x + 0.034, h, -0.02], 0.006, 0.006, { segments: 6, uv: uvS }));
    g.add(tube([x - 0.02, h + 0.012, -0.036], [x - 0.02, h + 0.024, -0.04], 0.006, 0.007, { segments: 6, uv: uvS }));
    m.add(g);
  }
  return m.rotateX(-(o.angle ?? 0) * DEG).translate(b[0], b[1], b[2]);
}

/** Control yoke on a column: opts { base: [x, y, z] (floor), top: [x, y, z] (wheel centre), width = .34, uv, uvGrip } */
export function yoke(o) {
  const t = o.top, w = (o.width ?? 0.34) / 2, m = new Mesh(), uv = o.uv, uvG = o.uvGrip || uv, A = atlasOf(uv), uvS = ksw(A, 'stick.steel', KF.steel, uv), uvP = ksw(A, 'crew.paper', KF.paper, uv);
  const d = [t[0] - o.base[0], t[1] - o.base[1], t[2] - o.base[2]];
  m.add(limb([o.base, [o.base[0] + d[0] * 0.55, o.base[1] + d[1] * 0.55, o.base[2] + d[2] * 0.55 - 0.012], [t[0], t[1] - 0.012, t[2] - 0.035]], [0.03, 0.026, 0.024], { segments: 10, sub: 3, uv }));
  m.add(lathe([[0.062, 0], [0.058, 0.014], [0.04, 0.02], [0.03, 0.03]], { segments: 12, uv: ksw(A, 'stick.boot', KF.rubber, uv) }).rotateX(-Math.PI / 2).translate(o.base[0], o.base[1], o.base[2]));
  m.add(rbox(0.11, 0.06, 0.05, 0.016, { segments: 10, uv }).translate(t[0], t[1] - 0.012, t[2] - 0.012));                                   // hub
  m.add(box(0.07, 0.085, 0.004, uvP).rotateX(-0.25).translate(t[0], t[1] + 0.06, t[2] + 0.006));                                              // checklist clip
  m.add(box(0.08, 0.012, 0.01, uvS).rotateX(-0.25).translate(t[0], t[1] + 0.1, t[2] + 0.02));
  for (const sx of [-1, 1]) {
    const P = (x, y, z) => [t[0] + sx * x * w, t[1] + y, t[2] + z];
    m.add(limb([P(0.25, -0.012, 0), P(0.6, -0.05, 0), P(0.9, -0.045, 0.002), P(1, 0.01, 0.006)], [[0.014, 0.012], [0.014, 0.012], [0.015, 0.014], 0.016], { segments: 8, sub: 3, caps: 'none', uv }));   // horn
    m.add(limb([P(1, 0.0, 0.006), P(1.01, 0.06, 0.012), P(0.98, 0.125, 0.018)], [0.018, 0.0195, 0.017], { segments: 8, sub: 3, uv: uvG }));    // hand grip
    m.add(tube(P(0.93, 0.118, 0.012), P(0.86, 0.128, 0.012), 0.008, 0.008, { segments: 6, uv: uvS }));                                        // trim / PTT switches
    m.add(box(0.012, 0.022, 0.012, uvS).translate(...P(0.98, 0.09, -0.012)));
  }
  return m;
}

/**
 * Rudder pedals: two pedals on hanging arms. opts: { centre: [x, y, z] (between the pedal faces), spacing = .28, width = .1, height = .13,
 *   tilt = 55 (deg from the floor), uv, uvPad }
 */
export function pedals(o) {
  const c = o.centre, sp = (o.spacing ?? 0.28) / 2, w = o.width ?? 0.1, h = o.height ?? 0.13, tl = (o.tilt ?? 55) * DEG, m = new Mesh(), uvP = o.uvPad || o.uv;
  for (const sx of [-1, 1]) {
    const g = new Mesh();
    g.add(rbox(w, h, 0.016, 0.006, { segments: 10, uv: uvP }));
    for (let i = -2; i <= 2; i++) g.add(box(w * 0.86, 0.006, 0.006, o.uv).translate(0, i * h * 0.17, 0.01));                                 // tread bars
    g.add(tube([0, h * 0.5, -0.008], [0, h * 0.5 + 0.22, -0.05], 0.011, 0.011, { segments: 6, uv: o.uv }));                                  // hanging arm
    g.add(tube([-w * 0.55, -h * 0.5, 0], [w * 0.55, -h * 0.5, 0], 0.008, 0.008, { segments: 6, uv: o.uv }));
    m.add(g.rotateX(-(Math.PI / 2 - tl)).translate(c[0] + sx * sp, c[1], c[2]));
  }
  return m;
}

/**
 * Open-topped cockpit tub: floor, side walls, rear bulkhead, front bulkhead. opts: { x: halfWidth, y0 (floor), y1 (sill),
 *   z0 (front), z1 (rear), uv, taper = 1 (front width factor) }. Faces point inward (visible from the seat and through the canopy).
 */
export function tub(o) {
  const { x, y0, y1, z0, z1, uv } = o, f = o.taper ?? 1, m = new Mesh(), xf = x * f;
  const quad = (a, b, c, d) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]; let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]; const l = Math.hypot(...n) || 1; n = n.map(q => q / l); const i = m.vertexCount; for (const p of [a, b, c, d]) m.vert(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1]); m.quad(i, i + 1, i + 2, i + 3); };
  quad([-xf, y0, z0], [-x, y0, z1], [x, y0, z1], [xf, y0, z0]);                 // floor (faces up)
  quad([xf, y0, z0], [x, y0, z1], [x, y1, z1], [xf, y1, z0]);                   // right wall (faces -X)
  quad([-xf, y0, z0], [-xf, y1, z0], [-x, y1, z1], [-x, y0, z1]);               // left wall (faces +X)
  quad([-x, y0, z1], [-x, y1, z1], [x, y1, z1], [x, y0, z1]);                   // rear bulkhead (faces forward)
  quad([-xf, y0, z0], [xf, y0, z0], [xf, y1, z0], [-xf, y1, z0]);               // front bulkhead (faces aft)
  return m;
}

/**
 * Interior lining patch that follows the inside of a lofted body: a bilinear quad in (z, t) space, offset inward and
 * facing inward. Use several patches that share edges to line a flight deck around its (painted) windows, so the pilot's
 * view shows posts, sills and roof while the outside world stays visible through the gaps.
 * corners: [[z, t], [z, t], [z, t], [z, t]] in order around the patch; opts: { inset = .05, nu = 4, nv = 4, uv, mirror = false }
 * mirror: also emit the left-hand copy (t → 1 − t).
 */
export function liner(body, corners, o = {}) {
  const nu = o.nu ?? 4, nv = o.nv ?? 4, inset = o.inset ?? 0.05, uv = o.uv || [0, 0], m = new Mesh();
  const one = (flip) => {
    const i0 = m.vertexCount, pts = [];
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv, c = corners;
      const z = (c[0][0] * (1 - u) + c[1][0] * u) * (1 - v) + (c[3][0] * (1 - u) + c[2][0] * u) * v;
      let t = (c[0][1] * (1 - u) + c[1][1] * u) * (1 - v) + (c[3][1] * (1 - u) + c[2][1] * u) * v;
      if (flip) t = 1 - t;
      const s = body.at(z, t), p = [s.p[0] - s.n[0] * inset, s.p[1] - s.n[1] * inset, s.p[2] - s.n[2] * inset];
      pts.push(p); m.vert(p[0], p[1], p[2], -s.n[0], -s.n[1], -s.n[2], uv[0], uv[1]);
    }
    // orient the faces inward whatever the corner order
    const a = pts[0], b = pts[1], d = pts[nu + 1], e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const inward = nx * m.n[i0 * 3] + ny * m.n[i0 * 3 + 1] + nz * m.n[i0 * 3 + 2] > 0;
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const q = i0 + j * (nu + 1) + i;
      if (inward) m.quad(q, q + 1, q + nu + 2, q + nu + 1); else m.quad(q, q + nu + 1, q + nu + 2, q + 1);
    }
  };
  one(false); if (o.mirror) one(true);
  return m;
}

/**
 * Flat bulkhead filling a lofted body's cross-section at station z (cockpit door wall, pressure bulkhead, well end wall).
 * opts: { inset = .05, uv, facing = -1 (-1: faces the nose, +1: faces aft), n = 24 }
 */
export function bulkhead(body, z, o = {}) {
  const n = o.n ?? 24, inset = o.inset ?? 0.05, uv = o.uv || [0, 0], f = o.facing ?? -1, m = new Mesh();
  let cx = 0, cy = 0; const pts = [];
  for (let i = 0; i < n; i++) { const s = body.at(z, i / n); pts.push([s.p[0] - s.n[0] * inset, s.p[1] - s.n[1] * inset]); cx += pts[i][0] / n; cy += pts[i][1] / n; }
  const c = m.vert(cx, cy, z, 0, 0, f, uv[0], uv[1]);
  const ids = pts.map(p => m.vert(p[0], p[1], z, 0, 0, f, uv[0], uv[1]));
  // ring parameter t runs bottom → right (+X) → top → left: clockwise when seen from the nose
  for (let i = 0; i < n; i++) { const a = ids[i], b = ids[(i + 1) % n]; if (f < 0) m.tri(c, b, a); else m.tri(c, a, b); }
  return m;
}

/** Floor (or ceiling) panel inside a lofted body at height y between stations z0..z1, trimmed to the body width. opts: { inset = .05, uv, n = 6, up = true } */
export function deck(body, z0, z1, y, o = {}) {
  const n = o.n ?? 6, inset = o.inset ?? 0.05, uv = o.uv || [0, 0], up = o.up ?? true, m = new Mesh(), rows = [];
  for (let i = 0; i <= n; i++) {
    const z = z0 + (z1 - z0) * i / n, x = Math.max(0.02, body.at(z, body.tAtY(z, y)).p[0] - inset);
    rows.push([m.vert(-x, y, z, 0, up ? 1 : -1, 0, uv[0], uv[1]), m.vert(x, y, z, 0, up ? 1 : -1, 0, uv[0], uv[1])]);
  }
  for (let i = 0; i < n; i++) { const [a, b] = rows[i], [c, d] = rows[i + 1]; if (up) m.quad(a, c, d, b); else m.quad(a, b, d, c); }
  return m;
}
