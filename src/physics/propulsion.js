// Turbofan / turbojet propulsion: thrust lapse with Mach and altitude, spool dynamics, afterburner, reversers,
// fuel flow, EGT, start/shutdown. Pure functions over a per-engine state record; no allocation in the step loop.
import { normalShockRecovery } from './atmosphere.js';
import { thrustTableLookup } from './config.js';

export function createEngineState() {
  return { running: true, starting: false, startT: 0, x: 0, n1: 0, n2: 0, ab: 0, rev: 0, revCmd: false, nozzle: 0, egt: 15, thrust: 0, gross: 0, ff: 0, vec: 0, failed: false };
}

/** Available thrust factors (relative to sea-level static) at Mach M, temperature ratio theta, pressure ratio delta. */
export function thrustLapse(E, M, theta, delta, alt, out) {
  if (E.table) {
    out.mil = thrustTableLookup(E.table, E.table.mil, M, alt);
    out.ab = E.table.ab ? thrustTableLookup(E.table, E.table.ab, M, alt) : out.mil;
    return out;
  }
  const r = 1 + 0.2 * M * M, theta0 = theta * r;
  let rec = 1;
  if (M > 1) rec = E.inlet === 'pitot' ? normalShockRecovery(M) : 1 - 0.075 * Math.pow(M - 1, 1.35);
  let delta0 = delta * r * r * r * Math.sqrt(r) * rec;
  if (E.altLapse !== 1) delta0 *= Math.pow(delta, E.altLapse - 1);
  const over = theta0 > E.TR ? theta0 - E.TR : 0;
  let mil, ab;
  if (E.hb) {                       // high-bypass turbofan (Mattingly)
    mil = 1 - E.machLapse * Math.sqrt(M) - (3 * over) / (1.5 + M); ab = mil;
  } else if (E.tj) {                // afterburning turbojet
    mil = 1 - 0.16 * Math.sqrt(M) - (24 * over) / ((9 + M) * theta0);
    ab = 1 - 0.3 * (theta0 - 1) - 0.1 * Math.sqrt(M) - (1.5 * over) / theta0;
  } else {                          // low-bypass mixed-flow turbofan
    mil = 1 - (3.8 * over) / theta0 - E.machLapse * Math.sqrt(M); ab = 1 - (3.5 * over) / theta0 - E.machLapse * Math.sqrt(M);
  }
  if (E.mMax > 0 && M > E.mMax) { const k = 1 - 4 * (M - E.mMax); mil *= k > 0 ? k : 0; ab *= k > 0 ? k : 0; }
  out.mil = mil > 0 ? mil * delta0 : 0; out.ab = ab > 0 ? ab * delta0 : 0;
  return out;
}

/** Put an engine in the steady state for a lever position (used by the trim solver and on reset). */
export function setEngineSteady(E, e, lever, running = true) {
  e.running = running; e.starting = false; e.failed = false; e.rev = 0; e.revCmd = false; e.vec = 0;
  if (!running) { e.x = 0; e.n1 = 0; e.n2 = 0; e.ab = 0; e.nozzle = 0; e.egt = 15; return; }
  const dry = E.hasAb ? Math.min(1, lever / 0.9) : lever, abCmd = E.hasAb ? Math.max(0, (lever - 0.9) / 0.1) : 0;
  e.x = dry < 0 ? 0 : dry > 1 ? 1 : dry;
  e.ab = abCmd > 0 && e.x > 0.92 ? E.abMin + (1 - E.abMin) * Math.min(1, abCmd) : 0;
  e.n1 = E.n1Idle + (1 - E.n1Idle) * e.x; e.n2 = E.n2Idle + (1 - E.n2Idle) * Math.pow(e.x, 0.55);
  e.egt = E.egtIdle + (E.egtMil - E.egtIdle) * Math.pow(e.x, 0.7) + (E.egtAb - E.egtMil) * e.ab;
  e.nozzle = nozzleTarget(E, e);
}

function nozzleTarget(E, e) {
  if (!E.hasAb) return 0;
  if (e.ab > 0) return 0.3 + 0.7 * e.ab;
  const t = (e.x - 0.1) / 0.5; return 0.55 * (1 - (t < 0 ? 0 : t > 1 ? 1 : t));
}

/** Thrust [N] (signed along the nozzle axis) and fuel flow for the current engine state. Writes e.thrust, e.gross, e.ff. */
export function engineOutput(E, e, lap, M, theta, delta, qbar) {
  if (!e.running || e.starting) {
    const drag = -0.12 * qbar * Math.PI * E.radius * E.radius;       // windmilling drag
    e.gross = 0; e.thrust = drag; e.ff = e.starting && e.startT > 0.3 * E.startTime ? E.idleFuel * 0.6 : 0;
    return e.thrust;
  }
  const tf = Math.pow(e.x, E.thrustExp);
  let idle = E.tMil * E.idleThrust * delta * (1 - 1.5 * M);
  const milT = E.tMil * lap.mil;
  const dryT = idle * (1 - tf) + milT * tf;
  const abT = e.ab > 0 ? e.ab * (E.tAb * lap.ab - milT) : 0;
  const T = dryT + (abT > 0 ? abT : 0);
  const st = Math.sqrt(theta);
  const sfc = (E.tsfc0 + E.tsfc1 * M) * st;
  let ff = sfc * (dryT > 0 ? dryT : 0);
  if (abT > 0) { const sfcAb = (E.tsfcAb0 + E.tsfcAb1 * M) * st; const inc = sfcAb * E.tAb * lap.ab - sfc * milT; ff += e.ab * (inc > 0 ? inc : 0); }
  const idleFF = E.idleFuel * (0.35 + 0.65 * delta);
  e.ff = ff > idleFF ? ff : idleFF;
  e.gross = T;
  e.thrust = E.reverser && e.rev > 0 ? T * (1 - (1 + E.reverser.frac) * e.rev) : T;
  return e.thrust;
}

/** Advance spool / afterburner / reverser / EGT dynamics by dt for the given lever (0..1). */
export function stepEngine(E, e, dt, lever, tambC, mach, vecCmd) {
  let dry = E.hasAb ? lever / 0.9 : lever; dry = dry < 0 ? 0 : dry > 1 ? 1 : dry;
  let abCmd = E.hasAb ? (lever - 0.9) / 0.1 : 0; abCmd = abCmd < 0 ? 0 : abCmd > 1 ? 1 : abCmd;
  let egtT = tambC;
  if (e.running) {
    if (e.starting) {
      e.startT += dt;
      const t = e.startT / E.startTime, sm = t >= 1 ? 1 : t * t * (3 - 2 * t);
      e.n2 += (E.n2Idle * sm - e.n2) * Math.min(1, dt * 3); e.n1 += (E.n1Idle * (t < 0.3 ? 0.15 * t / 0.3 : 0.15 + 0.85 * (t - 0.3) / 0.7) - e.n1) * Math.min(1, dt * 3);
      e.x = 0; e.ab = 0;
      egtT = t > 0.3 ? E.egtIdle * (1 + 0.5 * Math.sin(Math.PI * Math.min(1, (t - 0.3) / 0.5))) : tambC;
      if (t >= 1) { e.starting = false; e.n1 = E.n1Idle; e.n2 = E.n2Idle; }
    } else {
      const target = e.revCmd && E.reverser ? E.reverser.n1 : dry;
      const up = (1.19 / E.spoolUp) * (0.35 + 1.3 * e.x), dn = (1.25 / E.spoolDown) * (0.45 + 0.8 * e.x);
      let d = (target - e.x) * 5; if (d > up) d = up; else if (d < -dn) d = -dn;
      e.x += d * dt; if (e.x < 0) e.x = 0; else if (e.x > 1) e.x = 1;
      e.n1 = E.n1Idle + (1 - E.n1Idle) * e.x; e.n2 = E.n2Idle + (1 - E.n2Idle) * Math.pow(e.x, 0.55);
      const abT = abCmd > 0 && e.x > 0.92 && !e.revCmd ? E.abMin + (1 - E.abMin) * abCmd : 0;
      const ar = dt / E.abTime;
      if (abT > e.ab) e.ab = Math.min(abT, e.ab + (e.ab < E.abMin ? 3 * ar : ar)); else e.ab = Math.max(abT, e.ab - 2.5 * ar);
      egtT = E.egtIdle + (E.egtMil - E.egtIdle) * Math.pow(e.x, 0.7) + (E.egtAb - E.egtMil) * e.ab;
    }
  } else {
    const wm = Math.min(0.28, 0.45 * mach);              // windmilling
    e.x = 0; e.ab = 0;
    e.n1 += (wm - e.n1) * Math.min(1, dt / 3.5); e.n2 += (wm * 0.7 - e.n2) * Math.min(1, dt / 5);
  }
  e.egt += (egtT - e.egt) * Math.min(1, dt / (e.running ? 1.8 : 14));
  if (E.reverser) {
    const rt = e.revCmd && e.running ? 1 : 0, rr = dt / E.reverser.time;
    e.rev = rt > e.rev ? Math.min(rt, e.rev + rr) : Math.max(rt, e.rev - rr);
  }
  const nt = e.running ? nozzleTarget(E, e) : 0.5 * (E.hasAb ? 1 : 0);
  e.nozzle += Math.max(-2.5 * dt, Math.min(2.5 * dt, nt - e.nozzle));
  if (E.vectoring) { const m = E.vectoring.rate * dt, t = vecCmd * E.vectoring.max; e.vec += Math.max(-m, Math.min(m, t - e.vec)); }
}
