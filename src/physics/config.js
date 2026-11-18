// Resolves a declarative aircraft physics config (src/aircraft/<id>/physics.js, documented in SCHEMA.md) plus the
// aircraft definition (geometry + published specs) into the flat numeric "model" the engine runs on.
// Everything here runs once per createSim(); nothing in the step loop allocates.
import { liftCurve } from './aero.js';

const DEG = Math.PI / 180;
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const pick = (o, k, d) => (o && typeof o[k] === 'number' && isFinite(o[k]) ? o[k] : d);

function interp(xs, ys, x) {
  const n = xs.length; if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1; while (xs[i] < x) i++;
  return ys[i - 1] + ((ys[i] - ys[i - 1]) * (x - xs[i - 1])) / (xs[i] - xs[i - 1]);
}
const sstep = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

const M_STEP = 0.02, M_MAX = 4.0, M_N = Math.round(M_MAX / M_STEP) + 1;

/** Generic compressibility model used for any Mach column the config does not tabulate. */
function defaultMach(col, M, p) {
  const { mcrit, cd0, cdWave, k0, sweep, cla0 } = p;
  const cs = Math.cos(sweep * DEG);
  switch (col) {
    case 'cla': {
      const pg = (m) => 1 / Math.sqrt(Math.max(0.05, 1 - m * m * cs * cs));
      const sub = Math.min(pg(Math.min(M, 0.92)), 1.6);
      if (M <= 0.95) return sub;
      const sup = (m) => Math.min(sub, 4 / Math.sqrt(Math.max(0.05, m * m - 1)) / cla0);
      if (M >= 1.25) return sup(M);
      const t = sstep(0.95, 1.25, M);
      return Math.min(pg(0.92), 1.6) * (1 - t) + sup(1.25) * t;
    }
    case 'clMax': return 1 - 0.25 * sstep(0.3, 0.95, M) - 0.2 * sstep(0.95, 2.0, M);
    case 'cd0': {
      const rise = cdWave * (0.12 * sstep(mcrit - 0.08, mcrit + 0.04, M) + 0.88 * sstep(mcrit + 0.02, 1.08, M));
      const decay = M > 1.15 ? 1 - 0.28 * sstep(1.15, 2.4, M) : 1;
      return cd0 + rise * decay;
    }
    case 'k': return k0 * (1 + 0.25 * sstep(0.8, 1.0, M)) + (M > 1 ? 0.21 * (M - 1) : 0);
    case 'xac': return 0.18 * sstep(0.85, 1.25, M);
    case 'ctrl': return 1 - 0.2 * sstep(0.85, 1.1, M) - 0.3 * sstep(1.1, 2.4, M);
    default: return 1;
  }
}

function machTable(col, tab, p) {
  const out = new Float64Array(M_N);
  const has = tab && Array.isArray(tab.m) && Array.isArray(tab[col]) && tab[col].length === tab.m.length;
  for (let i = 0; i < M_N; i++) { const M = i * M_STEP; out[i] = has ? interp(tab.m, tab[col], M) : defaultMach(col, M, p); }
  return out;
}

/** Find the stall-blend centre a0 [rad] so that the peak of the lift curve equals clMax. */
function stallPeak(a0, cl0, cla, a0n, m, clPost, dclFlap, sign) {
  // local lift maximum near the stall (the post-stall flat-plate plateau is not part of it)
  let best = -1e9, at = 0;
  const end = Math.min(80, a0 / DEG + 6);
  for (let a = 0; a <= end; a += 0.125) {
    const al = a * DEG * sign;
    const cl = sign > 0 ? liftCurve(al, cl0, cla, a0, a0n, m, clPost, dclFlap) : -liftCurve(al, cl0, cla, a0n, a0, m, clPost, dclFlap);
    if (cl > best) { best = cl; at = a * DEG; }
  }
  return { cl: best, alpha: at };
}
function solveStallAlpha(clMax, cl0, cla, a0n, m, clPost, dclFlap, sign = 1) {
  const peak = (a0) => stallPeak(a0, cl0, cla, a0n, m, clPost, dclFlap, sign).cl;
  let lo = 1 * DEG, hi = 70 * DEG;
  if (peak(hi) < clMax) return hi;
  if (peak(lo) > clMax) return lo;
  for (let i = 0; i < 50; i++) { const mid = 0.5 * (lo + hi); if (peak(mid) < clMax) lo = mid; else hi = mid; }
  return 0.5 * (lo + hi);
}

const ENGINE_TYPES = {
  'turbofan-hb': { ab: false, n1Idle: 0.21, n2Idle: 0.60, spoolUp: 6.5, spoolDown: 4.5, idleThrust: 0.045, thrustExp: 1.7, tsfc: [0.37, 0.42], egt: [430, 880, 880], TR: 1.06, machLapse: 0.49 },
  'turbofan-lb': { ab: false, n1Idle: 0.35, n2Idle: 0.62, spoolUp: 4, spoolDown: 3, idleThrust: 0.04, thrustExp: 1.6, tsfc: [0.75, 0.3], egt: [400, 900, 900], TR: 1.05, machLapse: 0 },
  'turbofan-ab': { ab: true, n1Idle: 0.35, n2Idle: 0.65, spoolUp: 3.5, spoolDown: 2.5, idleThrust: 0.035, thrustExp: 1.6, tsfc: [0.75, 0.3], tsfcAb: [1.95, 0.27], egt: [380, 870, 960], TR: 1.07, machLapse: 0 },
  'turbojet-ab': { ab: true, n1Idle: 0.4, n2Idle: 0.6, spoolUp: 5, spoolDown: 3.5, idleThrust: 0.05, thrustExp: 1.5, tsfc: [0.9, 0.35], tsfcAb: [1.9, 0.2], egt: [420, 800, 900], TR: 1.2, machLapse: 0 },
};
const TYPE_ALIASES = { 'turbofan-afterburning': 'turbofan-ab', 'turbofan-highbypass': 'turbofan-hb', 'turbofan-lowbypass': 'turbofan-lb',
  'turbojet-afterburning': 'turbojet-ab', 'turbojet': 'turbojet-ab', 'turbofan': 'turbofan-hb' };

export function resolveConfig(def) {
  const cfg = def.physics && !def.physics.stub ? def.physics : {};
  const g = def.geometry, sp = def.specs || {};
  const heavy = ['airliner', 'transport', 'bomber'].includes(def.category);
  const model = { id: def.id, heavy, cgHeight: g.cgHeight, length: g.length };

  // ------------------------------------------------------------------ reference geometry
  const a = cfg.aero || {}, ref = a.ref || {};
  const S = num(ref.area, g.wingArea), b = num(ref.span, g.span), c = num(ref.chord, S / b * 1.08);
  const AR = (b * b) / S;

  // ------------------------------------------------------------------ mass
  const cm = cfg.mass || {};
  const empty = num(cm.empty, num(sp.emptyMass, 10000));
  const fuelCap = num(cm.fuelCapacity, num(sp.fuelCapacity, empty * 0.3));
  const fuelInit = Math.min(fuelCap, num(cm.fuel, fuelCap * 0.6));
  const payload = num(cm.payload, Math.max(0, num(sp.typicalMass, empty * 1.3) - empty - fuelInit));
  const refMass = empty + payload + fuelInit;
  let ixx, iyy, izz, ixz = 0, inertiaMass = refMass;
  if (cm.inertia) {
    ({ ixx, iyy, izz } = cm.inertia); ixz = num(cm.inertia.ixz, 0); inertiaMass = num(cm.inertia.atMass, refMass);
  } else {
    const gy = cm.gyration || {};
    const rx = num(gy.rx, heavy ? 0.25 : 0.24), ry = num(gy.ry, heavy ? 0.37 : 0.36), rz = num(gy.rz, heavy ? 0.45 : 0.47);
    ixx = refMass * (b * rx / 2) ** 2; iyy = refMass * (g.length * ry / 2) ** 2; izz = refMass * ((b + g.length) / 2 * rz / 2) ** 2;
  }
  model.mass = { empty, payload, fuelInit, fuelCap, ixx, iyy, izz, ixz, inertiaMass, refMass, mtow: num(cm.mtow, num(sp.maxTakeoffMass, refMass * 1.3)) };

  // ------------------------------------------------------------------ aero
  const lift = a.lift || {}, drag = a.drag || {}, pitch = a.pitch || {}, side = a.side || {}, roll = a.roll || {}, yaw = a.yaw || {}, stall = a.stall || {};
  const ct = cfg.controls || {};
  const cEl = ct.elevator || {}, cAil = ct.aileron || {}, cRud = ct.rudder || {};
  const cla0 = num(lift.cla, (2 * Math.PI * AR) / (2 + Math.sqrt(4 + AR * AR * 1.3)));
  const cl0 = num(lift.cl0, heavy ? 0.2 : 0.05);
  const sharp = num(lift.sharpness, heavy ? 40 : 12);
  const clPost = num(lift.postStallCl, 1.1);
  const clMax = num(lift.clMax, heavy ? 1.4 : 1.5);
  const clMaxNeg = num(lift.clMaxNeg, 0.7 * clMax);
  const k0 = num(drag.k, 1 / (Math.PI * AR * num(drag.oswald, 0.8)));
  const cd0 = num(drag.cd0, 0.02);
  const mp = { mcrit: num(a.mcrit, heavy ? 0.78 : 0.88), cd0, cdWave: num(a.cdWave, heavy ? 0.03 : 0.025), k0, sweep: num(a.sweepDeg, heavy ? 25 : 40), cla0 };
  const A = {
    S, b, c,
    mInv: 1 / M_STEP, mN: M_N,
    tCla: machTable('cla', a.mach, mp), tClmax: machTable('clMax', a.mach, mp), tCd0: machTable('cd0', a.mach, mp),
    tK: machTable('k', a.mach, mp), tXac: machTable('xac', a.mach, mp), tCtrl: machTable('ctrl', a.mach, mp),
    cl0, cla: cla0, sharp, clPost, cd90: num(lift.cd90, 1.25),
    a0n: 0, slatDAlpha: 0, slatCd: 0, peakOff: 0,
    clMinD: num(drag.clMinDrag, 0), cdGear: num(drag.gear, 0.02), cdSb: num(drag.speedbrake, 0.04), cdSp: num(drag.spoiler, 0.05),
    cdBeta: num(drag.beta, 1.1), cdde: num(drag.elevator, 0.08), cdda: num(drag.aileron, 0.004), cddr: num(drag.rudder, 0.002),
    cdSplit: num(drag.splitRudder, 0),
    // pitch
    cm0: num(pitch.cm0, 0), sm: num(pitch.staticMargin, heavy ? 0.2 : 0.05), cmq: num(pitch.cmq, heavy ? -16 : -6),
    cmde: num(pitch.cmde, heavy ? 1.2 : 0.65), clde: num(pitch.clde, heavy ? 0.35 : 0.45), cmPost: num(pitch.cmPostStall, -0.4),
    cmSb: num(pitch.cmSpeedbrake, 0), cmGear: num(pitch.cmGear, 0), cmSp: num(pitch.cmSpoiler, 0),
    // side
    cyb: num(side.cyb, -0.9), cyCross: num(side.cyCross, 0), cydr: num(side.cydr, 0.2),
    // roll
    clb: num(roll.clb, heavy ? -0.1 : -0.07), clbCl: num(roll.clbCl, -0.05), clp: num(roll.clp, heavy ? -0.45 : -0.36),
    clr: num(roll.clr, 0.05), clrCl: num(roll.clrCl, 0.2), clda: num(roll.clda, 0.08), cldt: num(roll.cldt, 0),
    cldr: num(roll.cldr, 0.01), clSpR: num(roll.clSpoiler, 0), clSp: num(lift.spoiler, 0), qRev: num(roll.qReversal, 0),
    ailLoss: num(stall.aileronLoss, 0.6), wingDrop: num(stall.wingDrop, heavy ? 0.02 : 0.012), clpPost: num(stall.clpPost, 0.03),
    // yaw
    cnb: num(yaw.cnb, heavy ? 0.14 : 0.2), cnp: num(yaw.cnp, -0.02), cnpCl: num(yaw.cnpCl, -0.06), cnr: num(yaw.cnr, heavy ? -0.2 : -0.38),
    cnda: num(yaw.cnda, 0.002), cndaCl: num(yaw.cndaCl, 0.012), cndr: num(yaw.cndr, 0.1), cnSpR: num(yaw.cnSpoiler, 0),
    cnbPost: num(yaw.cnbPostStall, heavy ? 0.04 : -0.05), cnbMach: num(yaw.cnbMach, 0.5), rudLoss: num(yaw.rudderLoss, 0.7),
    aDir0: 0, aDirInv: 1,
    // buffet / stall cues
    buffetMargin: num(stall.buffetMargin, heavy ? 2.5 : 6) * DEG, buffetEnd: 2 * DEG, buffetCl: num(stall.buffetCl, 0.04),
    warnMargin: num(stall.warnMargin, heavy ? 2 : 3) * DEG,
    // control deflection limits (rad)
    deMax: num(cEl.max, 25) * DEG, daMax: num(cAil.max, 20) * DEG, drMax: num(cRud.max, 25) * DEG,
    dtMax: num(ct.diffTail && ct.diffTail.max, 0) * DEG, trimMax: num(ct.trim && ct.trim.max, num(cEl.max, 25)) * DEG,
    groundEffect: a.groundEffect !== false,
    sweep: null, flaps: null,
  };
  const ad = yaw.alphaDir || (heavy ? [22, 40] : [28, 42]);
  A.aDir0 = ad[0] * DEG; A.aDirInv = 1 / ((ad[1] - ad[0]) * DEG);

  // slats / leading-edge flaps
  const sl = a.slat || {};
  A.slatDAlpha = num(sl.dAlphaStall, 0) * DEG; A.slatCd = num(sl.dcd0, 0);

  // flaps schedule
  const fl = a.flaps || {};
  const detents = Array.isArray(fl.detents) && fl.detents.length ? fl.detents : [{ name: 'UP', pos: 0 }];
  const n = detents.length;
  const F = { n, names: [], deg: [], pos: new Float64Array(n), slat: new Float64Array(n), dcl0: new Float64Array(n), a0: new Float64Array(n),
    dcd0: new Float64Array(n), dcm0: new Float64Array(n), kf: new Float64Array(n), clMax: new Float64Array(n),
    time: num(fl.time, 12), slatTime: num(fl.slatTime, 3),
    takeoff: Math.min(n - 1, Math.max(0, num(fl.takeoff, 0) | 0)), landing: Math.min(n - 1, Math.max(0, num(fl.landing, n - 1) | 0)),
    autoWithGear: !!fl.autoWithGear };
  A.a0n = solveStallAlpha(clMaxNeg, cl0, cla0, 60 * DEG, sharp, clPost, 0, -1);
  let a0Clean = 0;
  for (let i = 0; i < n; i++) {
    const d = detents[i];
    F.names[i] = d.name ?? String(i); F.deg[i] = num(d.deg, 0);
    F.pos[i] = num(d.pos, n > 1 ? i / (n - 1) : 0); F.slat[i] = num(d.slat, 0);
    F.dcl0[i] = num(d.dcl0, 0); F.dcd0[i] = num(d.dcd0, 0); F.dcm0[i] = num(d.dcm0, 0); F.kf[i] = num(d.kFactor, 1);
    F.clMax[i] = num(d.clMax, clMax + 0.9 * F.dcl0[i]);
    // slat contribution is applied at runtime as -(1-slat)*slatDAlpha, so solve for the fully-slatted curve here
    const solved = solveStallAlpha(F.clMax[i], cl0, cla0, A.a0n, sharp, clPost, F.dcl0[i]);
    if (i === 0) { a0Clean = solved; A.peakOff = solved - stallPeak(solved, cl0, cla0, A.a0n, sharp, clPost, F.dcl0[i], 1).alpha; }
    F.a0[i] = solved + (1 - (sl.auto ? 1 : F.slat[i])) * A.slatDAlpha;
  }
  // The `clMax` Mach column is the ratio CLmax(M)/CLmax(0) (buffet / shock-stall boundary). The aero model needs the
  // matching factor on the stall-blend angle, which also depends on the lift-curve slope at that Mach number.
  {
    const ms = a.mach && Array.isArray(a.mach.m) && Array.isArray(a.mach.clMax) ? a.mach.m : [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0];
    const fs = ms.map((M) => {
      const j = Math.min(M_N - 1, Math.round(M / M_STEP));
      return solveStallAlpha(F.clMax[0] * A.tClmax[j], cl0, cla0 * A.tCla[j], A.a0n, sharp, clPost, 0) / a0Clean;
    });
    for (let j = 0; j < M_N; j++) A.tClmax[j] = interp(ms, fs, j * M_STEP);
  }
  A.flaps = F;
  model.slatAuto = sl.auto ? { a0: num(sl.auto.alpha && sl.auto.alpha[0], 0) * DEG, a1: num(sl.auto.alpha && sl.auto.alpha[1], 20) * DEG,
    m0: num(sl.auto.machFade && sl.auto.machFade[0], 0.9), m1: num(sl.auto.machFade && sl.auto.machFade[1], 1.3), gearDown: num(sl.auto.gearDown, 0) } : null;

  // variable sweep
  if (a.sweep) {
    const e = a.sweep.effects || {};
    A.sweep = { cla: num(e.cla, 0.75), clMax: num(e.clMax, 0.8), cd0: num(e.cd0, 0), wave: num(e.wave, 0.6), k: num(e.k, 1.6), xac: num(e.xac, 0.08), damp: num(e.damp, 0.7), span: num(e.span, 0.65) };
    model.sweep = { auto: a.sweep.auto || [[0, 0], [0.4, 0], [0.9, 1], [3, 1]], time: num(a.sweep.time, 8) };
  } else model.sweep = null;
  model.aero = A; model.S = S; model.b = b; model.c = c;

  // ------------------------------------------------------------------ control system hardware
  const sbk = ct.speedbrake || {}, spo = ct.spoilers || null, trm = ct.trim || {};
  model.ctl = {
    deRate: num(cEl.rate, 60) * DEG / A.deMax, deTau: num(cEl.tau, 0.05),
    daRate: num(cAil.rate, 80) * DEG / A.daMax, daTau: num(cAil.tau, 0.05),
    drRate: num(cRud.rate, 90) * DEG / A.drMax, drTau: num(cRud.tau, 0.05),
    drBlow: num(cRud.qBlowdown, 0),                       // dynamic pressure [Pa] above which max rudder shrinks ~1/q
    dtGain: A.dtMax > 0 ? 1 : 0,
    sbTime: num(sbk.time, 1.5),
    spoilers: spo ? { flight: num(spo.flightMax, 0.5), rollGain: num(spo.rollGain, 1.2), rollDead: num(spo.rollDeadband, 0.15), rollMax: num(spo.rollMax, 0.5), time: num(spo.time, 0.6),
      ground: spo.ground !== false, autoGround: spo.autoGround !== false } : null,
    trimRate: num(trm.rate, 0.04), trimAuth: num(trm.authority, 1),
    splitRudder: !!cRud.split,
    hook: !!cfg.hook, hookTime: 1.5, canopy: cfg.canopy !== false && !heavy, canopyTime: 4,
  };

  // ------------------------------------------------------------------ engines
  const ce = cfg.engines || {};
  const type = TYPE_ALIASES[ce.type] || TYPE_ALIASES[sp.engineType] || (ENGINE_TYPES[ce.type] ? ce.type : ENGINE_TYPES[sp.engineType] ? sp.engineType : heavy ? 'turbofan-hb' : 'turbofan-ab');
  const tdef = ENGINE_TYPES[type];
  const count = num(ce.count, num(sp.engineCount, g.engines ? g.engines.length : 1)) | 0;
  const tMil = num(ce.thrustMil, num(sp.thrustDry, 50000));
  const tAb = num(ce.thrustMax, num(sp.thrustMax, tMil));
  const hasAb = tdef.ab && tAb > tMil * 1.02;
  model.engines = [];
  for (let i = 0; i < count; i++) {
    const o = Object.assign({}, ce, Array.isArray(ce.each) ? ce.each[i] : null);
    const ge = (g.engines && g.engines[i % g.engines.length]) || { nozzle: [0, 0, g.tailZ * 0.9], nozzleRadius: 0.5 };
    const p3 = o.pos || ge.nozzle;                      // three-style body axes
    const tsfc = o.tsfc || tdef.tsfc, tsfcAb = o.tsfcAb || tdef.tsfcAb || [1.9, 0.27], egt = o.egt || tdef.egt;
    const rev = o.reverser ? { frac: num(o.reverser.fraction, 0.4), time: num(o.reverser.time, 2), n1: num(o.reverser.power, 0.8),
      minSpeed: num(o.reverser.minSpeed, 30), stowSpeed: num(o.reverser.stowSpeed, 25) } : null;
    const vec = o.vectoring ? { max: num(o.vectoring.pitch, 20) * DEG, rate: num(o.vectoring.rate, 40) * DEG, qFade: num(o.vectoring.qFade, 25000) } : null;
    model.engines.push({
      type, hb: type === 'turbofan-hb', tj: type === 'turbojet-ab', hasAb,
      tMil: num(o.thrustMil, tMil), tAb: hasAb ? num(o.thrustMax, tAb) : num(o.thrustMil, tMil),
      x: -p3[2], y: p3[0], z: -p3[1] + num(o.thrustLineOffset, 0),      // aerospace body axes
      cant: num(o.cantDeg, 0) * DEG,
      radius: num(ge.nozzleRadius, 0.5),
      n1Idle: num(o.n1Idle, tdef.n1Idle), n2Idle: num(o.n2Idle, tdef.n2Idle),
      spoolUp: num(o.spoolUp, tdef.spoolUp), spoolDown: num(o.spoolDown, tdef.spoolDown),
      idleThrust: num(o.idleThrust, tdef.idleThrust), thrustExp: num(o.thrustExp, tdef.thrustExp),
      TR: num(o.throttleRatio, tdef.TR), machLapse: num(o.machLapse, tdef.machLapse), altLapse: num(o.altLapse, 1),
      milLapse: num(o.milLapse, 3.8), abLapse: num(o.abLapse, 3.5), pLimit: num(o.pressureLimit, 0),
      inlet: o.inlet || (hasAb ? 'ramp' : 'subsonic'), abMin: num(o.abMinFraction, 0.25), abTime: num(o.abLightTime, 1.2),
      // TSFC in 1/h (lb/lbf/h == kg/kgf/h): [static, per-Mach slope]; converted to kg/(N s)
      tsfc0: tsfc[0] / (3600 * 9.80665), tsfc1: tsfc[1] / (3600 * 9.80665),
      tsfcAb0: tsfcAb[0] / (3600 * 9.80665), tsfcAb1: tsfcAb[1] / (3600 * 9.80665),
      idleFuel: num(o.idleFuelFlow, num(o.thrustMil, tMil) * 0.0000022),      // kg/s at sea-level idle
      egtIdle: egt[0], egtMil: egt[1], egtAb: egt[2], startTime: num(o.startTime, 12),
      reverser: rev, vectoring: vec,
      table: o.thrustTable ? buildThrustTable(o.thrustTable) : null,
      mMax: num(o.maxMach, 0),
    });
  }

  // ------------------------------------------------------------------ landing gear
  const cg = cfg.gear || {};
  const wheels = g.gear.map((w) => {
    const grp = w.steerable ? 'nose' : 'main';
    const o = Object.assign({}, cg[grp], cg.wheels && cg.wheels[w.name]);
    const travel = num(o.travel, Math.min(0.6, Math.max(0.2, 0.12 * g.cgHeight + 0.1)));
    return { name: w.name, px: w.pos[0], py: w.pos[1], pz: w.pos[2], radius: w.wheelRadius, steerable: !!w.steerable, braked: !!w.braked,
      travel, x0: num(o.staticDeflection, 0.65 * travel), zeta: num(o.damping, 0.55), zetaReb: num(o.reboundDamping, 1.0),
      gasRatio: Math.max(1.05, num(o.gasRatio, 4)), gasL: 0, fExt: 0, xCap: 0, fCap: 0, kCap: 0, xTyre: 0.1 * w.wheelRadius,
      load: 0, k: 0, cC: 0, cR: 0, kt: 0, ct: 0, relax: num(o.relaxation, 1.2 * w.wheelRadius) };
  });
  // static load split between the nose group (ahead of the CG) and the main group
  let zf = 0, nf = 0, zr = 0, nr = 0;
  for (const w of wheels) { if (w.pz < 0) { zf += w.pz; nf++; } else { zr += w.pz; nr++; } }
  const W = refMass * 9.80665;
  if (nf && nr) { zf /= nf; zr /= nr; const front = (W * zr) / (zr - zf); for (const w of wheels) w.load = w.pz < 0 ? front / nf : (W - front) / nr; }
  else for (const w of wheels) w.load = W / wheels.length;
  const cs = num(cg.corneringStiffness, 7);
  for (const w of wheels) {
    w.k = w.load / w.x0;
    // oleo-pneumatic air spring F = fExt * gasL / (gasL - x): static load at x0, load / gasRatio fully extended; beyond
    // 5x the static load the curve continues as a straight line (bottoming)
    w.gasL = (w.x0 * w.gasRatio) / (w.gasRatio - 1); w.fExt = w.load / w.gasRatio;
    w.xCap = w.gasL * (1 - 1 / (5 * w.gasRatio)); w.fCap = 5 * w.load; w.kCap = (w.fExt * w.gasL) / ((w.gasL - w.xCap) * (w.gasL - w.xCap));
    if (w.travel < w.xCap) w.travel = w.xCap;
    const mEff = w.load / 9.80665, cc = 2 * Math.sqrt(w.k * mEff);
    w.cC = w.zeta * cc; w.cR = w.zetaReb * cc;
    w.kt = (cs * w.load) / w.relax;                     // tyre carcass stiffness [N/m]
    w.ct = 1.1 * w.load;                                // low-speed carcass damping [N s/m]
  }
  const mainZ = nr ? zr : 0;
  model.gear = {
    wheels, retractTime: num(cg.retractTime, heavy ? 9 : 5), extendTime: num(cg.extendTime, num(cg.retractTime, heavy ? 9 : 5) * 1.2),
    // nose-wheel steering: full pedal = steerMax at walking pace, reduced with speed so that the commanded turn never
    // exceeds steerLatG of lateral acceleration (kinematic turn: ay = V² tan(delta) / wheelbase)
    steerMax: num(cg.steerMax, heavy ? 70 : 32) * DEG, steerLatAcc: num(cg.steerLatG, heavy ? 0.22 : 0.30) * 9.80665,
    wheelbase: Math.max(1, Math.abs((wheels.find(w => w.steerable) || wheels[0]).pz - mainZ)), steerRate: num(cg.steerRate, heavy ? 40 : 60) * DEG,
    brakeMu: num(cg.brakeMu, 0.45), antiskid: cg.antiskid !== false, rollMu: num(cg.rollingMu, 0.018),
    maxSink: num(cg.maxSinkRate, heavy ? 3.05 : 3.6), crashSink: num(cg.crashSinkRate, heavy ? 6 : 8),
    arrestDecel: num(cg.arrestDecel, 30), catapult: cg.catapult ? { accel: num(cg.catapult.accel, 32), stroke: num(cg.catapult.stroke, 90) } : null,
  };

  // ------------------------------------------------------------------ structure contact points (three-style body axes)
  const st = cfg.structure || {};
  const bellyY = num(st.bellyY, -0.5 * g.cgHeight);
  const tailDeg = num(st.tailStrikeDeg, heavy ? 11 : 14), tz = num(st.tailZ, g.tailZ * 0.86);
  const pts = [];
  pts.push({ name: 'nose', type: 'nose', x: 0, y: num(st.noseY, bellyY * 0.5), z: g.noseZ });
  pts.push({ name: 'tail', type: 'tail', x: 0, y: -g.cgHeight + Math.tan(tailDeg * DEG) * (tz - mainZ) + 0.6 * (wheels.find(w => !w.steerable)?.x0 || 0), z: tz });
  pts.push({ name: 'belly-fwd', type: 'belly', x: 0, y: bellyY, z: g.noseZ * 0.45 });
  pts.push({ name: 'belly-aft', type: 'belly', x: 0, y: bellyY, z: g.tailZ * 0.35 });
  for (const wt of g.wingtips || []) pts.push({ name: 'wingtip', type: 'wingtip', x: wt[0], y: wt[1] - 0.1, z: wt[2] });
  for (const e of g.engines || []) if (Math.abs(e.nozzle[0]) > 1.5 && e.nozzle[1] < 0) {
    const iz = e.intake ? 0.5 * (e.intake[2] + e.nozzle[2]) : e.nozzle[2];
    pts.push({ name: 'nacelle', type: 'nacelle', x: e.nozzle[0], y: e.nozzle[1] - 1.25 * num(e.nozzleRadius, 0.6), z: iz });
  }
  if (Array.isArray(st.points)) for (const p of st.points) pts.push({ name: p.name || p.type, type: p.type || 'belly', x: p.pos[0], y: p.pos[1], z: p.pos[2] });
  model.points = pts;
  model.restBelly = -bellyY;               // origin height above ground when lying on the belly

  // ------------------------------------------------------------------ limits
  const lim = cfg.limits || {};
  model.limits = {
    gMax: num(lim.gMax, num(sp.maxG, heavy ? 2.5 : 9)), gMin: num(lim.gMin, num(sp.minG, heavy ? -1 : -3)),
    vmo: num(lim.vmo, num(sp.maxSpeedSeaLevel, 250)),           // CAS m/s
    mmo: num(lim.mmo, num(sp.maxMach, 0.85)),
    ultimate: num(lim.ultimateFactor, 1.5), overspeedFactor: num(lim.overspeedFactor, 1.25), gearVle: num(lim.gearSpeed, heavy ? 139 : 155),
  };

  // ------------------------------------------------------------------ flight control system
  const f = cfg.fcs || {};
  const ftype = f.type || (heavy ? 'conventional' : 'fbw-fighter');
  const fbwAir = ftype === 'fbw-airliner';
  const gd = f.gearDown || {};
  model.fcs = {
    type: ftype, fbw: ftype !== 'conventional', airliner: fbwAir,
    nzMax: num(f.nzMax, fbwAir ? 2.5 : model.limits.gMax), nzMin: num(f.nzMin, fbwAir ? -1 : model.limits.gMin),
    alphaMax: num(f.alphaMax, heavy ? 14 : 25) * DEG, alphaMin: num(f.alphaMin, heavy ? -6 : -10) * DEG,
    kAlpha: num(f.alphaGain, 2.5), kNz: num(f.nzGain, 1.2), qMax: num(f.pitchRateMax, heavy ? 8 : 60) * DEG,
    wq: num(f.pitchBandwidth, heavy ? 3.5 : 7), wi: num(f.pitchIntegral, heavy ? 1.5 : 3), kpMax: num(f.pitchGainMax, heavy ? 6 : 2.5),
    rollRate: num(f.rollRate, heavy ? 15 : 270) * DEG, wp: num(f.rollBandwidth, heavy ? 3 : 6), kpRollMax: num(f.rollGainMax, heavy ? 4 : 1.2),
    rollAlphaFade: [num(f.rollAlphaFade && f.rollAlphaFade[0], 15) * DEG, num(f.rollAlphaFade && f.rollAlphaFade[1], 30) * DEG],
    gdNz: num(gd.nzMax, 0), gdAlphaMax: num(gd.alphaMax, 0) * DEG, gdRoll: num(gd.rollRate, 0) * DEG, gdQMax: num(gd.pitchRateMax, 0) * DEG,
    bankMax: num(f.bankMax, fbwAir ? 67 : 0) * DEG, bankNeutral: num(f.bankNeutral, fbwAir ? 33 : 0) * DEG,
    pitchMax: num(f.pitchMax, fbwAir ? 30 : 0) * DEG, pitchMin: num(f.pitchMin, fbwAir ? -15 : 0) * DEG,
    stickShape: num(f.stickShape, 0.5),
    // conventional
    feelQ: num(f.feelQ, 4000), feelMin: num(f.feelMin, 0.18), rollFeelQ: num(f.rollFeelQ, 0), trimFollow: num(f.trimFollowUp, ftype === 'conventional' ? 0.25 : 0),
    // yaw axis (all types)
    yawDamper: num(f.yawDamper, 1), wr: num(f.yawBandwidth, 2.5), krMax: num(f.yawGainMax, heavy ? 4 : 2), kBeta: num(f.betaGain, heavy ? 1.5 : 3),
    sasAuthority: num(f.sasAuthority, ftype === 'conventional' ? 0.25 : 1), ari: num(f.ari, 0),
    pedalAuthority: num(f.pedalAuthority, 1), groundPitchGain: num(f.groundPitchGain, 1),
    // rotation assist (weight on wheels): soft pitch-rate and pitch-attitude limits that keep a held-back key off the tail
    groundYaw: f.groundYawAssist !== false,
    rotAssist: f.rotationAssist !== false, rotRate: num(f.rotationRate, heavy ? 3.2 : 9) * DEG, rotPitchMax: num(f.rotationPitchMax, tailDeg - (heavy ? 2.2 : 2.5)) * DEG,
  };

  // ------------------------------------------------------------------ autopilot
  const ap = cfg.autopilot || {};
  model.ap = {
    vsMax: num(ap.vsMax, heavy ? 10 : 40), accMax: num(ap.accelMax, heavy ? 0.15 : 0.5) * 9.80665, kh: num(ap.altGain, heavy ? 0.12 : 0.2), kv: num(ap.vsGain, heavy ? 0.6 : 1.0),
    bankMax: num(ap.bankMax, heavy ? 25 : 45) * DEG, turnRate: num(ap.turnRate, heavy ? 3 : 8) * DEG, kPhi: num(ap.bankGain, heavy ? 1.0 : 2.0),
    pMax: num(ap.rollRateMax, heavy ? 8 : 45) * DEG,
    thrKi: num(ap.throttleKi, 0.012), thrKp: num(ap.throttleKp, 0.06), thrMax: num(ap.throttleMax, 1), disengage: num(ap.stickDisengage, 0.35),
  };

  model.targets = cfg.targets || {};
  model.specs = sp;
  return model;
}

function buildThrustTable(t) {
  // { mach: [..], alt: [..m], mil: [[per alt row: factor vs mach]], ab: [[...]] } — factors relative to sea-level static thrust
  return { mach: t.mach.slice(), alt: t.alt.slice(), mil: t.mil.map(r => r.slice()), ab: t.ab ? t.ab.map(r => r.slice()) : null };
}

/** Bilinear lookup in a thrust table (rows = altitude, columns = Mach). */
export function thrustTableLookup(t, rows, M, h) {
  const ms = t.mach, hs = t.alt, nm = ms.length, nh = hs.length;
  let j = 0; while (j < nm - 2 && M > ms[j + 1]) j++;
  let i = 0; while (i < nh - 2 && h > hs[i + 1]) i++;
  let tm = (M - ms[j]) / (ms[j + 1] - ms[j]); tm = tm < 0 ? 0 : tm > 1 ? 1 : tm;
  let th = (h - hs[i]) / (hs[i + 1] - hs[i]); th = th < 0 ? 0 : th > 1.25 ? 1.25 : th;
  const r0 = rows[i], r1 = rows[i + 1];
  const a = r0[j] + (r0[j + 1] - r0[j]) * tm, b = r1[j] + (r1[j + 1] - r1[j]) * tm;
  const v = a + (b - a) * th;
  return v > 0 ? v : 0;
}
