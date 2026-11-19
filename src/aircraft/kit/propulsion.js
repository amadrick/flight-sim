// Aircraft kit — propulsion parts: fan / compressor faces, petal ("turkey feather") nozzles with a morph target,
// afterburner glow, 2D vectoring nozzles, high-bypass nacelles with reverser sleeves, intake helpers.
// All parts are built around the +Z axis (z increases aft) and placed with `centre` or mesh.translate().
import { Mesh, lathe, prism, box } from './mesh.js';
import { loft } from './loft.js';
import { wing } from './surface.js';
import { naca4 } from './airfoil.js';

const TAU = Math.PI * 2;

/**
 * Fan / compressor face with spinner. Front face at z = 0 looking toward -Z; spin the returned mesh about Z.
 * opts: { radius, hub = .3 r, blades = 24, chord = .28 r, staggerRoot = 28, staggerTip = 62 (deg), spinner = .55 r (length),
 *         uvBlade, uvSpinner, sweep = 0 }
 * Also returns nothing else — add a dark `disc` behind it with fanBackdrop().
 */
export function fan(o) {
  const R = o.radius, hub = o.hub ?? R * 0.3, nb = o.blades ?? 24, ch = o.chord ?? R * 0.28, m = new Mesh();
  const b0 = (o.staggerRoot ?? 28) * Math.PI / 180, b1 = (o.staggerTip ?? 62) * Math.PI / 180, uvB = o.uvBlade || [0, 0], NS = 5;
  for (let i = 0; i < nb; i++) {
    const phi = i / nb * TAU, c = Math.cos(phi), s = Math.sin(phi);
    const rad = [c, s, 0], tan = [-s, c, 0];
    const rows = [];
    for (let k = 0; k <= NS; k++) {
      const f = k / NS, r = hub * 0.96 + (R * 0.985 - hub * 0.96) * f, beta = b0 + (b1 - b0) * f, cc = ch * (0.8 + 0.35 * Math.sin(f * Math.PI * 0.9));
      const dir = [tan[0] * Math.sin(beta), tan[1] * Math.sin(beta), Math.cos(beta)];             // chord direction (LE → TE)
      const lean = (o.sweep ?? 0.08) * R * f * f;
      const le = [rad[0] * r - dir[0] * cc * 0.5, rad[1] * r - dir[1] * cc * 0.5, -dir[2] * cc * 0.5 + ch * 0.45 + lean];
      const te = [rad[0] * r + dir[0] * cc * 0.5, rad[1] * r + dir[1] * cc * 0.5, dir[2] * cc * 0.5 + ch * 0.45 + lean];
      const n = [dir[1] * rad[2] - dir[2] * rad[1], dir[2] * rad[0] - dir[0] * rad[2], dir[0] * rad[1] - dir[1] * rad[0]];
      rows.push({ le, te, n });
    }
    for (const sg of [1, -1]) {
      const base = m.vertexCount;
      for (const q of rows) { m.vert(q.le[0], q.le[1], q.le[2], q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvB[0], uvB[1]); m.vert(q.te[0], q.te[1], q.te[2], q.n[0] * sg, q.n[1] * sg, q.n[2] * sg, uvB[0], uvB[1]); }
      for (let k = 0; k < NS; k++) { const a = base + k * 2, b = a + 1, cI = a + 3, d = a + 2; if (sg > 0) m.quad(a, b, cI, d); else m.quad(a, d, cI, b); }
    }
  }
  const sl = o.spinner ?? R * 0.55;
  m.occlude((x, y, z) => 0.5 - 0.35 * Math.min(1, Math.hypot(x, y) / R));     // blade roots sit deep between their neighbours
  m.add(lathe([[0, -sl], [hub * 0.35, -sl * 0.82], [hub * 0.72, -sl * 0.42], [hub, 0.02], [hub, ch * 1.0, 1], [0, ch * 1.0]], { segments: 20, uv: o.uvSpinner || uvB }));
  return m;
}

/** Dark disc + short duct wall behind a fan so nothing shows through: disc at z, facing -Z. */
export function fanBackdrop(radius, z, uv) {
  return lathe([[0, z], [radius, z]], { segments: 24, uv }).occlude(0.8);
}

/**
 * Convergent-divergent petal nozzle with a morph target (influence 0 = closed, 1 = open).
 * opts: { z0, z1 (exit), r0 (radius at the hinge ring), rClosed, rOpen (exit radius), petals = 12, thickness = .025,
 *         throat = .82 (inner throat radius as a fraction of the exit radius, closed), centre = [0, 0, 0],
 *         uvOuter, uvInner | chart (rect chart: a = angle fraction × w, b = length fraction × h; inner uses uvInner) }
 */
export function petalNozzle(o) {
  const P = o.petals ?? 12, z0 = o.z0, z1 = o.z1, r0 = o.r0, th = o.thickness ?? 0.025, m = new Mesh().enableMorph();
  const c = o.centre || [0, 0, 0], NA = 3, NL = 4, gap = o.gap ?? 0.1, throat = o.throat ?? 0.82;
  const prof = (u, rExit, inner) => {
    if (!inner) return r0 + (rExit - r0) * (0.25 * u + 0.75 * u * u);
    const rt = rExit * throat, ut = 0.5;                                  // converge to the throat, then diverge to the exit
    return u < ut ? (r0 - th * 2) + (rt - (r0 - th * 2)) * Math.sin(u / ut * Math.PI / 2) : rt + (rExit - th - rt) * ((u - ut) / (1 - ut));
  };
  const uvO = o.uvOuter || [0, 0], uvI = o.uvInner || uvO, ch = o.chart || null;
  const ring = (inner, seal) => {
    // seal = continuous cone slightly below the petals; petals = P plates with gaps
    const n = seal ? 1 : P;
    for (let i = 0; i < n; i++) {
      const a0 = seal ? 0 : (i + gap / 2 + (inner ? 0.5 : 0)) / P * TAU, a1 = seal ? TAU : (i + 1 - gap / 2 + (inner ? 0.5 : 0)) / P * TAU, na = seal ? P * 2 : NA;
      const base = m.vertexCount;
      for (let k = 0; k <= NL; k++) for (let j = 0; j <= na; j++) {
        const u = k / NL, a = a0 + (a1 - a0) * j / na, cs = Math.cos(a), sn = Math.sin(a), off = seal ? (inner ? 0.012 : -0.012) : 0;
        const rc = prof(u, o.rClosed, inner) + off, ro = prof(u, o.rOpen, inner) + off, z = z0 + (z1 - z0) * u;
        const dr = (prof(Math.min(1, u + 0.05), o.rClosed, inner) - prof(Math.max(0, u - 0.05), o.rClosed, inner)) / ((z1 - z0) * (Math.min(1, u + 0.05) - Math.max(0, u - 0.05)));
        const sg = inner ? -1 : 1, nl = Math.hypot(1, dr), nr = sg / nl, nz = -sg * dr / nl;
        const uv = ch && !inner ? ch.uv(a / TAU * ch.spec.w, u * ch.spec.h) : (inner ? uvI : uvO);
        const id = m.vert(c[0] + rc * cs, c[1] + rc * sn, c[2] + z, nr * cs, nr * sn, nz, uv[0], uv[1]);
        m.setMorph(id, c[0] + ro * cs, c[1] + ro * sn, c[2] + z);
        if (inner) m._occ()[id] = 0.62 - 0.5 * u * u;                    // the throat is dark, the exit lip sees the sky
      }
      for (let k = 0; k < NL; k++) for (let j = 0; j < na; j++) {
        const a = base + k * (na + 1) + j, b = a + 1, d = a + na + 1, e = d + 1;
        // (angle, length) grid: outward-facing winding for outer skins, reversed for inner
        if (inner) m.quad(a, d, e, b); else m.quad(a, b, e, d);
      }
    }
  };
  ring(false, true); ring(false, false); ring(true, true); ring(true, false);
  // exit rim
  const base = m.vertexCount, NR = P * 4, uvR = uvI;
  for (let j = 0; j <= NR; j++) {
    const a = j / NR * TAU, cs = Math.cos(a), sn = Math.sin(a);
    for (const [rc, ro] of [[o.rClosed, o.rOpen], [o.rClosed - th, o.rOpen - th]]) { const id = m.vert(c[0] + rc * cs, c[1] + rc * sn, c[2] + z1, 0, 0, 1, uvR[0], uvR[1]); m.setMorph(id, c[0] + ro * cs, c[1] + ro * sn, c[2] + z1); }
  }
  for (let j = 0; j < NR; j++) { const a = base + j * 2; m.quad(a, a + 2, a + 3, a + 1); }
  return m;
}

/**
 * Afterburner / hot-section interior: flame-holder disc deep inside plus a liner, to be drawn with glowMaterial()
 * (additive). Colour it each frame with abGlowColor(). opts: { zDeep, zExit, rDeep, rExit, centre }
 */
export function afterburnerGlow(o) {
  const c = o.centre || [0, 0, 0];
  // uv.x: 0 exit … 0.9 liner at the flame holder, 0.9 … 1 across the flame-holder disc (rim → centre); uv.y = 2 + angle fraction
  // (a value above 1.5 switches on the flame-holder / liner structure in glowMaterial).
  const zm = o.zDeep + (o.zExit - o.zDeep) * 0.45, rm = o.rDeep + (o.rExit - o.rDeep) * 0.45, U = [0, 0.3, 0.8, 0.9, 1];
  const m = lathe([[o.rExit, o.zExit], [rm, zm], [o.rDeep, o.zDeep + 0.02], [o.rDeep * 0.98, o.zDeep], [0, o.zDeep]], { segments: 32, uv: (k, j) => [U[k], 2 + j] });
  return m.translate(c[0], c[1], c[2]);
}
/** Radiance for the glow material from an engine state view: dull red when hot and dry, bright orange-white in afterburner. */
export function abGlowColor(color, eng, night = 0) {
  const ab = eng.afterburner, hot = Math.max(0, Math.min(1, (eng.n1 - 0.55) / 0.45)) * (eng.running ? 1 : 0);
  const k = 1 - 0.6 * night;
  return color.setRGB((0.3 * hot + 16 * ab) * k, (0.04 * hot + 6.4 * ab * (0.55 + 0.45 * ab)) * k, (0.005 * hot + 2.6 * ab * ab) * k);
}

/**
 * 2D convergent-divergent thrust-vectoring nozzle (F-22 style): fixed sidewalls + upper and lower flaps hinged at their
 * front edge. Returns { fixed, upper: { mesh, hinge, ref }, lower: { mesh, hinge, ref }, interior }.
 * opts: { z0, length, width, height (at the hinge), exitHeight, centre = [0,0,0], sawtooth = true, uv, uvInner }
 * Animate: upper angle = pitch·v + area·a, lower = pitch·v − area·a (rotation about the hinge, + = trailing edge up).
 */
export function nozzle2D(o) {
  const c = o.centre || [0, 0, 0], w = o.width / 2, h = o.height / 2, he = (o.exitHeight ?? o.height * 0.55) / 2, L = o.length, z0 = o.z0, uv = o.uv || [0, 0], uvI = o.uvInner || uv;
  const T = (m) => m.translate(c[0], c[1], c[2]);
  const fixed = new Mesh(), t = 0.04;
  for (const sg of [-1, 1]) {
    const tip = o.sawtooth === false ? L * 0.85 : L * 1.02;
    fixed.add(prism([[z0, -h], [z0, h], [z0 + L * 0.55, h * 0.9], [z0 + tip, 0], [z0 + L * 0.55, -h * 0.9]], sg * w - (sg > 0 ? 0 : t), sg * w + (sg > 0 ? t : 0), uv));
  }
  const flap = (sg) => {
    // wedge plate: outer face from (z0, sg·h) to (z0+L, sg·he·1.25); inner from (z0, sg·h·0.82) to (z0+L, sg·he); chevron tip
    const out = [[z0, sg * h], [z0 + L * 0.8, sg * (he + (h - he) * 0.3)], [z0 + L, sg * he * 1.02], [z0 + L * 0.6, sg * he * 0.95], [z0, sg * h * 0.8]];
    const m = prism(out, -w + 0.005, w - 0.005, uv);
    return { mesh: T(m), hinge: { a: [c[0] - w, c[1] + sg * h * 0.9, c[2] + z0], b: [c[0] + w, c[1] + sg * h * 0.9, c[2] + z0] }, ref: [c[0], c[1] + sg * he, c[2] + z0 + L] };
  };
  const interior = T(box(2 * w - 0.02, 2 * h * 0.8, 0.02, uvI).translate(0, 0, z0 - L * 0.6));
  return { fixed: T(fixed), upper: flap(1), lower: flap(-1), interior };
}

/**
 * High-bypass turbofan nacelle. Built around the engine axis at `centre` (x, y, z of the inlet highlight plane centre).
 * opts: {
 *   centre, length (fan cowl, highlight → bypass exit), rHi (highlight radius), rMax, rThroat, rFan (fan tip radius),
 *   zFan (fan face behind the highlight), rExit (cowl outer radius at the bypass exit),
 *   flat = 0 (0..0.35 bottom flattening of the inlet, 737NG style), droop = 0 (inlet centre lowered at the lip),
 *   sleeve = 0.55 (fraction of the cowl length where the translating reverser sleeve starts; 0 = no separate sleeve),
 *   core: { r0, r1, length, z0 (start behind the highlight) }, plug: { r, length },
 *   segments = 32, chart (unwrap chart with uAxis 's' for the fixed cowl) | uv, uvLip (bare-metal inlet lip), uvInner, uvSleeve,
 *   uvCore, uvPlug, uvCascade
 * }
 * Returns { cowl, sleeve, cascade, core, plug, fanZ, exitZ, coreExitZ, sleeveTravel, body (cowl loft result) } — meshes in body coords.
 */
export function nacelle(o) {
  const [cx, cy, cz] = o.centre, L = o.length, seg = o.segments ?? 32, flat = o.flat ?? 0, droop = o.droop ?? 0;
  const rHi = o.rHi, rMax = o.rMax, rTh = o.rThroat ?? rHi * 0.9, rFan = o.rFan, zFan = o.zFan ?? L * 0.22, rExit = o.rExit ?? rMax * 0.86;
  const sl = o.sleeve ?? 0.55, zS = L * sl, uvIn = o.uvInner || o.uv || [0, 0];
  const st = (z, r, k = 0) => {                    // k = flattening weight at this station
    const f = flat * k;
    return { z: cz + z, x: cx, y: cy - droop * k - 0.3 * r * f, w: r * (1 + f * 0.12), top: r * (1 + 0.3 * f), bot: r * (1 - 1.3 * f), kBot: 0.5523 + f * 1.0 };
  };
  const rAt = (z) => rMax - (rMax - rExit) * Math.pow(Math.max(0, (z - L * 0.4) / (L * 0.6)), 1.6);
  // fixed cowl, one skin: inside behind the fan → fan face → inlet throat → lip → outer skin aft to the sleeve joint.
  // (A loft faces outward where z increases along the station list, so fold-over skins start INSIDE.)
  const stations = [];
  const zOuterEnd = sl > 0 ? zS : L;
  stations.push(st(zFan + L * 0.12, rFan, 0), st(zFan, rFan, 0), st(zFan * 0.6, (rTh + rFan) / 2, 0.3), st(L * 0.06, rTh, 0.8));
  stations.push(st(0.012, rHi - 0.022, 1), st(0, rHi, 1), st(0.012, rHi + 0.022, 1));
  for (const z of [L * 0.035, L * 0.1, L * 0.22, L * 0.4]) if (z < zOuterEnd - 0.05) stations.push(st(z, z > L * 0.3 ? rAt(z) : rHi + (rMax - rHi) * Math.sqrt(Math.min(1, z / (L * 0.3))), z < L * 0.3 ? 1 : 0.5));
  stations.push(st(zOuterEnd, rAt(zOuterEnd), 0.15));
  const uvFn = o.chart ? undefined : (x, y, z, t, ring) => (ring.k < 3.5 ? uvIn : ring.k <= 7 && o.uvLip ? o.uvLip : (o.uv || [0, 0]));
  const body = loft({ stations, segments: seg, step: L / 14, chart: o.chart, uAxis: 's', uv: o.uv, uvFn });
  // baked occlusion down the inlet duct (the inner skin is everything inside the highlight radius)
  body.mesh.occlude((x, y, z) => { const r = Math.hypot(x - cx, y - cy + droop * 0.5), zz = z - cz; return r < rHi - 0.015 && zz > 0.01 ? Math.min(0.6, 0.12 + 0.48 * zz / Math.max(0.05, zFan)) : 0; });
  const out = { body, cowl: body.mesh, fanZ: cz + zFan, exitZ: cz + L, sleeveTravel: L * 0.17 };
  if (sl > 0) {
    const sStations = [st(zS, rAt(zS), 0.15), st((zS + L) / 2, rAt((zS + L) / 2), 0.05), st(L - 0.01, rExit + 0.004, 0), { ...st(L, rExit - 0.01, 0), hard: true }, st(L - 0.02, rExit - 0.035, 0), st(zS, rFan + 0.03, 0)];
    out.sleeve = loft({ stations: sStations, segments: seg, step: L / 10, uv: o.uvSleeve || o.uv, chart: o.sleeveChart, uAxis: 's' }).mesh;
    out.cascade = lathe([[rAt(zS) - 0.03, zS - 0.02], [rAt(zS + out.sleeveTravel) - 0.045, zS + out.sleeveTravel + 0.05], [rFan + 0.03, zS + out.sleeveTravel + 0.05]], { segments: seg, uv: o.uvCascade || uvIn }).translate(cx, cy, cz);
  }
  // inner wall of the bypass duct behind the fan (static)
  out.cowl.add(lathe([[rFan + 0.02, Math.max(zS, zFan + L * 0.2)], [rFan, zFan + L * 0.12]], { segments: seg, uv: uvIn }).occlude(0.7).translate(cx, cy, cz));
  const co = o.core || { r0: rFan * 0.62, r1: rFan * 0.42, length: L * 0.55, z0: zFan + L * 0.15 };
  const cz0 = co.z0 ?? zFan + L * 0.15, cz1 = L + co.length;
  out.core = lathe([[co.r0 * 0.9, cz0], [co.r0, cz0 + (L - cz0) * 0.5], [co.r0 * 0.98, L], [co.r1 * 1.08, L + co.length * 0.7], [co.r1, cz1, 1], [co.r1 - 0.03, cz1, 1], [co.r1 - 0.035, cz1 - co.length * 0.5]], { segments: seg, uv: o.uvCore || o.uv }).translate(cx, cy, cz);
  out.coreExitZ = cz + cz1;
  const pl = o.plug || { r: co.r1 * 0.55, length: co.length * 0.55 };
  out.plug = lathe([[pl.r * 1.02, cz1 - co.length * 0.5], [pl.r, cz1 - 0.05], [pl.r * 0.5, cz1 + pl.length * 0.6], [0, cz1 + pl.length]], { segments: 20, uv: o.uvPlug || o.uvCore || o.uv }).translate(cx, cy, cz);
  // dark turbine face inside the core nozzle
  out.plug.add(lathe([[co.r1 - 0.035, cz1 - co.length * 0.5], [0, cz1 - co.length * 0.5]], { segments: 20, uv: uvIn }).occlude(0.8).translate(cx, cy, cz));
  return out;
}

/**
 * Pylon / strut as a thin vertical lifting surface: sections = [{ y, z0 (leading edge), z1 (trailing edge), x = 0 }, ...]
 * from top to bottom or bottom to top. opts: { tc = .1, uv, charts, airfoil }
 */
export function pylon(sections, o = {}) {
  const asc = sections[0].y <= sections[sections.length - 1].y ? sections : sections.slice().reverse();
  return wing({
    stations: asc.map(s => ({ x: s.x ?? 0, y: s.y, z: s.z0, chord: s.z1 - s.z0, tc: s.tc ?? o.tc ?? 0.1 })),
    airfoil: o.airfoil || naca4('0010'), spanAxis: 'y', tip: o.tip ?? 'flat', root: o.root ?? 'flat', chordPts: o.chordPts ?? 8, uv: o.uv, charts: o.charts, edgeUV: o.uv,
  }).mesh;
}

/**
 * Stations for a 2D (rectangular) intake with rounded lips: returns a station list for loft() that runs from the outer skin
 * deep in the duct (`depth` behind the lip) forward around the lip and back along the outer skin for `depthOuter`
 * (use capStart 'flat' with a dark swatch to close the duct).
 * opts: { z (lip plane), x, y, w, h (half sizes), lip = .03, depth = 1.5, depthOuter = 1.0, k = .88 (boxiness), shrink = .8 }
 * For a raked / swept lip, shear the finished mesh (mesh.transform) or build the lip inside a fuselage cut-out.
 */
export function intake2DStations(o) {
  const k = o.k ?? 0.88, lip = o.lip ?? 0.03, sh = o.shrink ?? 0.8;
  const st = (z, grow) => ({ z, x: o.x ?? 0, y: o.y ?? 0, w: o.w + grow, h: o.h + grow, kTop: k, kBot: k });
  return [{ ...st(o.z + (o.depth ?? 1.5), -lip * 1.3), w: (o.w - lip * 1.3) * sh, h: (o.h - lip * 1.3) * sh }, st(o.z + lip * 3, -lip * 1.3), st(o.z + lip * 0.6, -lip * 0.9), st(o.z, 0),
    st(o.z + lip * 0.6, lip * 0.9), st(o.z + lip * 3, lip * 1.6), st(o.z + (o.depthOuter ?? 1), lip * 2.5)];
}

