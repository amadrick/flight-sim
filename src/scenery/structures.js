// Buildings, control towers and airfield furniture → merged geometry per material key (MultiBuilder).
import { lin } from './builder.js';

const DEG = Math.PI / 180;
const C = {
  white: lin(0xe8e8e4), offwhite: lin(0xd6d3cb), grey: lin(0xa9adb1), dgrey: lin(0x4b4f54), black: lin(0x161616),
  steel: lin(0x8d949b), civil: lin(0xc9d1d8), blue: lin(0x7f97ad), mil: lin(0xa39a7d), milDark: lin(0x6f6a55), tan: lin(0xc9b48a),
  red: lin(0xb0201c), orange: lin(0xe0561b), terracotta: lin(0xa5553a), concrete: lin(0xc8c3b8), shelter: lin(0x9a9584),
  yellow: lin(0xd9a21b), glassTint: lin(0xffffff), green: lin(0x3d6b2a), trunk: lin(0x6b5a45), leaf: lin(0x3f6a2a),
};
export { C as COLORS };

const dirs = (hdg) => { const h = hdg * DEG; return { dx: Math.sin(h), dz: -Math.cos(h), rx: Math.cos(h), rz: Math.sin(h) }; };

export function buildStructures(L, B, signIndex, poles) {
  for (const b of L.buildings) building(B, b, L);
  if (L.tower) tower(B, L.tower, L.tower.kind);
  for (const p of L.props) prop(B, p, signIndex, L);
  // PAPI boxes
  for (const R of L.runways) for (const E of R.ends) for (const u of E.papi) {
    B.box('plain', u.x, 0.2, u.z, E.heading, 0.7, 1.7, 0.7, C.dgrey);
    const d = dirs(E.heading);
    B.box('plain', u.x - d.dx * 0.36, 0.45, u.z - d.dz * 0.36, E.heading, 0.04, 1.3, 0.3, C.black);
    B.box('plain', u.x, 0, u.z, E.heading, 0.3, 1.4, 0.2, C.grey);
  }
  // runway holding position signs (red, white text) both sides of every hold
  for (const h of L.holds) {
    const d = dirs(h.hdg);
    const R = L.runways[h.rwy];
    const txt = 'hold:' + R.ends.map((e) => e.digits + e.letter).join('-');
    for (const sg of [-1, 1]) {
      const x = h.x + d.rx * sg * (h.wid / 2 + 9), z = h.z + d.rz * sg * (h.wid / 2 + 9);
      sign(B, x, z, h.hdg, 2.8, 0.9, txt, signIndex, false);
      // collocated taxiway location sign (yellow on black), outboard of the holding position sign
      const lx = x + d.rx * sg * 2.4, lz = z + d.rz * sg * 2.4;
      sign(B, lx, lz, h.hdg, 1.4, 0.9, 'loc:' + h.twyName, signIndex, false);
    }
  }
  // approach light stanchions and crossbars
  for (const p of poles) {
    if (p.h > 0.5) B.box('plain', p.x, 0, p.z, p.hdg, 0.18, 0.18, p.h, C.steel);
    if (p.w > 0) B.box('plain', p.x, p.h - 0.1, p.z, p.hdg, 0.12, p.w + 0.4, 0.12, C.steel);
  }
  // floodlight masts
  for (const f of L.floods) {
    B.box('plain', f.x, 0, f.z, 0, 0.7, 0.7, f.h, C.grey);
    const ah = Math.atan2(f.aim.x, -f.aim.z) / DEG;
    B.box('plain', f.x, f.h - 0.2, f.z, ah, 0.8, 4.2, 1.1, C.dgrey);
  }
  for (const s of L.streetLights) {
    B.box('plain', s.x, 0, s.z, 0, 0.22, 0.22, s.h, C.grey);
    B.box('plain', s.x, s.h - 0.1, s.z, 0, 1.6, 0.35, 0.18, C.dgrey);
  }
  // fences: posts + chain-link panels
  for (const f of L.fences) {
    for (let i = 0; i + 1 < f.pts.length; i++) {
      const a = f.pts[i], b = f.pts[i + 1];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      const n = Math.max(1, Math.round(len / 3));
      for (let k = 0; k <= n; k++) B.box('plain', a.x + ux * len * k / n, 0, a.z + uz * len * k / n, 0, 0.08, 0.08, 2.5, C.grey);
      const nx = -uz, nz = ux;
      B.quad('fence', [a.x, 0.05, a.z], [b.x, 0.05, b.z], [a.x, 2.4, a.z], [b.x, 2.4, b.z], [nx, 0, nz], C.white, [0, 0, len, 2.35]);
    }
  }
  if (L.palms) for (const p of L.palms) palm(B, p.x, p.z, (p.x * 13.1 + p.z * 7.7) % 360);
}

function sign(B, x, z, hdg, w, h, key, signIndex, legsTall) {
  // a two-faced sign panel; face 'hdg' reads for a viewer looking along hdg+180 (i.e. facing the sign from hdg side)
  const d = dirs(hdg), y0 = legsTall ? 0.5 : 0.3;
  B.box('plain', x, y0, z, hdg, 0.35, w + 0.12, h + 0.12, C.black, {});
  B.box('plain', x + d.rx * (w / 2 - 0.15), 0, z + d.rz * (w / 2 - 0.15), hdg, 0.08, 0.08, y0, C.grey);
  B.box('plain', x - d.rx * (w / 2 - 0.15), 0, z - d.rz * (w / 2 - 0.15), hdg, 0.08, 0.08, y0, C.grey);
  const uv = signIndex.get(key);
  if (!uv) return;
  // face toward +along (viewer stands at +along, looking back along -along)
  const fx = x + d.dx * 0.18, fz = z + d.dz * 0.18;
  // viewer's right when looking at the face whose normal is +d: cross(up, n) = (nz, 0, -nx)
  const rx = d.dz, rz = -d.dx;
  const a = [fx - rx * w / 2, y0 + 0.06, fz - rz * w / 2], b = [fx + rx * w / 2, y0 + 0.06, fz + rz * w / 2];
  B.quad('sign', a, b, [a[0], y0 + 0.06 + h, a[2]], [b[0], y0 + 0.06 + h, b[2]], [d.dx, 0, d.dz], C.white, null,
    [[uv[0], uv[1]], [uv[2], uv[1]], [uv[0], uv[3]], [uv[2], uv[3]]]);
}

function signBack(B, x, z, hdg, w, h, key, signIndex, y0) {
  const d = dirs(hdg + 180);
  const uv = signIndex.get(key); if (!uv) return;
  const fx = x + d.dx * 0.18, fz = z + d.dz * 0.18, rx = d.dz, rz = -d.dx;
  const a = [fx - rx * w / 2, y0 + 0.06, fz - rz * w / 2], b = [fx + rx * w / 2, y0 + 0.06, fz + rz * w / 2];
  B.quad('sign', a, b, [a[0], y0 + 0.06 + h, a[2]], [b[0], y0 + 0.06 + h, b[2]], [d.dx, 0, d.dz], C.white, null,
    [[uv[0], uv[1]], [uv[2], uv[1]], [uv[0], uv[3]], [uv[2], uv[3]]]);
}

function rooftop(B, b, n, y) {
  const d = dirs(b.hdg);
  for (let k = 0; k < n; k++) {
    const sa = ((k * 0.618) % 1 - 0.5) * b.len * 0.8, sc = (((k * 0.414) % 1) - 0.5) * b.wid * 0.6;
    B.box('metal', b.x + d.dx * sa + d.rx * sc, y, b.z + d.dz * sa + d.rz * sc, b.hdg, 3 + (k % 3) * 2, 2.5 + (k % 2) * 2, 1.6 + (k % 2), C.grey);
  }
}

function building(B, b, L) {
  const d = dirs(b.hdg);
  switch (b.type) {
    case 'terminal': {
      B.box({ pa: 'glass', na: 'glass', pr: 'glass', nr: 'glass' }, b.x, 0, b.z, b.hdg, b.len, b.wid, b.h - 2, C.glassTint);
      // floating barrel-vault roof with deep overhangs + fascia slab
      B.box({ bottom: 'plain', pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain' }, b.x, b.h - 2, b.z, b.hdg, b.len + 16, b.wid + 20, 1.2, C.offwhite);
      B.vault('metal', { pa: 'cab', na: 'cab' }, b.x, b.h - 0.8, b.z, b.hdg, b.len + 16, b.wid + 20, 7, lin(0xc4c8cc), 14, C.glassTint);
      // landside canopy and kerb on the -along side? (terminal faces landside on -along)
      B.box({ top: 'plain', bottom: 'plain', pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain' }, b.x - d.dx * (b.len / 2 + 12), 7, b.z - d.dz * (b.len / 2 + 12), b.hdg, 20, b.wid * 0.9, 0.8, C.white);
      for (let k = -2; k <= 2; k++) B.box('plain', b.x - d.dx * (b.len / 2 + 18) + d.rx * k * b.wid * 0.2, 0, b.z - d.dz * (b.len / 2 + 18) + d.rz * k * b.wid * 0.2, b.hdg, 0.6, 0.6, 7, C.grey);
      rooftop(B, b, 8, b.h + 0.2);
      break;
    }
    case 'pier': {
      // apron level (baggage, services: cladding + roller shutters), glazed gate-lounge level with interior,
      // deep roof overhang with fascia, vertical sun fins on the airside face, rooftop plant and a skylight ridge
      const fs = b.faceSide; // which right-side faces the apron (+1 = +r)
      const base = 4.5, side = fs > 0 ? 'pr' : 'nr', land = fs > 0 ? 'nr' : 'pr';
      B.box({ pa: 'metal', na: 'metal', [side]: 'metal', [land]: 'metal' }, b.x, 0, b.z, b.hdg, b.len, b.wid, base, C.civil);
      B.box({ pa: 'glass', na: 'glass', [side]: 'glass', [land]: 'office', top: 'roof' }, b.x, base, b.z, b.hdg, b.len, b.wid, b.h - base, C.glassTint);
      // roller shutters along the apron face (slightly proud of the cladding)
      const nD = Math.floor(b.len / 22);
      for (let k = 0; k < nD; k++) {
        const sa = -b.len / 2 + (k + 0.5) * (b.len / nD);
        B.box({ [side]: 'door' }, b.x + d.dx * sa, 0, b.z + d.dz * sa, b.hdg, 5.5, b.wid + 0.1, 3.6, C.grey);
      }
      // floor slab edge band between levels
      B.box({ pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain' }, b.x, base - 0.4, b.z, b.hdg, b.len + 0.3, b.wid + 0.3, 0.6, C.offwhite);
      // roof overhang: soffit + fascia, 3 m beyond the glass
      B.box({ bottom: 'plain', pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain', top: 'roof' }, b.x, b.h, b.z, b.hdg, b.len + 6, b.wid + 6, 1.1, C.offwhite);
      // sun fins every 4.5 m on the glazed face
      const nf = Math.floor(b.len / 4.5);
      for (let k = 0; k <= nf; k++) {
        const sa = -b.len / 2 + k * (b.len / nf), sc = fs * (b.wid / 2 + 0.35);
        B.box('plain', b.x + d.dx * sa + d.rx * sc, base, b.z + d.dz * sa + d.rz * sc, b.hdg, 0.18, 0.7, b.h - base, C.steel);
      }
      // skylight ridge (dark glazing) along the roof centre, plant enclosures
      B.box({ top: 'cab', pr: 'cab', nr: 'cab', pa: 'plain', na: 'plain' }, b.x, b.h + 1.1, b.z, b.hdg, b.len * 0.85, 5, 1.2, C.glassTint);
      rooftop(B, b, Math.round(b.len / 45), b.h + 1.1);
      break;
    }
    case 'spine':
      B.box({ pa: 'glass', na: 'glass', pr: 'glass', nr: 'glass', top: 'roof' }, b.x, 4, b.z, b.hdg, b.len, b.wid, b.h - 4, C.glassTint);
      B.box('concrete', b.x, 0, b.z, b.hdg, b.len, b.wid * 0.5, 4, C.concrete);
      break;
    case 'garage':
      B.box({ pa: 'garage', na: 'garage', pr: 'garage', nr: 'garage', top: 'concrete' }, b.x, 0, b.z, b.hdg, b.len, b.wid, b.h, C.concrete);
      B.box('concrete', b.x + d.dx * (b.len / 2 - 6), b.h, b.z + d.dz * (b.len / 2 - 6), b.hdg, 6, 6, 3.5, C.concrete);
      break;
    case 'office':
      B.box({ pa: 'office', na: 'office', pr: 'office', nr: 'office', top: 'roof' }, b.x, 0, b.z, b.hdg, b.len, b.wid, b.h, b.mil ? C.tan : C.offwhite);
      B.box({ pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain' }, b.x, b.h, b.z, b.hdg, b.len + 0.3, b.wid + 0.3, 0.7, b.mil ? C.tan : C.offwhite);
      rooftop(B, b, 3, b.h);
      break;
    case 'firestation': {
      const tint = b.mil ? C.tan : C.offwhite;
      B.box({ pa: 'office', na: 'office', pr: 'office', top: 'roof' }, b.x, 0, b.z, b.hdg, b.len, b.wid, b.h, tint);
      // apparatus bay doors on the -r face (toward the runway side), office band above
      B.box({ nr: 'door' }, b.x, 0, b.z, b.hdg, b.len, b.wid, 5.5, C.red);
      B.box({ nr: 'office' }, b.x, 5.5, b.z, b.hdg, b.len, b.wid, b.h - 5.5, tint);
      B.box('plain', b.x + d.dx * (b.len / 2 - 4), 0, b.z + d.dz * (b.len / 2 - 4), b.hdg, 4, 4, b.h + 6, C.red); // hose tower
      break;
    }
    case 'hangar': {
      const wallCol = b.mil ? C.mil : C.civil;
      const wallH = b.mil ? b.h * 0.55 : b.h * 0.82;
      B.box({ pa: 'metal', na: 'metal', pr: 'metal', nr: 'door' }, b.x, 0, b.z, b.hdg, b.len, b.wid, wallH, wallCol, { cols: { nr: b.mil ? C.milDark : C.grey } });
      if (b.mil) B.vault('metal', { pa: 'metal', na: 'metal' }, b.x, wallH, b.z, b.hdg + 90, b.wid, b.len, b.h - wallH, C.mil, 12);
      else B.gable('roof', 'metal', b.x, wallH, b.z, b.hdg, b.len, b.wid, b.h - wallH, C.grey, wallCol);
      // door frame header
      B.box('plain', b.x - d.rx * (b.wid / 2 + 0.3), wallH - 2.2, b.z - d.rz * (b.wid / 2 + 0.3), b.hdg, b.len + 0.6, 0.8, 2.4, b.mil ? C.milDark : C.blue);
      // lean-to workshop on the back
      B.box({ pa: 'office', na: 'office', pr: 'office', top: 'roof' }, b.x + d.rx * (b.wid / 2 + 6), 0, b.z + d.rz * (b.wid / 2 + 6), b.hdg, b.len * 0.8, 12, 7, b.mil ? C.tan : C.offwhite);
      break;
    }
    case 'thangar': {
      B.box({ pa: 'metal', na: 'metal', pr: 'metal', nr: 'door', top: 'metal' }, b.x, 0, b.z, b.hdg, b.len, b.wid, b.h, C.civil, { cols: { nr: C.blue } });
      break;
    }
    case 'shelter': {
      B.box({ pr: 'concrete', nr: 'concrete', pa: 'concrete', top: 'concrete' }, b.x, 0, b.z, b.hdg, b.len, b.wid + 4, 1.5, C.shelter);
      B.vault('concrete', { pa: 'concrete', na: 'door' }, b.x, 1.5, b.z, b.hdg, b.len, b.wid, b.h - 1.5, C.shelter, 12, C.dgrey);
      // door slab at the -along end
      B.box({ na: 'door' }, b.x - d.dx * 0.2, 0, b.z - d.dz * 0.2, b.hdg, b.len, b.wid + 4, 1.5, C.dgrey);
      break;
    }
    case 'smallterminal': {
      const isl = b.island;
      const fs = b.faceSide;
      B.box({ pa: 'office', na: 'office', pr: fs > 0 ? 'glass' : 'office', nr: fs < 0 ? 'glass' : 'office', top: isl ? null : 'roof' }, b.x, 0, b.z, b.hdg, b.len, b.wid, b.h, isl ? C.white : C.offwhite);
      if (isl) B.gable('plain', 'plain', b.x, b.h, b.z, b.hdg, b.len + 3, b.wid + 4, 4.5, C.terracotta, C.white);
      else { B.box({ pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain' }, b.x, b.h, b.z, b.hdg, b.len + 0.4, b.wid + 0.4, 0.8, C.offwhite); rooftop(B, b, 3, b.h); }
      // airside canopy
      B.box({ top: 'plain', bottom: 'plain', pr: 'plain', nr: 'plain', pa: 'plain', na: 'plain' }, b.x + d.rx * fs * (b.wid / 2 + 3), 3.4, b.z + d.rz * fs * (b.wid / 2 + 3), b.hdg, b.len * 0.6, 6, 0.4, C.white);
      break;
    }
    default:
      B.box('office', b.x, 0, b.z, b.hdg, b.len, b.wid, b.h, C.offwhite);
  }
}

function tower(B, t, kind) {
  const { x, z } = t, h = t.h;
  if (kind === 'tall') {
    // podium (base building), shaft, junction level, cab, roof cap, antennas
    B.box({ pa: 'office', na: 'office', pr: 'office', nr: 'office', top: 'roof' }, x, 0, z + 0, t.hdg, 34, 22, 9, C.offwhite);
    B.cylinder('concrete', x, 0, z, 4.4, h - 4, 16, C.concrete, null, 3.8);
    B.cylinder('concrete', x, h - 4, z, 3.8, 0.01, 16, C.concrete, null, 7.6);
    B.cylinder('concrete', x, h - 4, z, 7.6, 4, 16, C.concrete, null, 7.6);
    B.cylinder('cab', x, h, z, 7.2, t.cab, 12, C.glassTint, null, 8.2);
    B.cylinder('plain', x, h + t.cab, z, 8.8, 1.2, 12, C.offwhite, 'plain', 8.8);
    B.box('plain', x, h + t.cab + 1.2, z, 0, 0.3, 0.3, 4.5, C.grey);
    B.box('plain', x + 2.5, h + t.cab + 1.2, z, 0, 1.2, 1.2, 1.4, C.grey);
  } else if (kind === 'mil') {
    B.box({ pa: 'office', na: 'office', pr: 'office', nr: 'office', top: 'roof' }, x, 0, z, t.hdg, 30, 18, 8, C.tan);
    B.box({ pa: 'concrete', na: 'concrete', pr: 'concrete', nr: 'concrete' }, x, 0, z, t.hdg, 7, 7, h, C.tan);
    B.box({ bottom: 'plain', pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain', top: 'plain' }, x, h - 1, z, t.hdg, 11, 11, 1, C.tan);
    B.cylinder('cab', x, h, z, 6.4, t.cab, 8, C.glassTint, null, 7.2);
    B.cylinder('plain', x, h + t.cab, z, 7.6, 1, 8, C.tan, 'plain', 7.6);
    B.box('plain', x, h + t.cab + 1, z, 0, 0.3, 0.3, 5, C.grey);
  } else {
    B.box({ pa: 'office', na: 'office', pr: 'office', nr: 'office' }, x, 0, z, t.hdg, 8, 8, h, C.offwhite);
    B.box({ bottom: 'plain', pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain', top: 'plain' }, x, h - 0.6, z, t.hdg, 9.5, 9.5, 0.6, C.offwhite);
    B.cylinder('cab', x, h, z, 4.6, t.cab, 8, C.glassTint, null, 5.2);
    B.cylinder('plain', x, h + t.cab, z, 5.6, 0.8, 8, C.offwhite, 'plain', 5.6);
    B.box('plain', x, h + t.cab + 0.8, z, 0, 0.2, 0.2, 3, C.grey);
  }
}

function prop(B, p, signIndex) {
  switch (p.type) {
    case 'jetbridge': {
      // rotunda on a column at the pier, telescopic tunnel sloping to the cab at the aircraft door, drive-wheel leg;
      // retracted against the pier when the stand is empty
      const docked = !p.stand || p.stand.occupied !== false;
      const ex0 = docked ? p.ex : p.px, ez0 = docked ? p.ez : p.pz;
      const dx = ex0 - p.x, dz = ez0 - p.z, len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len, hdg = Math.atan2(ux, -uz) / DEG;
      B.cylinder('plain', p.x, 0, p.z, 0.7, 4.0, 8, C.grey);
      B.cylinder('plain', p.x, 4.0, p.z, 2.4, 3.2, 10, C.steel, 'plain');
      const tl = Math.max(4, len - 4.2);
      const mx = p.x + ux * (2.2 + tl / 2), mz = p.z + uz * (2.2 + tl / 2);
      B.box({ pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain', top: 'plain', bottom: 'plain' }, mx, 4.2, mz, hdg, tl, 3.2, 2.9, C.civil);
      B.box({ pr: 'plain', nr: 'plain' }, mx, 5.2, mz, hdg, tl * 0.96, 3.25, 0.8, C.dgrey);   // window band
      const ex = ex0 - ux * 1.2, ez = ez0 - uz * 1.2;
      B.box({ pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain', top: 'plain', bottom: 'plain' }, ex, 4.0, ez, hdg, 2.6, 4.0, 3.3, C.steel);
      const lx = ex0 - ux * 7, lz = ez0 - uz * 7, rx = -uz, rz = ux;
      for (const s of [-1, 1]) B.box('plain', lx + rx * s * 1.2, 0.4, lz + rz * s * 1.2, hdg, 0.35, 0.35, 3.8, C.dgrey);
      B.box('plain', lx, 0.1, lz, hdg, 1.2, 3.4, 0.8, C.dgrey);
      break;
    }
    case 'fuelfarm': {
      const d = dirs(p.hdg);
      const cols = Math.ceil(p.n / 2);
      for (let k = 0; k < p.n; k++) {
        const sa = (k % cols - (cols - 1) / 2) * p.r * 2.6, sc = (Math.floor(k / cols) - 0.5) * p.r * 2.6 * (p.n > 1 ? 1 : 0);
        const x = p.x + d.dx * sa + d.rx * sc, z = p.z + d.dz * sa + d.rz * sc;
        B.cylinder('plain', x, 0, z, p.r, p.h, 18, C.white, 'plain');
        B.cylinder('plain', x, p.h, z, p.r, p.r * 0.15, 18, C.offwhite, 'plain', p.r * 0.2);
      }
      const W = cols * p.r * 2.6 + 6, D = (p.n > 1 ? 2 : 1) * p.r * 2.6 + 6;
      for (const [sa, sc, w, dd] of [[0.5, 0, 0.5, D], [-0.5, 0, 0.5, D], [0, 0.5, W, 0.5], [0, -0.5, W, 0.5]]) {
        B.box('concrete', p.x + d.dx * sa * W + d.rx * sc * D, 0, p.z + d.dz * sa * W + d.rz * sc * D, p.hdg, w, dd, 1.2, C.concrete);
      }
      break;
    }
    case 'radar': {
      B.box('metal', p.x, 0, p.z, 0, 3.2, 3.2, p.h, C.grey);
      B.cylinder('plain', p.x, p.h, p.z, p.r * 0.9, 0.6, 14, C.grey, 'plain');
      B.dome('plain', p.x, p.h + p.r * 0.75, p.z, p.r, C.white, -0.7, 16, 7);
      break;
    }
    case 'mast': {
      const n = 7, seg = p.h / n;
      for (let k = 0; k < n; k++) B.box('plain', p.x, k * seg, p.z, 0, 0.9 - k * 0.06, 0.9 - k * 0.06, seg, k % 2 ? C.white : C.orange);
      break;
    }
    case 'glideslope': {
      const d = dirs(p.hdg);
      B.box('plain', p.x, 0, p.z, p.hdg, 0.5, 0.5, 15, C.orange);
      for (const y of [5, 9.5, 14]) B.box('plain', p.x - d.dx * 0.6, y, p.z - d.dz * 0.6, p.hdg, 0.5, 1.4, 0.5, C.grey);
      B.box({ pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain', top: 'plain' }, p.x + d.rx * 6, 0, p.z + d.rz * 6, p.hdg, 3, 2.5, 2.6, C.offwhite);
      break;
    }
    case 'localizer': {
      const d = dirs(p.hdg);
      const n = Math.round(p.width / 2.2);
      for (let k = 0; k < n; k++) {
        const s = (k - (n - 1) / 2) * 2.2;
        if (Math.abs(s) < 2) continue;
        const x = p.x + d.rx * s, z = p.z + d.rz * s;
        B.box('plain', x, 0, z, p.hdg, 0.12, 0.12, 2.6, C.grey);
        B.box('plain', x, 2.3, z, p.hdg, 1.2, 0.1, 0.1, C.white);
        B.box('plain', x, 1.6, z, p.hdg, 1.0, 0.1, 0.1, C.white);
      }
      B.box('plain', p.x, 0.5, p.z, p.hdg, 0.15, p.width, 0.15, C.grey);
      B.box({ pa: 'plain', na: 'plain', pr: 'plain', nr: 'plain', top: 'plain' }, p.x + d.dx * 20 + d.rx * (p.width / 2 + 10), 0, p.z + d.dz * 20 + d.rz * (p.width / 2 + 10), p.hdg, 3, 3, 2.6, C.offwhite);
      break;
    }
    case 'windsock': {
      B.box('plain', p.x, 0, p.z, 0, 0.18, 0.18, 6, C.white);
      B.box('plain', p.x, 0, p.z, 0, 1.2, 1.2, 0.3, C.concrete);
      break;
    }
    case 'drsign': {
      sign(B, p.x, p.z, p.hdg + 180, 1.6, 1.1, 'dr:' + p.a, signIndex, true);
      signBack(B, p.x, p.z, p.hdg + 180, 1.6, 1.1, 'dr:' + p.b, signIndex, 0.5);
      break;
    }
    default: break;
  }
}

function palm(B, x, z, seed) {
  const h = 7 + (seed % 5);
  const lean = ((seed % 30) - 15) * DEG * 0.6;
  const lx = Math.sin(lean) * 1.8, lz = Math.cos(seed) * 1.2;
  B.beam('plain', [x, 0, z], [x + lx * 0.4, h * 0.5, z + lz * 0.4], 0.45, C.trunk);
  B.beam('plain', [x + lx * 0.4, h * 0.5, z + lz * 0.4], [x + lx, h, z + lz], 0.35, C.trunk);
  const tx = x + lx, tz = z + lz;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + seed;
    const ux = Math.cos(a), uz = Math.sin(a);
    const L1 = 2.4, L2 = 4.6;
    const p0 = [tx, h, tz], p1 = [tx + ux * L1, h + 0.6, tz + uz * L1], p2 = [tx + ux * L2, h - 1.4, tz + uz * L2];
    const sx = -uz * 0.7, sz = ux * 0.7;
    B.quad('leaf', [p0[0] - sx * 0.3, p0[1], p0[2] - sz * 0.3], [p0[0] + sx * 0.3, p0[1], p0[2] + sz * 0.3], [p1[0] - sx, p1[1], p1[2] - sz], [p1[0] + sx, p1[1], p1[2] + sz], [0, 1, 0], C.leaf, [0, 0, 1, 1]);
    B.quad('leaf', [p1[0] - sx, p1[1], p1[2] - sz], [p1[0] + sx, p1[1], p1[2] + sz], [p2[0] - sx * 0.2, p2[1], p2[2] - sz * 0.2], [p2[0] + sx * 0.2, p2[1], p2[2] + sz * 0.2], [0, 1, 0], C.leaf, [0, 0, 1, 1]);
  }
}
