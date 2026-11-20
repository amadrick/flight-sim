// Procedural textures for the airports (generated once at boot; no network).
import * as THREE from 'three';

// ---------- tileable value noise helpers ----------
function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// value noise on a periodic lattice; lattice values are cached per (period, seed) so each sample is 4 table reads
const _lat = new Map();
function lattice(period, seed) {
  const k = period * 4096 + seed;
  let t = _lat.get(k);
  if (!t) { t = new Float32Array(period * period); for (let y = 0; y < period; y++) for (let x = 0; x < period; x++) t[y * period + x] = hash2(x, y, seed); _lat.set(k, t); }
  return t;
}
function tileNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const T = lattice(period, seed);
  const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
  const x1 = x0 + 1 === period ? 0 : x0 + 1, y1 = y0 + 1 === period ? 0 : y0 + 1;
  const a = T[y0 * period + x0], b = T[y0 * period + x1], c = T[y1 * period + x0], d = T[y1 * period + x1];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, period, oct, seed) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += amp * tileNoise(x * f, y * f, period * f, seed + o * 17); n += amp; amp *= 0.5; f *= 2; }
  return s / n;
}

function finishData(tex, ctx) {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = Math.min(ctx.quality?.anisotropy || 4, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  tex.needsUpdate = true;
  return tex;
}

/**
 * RGBA pavement noise, 256² tileable:
 *  R aggregate (high-frequency speckle), G mid fbm, B low fbm (blotches), A crack network (ridged noise).
 */
export function makePavementNoise(ctx, N = 256) {
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4;
    const u = x / N, v = y / N;
    const speck = 0.55 * hash2(x, y, 3) + 0.45 * tileNoise(u * 64, v * 64, 64, 5);
    const mid = fbm(u * 8, v * 8, 8, 4, 11);
    const low = fbm(u * 3, v * 3, 3, 4, 23);
    const rn = fbm(u * 6, v * 6, 6, 3, 37);
    const ridge = Math.pow(1 - Math.abs(rn * 2 - 1), 14);
    data[i] = speck * 255; data[i + 1] = mid * 255; data[i + 2] = low * 255; data[i + 3] = Math.min(1, ridge) * 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  return finishData(tex, ctx);
}

/**
 * Close-range aggregate, AGGR_N^2 tileable (one tile = AGGR_TILE m of pavement in the shader, ~2 mm per texel):
 *  R albedo factor (mean ~0.5), G height (stones domed above the binder), B stone tone id, A pores / voids.
 * Crushed stone (2-20 mm; angular: every stone is a random convex polygon) of a few rock types - dark basalt /
 * greywacke, mid grey limestone, the odd pale quartz or brownish chip - packed into a dark binder with sand fines.
 * Traffic and weather strip the binder off the stone tops, so the stones show their own colour.
 */
export const AGGR_TILE = 0.62;
export function makeAggregateTexture(ctx, N = 512) {
  const data = new Uint8Array(N * N * 4);
  const hb = new Float32Array(N * N), tn = new Float32Array(N * N), al = new Float32Array(N * N);
  const layers = [[22, 0.55, 41, 1.0], [44, 0.52, 43, 0.75], [88, 0.50, 47, 0.5], [176, 0.45, 49, 0.3]];   // cells per tile, radius (cells), seed, height
  for (const [P, rad, seed, hk] of layers) {
    const cpx = N / P;
    for (let cy = 0; cy < P; cy++) for (let cx = 0; cx < P; cx++) {
      if (hash2(cx, cy, seed + 7) < (P > 100 ? 0.5 : 0.3)) continue;   // gaps: binder shows between the stones
      const jx = hash2(cx, cy, seed), jy = hash2(cx, cy, seed + 1), sz = hash2(cx, cy, seed + 2), tone = hash2(cx, cy, seed + 5);
      // rock type -> albedo
      const rt = hash2(cx, cy, seed + 9);
      const alb = rt < 0.55 ? 0.26 + 0.14 * tone : rt < 0.85 ? 0.42 + 0.14 * tone : rt < 0.95 ? 0.62 + 0.2 * tone : 0.40 + 0.1 * tone;
      const R = rad * (0.55 + 0.6 * sz) * cpx, mx = (cx + 0.2 + 0.6 * jx) * cpx, my = (cy + 0.2 + 0.6 * jy) * cpx;
      // convex polygon: 5-7 half planes at random angles and distances
      const ns = 5 + Math.floor(hash2(cx, cy, seed + 11) * 3), nrm = [];
      const a0 = hash2(cx, cy, seed + 3) * 6.283;
      for (let k = 0; k < ns; k++) { const a = a0 + (k + 0.5 * hash2(cx + k, cy, seed + 13)) * 6.283 / ns; nrm.push([Math.cos(a), Math.sin(a), 0.75 + 0.45 * hash2(cx, cy + k, seed + 17)]); }
      const r0 = Math.ceil(R * 1.25);
      for (let yy = Math.floor(my - r0); yy <= Math.ceil(my + r0); yy++) for (let xx = Math.floor(mx - r0); xx <= Math.ceil(mx + r0); xx++) {
        const ox = xx + 0.5 - mx, oy = yy + 0.5 - my;
        let d = 0; for (const [nx, ny, nd] of nrm) d = Math.max(d, (nx * ox + ny * oy) / (R * nd));
        if (d >= 1) continue;
        const h = Math.pow(1 - d * d, 0.35) * (0.55 + 0.45 * sz) * hk;        // flat-topped (worn) stones
        const i = (((yy % N) + N) % N) * N + (((xx % N) + N) % N);
        if (h > hb[i]) { hb[i] = h; tn[i] = tone; al[i] = alb * (0.92 + 0.16 * hash2(xx, yy, seed + 19)) * (0.8 + 0.25 * Math.min(1, h / hk + 0.2)); }
      }
    }
  }
  let st = 0;
  for (let i = 0; i < N * N; i++) {
    const x = i % N, y = (i / N) | 0;
    const stone = hb[i] > 0.02;
    if (stone) st++;
    const fines = hash2(x, y, 51), pore = !stone && hash2(x >> 1, y >> 1, 53) > 0.82 ? 1 : 0;
    const alb = stone ? al[i] : 0.13 + 0.10 * fines * fines;            // binder with sand fines
    data[i * 4] = Math.min(255, alb * 1.25 * 255 * (pore ? 0.45 : 1));
    data[i * 4 + 1] = Math.min(255, (0.22 + 0.78 * hb[i] - 0.18 * pore) * 255);
    data[i * 4 + 2] = tn[i] * 255;
    data[i * 4 + 3] = pore * 255;
  }
  let mr = 0; for (let i = 0; i < N * N; i++) mr += data[i * 4];
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.userData.stoneFraction = st / (N * N);
  tex.userData.meanR = mr / (N * N * 255);
  return finishData(tex, ctx);
}

// ---------- runway rubber: simulated tyre deposits in the touchdown zone ----------
// One layer = one runway end. u = across (RUBBER.span m centred on the centre line), v = along from the threshold
// (RUBBER.len m). Thousands of landings of a traffic mix (gear track, tyres per side, tyre width), each touching down
// at a lognormally distributed distance past the aiming point, laterally scattered about the centre line, slightly
// crabbed; every tyre lays a short, very dark spin-up skid and a long faint smear. R = accumulated deposit
// (1 - exp(-k acc)), G = the most recent few hundred landings only (crisp black marks over the grey smear).
// v is stretched toward the threshold (0.75 m texels there, 2.4 m at 300 m, 5 m at the far end) so the line-up arcs
// and the first touchdown marks under the default view stay sharp: a = len * (0.25 v + 0.75 v^2).
export const RUBBER = { nu: 512, nv: 512, span: 64, len: 1536, layers: 2 };
export const rubberA = (v, len = RUBBER.len) => len * (0.25 * v + 0.75 * v * v);
export const rubberV = (a, len = RUBBER.len) => (Math.sqrt(0.0625 + 3 * Math.max(0, a) / len) - 0.25) / 1.5;
const AIRCRAFT_MIX = [
  // share, gear track (m) [min, max], tyres per side, tyre spacing (m), tyre width (m), deposit strength
  [0.46, [5.7, 7.6], 2, 0.86, 0.36, 1.0],     // narrow bodies
  [0.18, [9.4, 12.6], 2, 1.40, 0.46, 1.6],    // wide bodies (bogies: tandem wheels on the same line)
  [0.22, [3.6, 8.5], 2, 0.48, 0.26, 0.55],    // regional jets / turboprops
  [0.14, [2.3, 3.6], 1, 0, 0.20, 0.35],       // fighters / business jets
];
export function simulateRubber(seed = 1, { nu = RUBBER.nu, nv = RUBBER.nv, span = RUBBER.span, len = RUBBER.len, landings = 1700, recent = 170 } = {}) {
  const r = rngA(seed * 7919 + 13);
  const gauss = () => { let s = 0; for (let k = 0; k < 6; k++) s += r(); return (s - 3) * 1.414; };
  const acc = new Float32Array(nu * nv), rec = new Float32Array(nu * nv);
  const du = span / nu;
  const A = new Float32Array(nv + 1); for (let j = 0; j <= nv; j++) A[j] = rubberA(j / nv, len);
  const rowOf = (a) => Math.floor(rubberV(a, len) * nv);
  // box-filtered stripe [x0, x1] (m across) added to row j with weight w
  const stamp = (buf, j, x0, x1, w) => {
    const u0 = (x0 + span / 2) / du, u1 = (x1 + span / 2) / du;
    const i0 = Math.max(0, Math.floor(u0)), i1 = Math.min(nu - 1, Math.floor(u1));
    for (let i = i0; i <= i1; i++) buf[j * nu + i] += w * (Math.min(u1, i + 1) - Math.max(u0, i));
  };
  for (let n = 0; n < landings; n++) {
    let t = r(), ac = AIRCRAFT_MIX[0];
    for (const m of AIRCRAFT_MIX) { if (t < m[0]) { ac = m; break; } t -= m[0]; }
    const track = ac[1][0] + (ac[1][1] - ac[1][0]) * r();
    const off = gauss() * 1.5 + (r() < 0.12 ? gauss() * 3.5 : 0);           // lateral scatter about the centre line
    const td = 60 + Math.exp(Math.log(240) + 0.5 * gauss());               // touchdown, m past the threshold
    const crab = gauss() * 0.005;                                            // de-crab drift (m per m)
    const I = ac[5] * Math.exp(0.5 * gauss());                               // hard / soft landing
    const l0 = 6 + 18 * r(), l1 = 50 + 110 * r();                             // skid, smear lengths
    const isRecent = n >= landings - recent;
    for (const sd of [-1, 1]) for (let k = 0; k < ac[2]; k++) {
      const x0 = off + sd * track / 2 + (k - (ac[2] - 1) / 2) * ac[3];
      const tw = ac[4] * (0.85 + 0.3 * r());
      const aEnd = Math.min(len, td + l0 * 4 + l1 * 2.5);
      for (let j = Math.max(0, rowOf(td)); j < nv; j++) {
        const a0 = A[j], a1 = A[j + 1];
        if (a0 > aEnd) break;
        const lo = Math.max(a0, td), cover = (a1 - lo) / (a1 - a0);        // first row only partly covered
        if (cover <= 0) continue;
        const s = (lo + a1) / 2 - td;
        const w = I * cover * (Math.exp(-s / l0) + 0.13 * Math.exp(-s / l1));
        const x = x0 + crab * Math.min(s, 60);
        stamp(acc, j, x - tw / 2, x + tw / 2, w);
        if (isRecent) stamp(rec, j, x - tw / 2, x + tw / 2, w);
      }
    }
  }
  // departures: lining up from the entry taxiway at the threshold (main gear arcs, the inner wheel scrubbing hard
  // through a tight turn), then brake release / spool-up scuffs on the centre line
  const path = (buf, pts, tw, I) => {                                         // pts: [a, x] every ~0.25 m
    for (const [a, x] of pts) { const j = rowOf(a); if (a >= 0 && j < nv) stamp(buf, j, x - tw / 2, x + tw / 2, I * 0.25 / (A[j + 1] - A[j])); }
  };
  for (let n = 0; n < landings * 0.6; n++) {
    const ac = AIRCRAFT_MIX[Math.min(3, Math.floor(r() * 4))];
    const track = ac[1][0] + (ac[1][1] - ac[1][0]) * r(), I = ac[5] * Math.exp(0.4 * gauss());
    const sd = r() < 0.65 ? 1 : -1;                                          // which side the entry taxiway is on
    const Rt = 16 + 24 * r(), aE = Rt + 4 + 30 * r() * r(), off = gauss() * 0.45;
    for (const g of [-1, 1]) for (let k = 0; k < ac[2]; k++) {
      // gear on the inside of the turn (g = sd: nearer the turn centre) scrubs; the outer one only rolls
      const Rr = Math.max(1.5, Rt - g * sd * (track / 2 + (k - (ac[2] - 1) / 2) * ac[3] * 0)), inner = g === sd;
      const scrub = I * (inner ? 0.9 * Math.min(2.5, 14 / Rr) : 0.12);
      const pts = [];
      for (let th = -Math.PI / 2; th < 0; th += 0.25 / Rr) pts.push([aE + Rr * Math.sin(th), off + sd * Rt - sd * Rr * Math.cos(th)]);
      path(acc, pts, ac[4], scrub * 0.35);
      // lined up: a short run straight ahead, power up against the brakes, roll
      const x = off + (Rt - Rr) * sd, a1 = aE + 2 + 25 * r();
      for (let j = rowOf(aE); j < Math.min(nv, rowOf(a1 + 80)); j++) {
        const a = 0.5 * (A[j] + A[j + 1]);
        stamp(acc, j, x - ac[4] / 2, x + ac[4] / 2, I * (a < a1 ? 0.04 : 0.3 * Math.exp(-(a - a1) / 26)) * (0.4 + 1.2 * r() * r()));
      }
    }
  }
  // normalise: the busiest texels saturate to near black
  const sorted = Float32Array.from(acc).sort();
  const p = sorted[Math.floor(sorted.length * 0.997)] || 1;
  const kA = 2.6 / p, kR = 1.6 / Math.max(1e-6, p * recent / landings);
  const R = new Float32Array(nu * nv), G = new Float32Array(nu * nv);
  for (let i = 0; i < acc.length; i++) { R[i] = 1 - Math.exp(-kA * acc[i]); G[i] = 1 - Math.exp(-kR * rec[i]); }
  return { R, G, nu, nv };
}
export function makeRubberTexture(ctx) {
  const { nu, nv, layers } = RUBBER;
  const data = new Uint8Array(nu * nv * layers * 2);
  for (let l = 0; l < layers; l++) {
    const s = simulateRubber(l + 1);
    const o = l * nu * nv * 2;
    for (let i = 0; i < nu * nv; i++) { data[o + i * 2] = Math.round(s.R[i] * 255); data[o + i * 2 + 1] = Math.round(s.G[i] * 255); }
  }
  const tex = new THREE.DataArrayTexture(data, nu, nv, layers);
  tex.format = THREE.RGFormat; tex.type = THREE.UnsignedByteType; tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = Math.min(ctx.quality?.anisotropy || 4, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  tex.needsUpdate = true;
  return tex;
}

// ---------- asphalt defects: sealed cracks, patches, stains (one paving lane wide strips are cut from it) ----------
// DEFECT.len x DEFECT.wid metres per tile. R = crack sealant (hand-poured overbanding: wavy, varying width, over the
// crack), G = patch tone (0.5 = none, lower = fresh dark patch, higher = old pale patch), B = stains (oil / fuel drips).
export const DEFECT = { len: 64, wid: 32 };
export function makeDefectTexture(ctx) {
  const hi = ['high', 'ultra'].includes(ctx.quality?.level);
  const W = hi ? 2048 : 1024, H = W / 2, sx = W / DEFECT.len;           // px per metre
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });       // (software canvas: an accelerated one may dither)
  const r = rngA(911);
  g.fillStyle = 'rgb(0,128,0)'; g.fillRect(0, 0, W, H);
  // wrap-around drawing: every primitive is drawn at the 9 periodic copies that can touch the tile
  const wrap = (fn) => { for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { g.save(); g.translate(ox, oy); fn(); g.restore(); } };
  // patches (source-over: tone in G), then their sealed borders
  const patches = [];
  for (let k = 0; k < 6; k++) {
    const x = r() * W, y = r() * H, pw = (2 + 22 * r() * r()) * sx, ph = (r() < 0.6 ? 7.5 : 1 + 3 * r()) * sx;
    const tone = r() < 0.4 ? 55 + 30 * r() : 150 + 35 * r();
    patches.push([x, y, pw, ph]);
    wrap(() => { g.fillStyle = `rgb(0,${tone | 0},0)`; g.fillRect(x, y, pw, ph); });
  }
  g.globalCompositeOperation = 'lighter';
  for (const [x, y, pw, ph] of patches) wrap(() => { g.strokeStyle = 'rgba(200,0,0,1)'; g.lineWidth = 0.09 * sx; g.strokeRect(x, y, pw, ph); });
  // cracks: wandering polylines, sealed with a wider, wavier band
  const crack = (x, y, ang, length, wid, branch) => {
    const pts = [[x, y]]; let a = ang;
    const step = 0.25 * sx;
    for (let s = 0; s < length; s += step) {
      a += (r() - 0.5) * 0.55 + (ang - a) * 0.08;
      x += Math.cos(a) * step; y += Math.sin(a) * step; pts.push([x, y]);
      if (branch > 0 && r() < 0.012) crack(x, y, a + (r() < 0.5 ? 1 : -1) * (0.6 + 0.6 * r()), length * (0.15 + 0.3 * r()), wid * 0.8, branch - 1);
    }
    const sealed = r() < 0.85;
    wrap(() => {
      if (sealed) {
        // overband: drawn as overlapping strokes of varying width, offset a little from the crack (hand-poured)
        for (let p = 0; p < 2; p++) {
          g.beginPath(); g.lineCap = 'round'; g.lineJoin = 'round';
          const o = (r() - 0.5) * 0.03 * sx;
          pts.forEach(([px, py], i) => (i ? g.lineTo(px + o, py - o) : g.moveTo(px + o, py - o)));
          g.strokeStyle = `rgba(${p ? 110 : 150},0,0,1)`; g.lineWidth = wid * sx * (p ? 1.6 : 1.0); g.stroke();
        }
      } else {
        g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.strokeStyle = 'rgba(90,0,0,1)'; g.lineWidth = Math.max(1, 0.015 * sx); g.stroke();
      }
    });
  };
  // transverse (thermal) cracks every 6-25 m, longitudinal cracks, a block-cracked area
  for (let x = r() * 6 * sx; x < W; x += (6 + 19 * r()) * sx) crack(x, r() * H, Math.PI / 2 + (r() - 0.5) * 0.3, (6 + 20 * r()) * sx, 0.05 + 0.04 * r(), 2);
  for (let k = 0; k < 14; k++) crack(r() * W, r() * H, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.2, (4 + 26 * r()) * sx, 0.045 + 0.035 * r(), 2);
  for (let k = 0; k < 3; k++) {
    const bx = r() * W, by = r() * H, bw = (8 + 10 * r()) * sx, bh = (5 + 5 * r()) * sx;
    for (let s = 0; s < 6; s++) crack(bx + r() * bw, by + r() * bh, r() * 6.283, (1.5 + 3 * r()) * sx, 0.035, 1);
  }
  // stains: drips and blots (B)
  for (let k = 0; k < 220; k++) {
    const x = r() * W, y = r() * H, rr = (0.08 + 0.5 * r() * r() * r()) * sx, a = 40 + 120 * r();
    wrap(() => {
      const gr = g.createRadialGradient(x, y, 0, x, y, rr);
      gr.addColorStop(0, `rgba(0,0,${a | 0},1)`); gr.addColorStop(0.7, `rgba(0,0,${(a * 0.6) | 0},1)`); gr.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rr * (1 + r()), rr, r() * 3, 0, 6.283); g.fill();
    });
  }
  g.globalCompositeOperation = 'source-over';
  const data = new Uint8Array(g.getImageData(0, 0, W, H).data.buffer);
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  return finishData(tex, ctx);
}

// ---------- glyph atlas for painted markings ----------
export const GLYPHS = '0123456789LRC-o';   // 'o' = soft blob (stains, tyre marks)
export const ATLAS = { cellW: 80, cellH: 240, cols: GLYPHS.length + 1, rows: 2, w: 1280, h: 512 };

function drawRunwayGlyph(g, ch, x, y, w, h) {
  // FAA runway numerals: uniform-stroke, tall, condensed. Draw with the font, then squeeze to fit the cell.
  g.save();
  g.translate(x + w / 2, y + h / 2);
  g.font = `bold ${Math.round(h * 1.0)}px "DIN Condensed","Roboto Condensed","Arial Narrow","Liberation Sans Narrow","DejaVu Sans Condensed",Arial,sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const m = g.measureText(ch);
  const asc = m.actualBoundingBoxAscent || h * 0.36, desc = m.actualBoundingBoxDescent || h * 0.36;
  const gh = asc + desc, gw = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
  const sy = (h * 0.94) / gh, sx = (w * 0.86) / Math.max(1, gw);
  g.scale(sx, sy);
  g.fillText(ch, 0, (asc - desc) / 2);
  g.restore();
}

function rngA(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeGlyphAtlas(ctx) {
  const c = document.createElement('canvas');
  c.width = ATLAS.w; c.height = ATLAS.h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = '#fff';
  const { cellW, cellH } = ATLAS;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < GLYPHS.length; i++) {
      const ch = GLYPHS[i];
      const x = i * cellW, y = row * cellH;
      if (ch === '-') { g.fillRect(x + cellW * 0.15, y + cellH * 0.46, cellW * 0.7, cellH * 0.08); continue; }
      if (ch === 'o') {
        // soft, irregular blob with low peak opacity: oil/fuel stains and tyre scuffs are layered from these
        g.save(); g.beginPath(); g.rect(x, y, cellW, cellH); g.clip();
        const R2 = rngA(row + 5);
        for (let k = 0; k < 9; k++) {
          const cx = x + cellW * (0.35 + 0.3 * R2()), cy = y + cellH * (0.3 + 0.4 * R2()), rr = cellW * (0.18 + 0.16 * R2());
          const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
          gr.addColorStop(0, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          g.fillStyle = gr; g.save(); g.translate(cx, cy); g.scale(1, cellH / cellW); g.translate(-cx, -cy); g.fillRect(x, y, cellW, cellH); g.restore();
        }
        g.restore(); g.fillStyle = '#fff'; continue;
      }
      if (row === 1) {
        // outline row: draw dilated glyph (black borders on concrete) by stamping offsets
        for (let a = 0; a < 16; a++) {
          const ox = Math.cos(a / 16 * Math.PI * 2) * 6, oy = Math.sin(a / 16 * Math.PI * 2) * 6;
          drawRunwayGlyph(g, ch, x + ox, y + oy, cellW, cellH);
        }
      } else drawRunwayGlyph(g, ch, x, y, cellW, cellH);
    }
    // solid cell
    g.fillRect(GLYPHS.length * cellW + 4, row * cellH + 4, cellW - 8, cellH - 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(ctx.quality?.anisotropy || 4, ctx.renderer.capabilities.getMaxAnisotropy?.() || 1);
  return tex;
}
/** UV rect [u0, v0, u1, v1] for a glyph (or the solid cell when ch is null). flipY=true canvas convention. */
export function glyphUV(ch, outline = false) {
  let i = ch == null ? GLYPHS.length : GLYPHS.indexOf(ch);
  if (i < 0) i = GLYPHS.length;
  const { cellW, cellH, w, h } = ATLAS;
  const row = outline ? 1 : 0;
  const pad = ch == null ? 10 : 0;
  const u0 = (i * cellW + pad) / w, u1 = ((i + 1) * cellW - pad) / w;
  const y0 = (row * cellH + pad) / h, y1 = ((row + 1) * cellH - pad) / h;
  // CanvasTexture flipY = true: v = 1 - y
  return [u0, 1 - y1, u1, 1 - y0];
}

// ---------- building facades (albedo + emissive) ----------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function texFrom(c, ctx, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = Math.min(ctx.quality?.anisotropy || 4, 8);
  return t;
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function grain(g, w, h, amt, r) { const id = g.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0); }

/**
 * Facade set. Each entry: { map, emissive?, tile: [metres per texture repeat in u, v] }.
 */
export function makeFacades(ctx) {
  const R = rng(7);
  const F = {};
  // Glass curtain wall: 8 bays × 2 floors per tile (12 m × 9 m)
  {
    const [c, g] = canvas(512, 384), [ce, ge] = canvas(512, 384);
    const grd = g.createLinearGradient(0, 0, 0, 384);
    grd.addColorStop(0, '#5d7286'); grd.addColorStop(0.5, '#33465a'); grd.addColorStop(1, '#2a3a4a');
    g.fillStyle = grd; g.fillRect(0, 0, 512, 384);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 384);
    for (let f = 0; f < 2; f++) {
      const y0 = f * 192;
      g.fillStyle = '#9aa3aa'; g.fillRect(0, y0 + 176, 512, 16);         // floor slab / spandrel
      for (let b = 0; b < 8; b++) {
        const x0 = b * 64;
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x0 + 4, y0 + 4, 28, 168);
        const lit = R() < 0.6;
        const warm = (90 + R() * 120) * (f === 0 ? 1 : 0.8);
        ge.fillStyle = lit ? `rgb(${warm},${warm * 0.85},${warm * 0.6})` : 'rgb(20,18,14)';
        ge.fillRect(x0 + 3, y0 + 2, 58, 172);
      }
    }
    g.fillStyle = '#b8bec4';
    for (let b = 0; b <= 8; b++) g.fillRect(b * 64 - 2, 0, 4, 384);
    for (let f = 0; f < 4; f++) g.fillRect(0, f * 96 + 94, 512, 3);
    F.glass = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [12, 9] };
  }
  // Office: 2 floors of 3.6 m, window bands; tile 14.4 m × 7.2 m
  {
    const [c, g] = canvas(512, 256), [ce, ge] = canvas(512, 256);
    g.fillStyle = '#c9c5bc'; g.fillRect(0, 0, 512, 256);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 512, 256);
    for (let f = 0; f < 2; f++) for (let w = 0; w < 8; w++) {
      const x = w * 64 + 8, y = f * 128 + 40;
      g.fillStyle = '#2c3540'; g.fillRect(x, y, 48, 60);
      g.fillStyle = 'rgba(160,190,220,0.25)'; g.fillRect(x + 2, y + 2, 20, 56);
      g.fillStyle = '#8f8a80'; g.fillRect(x - 2, y + 60, 52, 4);
      if (R() < 0.45) { const k = 160 + R() * 90; ge.fillStyle = `rgb(${k},${k * 0.92},${k * 0.75})`; ge.fillRect(x, y, 48, 60); }
    }
    grain(g, 512, 256, 14, R);
    F.office = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [14.4, 7.2] };
  }
  // Corrugated cladding: vertical ribs, tile 4 m × 4 m (tinted by vertex colour)
  {
    const [c, g] = canvas(256, 256);
    for (let x = 0; x < 256; x++) {
      const k = 0.5 + 0.5 * Math.cos((x / 256) * Math.PI * 2 * 16);
      const v = Math.round(185 + 45 * k);
      g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 256);
    }
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 126, 256, 3);
    grain(g, 256, 256, 10, R);
    F.metal = { map: texFrom(c, ctx), tile: [4, 4] };
  }
  // Hangar / bay door: horizontal panels, tile 8 m × 8 m
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#d0d0cc'; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 32) { g.fillStyle = '#8e8e8a'; g.fillRect(0, y, 256, 3); g.fillStyle = '#e6e6e2'; g.fillRect(0, y + 3, 256, 2); }
    g.fillStyle = '#7a7a76'; g.fillRect(0, 0, 4, 256); g.fillRect(126, 0, 4, 256);
    grain(g, 256, 256, 12, R);
    F.door = { map: texFrom(c, ctx), tile: [8, 8] };
  }
  // Concrete: panels with form-tie holes, tile 6 m × 6 m
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#b5b1a8'; g.fillRect(0, 0, 256, 256);
    grain(g, 256, 256, 26, R);
    g.fillStyle = 'rgba(60,55,50,0.35)'; g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256);
    for (let y = 32; y < 256; y += 64) for (let x = 32; x < 256; x += 64) { g.fillStyle = 'rgba(50,50,50,0.4)'; g.beginPath(); g.arc(x, y, 2.5, 0, 7); g.fill(); }
    for (let k = 0; k < 10; k++) { const x = R() * 256; const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(70,65,60,0.14)'); gr.addColorStop(1, 'rgba(70,65,60,0)'); g.fillStyle = gr; g.fillRect(x, 0, 6 + R() * 10, 256); }
    F.concrete = { map: texFrom(c, ctx), tile: [6, 6] };
  }
  // Roof membrane / gravel, tile 20 m
  {
    const [c, g] = canvas(256, 256);
    g.fillStyle = '#8c8a86'; g.fillRect(0, 0, 256, 256);
    grain(g, 256, 256, 40, R);
    g.fillStyle = 'rgba(40,40,40,0.15)';
    for (let k = 0; k < 6; k++) g.fillRect(0, k * 43, 256, 1);
    F.roof = { map: texFrom(c, ctx), tile: [20, 20] };
  }
  // Parking garage: open floors (dark gaps), tile 12 m × 6 m (2 decks of 3 m)
  {
    const [c, g] = canvas(256, 128), [ce, ge] = canvas(256, 128);
    g.fillStyle = '#bdb8ae'; g.fillRect(0, 0, 256, 128);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 128);
    for (let f = 0; f < 2; f++) {
      g.fillStyle = '#26282a'; g.fillRect(0, f * 64 + 22, 256, 36);
      ge.fillStyle = '#6a6250'; ge.fillRect(0, f * 64 + 24, 256, 32);
      g.fillStyle = '#a8a39a'; for (let x = 0; x < 256; x += 64) g.fillRect(x, f * 64 + 22, 8, 36);
    }
    grain(g, 256, 128, 14, R);
    F.garage = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [12, 6] };
  }
  // Tower cab glass: tile 3 m × 4 m (one pane)
  {
    const [c, g] = canvas(128, 128), [ce, ge] = canvas(128, 128);
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#4f6a6e'); gr.addColorStop(1, '#22343a');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#30363a'; g.fillRect(0, 0, 6, 128); g.fillRect(0, 0, 128, 6);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 128, 128);
    ge.fillStyle = '#4a5a40'; ge.fillRect(8, 8, 120, 120);
    ge.fillStyle = '#9a8a60'; ge.fillRect(8, 90, 120, 38);
    F.cab = { map: texFrom(c, ctx), emissive: texFrom(ce, ctx), tile: [3, 4] };
  }
  return F;
}

/** Sign atlas: black/red/yellow sign faces with text (distance-remaining, holding position, location). */
export function makeSignAtlas(ctx, texts) {
  const cellW = 128, cellH = 48, cols = 16;
  const rows = Math.ceil(texts.length / cols);
  const [c, g] = canvas(cellW * cols, Math.max(1, cellH * rows));
  const index = new Map();
  texts.forEach((t, i) => {
    const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
    const [kind, txt, arrow] = t.split(':');
    const bg = kind === 'hold' ? '#c0141a' : kind === 'loc' ? '#111' : kind === 'dir' ? '#f2c21b' : '#0d0d0d';
    const fg = kind === 'hold' ? '#ffffff' : kind === 'loc' ? '#ffd21c' : kind === 'dir' ? '#0b0b0b' : '#f4f4f4';
    g.fillStyle = bg; g.fillRect(x, y, cellW, cellH);
    if (kind === 'loc') { g.strokeStyle = '#ffd21c'; g.lineWidth = 3; g.strokeRect(x + 5, y + 5, cellW - 10, cellH - 10); }
    g.fillStyle = fg;
    g.font = 'bold 33px "Arial Narrow","Liberation Sans Narrow",Arial,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (kind === 'dir') {
      // text + a drawn arrow (no reliance on font glyphs): arrow on the side it points to
      const right = arrow === 'R', ax = right ? x + cellW - 31 : x + 31, ay = y + cellH / 2, dirn = right ? 1 : -1;
      g.beginPath(); g.moveTo(ax + dirn * 20, ay); g.lineTo(ax + dirn * 3, ay - 15); g.lineTo(ax + dirn * 3, ay - 6); g.lineTo(ax - dirn * 19, ay - 6);
      g.lineTo(ax - dirn * 19, ay + 6); g.lineTo(ax + dirn * 3, ay + 6); g.lineTo(ax + dirn * 3, ay + 15); g.closePath(); g.fill();
      g.fillText(txt, x + cellW / 2 - dirn * 20, y + cellH / 2 + 2, cellW - 60);
    } else g.fillText(txt, x + cellW / 2, y + cellH / 2 + 2, cellW - 15);
    index.set(t, [x / c.width, 1 - (y + cellH) / c.height, (x + cellW) / c.width, 1 - y / c.height]);
  });
  const tex = texFrom(c, ctx);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return { tex, index };
}

/** Chain-link fence texture with alpha. */
export function makeFenceTexture(ctx) {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(190,195,198,0.9)'; g.lineWidth = 1.6;
  for (let k = -128; k < 256; k += 16) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 128, 128); g.stroke(); g.beginPath(); g.moveTo(k, 128); g.lineTo(k + 128, 0); g.stroke(); }
  g.fillStyle = 'rgba(150,150,150,1)'; g.fillRect(0, 0, 128, 4); g.fillRect(0, 124, 128, 4);
  const t = texFrom(c, ctx);
  return t;
}
