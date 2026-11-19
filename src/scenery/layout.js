// Airport layout generation (pure: no three.js, node-testable).
//
// buildLayout(airport) turns the fixed airport data (position, elevation, runways) into an abstract airfield plan in
// AIRPORT-LOCAL coordinates: x east, z south, metres relative to airport.position, y = metres above airport.elevation.
// Everything downstream (pavement meshes, paint, lights, buildings, props, the physics surface provider) is built from it.
//
// Internally the field is designed in a "frame": a = along the primary runway heading, c = cross (+ = right of heading).
// Standards used: ICAO Annex 14 Vol I / FAA AC 150/5300-13 (separations, holding positions), AC 150/5340-1 (markings).

const DEG = Math.PI / 180;

export const KIND_SPECS = {
  //            rwy→twy sep, twy width, twy shoulder, holding pos., rwy shoulder, blast pad, RETs, apron depth
  international: { T: 190, twyW: 23, twyShoulder: 7.5, hold: 90, rwyShoulder: 7.5, blast: 120, ret: true, twyCL: true, apronDepth: 175 },
  military:      { T: 200, twyW: 23, twyShoulder: 5, hold: 90, rwyShoulder: 7.5, blast: 150, ret: false, twyCL: true, apronDepth: 300 },
  regional:      { T: 120, twyW: 15, twyShoulder: 0, hold: 65, rwyShoulder: 0, blast: 45, ret: false, twyCL: false, apronDepth: 105 },
  island:        { T: 135, twyW: 18, twyShoulder: 3, hold: 75, rwyShoulder: 3, blast: 60, ret: false, twyCL: false, apronDepth: 120 },
};

export function makeFrame(ox, oz, H) {
  const h = H * DEG;
  const d = { x: Math.sin(h), z: -Math.cos(h) }, r = { x: Math.cos(h), z: Math.sin(h) };
  return {
    H, d, r, ox, oz,
    /** frame (a, c) → airport-local {x, z} */
    P(a, c) { return { x: ox + a * d.x + c * r.x, z: oz + a * d.z + c * r.z }; },
    toAC(x, z) { const dx = x - ox, dz = z - oz; return { a: dx * d.x + dz * d.z, c: dx * r.x + dz * r.z }; },
  };
}

/** Parse "09L" → { digits: '9', letter: 'L', number: 9 }. FAA style: no leading zero. */
export function parseDesignator(name) {
  const m = /^(\d{1,2})([LCR]?)$/.exec(name.trim());
  if (!m) return { digits: name, letter: '', number: 0 };
  const n = parseInt(m[1], 10);
  return { digits: String(n), letter: m[2] || '', number: n };
}

const norm360 = (h) => ((h % 360) + 360) % 360;

/**
 * Oriented rectangle helper. hdg = direction of the LENGTH axis (deg true). Returns an airport-local record.
 */
function rect(F, a, c, len, wid, kind, surf, extra) {
  const p = F.P(a, c);
  return { x: p.x, z: p.z, hdg: F.H, len, wid, kind, surf, ...extra };
}

function rectAngled(x, z, hdg, len, wid, kind, surf, extra) { return { x, z, hdg: norm360(hdg), len, wid, kind, surf, ...extra }; }

export function buildLayout(airport) {
  const spec = KIND_SPECS[airport.kind] || KIND_SPECS.regional;
  const P0 = airport.position;
  const loc = (w) => ({ x: w.x - P0.x, z: w.z - P0.z });
  const rw0 = airport.runways[0];
  const H = rw0.heading;
  // Frame origin: midpoint of runway centres
  let ox = 0, oz = 0;
  for (const r of airport.runways) { const l = loc(r.center); ox += l.x; oz += l.z; }
  ox /= airport.runways.length; oz /= airport.runways.length;
  const F = makeFrame(ox, oz, H);

  const L = {
    id: airport.id, kind: airport.kind, spec, frame: F, elevation: airport.elevation,
    radius: airport.flattenRadius,
    runways: [], pave: [], taxiLines: [], holds: [], stands: [], buildings: [], props: [],
    floods: [], roads: [], parkingLots: [], fences: [], tower: null, aprons: [], connectors: [], streetLights: [], fillets: [],
  };

  // ---------------- runways ----------------
  const multi = airport.runways.length > 1;
  airport.runways.forEach((rw, i) => {
    const c0 = loc(rw.center);
    const ac = F.toAC(c0.x, c0.z);
    // taxiway side: toward the middle for parallel runways, +c (right of the primary heading) for single runways
    const side = multi ? (ac.c < 0 ? 1 : -1) : 1;
    const ends = [0, 1].map((e) => {
      const hdg = norm360(rw.heading + (e ? 180 : 0));
      const h = hdg * DEG;
      const dir = { x: Math.sin(h), z: -Math.cos(h) };
      const name = rw.id.split('/')[e] || rw.id;
      return {
        e, name, ...parseDesignator(name), heading: hdg, dir,
        thr: { x: c0.x - dir.x * rw.length / 2, z: c0.z - dir.z * rw.length / 2 },
        far: { x: c0.x + dir.x * rw.length / 2, z: c0.z + dir.z * rw.length / 2 },
        // "left" of the approaching pilot (unit vector): heading - 90
        left: { x: -Math.cos(h), z: -Math.sin(h) },
      };
    });
    const precision = rw.lighting === 'full';
    const R = {
      i, data: rw, id: rw.id, x: c0.x, z: c0.z, a: ac.a, c: ac.c, heading: rw.heading, len: rw.length, wid: rw.width,
      surface: rw.surface || 'asphalt', lighting: rw.lighting || 'basic', precision, side, ends,
      shoulder: spec.rwyShoulder, blast: spec.blast,
    };
    L.runways.push(R);
    const rk = R.surface === 'concrete' ? 'rwyConcrete' : 'rwy';
    L.pave.push(rect(F, ac.a, ac.c, rw.length, rw.width, rk, 'runway', { rwy: i, layer: 4 }));
    if (R.shoulder > 0) {
      for (const s of [-1, 1]) L.pave.push(rect(F, ac.a, ac.c + s * (rw.width / 2 + R.shoulder / 2), rw.length + 2 * R.blast, R.shoulder, 'shoulder', 'taxiway', { layer: 1 }));
    }
    for (const s of [-1, 1]) {
      L.pave.push(rect(F, ac.a + s * (rw.length / 2 + R.blast / 2), ac.c, R.blast, rw.width, 'blast', 'runway', { rwy: i, layer: 2, blastEnd: s < 0 ? 0 : 1 }));
    }
  });

  // ---------------- taxiways ----------------
  const tw = spec.twyW, tsh = spec.twyShoulder;
  const addTwy = (a, c, len, wid, hdgOverride, extra = {}) => {
    let r;
    if (hdgOverride == null) r = rect(F, a, c, len, wid, 'twy', 'taxiway', { layer: 3, ...extra });
    else { const p = F.P(a, c); r = rectAngled(p.x, p.z, hdgOverride, len, wid, 'twy', 'taxiway', { layer: 3, ...extra }); }
    L.pave.push(r);
    if (tsh > 0) {
      const h = r.hdg * DEG, rx = Math.cos(h), rz = Math.sin(h);
      for (const s of [-1, 1]) {
        L.pave.push({ ...r, x: r.x + rx * s * (wid / 2 + tsh / 2), z: r.z + rz * s * (wid / 2 + tsh / 2), wid: tsh, kind: 'shoulder', surf: 'taxiway', layer: 1, edge: true });
      }
    }
    return r;
  };

  for (const R of L.runways) {
    const s = R.side, ct = R.c + s * spec.T;
    R.twyC = ct;
    const half = R.len / 2;
    // parallel taxiway (extends to the end connectors)
    const eA = half - tw / 2;
    addTwy(R.a, ct, 2 * eA + tw, tw, null, { parallel: true });
    L.taxiLines.push({ pts: [F.P(R.a - eA, ct), F.P(R.a + eA, ct)], kind: 'cl' });
    // connectors: list of along positions (perpendicular)
    const conn = [R.a - eA, R.a + eA];
    if (airport.kind === 'military') conn.push(R.a, R.a - 0.27 * R.len, R.a + 0.27 * R.len);
    else if (airport.kind === 'international') conn.push(R.a, R.a - 0.3 * R.len, R.a + 0.3 * R.len);
    else conn.push(R.a);
    conn.sort((p, q) => p - q);
    const letter = 'ABCD'[R.i] || 'A';
    R.twyName = letter;
    conn.forEach((a, ci) => {
      const twyName = letter + (ci + 1);
      const isEnd = Math.abs(Math.abs(a - R.a) - eA) < 1;
      const cMid = (R.c + ct) / 2;
      addTwy(a, cMid, spec.T, tw, F.H + 90, { connector: true });
      // centreline from taxiway into the runway, with lead-on/off curves
      const rad = Math.min(spec.T * 0.4, airport.kind === 'international' || airport.kind === 'military' ? 55 : 35);
      const pts = [F.P(a, ct), F.P(a, R.c + s * (R.wid / 2 + rad))];
      L.taxiLines.push({ pts, kind: 'cl' });
      // lead-on curves to runway centreline (both directions, or only "into" the runway at the ends)
      const dirs = isEnd ? [a < R.a ? 1 : -1] : [1, -1];
      for (const da of dirs) L.taxiLines.push({ arc: arcPts(F, a, R.c + s * (R.wid / 2 + rad), da, s, rad, R.wid / 2 + rad), kind: 'lead' });
      // holding position marking (pattern A): across the connector at `hold` metres from the runway centreline
      const ph = F.P(a, R.c + s * spec.hold);
      L.holds.push({ x: ph.x, z: ph.z, hdg: norm360(F.H + (s > 0 ? 90 : -90)), wid: tw, rwy: R.i, rwyName: R.id, twyName });
      L.connectors.push({ rwy: R.i, a, isEnd, name: twyName });
      // junction fillets (triangles) where the connector meets the runway shoulder and the parallel taxiway
      const f = airport.kind === 'international' || airport.kind === 'military' ? 24 : 14;
      const cR = R.c + s * (R.wid / 2 + R.shoulder), cT = ct - s * (tw / 2 + tsh);
      for (const sa of [-1, 1]) {
        if (isEnd && Math.sign(R.a - a) !== sa) continue;   // no fillet beyond the runway end
        const a0 = a + sa * tw / 2;
        L.fillets.push([F.P(a0, cR), F.P(a0 + sa * f, cR), F.P(a0, cR + s * f)]);
        L.fillets.push([F.P(a0, cT), F.P(a0 + sa * f, cT), F.P(a0, cT - s * f)]);
      }
    });
    // rapid exit taxiways (30°) for each landing direction
    if (spec.ret) {
      const ang = 30 * DEG;
      for (const e of [0, 1]) {
        const sgn = e === 0 ? 1 : -1;               // landing direction along a
        const aS = R.a - sgn * half + sgn * 0.55 * R.len; // where the RET leaves the runway centreline
        const aE = aS + sgn * spec.T / Math.tan(ang);
        const len = spec.T / Math.sin(ang);
        const hdg = F.H + (sgn > 0 ? 0 : 180) + (sgn * s > 0 ? 30 : -30);
        const pm = F.P((aS + aE) / 2, R.c + s * spec.T / 2);
        L.pave.push(rectAngled(pm.x, pm.z, hdg, len + tw * 0.6, tw, 'twy', 'taxiway', { layer: 3, ret: true }));
        // centreline: start on the runway centreline offset, join the parallel taxiway with a curve
        const p1 = F.P(aS + sgn * 25, R.c), p2 = F.P(aE - sgn * 35, ct - s * 35 * Math.tan(ang)), p3 = F.P(aE + sgn * 40, ct);
        L.taxiLines.push({ pts: [p1, p2, F.P(aE + sgn * 5, ct - s * 3), p3], kind: 'ret' });
      }
    }
    // military: arming pads beside both runway ends
    if (airport.kind === 'military') {
      for (const e of [-1, 1]) {
        const a = R.a + e * (eA - 140);
        const c = R.c + s * (spec.T + tw / 2 + 45);
        L.pave.push(rect(F, a, c, 220, 90, 'apron', 'apron', { layer: 2 }));
        for (let k = 0; k < 4; k++) {
          const pp = F.P(a - 75 + k * 50, c + s * 10);
          L.stands.push({ x: pp.x, z: pp.z, hdg: norm360(F.H + (s > 0 ? 180 : 0) + e * 45), size: 'fighter', paint: true });
        }
      }
    }
  }

  // ---------------- apron / terminal area per kind ----------------
  if (airport.kind === 'international') layoutHub(L, F, spec);
  else if (airport.kind === 'military') layoutMilitary(L, F, spec);
  else layoutSmall(L, F, spec, airport.kind);

  // ---------------- runway-side objects shared by all kinds ----------------
  for (const R of L.runways) runwayFurniture(L, F, R, spec);

  return L;
}

/** Quarter-ish arc from the end of a connector centreline onto the runway centreline. */
function arcPts(F, a, cStart, da, s, rad, cToRwy) {
  // circle centre at (a + da*rad, cStart); start at angle pointing -da (point (a, cStart)), end at (a+da*rad, cStart - s*rad)
  const pts = [];
  const n = 10;
  const ca = a + da * rad, cc = cStart;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * Math.PI / 2;
    const pa = ca - da * rad * Math.cos(t);
    const pc = cc - s * rad * Math.sin(t);
    pts.push(F.P(pa, pc));
  }
  // continue a short way along the runway centreline
  pts.push(F.P(ca + da * 40, cc - s * rad));
  return pts;
}

// --------------------------------------------------------------------------------------------------------------------
function layoutHub(L, F, spec) {
  const [R0, R1] = L.runways;
  const tw = spec.twyW, tsh = spec.twyShoulder;
  const bands = (R1 ? [R0, R1] : [R0]);
  // overlapping along range of the runways
  let aMin = -Infinity, aMax = Infinity;
  for (const R of bands) { aMin = Math.max(aMin, R.a - R.len / 2); aMax = Math.min(aMax, R.a + R.len / 2); }
  const aC = (aMin + aMax) / 2;
  const pierLen = Math.min(760, (aMax - aMin) * 0.42);
  const apronLen = pierLen + 260;
  const piers = [];
  for (const R of bands) {
    const s = R.side;
    const cIn = R.twyC + s * (tw / 2 + tsh);            // apron edge on the taxiway
    // between widely spaced parallels the apron grows (remote stands); the pier faces stay ~270 m off the middle
    const dep = R1 ? Math.max(spec.apronDepth, Math.abs(R.twyC) - tw / 2 - tsh - 270) : spec.apronDepth;
    const cOut = cIn + s * dep;                         // pier face
    const cm = (cIn + cOut) / 2;
    L.pave.push(rect(F, aC, cm, apronLen, dep + 1, 'apron', 'apron', { layer: 2 }));
    L.aprons.push({ a: aC, c: cm, len: apronLen, dep, side: s, cIn, cOut });
    // apron taxilane centreline (parallel, 32 m inside the apron edge) + links to the parallel taxiway
    const cLane = cIn + s * 32;
    L.taxiLines.push({ pts: [F.P(aC - apronLen / 2 + 20, cLane), F.P(aC + apronLen / 2 - 20, cLane)], kind: 'cl' });
    for (const k of [-1, 0, 1]) {
      const a = aC + k * apronLen * 0.38;
      L.taxiLines.push({ pts: [F.P(a, R.twyC), F.P(a, cLane)], kind: 'cl' });
    }
    // deep apron: second taxilane in front of the pier + two rows of remote stands between the lanes
    let cLanePier = cLane;
    const towardPier = norm360(F.H + (s > 0 ? 90 : -90)), awayPier = norm360(towardPier + 180);
    if (dep > 300) {
      cLanePier = cOut - s * 112;
      L.taxiLines.push({ pts: [F.P(aC - apronLen / 2 + 20, cLanePier), F.P(aC + apronLen / 2 - 20, cLanePier)], kind: 'cl' });
      for (const e of [-1, 1]) L.taxiLines.push({ pts: [F.P(aC + e * (apronLen / 2 - 20), cLane), F.P(aC + e * (apronLen / 2 - 20), cLanePier)], kind: 'cl' });
      const nR = Math.floor((apronLen - 120) / 62);
      for (let k = 0; k < nR; k++) {
        const a = aC - (nR - 1) * 31 + k * 62;
        const p1 = F.P(a, cLane + s * 70);
        L.stands.push({ x: p1.x, z: p1.z, hdg: towardPier, size: k % 4 === 2 ? 'heavy' : 'medium', paint: true, number: 100 + k + (s > 0 ? 0 : 50), leadFrom: F.P(a, cLane) });
        const p2 = F.P(a, cLanePier - s * 65);
        L.stands.push({ x: p2.x, z: p2.z, hdg: awayPier, size: k % 3 === 1 ? 'heavy' : 'medium', paint: true, number: 130 + k + (s > 0 ? 0 : 50), leadFrom: F.P(a, cLanePier) });
      }
      for (let k = 0; k < 5; k++) {
        const p = F.P(aC - apronLen / 2 + 60 + k * (apronLen - 120) / 4, (cLane + cLanePier) / 2);
        L.floods.push({ x: p.x, z: p.z, h: 30, aim: { x: F.r.x * s, z: F.r.z * s } });
      }
    }
    // pier building + stands
    const pierDepth = 32;
    const cPier = cOut + s * pierDepth / 2;
    L.buildings.push({ type: 'pier', ...F.P(aC, cPier), hdg: F.H, len: pierLen, wid: pierDepth, h: 14, faceSide: -s });
    piers.push({ a: aC, c: cPier, len: pierLen, s, cOut });
    const nStands = Math.floor(pierLen / 68);
    const spacing = pierLen / nStands;
    const leftA = s > 0 ? 1 : -1;      // the aircraft's left side (boarding doors) lies toward +a when nosing toward +c
    for (let k = 0; k < nStands; k++) {
      const a = aC - pierLen / 2 + spacing * (k + 0.5);
      const big = k % 3 === 1;
      const sc = big ? 1.55 : 1;
      const noseC = cOut - s * (big ? 9 : 7);
      const p = F.P(a, noseC);
      const stand = { x: p.x, z: p.z, hdg: towardPier, size: big ? 'heavy' : 'medium', paint: true, number: k + 1 + (s > 0 ? 0 : 20), bridge: true, leadFrom: F.P(a, cLanePier) };
      L.stands.push(stand);
      // jet bridge: rotunda just off the pier face, tunnel to the forward left door
      const rot = F.P(a + leftA * (big ? 15 : 11), cOut - s * 3);
      const door = F.P(a + leftA * (2.0 * sc + 1.6), noseC + s * (4.6 - 6.2) * sc);
      // parked (retracted) position: tunnel swung back along the pier face, cab clear of the stand
      const park = F.P(a + leftA * (big ? 15 : 11) - leftA * 6, cOut - s * 15);
      L.props.push({ type: 'jetbridge', x: rot.x, z: rot.z, ex: door.x, ez: door.z, px: park.x, pz: park.z, stand });
    }
    // remote stands at the two ends of the pier
    for (const e of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const a = aC + e * (pierLen / 2 + 40 + k * 55);
        const p = F.P(a, cOut - s * 32);
        L.stands.push({ x: p.x, z: p.z, hdg: towardPier, size: 'medium', paint: true, number: 50 + k + (e > 0 ? 2 : 0) + (s > 0 ? 0 : 10), leadFrom: F.P(a, cLanePier) });
      }
    }
    // apron floodlight masts along the pier side, and at apron ends
    const nf = 6;
    for (let k = 0; k < nf; k++) {
      const a = aC - apronLen / 2 + 30 + (apronLen - 60) * k / (nf - 1);
      const p = F.P(a, cOut - s * (k === 0 || k === nf - 1 ? 60 : 3));
      L.floods.push({ x: p.x, z: p.z, h: 28, aim: { x: F.r.x * -s, z: F.r.z * -s } });
    }
    // maintenance hangar at one end of the apron
    const hp = F.P(aC - apronLen / 2 - 110, cIn + s * 95);
    L.pave.push(rect(F, aC - apronLen / 2 - 110, cIn + s * 45, 150, 90, 'apron', 'apron', { layer: 2 }));
    L.buildings.push({ type: 'hangar', ...hp, hdg: norm360(F.H + (s > 0 ? 0 : 180)), len: 110, wid: 80, h: 26, doorSide: -s });
  }
  // central terminal + connector spines between the piers (for 2 runways), landside to one side otherwise
  if (R1) {
    const cMid = (piers[0].c + piers[1].c) / 2;
    const gap = Math.abs(piers[1].c - piers[0].c) - 32;
    const termDepth = Math.min(90, gap * 0.28);
    L.buildings.push({ type: 'terminal', ...F.P(aC, cMid), hdg: F.H, len: 360, wid: termDepth, h: 24 });
    // spines from the terminal to each pier
    for (const pr of piers) {
      const sg = Math.sign(pr.c - cMid);
      const len = Math.abs(pr.c - cMid) - termDepth / 2 - 16;
      for (const da of [-120, 120]) {
        L.buildings.push({ type: 'spine', ...F.P(aC + da, cMid + sg * (termDepth / 2 + len / 2)), hdg: norm360(F.H + 90), len, wid: 22, h: 10 });
      }
    }
    // landside: car parks + garage on the -a side of the terminal, road out along -a
    const aLand = aC - 180 - 140;
    const lotW = Math.min(gap * 0.55, 300);
    L.parkingLots.push({ ...F.P(aLand, cMid), hdg: F.H, len: 200, wid: lotW });
    L.buildings.push({ type: 'garage', ...F.P(aC - 180 - 26, cMid), hdg: norm360(F.H + 90), len: Math.min(gap * 0.6, 260), wid: 36, h: 13 });
    const pRoadStart = F.P(aLand - 100, cMid + lotW * 0.25), pRoadEnd = clipToRadius(F, aLand - 100, cMid + lotW * 0.25, -1, 0, L.radius * 0.93);
    L.roads.push({ pts: [F.P(aC - 180 - 60, cMid + lotW * 0.25), pRoadStart, pRoadEnd], wid: 14, lanes: 4 });
    L.roads.push({ pts: [F.P(aC - 180 - 60, cMid - lotW * 0.35), F.P(aC - 180 - 60, cMid + lotW * 0.35)], wid: 12, lanes: 2 });
    for (let k = 0; k < 12; k++) {
      const a = aLand - 100 - k * 90;
      for (const e of [-1, 1]) { const p = F.P(a, cMid + lotW * 0.25 + e * 10); L.streetLights.push({ x: p.x, z: p.z, h: 11 }); }
    }
    // tower beyond the terminal on the +a side, midway between runways
    const tp = F.P(aC + 360, cMid);
    L.tower = { x: tp.x, z: tp.z, h: 72, cab: 9, kind: 'tall', hdg: F.H };
    L.buildings.push({ type: 'office', ...F.P(aC + 360, cMid + 55), hdg: F.H, len: 70, wid: 26, h: 12 });
    // fire station, fuel farm, radar, cargo/ops buildings
    L.buildings.push({ type: 'firestation', ...F.P(aC + 560, cMid - 40), hdg: norm360(F.H + 90), len: 60, wid: 28, h: 9 });
    L.props.push({ type: 'fuelfarm', ...F.P(aC + 560, cMid + 70), hdg: F.H, n: 6, r: 11, h: 14 });
    L.props.push({ type: 'radar', ...F.P(aC + 780, cMid), r: 7, h: 18 });
    L.props.push({ type: 'mast', ...F.P(aC + 700, cMid - 60), h: 35 });
    L.props.push({ type: 'mast', ...F.P(aC - 520, cMid + lotW * 0.5 + 30), h: 30 });
    // landside fence along the car park / terminal edges
    for (const s2 of [-1, 1]) {
      const cF = cMid + s2 * (gap / 2 - 8);
      L.fences.push({ pts: [F.P(aC - 420, cF), F.P(aC - 220, cF)] });
    }
    L.landside = { a: aLand, c: cMid };
  }
}

function clipToRadius(F, a, c, da, dc, R) {
  // march along (da, dc) from (a,c) until distance from airport origin reaches R
  let lo = 0, hi = 2 * R;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2, p = F.P(a + da * m, c + dc * m);
    if (Math.hypot(p.x, p.z) < R) lo = m; else hi = m;
  }
  return F.P(a + da * lo, c + dc * lo);
}

// --------------------------------------------------------------------------------------------------------------------
function layoutMilitary(L, F, spec) {
  const R = L.runways[0], s = R.side, tw = spec.twyW, tsh = spec.twyShoulder;
  const cIn = R.twyC + s * (tw / 2 + tsh);
  const dep = spec.apronDepth, len = 1700, aC = R.a - 150;
  const cm = cIn + s * dep / 2;
  L.pave.push(rect(F, aC, cm, len, dep, 'apron', 'apron', { layer: 2 }));
  L.aprons.push({ a: aC, c: cm, len, dep, side: s, cIn, cOut: cIn + s * dep });
  const cLane = cIn + s * 40;
  L.taxiLines.push({ pts: [F.P(aC - len / 2 + 30, cLane), F.P(aC + len / 2 - 30, cLane)], kind: 'cl' });
  // flight-line: two rows of fighters, nose toward the taxiway
  for (let row = 0; row < 2; row++) {
    const c = cIn + s * (95 + row * 85);
    for (let k = 0; k < 14; k++) {
      const a = aC - 560 + k * 38 + row * 19;
      const p = F.P(a, c);
      L.stands.push({ x: p.x, z: p.z, hdg: norm360(F.H + (s > 0 ? -90 : 90)), size: 'fighter', paint: true });
    }
  }
  // heavy stands (tankers/transports) at the +a end of the ramp
  for (let k = 0; k < 3; k++) {
    const p = F.P(aC + 330 + k * 80, cIn + s * 160);
    L.stands.push({ x: p.x, z: p.z, hdg: norm360(F.H + (s > 0 ? -90 : 90)), size: 'heavy', paint: true });
  }
  // hangars behind the ramp
  const cH = cIn + s * (dep + 45);
  for (let k = 0; k < 4; k++) {
    const a = aC - 600 + k * 170;
    L.buildings.push({ type: 'hangar', ...F.P(a, cH), hdg: norm360(F.H + (s > 0 ? 0 : 180)), len: 120, wid: 80, h: 24, doorSide: -s, mil: true });
  }
  L.buildings.push({ type: 'hangar', ...F.P(aC + 390, cH + s * 10), hdg: norm360(F.H + (s > 0 ? 0 : 180)), len: 200, wid: 100, h: 32, doorSide: -s, mil: true });
  // ops / squadron buildings
  for (let k = 0; k < 4; k++) L.buildings.push({ type: 'office', ...F.P(aC - 650 + k * 110, cH + s * 110), hdg: F.H, len: 70, wid: 22, h: 9, mil: true });
  // tower
  const tp = F.P(aC + 80, cH + s * 120);
  L.tower = { x: tp.x, z: tp.z, h: 38, cab: 7, kind: 'mil', hdg: F.H };
  // hardened aircraft shelters near the +a end, each with its own taxilane
  const aH0 = R.a + R.len / 2 - 950;
  for (let k = 0; k < 8; k++) {
    const a = aH0 + (k % 4) * 140;
    const c = cIn + s * (70 + Math.floor(k / 4) * 170);
    L.pave.push(rect(F, a, c, 60, 110, 'apron', 'apron', { layer: 2 }));
    const pb = F.P(a, c + s * 50);
    L.buildings.push({ type: 'shelter', ...pb, hdg: norm360(F.H + (s > 0 ? 90 : -90)), len: 40, wid: 26, h: 11 });
    const p = F.P(a, c + s * 30);
    L.stands.push({ x: p.x, z: p.z, hdg: norm360(F.H + (s > 0 ? -90 : 90)), size: 'fighter', paint: false });
  }
  L.pave.push(rect(F, aH0 + 210, cIn + s * 20, 640, 40, 'twy', 'taxiway', { layer: 3 }));
  L.pave.push(rect(F, aH0 + 210, cIn + s * 190, 640, 40, 'twy', 'taxiway', { layer: 3 }));
  L.pave.push(rect(F, aH0 - 60, cIn + s * 105, 30, 210, 'twy', 'taxiway', { layer: 3 }));
  // floods on the ramp
  for (let k = 0; k < 8; k++) {
    const p = F.P(aC - len / 2 + 60 + k * (len - 120) / 7, cIn + s * (dep - 4));
    L.floods.push({ x: p.x, z: p.z, h: 25, aim: { x: F.r.x * -s, z: F.r.z * -s } });
  }
  // support: fire station, fuel farm, radar, masts
  L.buildings.push({ type: 'firestation', ...F.P(R.a, cIn + s * (dep + 30) - 0), hdg: F.H, len: 50, wid: 26, h: 9, mil: true });
  L.props.push({ type: 'fuelfarm', ...F.P(aC - 780, cH + s * 120), hdg: F.H, n: 6, r: 12, h: 13 });
  L.props.push({ type: 'radar', ...F.P(aC - 300, cH + s * 220), r: 8, h: 20 });
  L.props.push({ type: 'radar', ...F.P(aC + 600, cH + s * 230), r: 5, h: 14 });
  L.props.push({ type: 'mast', ...F.P(aC - 150, cH + s * 230), h: 40 });
  L.props.push({ type: 'mast', ...F.P(aC + 300, cH + s * 160), h: 28 });
  // base road + parking
  const pk = F.P(aC - 300, cH + s * 165);
  L.parkingLots.push({ x: pk.x, z: pk.z, hdg: F.H, len: 160, wid: 60 });
  L.roads.push({ pts: [F.P(aC - 760, cH + s * 160), F.P(aC + 700, cH + s * 160)], wid: 9, lanes: 2 });
  L.roads.push({ pts: [F.P(aC + 100, cH + s * 160), clipToRadius(F, aC + 100, cH + s * 160, 0, s, L.radius * 0.93)], wid: 9, lanes: 2 });
  L.fences.push({ pts: [F.P(aC - 800, cH + s * 140), F.P(aC + 760, cH + s * 140)] });
  for (let k = 0; k < 10; k++) { const p = F.P(aC - 700 + k * 150, cH + s * 150); L.streetLights.push({ x: p.x, z: p.z, h: 10 }); }
}

// --------------------------------------------------------------------------------------------------------------------
function layoutSmall(L, F, spec, kind) {
  const R = L.runways[0], s = R.side, tw = spec.twyW, tsh = spec.twyShoulder;
  const cIn = R.twyC + s * (tw / 2 + tsh);
  const dep = spec.apronDepth, len = kind === 'island' ? 380 : 320, aC = R.a + 30;
  const cm = cIn + s * dep / 2, cOut = cIn + s * dep;
  L.pave.push(rect(F, aC, cm, len, dep, 'apron', 'apron', { layer: 2 }));
  L.aprons.push({ a: aC, c: cm, len, dep, side: s, cIn, cOut });
  const cLane = cIn + s * 22;
  L.taxiLines.push({ pts: [F.P(aC - len / 2 + 15, cLane), F.P(aC + len / 2 - 15, cLane)], kind: 'cl' });
  // airline stands in front of the terminal (nose in, walk-out boarding) + GA tie-down rows
  for (let k = 0; k < 3; k++) {
    const a = aC - 40 + (k - 1) * 48;
    const p = F.P(a, cOut - s * 30);
    L.stands.push({ x: p.x, z: p.z, hdg: norm360(F.H + (s > 0 ? 90 : -90)), size: 'medium', paint: true, number: k + 1, leadFrom: F.P(a, cLane) });
  }
  for (let k = 0; k < 6; k++) {
    const a = aC + 70 + k * 16;
    const p = F.P(a, cOut - s * 20);
    L.stands.push({ x: p.x, z: p.z, hdg: norm360(F.H + (s > 0 ? 90 : -90)), size: 'light', paint: true, tiedown: true });
  }
  // terminal (with the tower cab on a short tower next to it)
  const cT = cOut + s * 14;
  L.buildings.push({ type: 'smallterminal', ...F.P(aC - 40, cT), hdg: F.H, len: 110, wid: 24, h: 9, faceSide: -s, island: kind === 'island' });
  const tp = F.P(aC + 45, cT + s * 6);
  L.tower = { x: tp.x, z: tp.z, h: kind === 'island' ? 16 : 18, cab: 5, kind: 'small', hdg: F.H };
  // hangars (T-hangar row + a maintenance hangar)
  const aHg = aC + len / 2 + 90;
  L.pave.push(rect(F, aHg, cIn + s * 45, 150, 90, 'apron', 'apron', { layer: 2 }));
  L.buildings.push({ type: 'hangar', ...F.P(aHg - 30, cIn + s * 112), hdg: norm360(F.H + (s > 0 ? 0 : 180)), len: 40, wid: 36, h: 10, doorSide: -s });
  L.buildings.push({ type: 'thangar', ...F.P(aHg + 45, cIn + s * 112), hdg: F.H, len: 70, wid: 18, h: 4.5 });
  L.buildings.push({ type: 'firestation', ...F.P(aC - len / 2 - 40, cIn + s * 40), hdg: F.H, len: 26, wid: 18, h: 7 });
  L.pave.push(rect(F, aC - len / 2 - 40, cIn + s * 12, 30, 24, 'apron', 'apron', { layer: 2 }));
  L.props.push({ type: 'fuelfarm', ...F.P(aC - len / 2 - 40, cOut + s * 30), hdg: F.H, n: 2, r: 4, h: 6 });
  L.props.push({ type: 'mast', ...F.P(aC + 140, cOut + s * 60), h: 22 });
  // car park + access road
  const lot = F.P(aC - 40, cOut + s * 62);
  L.parkingLots.push({ x: lot.x, z: lot.z, hdg: F.H, len: 120, wid: 50 });
  L.roads.push({ pts: [F.P(aC - 40 - 70, cOut + s * 92), F.P(aC - 40 + 70, cOut + s * 92)], wid: 8, lanes: 2 });
  L.roads.push({ pts: [F.P(aC - 40 + 70, cOut + s * 92), clipToRadius(F, aC - 40 + 70, cOut + s * 92, 0.35, s, L.radius * 0.92)], wid: 8, lanes: 2 });
  for (let k = 0; k < 4; k++) { const p = F.P(aC - 100 + k * 40, cOut + s * 100); L.streetLights.push({ x: p.x, z: p.z, h: 8 }); }
  // floods
  for (let k = 0; k < 3; k++) { const p = F.P(aC - len / 2 + 30 + k * (len - 60) / 2, cOut - s * 3); L.floods.push({ x: p.x, z: p.z, h: 16, aim: { x: F.r.x * -s, z: F.r.z * -s } }); }
  // perimeter fence (airside boundary) around the strip
  const aE = R.len / 2 + R.blast + 90, cNear = R.c - s * (R.wid / 2 + 140), cFar = cOut + s * 40;
  L.fences.push({ pts: [F.P(-aE, cFar), F.P(aC - 110 - 20, cFar)] });
  L.fences.push({ pts: [F.P(aC + 30 + 20, cFar), F.P(aE, cFar), F.P(aE, cNear), F.P(-aE, cNear), F.P(-aE, cFar)] });
  if (kind === 'island') {
    L.palms = [];
    for (let k = 0; k < 26; k++) {
      const a = aC - 140 + k * 11 + Math.sin(k * 7.3) * 4, c = cOut + s * (118 + Math.sin(k * 3.1) * 6);
      L.palms.push(F.P(a, c));
    }
    for (let k = 0; k < 10; k++) L.palms.push(F.P(aC - 120 + k * 9, cOut + s * 42 + s * (k % 2) * 3));
  }
}

// --------------------------------------------------------------------------------------------------------------------
// Runway furniture: PAPI, ILS antennas, windsocks, distance-remaining signs, aiming point distance
export function aimingPointDistance(len) {
  // ICAO Annex 14 Table 5-1 (landing distance available)
  if (len >= 2400) return 400;
  if (len >= 1200) return 300;
  if (len >= 800) return 250;
  return 150;
}

function runwayFurniture(L, F, R, spec) {
  const aim = aimingPointDistance(R.len);
  R.aim = aim;
  for (const E of R.ends) {
    // PAPI on the pilot's LEFT, abeam the aiming point; 4 units, 9 m apart, first one 15 m from the edge
    const base = { x: E.thr.x + E.dir.x * aim, z: E.thr.z + E.dir.z * aim };
    // keep PAPI on the side away from the parallel taxiway when the left side is the taxiway side and it's close
    const units = [];
    for (let k = 0; k < 4; k++) {
      const off = R.wid / 2 + 15 + k * 9;
      units.push({ x: base.x + E.left.x * off, z: base.z + E.left.z * off,
        // inner unit (closest to runway) has the highest setting: 3°30', then 3°10', 2°50', 2°30'
        angle: [3.5, 3 + 1 / 6, 2 + 5 / 6, 2.5][k] });
    }
    E.papi = units;
    // glideslope antenna mast (precision runways): ~300 m in, 160 m to the side away from the taxiway
    if (R.precision) {
      const sideV = { x: F.r.x * -R.side, z: F.r.z * -R.side };
      const g = { x: E.thr.x + E.dir.x * 310 + sideV.x * 160, z: E.thr.z + E.dir.z * 310 + sideV.z * 160 };
      L.props.push({ type: 'glideslope', x: g.x, z: g.z, hdg: E.heading });
      // localizer array 300 m beyond the far end (serves this end's approach)
      const lz = { x: E.far.x + E.dir.x * (R.blast + 200), z: E.far.z + E.dir.z * (R.blast + 200) };
      L.props.push({ type: 'localizer', x: lz.x, z: lz.z, hdg: E.heading, width: Math.max(24, R.wid * 0.6) });
    }
    // windsock: 150 m in, 75 m to the left
    const ws = { x: E.thr.x + E.dir.x * 180 + E.left.x * (R.wid / 2 + 70), z: E.thr.z + E.dir.z * 180 + E.left.z * (R.wid / 2 + 70) };
    L.props.push({ type: 'windsock', x: ws.x, z: ws.z });
  }
  // distance remaining signs (1000 ft intervals) on the side away from the taxiway, 20 m outside the edge
  const ft = 304.8;
  const n = Math.floor(R.len / ft);
  const sideV = { x: F.r.x * -R.side, z: F.r.z * -R.side };
  const E0 = R.ends[0];
  for (let k = 1; k < n; k++) {
    const along = k * ft;
    const remain0 = Math.round((R.len - along) / ft), remain1 = k;
    if (remain0 < 1) continue;
    const off = R.wid / 2 + R.shoulder + 18;
    L.props.push({ type: 'drsign', x: E0.thr.x + E0.dir.x * along + sideV.x * off, z: E0.thr.z + E0.dir.z * along + sideV.z * off,
      hdg: E0.heading, a: remain0, b: remain1 });
  }
}
