// Pavement markings (pure): converts a layout into a flat list of painted quads.
// Quad: { x, z (airport-local centre), hdg (deg, direction of the quad's LENGTH axis = glyph "up"), len, wid, col, glyph?, rw? }
// col: 'w' white, 'y' yellow, 'r' red, 'k' black. glyph: a character from the atlas (runway designators, stand numbers).
// Standards: FAA AC 150/5340-1M (runway/taxiway/holding position markings), ICAO Annex 14 §5.2 (aiming point, TDZ).
import { aimingPointDistance } from './layout.js';

const DEG = Math.PI / 180;

/** Threshold stripe count by runway width (ICAO Annex 14 5.2.4.6 / FAA Table). */
export function thresholdStripeCount(w) {
  if (w >= 60) return 16;
  if (w >= 45) return 12;
  if (w >= 30) return 8;
  if (w >= 23) return 6;
  return 4;
}

export function buildMarkings(L) {
  const Q = [];
  const q = (x, z, hdg, len, wid, col, extra) => { Q.push({ x, z, hdg, len, wid, col, ...extra }); };
  for (const R of L.runways) runwayMarkings(R, q, L);
  taxiMarkings(L, q);
  standMarkings(L, q);
  lotMarkings(L, q);
  return Q;
}

function runwayMarkings(R, q, L) {
  const W = R.wid, Lr = R.len;
  const concrete = R.surface === 'concrete';
  const precision = R.precision;
  // helper in runway-end coordinates: u along from threshold (into the runway), v lateral (+ = pilot's right)
  for (const E of R.ends) {
    const d = E.dir, rt = { x: -E.left.x, z: -E.left.z };
    const P = (u, v) => ({ x: E.thr.x + d.x * u + rt.x * v, z: E.thr.z + d.z * u + rt.z * v });
    const rq = (u0, u1, v0, v1, col = 'w', extra = {}) => {
      const p = P((u0 + u1) / 2, (v0 + v1) / 2);
      if (concrete && col === 'w') q(p.x, p.z, E.heading, (u1 - u0) + 0.5, (v1 - v0) + 0.5, 'k', { rw: R.i });
      q(p.x, p.z, E.heading, u1 - u0, v1 - v0, col, { rw: R.i, ...extra });
    };
    // --- threshold stripes
    const n = thresholdStripeCount(W);
    const stripeW = (W * 0.93) / (2 * n);        // 1.75 m for the standard widths (FAA 5.75 ft), wider on 90 m runways
    const tLen = precision ? 45 : 30;
    const u0 = 6;
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < n / 2; k++) {
        const vIn = stripeW + k * 2 * stripeW;   // central gap = 2·stripeW
        rq(u0, u0 + tLen, side > 0 ? vIn : -vIn - stripeW, side > 0 ? vIn + stripeW : -vIn);
      }
    }
    // --- designation: letter nearest the threshold, then the number (FAA AC 150/5340-1 fig. A-?)
    let u = u0 + tLen + 6;
    const gh = W >= 30 ? 18 : 12, gw = W >= 30 ? 6 : 4, gap = gw * 0.5;
    const putText = (txt, uStart) => {
      const nch = txt.length;
      const total = nch * gw + (nch - 1) * gap;
      for (let i = 0; i < nch; i++) {
        const v = -total / 2 + gw / 2 + i * (gw + gap);
        const p = P(uStart + gh / 2, v);
        if (concrete) q(p.x, p.z, E.heading, gh, gw, 'k', { glyph: txt[i], outline: true, rw: R.i });
        q(p.x, p.z, E.heading, gh, gw, 'w', { glyph: txt[i], rw: R.i });
      }
    };
    if (E.letter) { putText(E.letter, u); u += gh + 6; }
    putText(E.digits, u); u += gh;
    E.clStart = u + 12;
    // --- aiming point
    const aim = aimingPointDistance(Lr);
    if (Lr >= 1200 || precision) {
      const aLen = Lr >= 2400 ? 60 : 45, aWid = W >= 45 ? (Lr >= 2400 ? 10 : 9) : W >= 30 ? 6 : 4;
      const inner = W >= 45 ? 20 : W >= 30 ? 12 : 8;
      for (const sgn of [-1, 1]) rq(aim, aim + aLen, sgn > 0 ? inner / 2 : -inner / 2 - aWid, sgn > 0 ? inner / 2 + aWid : -inner / 2);
      R.aimLen = aLen;
    }
    // --- touchdown zone (precision runways): pairs of 3/3/2/2/1/1 bars, 22.5 m × 1.8 m, 1.5 m apart
    if (precision) {
      const inner = W >= 45 ? 20 : 12;
      const pairs = [[150, 3], [300, 3], [550, 2], [700, 2], [850, 1], [1000, 1]];
      for (const [pu, nb] of pairs) {
        if (pu + 22.5 > Lr / 2 - 60) break;
        for (const sgn of [-1, 1]) for (let b = 0; b < nb; b++) {
          const vi = inner / 2 + b * 3.3;
          rq(pu, pu + 22.5, sgn > 0 ? vi : -vi - 1.8, sgn > 0 ? vi + 1.8 : -vi);
        }
      }
    }
    // --- blast pad chevrons (yellow), apex on the centreline pointing toward the threshold
    if (R.blast > 0) {
      const armW = 0.9, half = W / 2;
      for (let apex = -4; apex - half > -R.blast + 2; apex -= 30) {
        for (const sgn of [-1, 1]) {
          const len = half * Math.SQRT2;
          const c = P(apex - half / 2, sgn * half / 2);
          q(c.x, c.z, E.heading + sgn * 45, len, armW, 'y', { rw: R.i });
        }
      }
    }
  }
  // --- centreline (between the designations), 36 m stripes / 24 m gaps (FAA 120 ft / 80 ft)
  {
    const E = R.ends[0], d = E.dir;
    const s0 = R.ends[0].clStart, s1 = Lr - R.ends[1].clStart;
    const D = s1 - s0, dash = 36, gapNom = 24;
    const nD = Math.max(1, Math.floor((D + gapNom) / (dash + gapNom)));
    const gapA = nD > 1 ? (D - nD * dash) / (nD - 1) : 0;
    const w = precision ? 0.9 : 0.6;
    for (let k = 0; k < nD; k++) {
      const uc = s0 + dash / 2 + k * (dash + gapA);
      const p = { x: E.thr.x + d.x * uc, z: E.thr.z + d.z * uc };
      if (concrete) q(p.x, p.z, E.heading, dash + 0.5, w + 0.5, 'k', { rw: R.i });
      q(p.x, p.z, E.heading, dash, w, 'w', { rw: R.i });
    }
    // --- side stripes along both edges, threshold to threshold
    const sw = W >= 30 ? 0.9 : 0.45;
    for (const sgn of [-1, 1]) {
      const v = sgn * (W / 2 - sw / 2 - 0.1);
      const p = { x: R.x - E.left.x * v, z: R.z - E.left.z * v };
      q(p.x, p.z, E.heading, Lr, sw, 'w', { rw: R.i });
    }
  }
}

function polyQuads(pts, wid, col, q, extra) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const hdg = Math.atan2(dx, -dz) / DEG;
    // small overlap so joints of curves are closed
    q((a.x + b.x) / 2, (a.z + b.z) / 2, hdg, len + wid * 0.6, wid, col, extra);
  }
}

function dashedAlong(a, b, dash, gap, wid, col, q, offset = 0) {
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  const ux = dx / len, uz = dz / len, hdg = Math.atan2(dx, -dz) / DEG;
  for (let s = offset; s + dash <= len; s += dash + gap) {
    const m = s + dash / 2;
    q(a.x + ux * m, a.z + uz * m, hdg, dash, wid, col);
  }
}

function taxiMarkings(L, q) {
  const spec = L.spec;
  const clW = 0.3;
  for (const t of L.taxiLines) {
    const pts = t.pts || t.arc;
    if (!pts) continue;
    polyQuads(pts, clW, 'y', q);
  }
  // taxiway edge markings (double solid yellow) on taxiways with paved shoulders
  if (spec.twyShoulder > 0) {
    for (const r of L.pave) {
      if (r.kind !== 'twy' || !r.parallel) continue;
      const h = r.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
      // gaps where connectors meet the runway-side edge; the apron side is left open along the apron
      for (const sgn of [-1, 1]) {
        for (const off of [r.wid / 2 - 0.25, r.wid / 2 - 0.75]) {
          const ox = rx * sgn * off, oz = rz * sgn * off;
          // break the line into segments between connectors
          const cuts = [];
          for (const c of L.pave) {
            if (c.kind !== 'twy' || c === r || c.parallel) continue;
            const along = (c.x - r.x) * dx + (c.z - r.z) * dz;
            const cross = (c.x - r.x) * rx + (c.z - r.z) * rz;
            if (Math.abs(along) > r.len / 2 + 30 || Math.abs(cross) > 400) continue;
            if (Math.sign(cross) !== sgn && Math.abs(cross) > 5) continue;
            const halfW = c.ret ? 60 : c.wid / 2 + 25;
            cuts.push([along - halfW, along + halfW]);
          }
          for (const a of L.aprons) {
            // project apron extents on this taxiway
            const ac = L.frame.P(a.a, a.c);
            const cross = (ac.x - r.x) * rx + (ac.z - r.z) * rz;
            if (Math.sign(cross) !== sgn || Math.abs(cross) > a.dep + 100) continue;
            const along = (ac.x - r.x) * dx + (ac.z - r.z) * dz;
            cuts.push([along - a.len / 2, along + a.len / 2]);
          }
          cuts.sort((p, s) => p[0] - s[0]);
          let s = -r.len / 2 + 15;
          const segs = [];
          for (const [c0, c1] of cuts) { if (c0 > s) segs.push([s, c0]); s = Math.max(s, c1); }
          if (s < r.len / 2 - 15) segs.push([s, r.len / 2 - 15]);
          for (const [s0, s1] of segs) {
            if (s1 - s0 < 3) continue;
            const m = (s0 + s1) / 2;
            q(r.x + dx * m + ox, r.z + dz * m + oz, r.hdg, s1 - s0, 0.25, 'y');
          }
        }
      }
    }
  }
  // holding position markings (pattern A): two solid lines on the holding side, two dashed on the runway side
  for (const h of L.holds) {
    const hr = h.hdg * DEG, dx = Math.sin(hr), dz = -Math.cos(hr), rx = Math.cos(hr), rz = Math.sin(hr);
    const W = h.wid;
    for (const [off, solid] of [[-0.9, false], [-0.3, false], [0.3, true], [0.9, true]]) {
      const cx = h.x + dx * off, cz = h.z + dz * off;
      if (solid) q(cx, cz, h.hdg + 90, W, 0.3, 'y');
      else dashedAlong({ x: cx - rx * W / 2, z: cz - rz * W / 2 }, { x: cx + rx * W / 2, z: cz + rz * W / 2 }, 0.9, 0.9, 0.3, 'y', q, 0.45);
    }
    // enhanced taxiway centreline: dashed lines either side of the centreline for 45 m on the holding side
    for (const sgn of [-1, 1]) {
      const a = { x: h.x + dx * 2 + rx * sgn * 0.45, z: h.z + dz * 2 + rz * sgn * 0.45 };
      const b = { x: a.x + dx * 45, z: a.z + dz * 45 };
      dashedAlong(a, b, 2.7, 0.9, 0.15, 'y', q);
    }
    // surface painted holding position sign (red with white runway designation) on intl airports
    if (L.kind === 'international' || L.kind === 'military') {
      const txt = L.runways[h.rwy].ends.map((e) => e.digits + e.letter).join('-');
      const n = txt.length, gh = 2.6, gw = 1.2;
      const cx = h.x + dx * 6, cz = h.z + dz * 6;
      // read by the pilot approaching the hold (moving toward the runway, i.e. along -hdg)
      const hd = h.hdg + 180;
      q(cx, cz, hd, gh + 1.0, n * gw + 1.4, 'r');
      for (let i = 0; i < n; i++) {
        const v = -(n * gw) / 2 + gw / 2 + i * gw;
        // pilot's right (moving along hd) = -r of the hold frame
        q(cx - rx * v, cz - rz * v, hd, gh, gw, 'w', { glyph: txt[i] === '-' ? '-' : txt[i] });
      }
    }
  }
}

function standMarkings(L, q) {
  for (const s of L.stands) {
    if (!s.paint) continue;
    const h = s.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    if (s.leadFrom) {
      // lead-in line: from the taxilane, straight in to the stop position (tangent to taxilane at the start)
      const a = s.leadFrom;
      polyQuads([a, { x: s.x, z: s.z }], 0.25, 'y', q);
      // stop bar across the lead-in line at the nose-wheel stop position
      q(s.x + dx * 0.3, s.z + dz * 0.3, s.hdg + 90, s.size === 'heavy' ? 6 : 4, 0.3, 'y');
      if (s.number != null) {
        const txt = String(s.number);
        const gh = 3, gw = 1.6, n = txt.length;
        const p = { x: a.x + dx * 12, z: a.z + dz * 12 };
        for (let i = 0; i < n; i++) {
          const v = -(n * gw * 1.1) / 2 + gw / 2 + i * gw * 1.1;
          q(p.x + rx * (v - 3.5), p.z + rz * (v - 3.5), s.hdg, gh, gw, 'y', { glyph: txt[i] });
        }
      }
      // equipment restraint area: red box near the nose for bridge stands
      if (s.bridge) {
        const c = { x: s.x + dx * 3, z: s.z + dz * 3 };
        const W = s.size === 'heavy' ? 30 : 22;
        q(c.x + rx * (W / 2), c.z + rz * (W / 2), s.hdg, 6, 0.2, 'r');
        q(c.x - rx * (W / 2), c.z - rz * (W / 2), s.hdg, 6, 0.2, 'r');
        q(c.x - dx * 3, c.z - dz * 3, s.hdg + 90, W, 0.2, 'r');
      }
    } else if (s.size === 'fighter' || s.size === 'light') {
      // short lead line + T stop bar
      const len = s.size === 'fighter' ? 16 : 8;
      q(s.x - dx * len / 2, s.z - dz * len / 2, s.hdg, len, 0.2, 'y');
      q(s.x, s.z, s.hdg + 90, s.size === 'fighter' ? 3 : 2, 0.2, 'y');
      if (s.tiedown) {
        // tie-down anchors marked with white boxes at the wing positions
        for (const sg of [-1, 1]) q(s.x - dx * 2 + rx * sg * 5, s.z - dz * 2 + rz * sg * 5, s.hdg, 1, 1, 'w');
      }
    }
  }
  // stains: every stand collects oil/hydraulic drips under the engines and the nose gear, APU soot behind the tail,
  // and tyre scuffs along the lead-in line where aircraft turn in and stop ('s' = soft dark blob, low opacity)
  for (const s of L.stands) {
    const h = s.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const at = (fwd, right) => ({ x: s.x + dx * fwd + rx * right, z: s.z + dz * fwd + rz * right });
    const blob = (p, len, wid, hd = s.hdg) => q(p.x, p.z, hd, len, wid, 's', { glyph: 'o' });
    if (s.size === 'heavy' || s.size === 'medium') {
      const k = s.size === 'heavy' ? 1.55 : 1;
      blob(at(-0.5, 0), 7, 3.2);
      for (const sg of [-1, 1]) { blob(at(-9 * k, sg * 5.6 * k), 7 * k, 5 * k); blob(at(-15 * k, sg * 2.9 * k), 9, 3.5); }
      blob(at(-34 * k, 0), 10 * k, 4.5 * k);
      if (s.leadFrom) {
        const a = s.leadFrom, ll = Math.hypot(s.x - a.x, s.z - a.z);
        for (const sg of [-1, 1]) for (let t = 0; t < 3; t++) {
          const m = ll * (0.2 + 0.25 * t);
          q(a.x + (s.x - a.x) * (m / ll) + rx * sg * 2.9 * k, a.z + (s.z - a.z) * (m / ll) + rz * sg * 2.9 * k, s.hdg, ll * 0.3, 1.4, 's', { glyph: 'o' });
        }
      }
    } else if (s.size === 'fighter') {
      blob(at(-1, 0), 4, 2); blob(at(-7, 0), 6, 3.5); blob(at(-15, 0), 8, 4);
    } else blob(at(-1.5, 0), 4, 3);
  }
  // tail-of-stand service road along each apron (two white lines, dashed centre)
  for (const a of L.aprons) {
    if (L.kind !== 'international') continue;
    const F = L.frame, s = a.side;
    const c0 = a.cOut - s * 84, c1 = a.cOut - s * 76;
    for (const c of [c0, c1]) { const p = F.P(a.a, c); q(p.x, p.z, F.H, a.len - 30, 0.2, 'w'); }
    dashedAlong(F.P(a.a - a.len / 2 + 15, (c0 + c1) / 2), F.P(a.a + a.len / 2 - 15, (c0 + c1) / 2), 3, 3, 0.15, 'w', q);
  }
}

function lotMarkings(L, q) {
  for (const P of L.parkingLots) {
    const h = P.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    P.bays = [];
    // rows across the lot's width: [bay 5 m][aisle 7 m][bay 5 m] repeating along the width
    const rowPitch = 17;
    const nRows = Math.floor(P.wid / rowPitch);
    for (let r = 0; r < nRows; r++) {
      const cRow = -P.wid / 2 + rowPitch * r + 6;
      for (const side of [-1, 1]) {
        const cb = cRow + (side > 0 ? 5 : 0); // two bay rows back to back around cRow+2.5... simplified
        const nb = Math.floor((P.len - 6) / 2.6);
        for (let k = 0; k <= nb; k++) {
          const a = -P.len / 2 + 3 + k * 2.6;
          const p = { x: P.x + dx * a + rx * cb, z: P.z + dz * a + rz * cb };
          q(p.x, p.z, P.hdg + 90, 5, 0.12, 'w');
          if (k < nb) P.bays.push({ x: P.x + dx * (a + 1.3) + rx * cb, z: P.z + dz * (a + 1.3) + rz * cb, hdg: P.hdg + 90 + (side > 0 ? 0 : 180) });
        }
      }
    }
  }
  for (const R of L.roads) {
    for (let i = 0; i + 1 < R.pts.length; i++) {
      const a = R.pts[i], b = R.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
      const rx = -uz, rz = ux, hdg = Math.atan2(dx, -dz) / DEG;
      for (const sg of [-1, 1]) q((a.x + b.x) / 2 + rx * sg * (R.wid / 2 - 0.5), (a.z + b.z) / 2 + rz * sg * (R.wid / 2 - 0.5), hdg, len, 0.15, 'w');
      if (R.lanes >= 4) {
        for (const sg of [-1, 1]) q((a.x + b.x) / 2 + rx * sg * 0.25, (a.z + b.z) / 2 + rz * sg * 0.25, hdg, len, 0.12, 'y');
        for (const sg of [-1, 1]) dashedAlong({ x: a.x + rx * sg * R.wid / 4, z: a.z + rz * sg * R.wid / 4 }, { x: b.x + rx * sg * R.wid / 4, z: b.z + rz * sg * R.wid / 4 }, 3, 9, 0.12, 'w', q);
      } else dashedAlong(a, b, 3, 9, 0.12, 'y', q);
    }
  }
}
