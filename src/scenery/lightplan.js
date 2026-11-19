// Aeronautical ground lighting plan (pure). Produces a flat Float32-ready array of light fixtures for one airport.
// Standards: FAA AC 150/5340-30 (design & installation of airport visual aids), AC 150/5345 (fixtures), ICAO Annex 14 §5.3.
//
// Stride LIGHT_STRIDE per light:
//  0-2 x, y, z        airport-local metres (y above the airport elevation)
//  3-5 r, g, b        chromaticity (linear, max component 1)
//  6   intensity      relative luminous intensity (runway edge light = 1)
//  7-9 dx, dy, dz     main beam direction (unit) — the direction the light SHINES toward
//  10  cosW           beam half-width cosine; <= -1.5 means omnidirectional
//  11  mode           0 steady, 1 sequenced flasher, 2 rotating beacon, 3 PAPI, 4 slow-blink obstruction, 5 strobe, 6 wig-wag
//  12  p1             phase (s) / PAPI transition angle (rad)
//  13  p2             period (s)
//  14  size           sprite size class (fixture glow radius in metres)
//  15  day            fraction of the night intensity shown in daylight (0 = night/low-vis only)
export const LIGHT_STRIDE = 16;
export const MODE = { STEADY: 0, SEQ: 1, BEACON: 2, PAPI: 3, BLINK: 4, STROBE: 5, WIGWAG: 6 };

const DEG = Math.PI / 180;
export const COLORS = {
  white: [1.0, 0.9, 0.74],      // halogen runway white
  yellow: [1.0, 0.6, 0.1],
  red: [1.0, 0.07, 0.03],
  green: [0.1, 1.0, 0.45],
  blue: [0.1, 0.28, 1.0],
  sodium: [1.0, 0.62, 0.28],
  led: [1.0, 0.94, 0.85],
  strobe: [0.85, 0.9, 1.0],
};

export function buildLightPlan(L, heightFn = () => 0) {
  const out = [];
  const poles = [];   // approach-light stanchions { x, z, h, w (crossbar width), hdg }
  // coloured filters pass only part of the lamp's output (and keeps hues from blowing out to white in the tone map)
  const filt = new Map([[COLORS.red, 0.45], [COLORS.green, 0.55], [COLORS.blue, 0.7], [COLORS.yellow, 0.8]]);
  const push = (x, y, z, col, I, dir, cosW, mode = 0, p1 = 0, p2 = 0, size = 0.25, day = 0) => {
    I *= filt.get(col) ?? 1;
    out.push(x, y, z, col[0], col[1], col[2], I, dir ? dir[0] : 0, dir ? dir[1] : 0, dir ? dir[2] : 0, dir ? cosW : -2, mode, p1, p2, size, day);
  };
  const lift = (x, z, h) => Math.max(0, heightFn(x, z)) + h;
  const counts = {};
  let prev = 0;
  const tally = (k) => { const n = out.length / LIGHT_STRIDE; counts[k] = (counts[k] || 0) + n - prev; prev = n; };

  for (const R of L.runways) {
    const W = R.wid, Lr = R.len, full = R.precision;
    const E0 = R.ends[0], d = E0.dir, rt = { x: -E0.left.x, z: -E0.left.z };
    const P = (u, v) => ({ x: E0.thr.x + d.x * u + rt.x * v, z: E0.thr.z + d.z * u + rt.z * v });
    const toward0 = [-d.x, 0.04, -d.z], toward1 = [d.x, 0.04, d.z];
    // ---- edge lights (HIRL/MIRL): ≤ 60 m spacing, bidirectional; yellow in the last 600 m (instrument runways)
    {
      const n = Math.ceil(Lr / 60);
      for (let k = 0; k <= n; k++) {
        const u = (k / n) * Lr;
        for (const sg of [-1, 1]) {
          const p = P(u, sg * (W / 2 + 1.2));
          const c0 = full && Lr - u <= 600 ? COLORS.yellow : COLORS.white;   // seen by a pilot using end 0
          const c1 = full && u <= 600 ? COLORS.yellow : COLORS.white;        // seen by a pilot using end 1
          push(p.x, 0.36, p.z, c0, 1, toward0, 0.0, 0, 0, 0, 0.22, 0);
          push(p.x, 0.36, p.z, c1, 1, toward1, 0.0, 0, 0, 0, 0.22, 0);
        }
      }
      tally('edge');
    }
    // ---- threshold (green, outward) and runway end (red, inward) bars at both ends
    for (const E of R.ends) {
      const de = E.dir, re = { x: -E.left.x, z: -E.left.z };
      const n = Math.max(8, Math.round(W / 3));
      for (let k = 0; k <= n; k++) {
        const v = -W / 2 + (k / n) * W;
        const x = E.thr.x - de.x * 1.0 + re.x * v, z = E.thr.z - de.z * 1.0 + re.z * v;
        push(x, 0.3, z, COLORS.green, 1.3, [-de.x, 0.05, -de.z], 0.55, 0, 0, 0, 0.24, 0);
        push(x, 0.3, z, COLORS.red, 0.8, [de.x, 0.03, de.z], 0.7, 0, 0, 0, 0.22, 0);
      }
      // threshold wing bars (basic runways) — 5 green lights each side outside the edge
      if (!full) {
        for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) {
          const v = sg * (W / 2 + 3 + k * 3);
          const x = E.thr.x - de.x * 1.0 + re.x * v, z = E.thr.z - de.z * 1.0 + re.z * v;
          push(x, 0.3, z, COLORS.green, 1.2, [-de.x, 0.05, -de.z], 0.55, 0, 0, 0, 0.24, 0);
        }
      }
    }
    tally('threshold');
    // ---- centreline lights (instrument runways): 15 m spacing, 0.6 m offset;
    //      white → alternating red/white in the last 900 m → red in the last 300 m (for each direction)
    if (full) {
      const n = Math.floor(Lr / 15);
      const ccol = (remain, k) => (remain <= 300 ? COLORS.red : remain <= 900 ? (k % 2 ? COLORS.red : COLORS.white) : COLORS.white);
      for (let k = 1; k < n; k++) {
        const u = k * 15;
        const p = P(u, 0.6);
        push(p.x, 0.03, p.z, ccol(Lr - u, k), 0.75, toward0, 0.9, 0, 0, 0, 0.16, 0);
        push(p.x, 0.03, p.z, ccol(u, k), 0.75, toward1, 0.9, 0, 0, 0, 0.16, 0);
      }
      tally('centreline');
      // ---- touchdown zone lights: barrettes of 3, 30 m spacing, first 900 m from each threshold
      for (const E of R.ends) {
        const de = E.dir, re = { x: -E.left.x, z: -E.left.z };
        for (let u = 30; u <= 900 && u < Lr / 2; u += 30) {
          for (const sg of [-1, 1]) for (let j = 0; j < 3; j++) {
            const v = sg * (11 + j * 1.5);
            push(E.thr.x + de.x * u + re.x * v, 0.03, E.thr.z + de.z * u + re.z * v, COLORS.white, 0.7, [-de.x, 0.06, -de.z], 0.9, 0, 0, 0, 0.16, 0);
          }
        }
      }
      tally('tdz');
    }
    // ---- approach lighting
    R.ends.forEach((E, ei) => {
      const de = E.dir, re = { x: -E.left.x, z: -E.left.z };
      const Q = (u, v) => ({ x: E.thr.x + de.x * u + re.x * v, z: E.thr.z + de.z * u + re.z * v });
      const aim = [-de.x * Math.cos(6 * DEG), Math.sin(6 * DEG), -de.z * Math.cos(6 * DEG)];
      const bar = (u, nl, spacing, col, I) => {
        const pc = Q(u, 0);
        poles.push({ x: pc.x, z: pc.z, h: lift(pc.x, pc.z, 0.8) - 0.12, w: (nl - 1) * spacing, hdg: E.heading });
        for (let j = 0; j < nl; j++) {
          const v = (j - (nl - 1) / 2) * spacing;
          const p = Q(u, v);
          push(p.x, lift(p.x, p.z, 0.8), p.z, col, I, aim, 0.9, 0, 0, 0, 0.26, 0.5);
        }
      };
      if (full) {
        // ALSF-2: 720 m, barrettes every 30 m, 1000 ft and 500 ft crossbars, red side rows in the inner 300 m,
        // sequenced flashers (the "rabbit") from 330 m to 720 m, twice per second toward the threshold
        for (let u = 30; u <= 720; u += 30) bar(-u, 5, 1.05, COLORS.white, 1.6);
        for (const sg of [-1, 1]) for (let j = 0; j < 8; j++) { const p = Q(-300, sg * (4.5 + j * 1.5)); push(p.x, lift(p.x, p.z, 0.8), p.z, COLORS.white, 1.6, aim, 0.9, 0, 0, 0, 0.26, 0.5); }
        for (const sg of [-1, 1]) for (let j = 0; j < 4; j++) { const p = Q(-150, sg * (4.5 + j * 1.5)); push(p.x, lift(p.x, p.z, 0.8), p.z, COLORS.white, 1.6, aim, 0.9, 0, 0, 0, 0.26, 0.5); }
        for (let u = 30; u <= 270; u += 30) for (const sg of [-1, 1]) for (let j = 0; j < 3; j++) {
          const p = Q(-u, sg * (11 + j * 1.5));
          push(p.x, lift(p.x, p.z, 0.6), p.z, COLORS.red, 1.2, aim, 0.9, 0, 0, 0, 0.24, 0.3);
        }
        const nF = 14;
        for (let k = 0; k < nF; k++) {
          const u = 720 - k * 30;              // farthest flashes first
          const p = Q(-u, 0);
          push(p.x, lift(p.x, p.z, 1.6), p.z, COLORS.strobe, 9, aim, 0.85, MODE.SEQ, (k / nF) * 0.38, 0.5, 0.45, 0.6);
        }
      } else if (ei === 0) {
        // MALSR: steady barrettes every 60 m to 420 m, 1000 ft crossbar, runway alignment indicator flashers beyond
        for (let u = 60; u <= 420; u += 60) bar(-u, 5, 1.05, COLORS.white, 1.4);
        for (const sg of [-1, 1]) for (let j = 0; j < 5; j++) { const p = Q(-300, sg * (3.5 + j * 1.5)); push(p.x, lift(p.x, p.z, 0.8), p.z, COLORS.white, 1.4, aim, 0.9, 0, 0, 0, 0.26, 0.5); }
        const nF = 5;
        for (let k = 0; k < nF; k++) {
          const u = 720 - k * 60;
          const p = Q(-u, 0);
          push(p.x, lift(p.x, p.z, 1.4), p.z, COLORS.strobe, 8, aim, 0.85, MODE.SEQ, (k / nF) * 0.3, 0.5, 0.45, 0.6);
        }
      } else {
        // REIL: synchronised flashing pair either side of the threshold, aimed 15° outward
        for (const sg of [-1, 1]) {
          const p = Q(-2, sg * (W / 2 + 12));
          const a = Math.atan2(-de.x, -de.z) + sg * 15 * DEG;
          push(p.x, 0.6, p.z, COLORS.strobe, 7, [Math.sin(a), 0.1, Math.cos(a)], 0.75, MODE.STROBE, 0, 1.0, 0.4, 0.4);
        }
      }
    });
    tally('approach');
    // ---- PAPI: 4 units, each 2 lamps; red/white by the viewer's elevation angle
    for (const E of R.ends) {
      const de = E.dir;
      for (const u of E.papi) {
        for (const off of [-0.45, 0.45]) {
          const xx = u.x + E.left.x * off, zz = u.z + E.left.z * off;
          push(xx, 0.8, zz, COLORS.white, 2.6, [-de.x, 0.05, -de.z], 0.8, MODE.PAPI, u.angle * DEG, 0, 0.3, 0.3);
        }
      }
    }
    tally('papi');
  }

  // ---- taxiway lights: blue edge (all), green centreline (where specified)
  const rwys = L.runways;
  const onRunwayStrip = (x, z, margin) => rwys.some((R) => {
    const E = R.ends[0];
    const ox = x - R.x, oz = z - R.z;
    const al = ox * E.dir.x + oz * E.dir.z, cr = -ox * E.dir.z + oz * E.dir.x;
    return Math.abs(al) < R.len / 2 + R.blast + margin && Math.abs(cr) < R.wid / 2 + R.shoulder + margin;
  });
  const distToRunwayCL = (x, z) => Math.min(...rwys.map((R) => {
    const E = R.ends[0]; const ox = x - R.x, oz = z - R.z;
    return Math.abs(-ox * E.dir.z + oz * E.dir.x);
  }));
  const inApron = (x, z) => L.aprons.some((a) => {
    const p = L.frame.toAC(x, z);
    return Math.abs(p.a - a.a) < a.len / 2 + 2 && Math.abs(p.c - a.c) < a.dep / 2 + 2;
  });
  const inTwy = (x, z, self) => L.pave.some((r) => {
    if (r === self || r.kind !== 'twy') return false;
    const h = r.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h);
    const ox = x - r.x, oz = z - r.z;
    return Math.abs(ox * dx + oz * dz) < r.len / 2 + 1 && Math.abs(-ox * dz + oz * dx) < r.wid / 2 + 2;
  });
  for (const r of L.pave) {
    if (r.kind !== 'twy') continue;
    const h = r.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    const n = Math.max(1, Math.round(r.len / 50));
    for (let k = 0; k <= n; k++) {
      const s = -r.len / 2 + (k / n) * r.len;
      for (const sg of [-1, 1]) {
        const x = r.x + dx * s + rx * sg * (r.wid / 2 + 1), z = r.z + dz * s + rz * sg * (r.wid / 2 + 1);
        if (onRunwayStrip(x, z, 6) || inApron(x, z) || inTwy(x, z, r)) continue;
        push(x, 0.35, z, COLORS.blue, 0.45, null, -2, 0, 0, 0, 0.18, 0);
      }
    }
  }
  tally('taxiEdge');
  if (L.spec.twyCL) {
    for (const t of L.taxiLines) {
      const pts = t.pts || t.arc; if (!pts) continue;
      const step = t.arc || t.kind === 'ret' ? 12 : 30;
      let acc = 0, idx = 0;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        while (acc <= len) {
          const t2 = acc / len, x = a.x + (b.x - a.x) * t2, z = a.z + (b.z - a.z) * t2;
          const dr = distToRunwayCL(x, z);
          // FAA: alternating green/yellow between the runway centreline and the holding position
          const col = dr < L.spec.hold ? (idx % 2 ? COLORS.yellow : COLORS.green) : COLORS.green;
          if (dr > 3) push(x, 0.03, z, col, 0.5, null, -2, 0, 0, 0, 0.13, 0);
          acc += step; idx++;
        }
        acc -= len;
      }
    }
    tally('taxiCL');
  }
  // ---- runway guard lights (wig-wags) at each holding position: alternating yellow pair
  for (const h of L.holds) {
    const hr = h.hdg * DEG, dx = Math.sin(hr), dz = -Math.cos(hr), rx = Math.cos(hr), rz = Math.sin(hr);
    for (const sg of [-1, 1]) {
      const x = h.x + rx * sg * (h.wid / 2 + 4) + dx * 1.5, z = h.z + rz * sg * (h.wid / 2 + 4) + dz * 1.5;
      for (const j of [-1, 1]) {
        push(x + rx * j * 0.3, 0.9, z + rz * j * 0.3, COLORS.yellow, 1.4, [dx, 0.05, dz], 0.6, MODE.WIGWAG, j > 0 ? 0.5 : 0, 1.0, 0.22, 0.25);
      }
    }
  }
  tally('guard');
  // ---- apron floodlights (lamp heads on masts), street lights
  for (const f of L.floods) {
    for (const j of [-1, 0, 1]) {
      const rx = -f.aim.z, rz = f.aim.x;
      push(f.x + rx * j * 1.2, f.h + 0.4, f.z + rz * j * 1.2, COLORS.led, 2.2, [f.aim.x * 0.6, -0.8, f.aim.z * 0.6], -0.2, 0, 0, 0, 0.5, 0);
    }
  }
  for (const s of L.streetLights) push(s.x, s.h, s.z, COLORS.sodium, 1.0, [0, -1, 0], -0.3, 0, 0, 0, 0.35, 0);
  tally('flood');
  // ---- obstruction lights + rotating beacon on the tower
  if (L.tower) {
    const t = L.tower;
    const top = t.h + t.cab * 0.5 + 3.2;
    push(t.x, top + 1.2, t.z, COLORS.white, 6, null, -2, MODE.BEACON, 0, 2.4, 0.5, 0);
    push(t.x, top + 1.2, t.z, COLORS.green, 6, null, -2, MODE.BEACON, 0.5, 2.4, 0.5, 0);
    push(t.x + 1.5, top, t.z, COLORS.red, 1.1, null, -2, 0, 0, 0, 0.3, 0);
  }
  for (const p of L.props) {
    if (p.type === 'mast') push(p.x, p.h + 0.3, p.z, COLORS.red, 1.4, null, -2, MODE.BLINK, (p.x * 0.013) % 1.5, 1.5, 0.3, 0);
    if (p.type === 'radar') push(p.x, p.h + 2 * p.r + 0.5, p.z, COLORS.red, 1.0, null, -2, 0, 0, 0, 0.3, 0);
    if (p.type === 'glideslope') push(p.x, 16, p.z, COLORS.red, 1.0, null, -2, 0, 0, 0, 0.3, 0);
  }
  for (const b of L.buildings) {
    if (b.type !== 'hangar' && b.type !== 'terminal') continue;
    const h = b.hdg * DEG, dx = Math.sin(h), dz = -Math.cos(h), rx = Math.cos(h), rz = Math.sin(h);
    for (const [sa, sc] of [[-1, -1], [1, 1]]) push(b.x + dx * sa * b.len / 2 + rx * sc * b.wid / 2, b.h + 0.4, b.z + dz * sa * b.len / 2 + rz * sc * b.wid / 2, COLORS.red, 0.8, null, -2, 0, 0, 0, 0.25, 0);
  }
  tally('obstruction');
  return { data: out, count: out.length / LIGHT_STRIDE, counts, poles };
}
