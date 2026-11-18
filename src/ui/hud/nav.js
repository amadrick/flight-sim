// Pure navigation maths for the HUD and flight-deck displays: destination, ILS deviations, ground-collision prediction.
// World: metres, +X east, +Y up, +Z south (north = -Z); headings in degrees true (0 = north, 90 = east).
import { AIRPORTS, runwayEnd } from '../../data/airports.js';
import { DEG, RAD, NM, wrap180, wrap360 } from './common.js';

export const ILS_RANGE = 25 * NM;    // localizer / glideslope service range used here
export const GS_ANGLE = 3;           // degrees
export const TDZ_OFFSET = 300;       // glideslope reference point past the threshold, metres
export const LOC_FULL = 2.5;         // localizer half-sector (deg) = 2 dots
export const GS_FULL = 0.7;          // glideslope half-sector (deg) = 2 dots

/** True bearing (deg) from (x1,z1) to (x2,z2). */
export function bearingTo(x1, z1, x2, z2) { return wrap360(Math.atan2(x2 - x1, -(z2 - z1)) * RAD); }

export function nearestAirport(x, z, excludeId = null, list = AIRPORTS) {
  let best = null, bd = Infinity;
  for (const a of list) {
    if (a.id === excludeId) continue;
    const d = Math.hypot(a.position.x - x, a.position.z - z);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

// Precomputed runway ends (both directions) with ILS reference points.
let _ends = null;
export function runwayEnds() {
  if (_ends) return _ends;
  _ends = [];
  for (const ap of AIRPORTS) for (const rw of ap.runways) for (let e = 0; e < 2; e++) {
    const E = runwayEnd(rw, e);
    _ends.push({
      airport: ap, runway: rw, end: e, name: E.name, heading: E.heading, dir: E.dir, length: E.length, width: E.width,
      threshold: E.threshold, farEnd: E.farEnd, elevation: ap.elevation,
      gs: { x: E.threshold.x + E.dir.x * TDZ_OFFSET, z: E.threshold.z + E.dir.z * TDZ_OFFSET },
      loc: { x: E.farEnd.x + E.dir.x * 300, z: E.farEnd.z + E.dir.z * 300 },
      ident: 'I' + ap.id.slice(1) + ' ' + E.name,
    });
  }
  return _ends;
}

export function createIlsResult() {
  return { active: false, rwy: null, ident: '', course: 0, locDev: 0, gsDev: 0, gsValid: false, dist: 0, dme: 0, along: 0, cross: 0, height: 0 };
}

/**
 * Evaluate a single runway end's ILS for an aircraft at world (x, y, z).
 * locDev: degrees, + = aircraft is RIGHT of the centreline (so the course needle sits LEFT).
 * gsDev:  degrees, + = aircraft is ABOVE the glidepath.
 */
export function ilsFor(rwy, x, y, z, out = createIlsResult()) {
  const d = rwy.dir;
  const rx = x - rwy.threshold.x, rz = z - rwy.threshold.z;
  const along = rx * d.x + rz * d.z;              // metres past the threshold (negative on approach)
  const cross = rx * -d.z + rz * d.x;             // + = right of centreline looking along the landing direction
  const toLoc = (rwy.loc.x - x) * d.x + (rwy.loc.z - z) * d.z;
  const gx = rwy.gs.x - x, gz = rwy.gs.z - z;
  const gsHoriz = Math.hypot(gx, gz);
  const h = y - rwy.elevation;
  out.rwy = rwy; out.ident = rwy.ident; out.course = rwy.heading;
  out.along = along; out.cross = cross; out.height = h;
  out.locDev = Math.atan2(cross, Math.max(1, toLoc)) * RAD;
  out.gsDev = Math.atan2(h, Math.max(1, gsHoriz)) * RAD - GS_ANGLE;
  out.gsValid = along < TDZ_OFFSET - 50 && Math.abs(out.locDev) < 10;
  out.dist = Math.hypot(rx, rz);
  out.dme = Math.hypot(gx, gz) / NM;
  return out;
}

const _tmp = createIlsResult();
/**
 * Pick the ILS the aircraft is set up for: within range, in front of the runway (approach side),
 * inside the localizer's ±35° coverage and heading within ±60° of the runway heading.
 * Prefers the destination airport, then the closest. Returns out.active.
 */
export function findIls(x, y, z, headingDeg, preferAirportId, out = createIlsResult()) {
  out.active = false;
  let bestScore = Infinity, best = null;
  for (const r of runwayEnds()) {
    const dx = x - r.threshold.x, dz = z - r.threshold.z;
    if (dx * dx + dz * dz > ILS_RANGE * ILS_RANGE) continue;
    ilsFor(r, x, y, z, _tmp);
    if (_tmp.along > r.length * 0.9) continue;                 // past the far end
    if (_tmp.gsDev + GS_ANGLE > 12) continue;                  // far above the glidepath sector: overflying, not approaching
    if (Math.abs(_tmp.locDev) > 35) continue;
    if (Math.abs(wrap180(headingDeg - r.heading)) > 60) continue;
    let score = _tmp.dist + Math.abs(_tmp.locDev) * 400;
    if (r.airport.id === preferAirportId) score *= 0.5;
    if (score < bestScore) { bestScore = score; best = r; }
  }
  if (best) { ilsFor(best, x, y, z, out); out.active = true; }
  return out;
}

/**
 * Predict ground collision along the current velocity vector.
 * groundHeightAt(x, z) → metres MSL. Returns { tti (s, Infinity if none), pullUp, sinkRate, recover }.
 * nMax: load factor the pilot can pull in a recovery (fighter ~5, airliner ~1.6).
 */
export function createGcas() { return { tti: Infinity, pullUp: false, sinkRate: false, recover: 0, clearance: Infinity }; }
const T_SAMPLES = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 13, 16, 20];
export function predictGroundCollision(s, groundHeightAt, nMax, out = createGcas(), skin = 15) {
  out.tti = Infinity; out.pullUp = false; out.sinkRate = false; out.recover = 0; out.clearance = Infinity;
  if (!s || s.onGround || s.crashed) return out;
  const p = s.position, v = s.velocity;
  const V = Math.hypot(v.x, v.y, v.z);
  if (V < 20) return out;
  const gamma = Math.asin(Math.max(-1, Math.min(1, v.y / V)));
  const g = 9.80665;
  // time to bring the flight path level with a nMax pull, plus pilot reaction
  const recover = 1.2 + (gamma < 0 ? (V * -gamma) / (g * Math.max(0.3, nMax - 1)) : 0);
  out.recover = recover;
  for (const t of T_SAMPLES) {
    const px = p.x + v.x * t, pz = p.z + v.z * t, py = p.y + v.y * t;
    let gh = 0;
    try { gh = groundHeightAt(px, pz); } catch { gh = 0; }
    if (!isFinite(gh)) gh = 0;
    const c = py - gh;
    if (t === 0.5) out.clearance = c;
    if (c < skin) {
      out.tti = t;
      // terrain rising above the flight path: add the time a pull needs to gain the missing height
      if (py > gh - 1e3 && gamma > -3 * DEG) out.recover = recover + Math.sqrt(2 * (skin - c) / (g * Math.max(0.3, nMax - 1)));
      break;
    }
  }
  const landingConfig = (s.surfaces?.gear ?? 0) > 0.9 && gamma > -6 * DEG && v.y > -7.5;
  if (!landingConfig) out.pullUp = out.tti < out.recover * 1.25 + 1.5;
  else out.pullUp = out.tti < 2.5 && v.y < -4;
  // GPWS "mode 1" style excessive sink rate (barometric descent rate vs. radio height)
  const aglFt = (s.agl ?? 1e9) / 0.3048, vsFpm = v.y / 0.00508;
  if (aglFt < 2500 && aglFt > 30) {
    const lim = Math.min(5000, 1000 + aglFt * 1.6);
    if (-vsFpm > lim) out.sinkRate = true;
    if (-vsFpm > lim * 1.4) out.pullUp = true;
  }
  return out;
}

/** Wind component helpers: wind FROM (deg) and speed → head/cross relative to a heading. */
export function windComponents(fromDeg, speed, headingDeg) {
  const a = (fromDeg - headingDeg) * DEG;
  return { head: speed * Math.cos(a), cross: speed * Math.sin(a) };
}
