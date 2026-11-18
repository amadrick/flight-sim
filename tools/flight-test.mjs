// Headless flight-test bench for the Skyward flight model.
//
//   node tools/flight-test.mjs <aircraftId> [--verbose] [--only name[,name]] [--list] [--json]
//
// Flies scripted manoeuvres in node against a mock world (flat runway at 0 m MSL, calm ISA atmosphere) and prints a
// table of measured performance against the targets in src/aircraft/<id>/physics.js (`targets`) and index.js (`specs`).
// Exit code 1 if any check fails. This is the tool to tune a new aircraft config with — see src/physics/SCHEMA.md.
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const id = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--only');
const verbose = args.includes('--verbose');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
if (!id) { console.log('usage: node tools/flight-test.mjs <aircraftId> [--verbose] [--only test[,test]] [--list] [--json]'); process.exit(2); }
if (!existsSync(resolve(root, `src/aircraft/${id}/index.js`))) { console.log(`unknown aircraft "${id}" (no src/aircraft/${id}/index.js)`); process.exit(2); }

// Aircraft visuals may touch the DOM at import time in later versions — give them inert stand-ins.
globalThis.window ??= globalThis;
globalThis.document ??= { createElement: () => ({ getContext: () => null, style: {} }), body: {}, addEventListener() {} };

const imp = (p) => import(pathToFileURL(resolve(root, p)).href);
const { createSim, isaAtmosphere, machFromCas } = await imp('src/physics/index.js');
const { createMockContext, makeInit } = await imp('src/physics/testing.js');
const def = (await imp(`src/aircraft/${id}/index.js`)).default;

const DEG = Math.PI / 180, KT = 0.514444, G0 = 9.80665;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrapPi = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
const tasFromCas = (cas, alt) => { const a = isaAtmosphere(alt); return machFromCas(cas, a.p) * a.a; };
const sp = def.specs;

// ---------------------------------------------------------------------------------------------------------------------
function flight(init, opts = {}) {
  const ctx = createMockContext(opts);
  const sim = createSim(ctx, def, makeInit(init));
  const c = ctx.controls, s = sim.state;
  const fl = {
    ctx, sim, s, c, t: 0,
    cmd(name) { ctx.events.emit('cmd', { name }); },
    /** run for `seconds`; fn(t, dt) may set controls and return true to stop early */
    run(seconds, fn, dt = 1 / 60) {
      const n = Math.round(seconds / dt);
      for (let i = 0; i < n; i++) {
        if (fn && fn(fl.t, dt) === true) return true;
        sim.step(dt, c); fl.t += dt;
        if (!isFinite(s.position.x + s.position.y + s.position.z + s.velocity.x + s.velocity.y + s.velocity.z + s.quaternion.x + s.quaternion.w)) { fl.nan = true; return true; }
      }
      return false;
    },
    events(name) { return ctx.log.filter((e) => e.name === name); },
    crashed() { return s.crashed ? s.crashReason : ''; },
  };
  return fl;
}
const T = def.physics.targets || {};
const fbw = (def.physics.fcs && def.physics.fcs.type || '').startsWith('fbw') || (!def.physics.fcs && def.category !== 'airliner');

/** Simple "pilot": hold a pitch attitude with the stick. */
function pitchPilot(fl, thetaCmd) {
  const s = fl.s, e = thetaCmd - s.pitch;
  fl.c.pitch = fbw ? clamp(5 * e - 0.3 * s.bodyRates.q, -1, 1) : clamp(4.5 * e - 2.2 * s.bodyRates.q, -1, 1);
}
function wingsLevel(fl, bank = 0) { fl.c.roll = clamp(2.5 * (bank - fl.s.roll) - 0.6 * fl.s.bodyRates.p, -1, 1); }

const rows = [];
function row(test, name, value, unit, target, tol, opts = {}) {
  // tol: fraction (0.1 = ±10 %) unless opts.abs; opts.min / opts.max = one-sided limits; opts.info = no pass/fail
  let pass = null, tgt = '';
  if (opts.info) { pass = null; }
  else if (opts.max !== undefined) { pass = value <= opts.max; tgt = `<= ${fmt(opts.max)}`; }
  else if (opts.min !== undefined) { pass = value >= opts.min; tgt = `>= ${fmt(opts.min)}`; }
  else if (typeof target === 'boolean' || typeof target === 'string') { pass = value === target; tgt = String(target); }
  else if (target !== undefined && target !== null) {
    const band = opts.abs ? tol : Math.abs(target) * tol;
    pass = Math.abs(value - target) <= band; tgt = `${fmt(target)} ±${opts.abs ? fmt(tol) : Math.round(tol * 100) + '%'}`;
  }
  rows.push({ test, name, value, unit, target: tgt, pass, note: opts.note || '' });
}
const fmt = (v) => (typeof v !== 'number' ? String(v) : Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 10 ? v.toFixed(2) : v.toFixed(3));
const log = (...a) => { if (verbose) console.log('   ', ...a); };

// ---------------------------------------------------------------------------------------------------------------------
const tests = {
  rest() {
    const fl = flight({ onGround: true });
    const s = fl.s, p0 = s.position.clone(), q0 = s.quaternion.clone();
    let vmax = 0, dmax = 0, amax = 0;
    fl.run(30, () => { vmax = Math.max(vmax, s.velocity.length()); dmax = Math.max(dmax, s.position.distanceTo(p0)); amax = Math.max(amax, s.quaternion.angleTo(q0)); });
    row('rest', 'drift in 30 s (brakes off, idle)', dmax * 1000, 'mm', null, null, { max: 5 });
    row('rest', 'max speed at rest', vmax * 1000, 'mm/s', null, null, { max: 1 });
    row('rest', 'attitude change', amax / DEG, 'deg', null, null, { max: 0.02 });
    row('rest', 'height error vs geometry.cgHeight', Math.abs(s.position.y - def.geometry.cgHeight) * 1000, 'mm', null, null, { max: 15 });
    row('rest', 'load factor at rest', s.gLoad, 'g', 1, 0.005);
    // parking brake + full power run-up must hold on airliners / creep or hold on fighters; crosswind must not move it
    const f2 = flight({ onGround: true }, { wind: [12, 0, 0] });
    const p1 = f2.s.position.clone(); let d2 = 0;
    f2.run(20, () => { d2 = Math.max(d2, f2.s.position.distanceTo(p1)); });
    row('rest', 'drift in 20 s, 12 m/s crosswind', d2 * 1000, 'mm', null, null, { max: 30 });
  },

  takeoff() {
    const fl = flight({ onGround: true });
    const s = fl.s, c = fl.c, x0 = s.position.clone();
    const vr = T.rotateSpeed || sp.rotateSpeed, rotPitch = (T.rotatePitch ?? (fbw ? 10 : 8.5)) * DEG, climbPitch = (T.climbPitch ?? (fbw ? 14 : 13)) * DEG;
    let liftDist = 0, liftSpeed = 0, liftTime = 0, d35 = 0, t35 = 0, rotating = false, airborne = false, maxPitchGround = 0, tail = false;
    c.throttle = 1;
    fl.run(120, (t) => {
      if (!rotating && s.ias >= vr) rotating = true;
      if (rotating) pitchPilot(fl, airborne ? climbPitch : rotPitch);
      if (airborne) wingsLevel(fl);
      if (s.tailStrike) tail = true;
      if (!airborne && !s.onGround && s.agl > 0.3) { airborne = true; liftDist = s.position.distanceTo(x0); liftSpeed = s.ias; liftTime = t; }
      if (!airborne) maxPitchGround = Math.max(maxPitchGround, s.pitch);
      if (airborne && s.agl > 5 && s.surfaces.gear === 1) fl.cmd('gearToggle');
      if (airborne && !d35 && s.agl >= 10.7) { d35 = Math.hypot(s.position.x - x0.x, s.position.z - x0.z); t35 = t; }
      if (verbose && Math.round(t * 60) % 60 === 0) log(`t=${t.toFixed(0)} ias=${s.ias.toFixed(1)} pitch=${(s.pitch / DEG).toFixed(1)} agl=${s.agl.toFixed(1)} n1=${s.engines[0].n1.toFixed(2)} thr=${(s.engines[0].thrust / 1000).toFixed(0)}kN`);
      return s.crashed || (airborne && s.agl > 150);
    });
    row('takeoff', 'ground roll (max power)', liftDist, 'm', T.takeoffRoll?.[0], T.takeoffRoll?.[1] ?? 0.3);
    row('takeoff', 'lift-off speed', liftSpeed, 'm/s', vr * 1.08, 0.12, { note: `rotate at ${vr} m/s` });
    row('takeoff', 'time to lift-off', liftTime, 's', null, null, { info: true });
    row('takeoff', 'distance to 35 ft', d35, 'm', null, null, { info: true });
    row('takeoff', 'pitch at lift-off', maxPitchGround / DEG, 'deg', null, null, { info: true });
    row('takeoff', 'no tail strike / crash', !tail && !s.crashed, '', true, null, { note: s.crashReason });
    row('takeoff', 'gear retracted after lift-off', s.surfaces.gear < 1, '', true);
  },

  climb() {
    // specific excess power at sea level at the climb speed == steady rate of climb at that speed.
    // Level acceleration from 0.7 V at max power (engines fully spooled by then), energy rate measured through V.
    const V = T.climbSpeed || sp.cruiseSpeed * 0.6;
    const fl = flight({ alt: 300, speed: V * 0.7 });
    const s = fl.s; fl.cmd('apAltHold'); fl.cmd('apHdgHold'); fl.c.throttle = 1;
    const hist = []; let ps = 0, thr = 0;
    const energy = () => s.altitude + s.velocity.lengthSq() / (2 * G0);
    fl.run(120, (t) => {
      hist.push(energy()); if (hist.length > 31) hist.shift();
      if (s.tas >= V + 0.5 * (hist.length > 1 ? (s.tas - V) * 0 : 0) && hist.length === 31 && s.tas >= V) { ps = (hist[30] - hist[0]) / 0.5; thr = s.engines.reduce((a, e) => a + e.thrust, 0); return true; }
      return s.crashed;
    });
    row('climb', `rate of climb, sea level, ${V.toFixed(0)} m/s, max power`, ps, 'm/s', T.climbRate?.[0] ?? sp.climbRate, T.climbRate?.[1] ?? 0.3, { note: `${(ps / 0.00508).toFixed(0)} ft/min, thrust ${(thr / 1000).toFixed(0)} kN` });
  },

  maxSpeedSL() {
    const fl = flight({ alt: 300, speed: Math.min(sp.cruiseSpeed, sp.maxSpeedSeaLevel * 0.85) });
    const s = fl.s; fl.cmd('apAltHold'); fl.cmd('apHdgHold'); fl.c.throttle = 1;
    let prevV = s.tas, steady = 0, reachedVmo = 0, vmoT = 0;
    const vmo = fl.sim.model.limits.vmo;
    fl.run(600, (t) => {
      if (Math.round(t * 30) % 30 === 0) {
        const acc = s.tas - prevV; prevV = s.tas;
        steady = Math.abs(acc) < 0.03 ? steady + 1 : 0;
        log(`t=${t.toFixed(0)} M=${s.mach.toFixed(3)} cas=${s.ias.toFixed(1)} acc=${acc.toFixed(2)} alt=${s.altitude.toFixed(0)}`);
      }
      if (!reachedVmo && s.ias >= vmo) { reachedVmo = s.ias; vmoT = t; }
      return steady >= 6 || s.crashed || (T.maxSpeedSLisCas && reachedVmo > 0);
    }, 1 / 30);
    if (T.maxSpeedSLisCas) {
      row('maxSpeedSL', 'reaches VMO in level flight at sea level', reachedVmo, 'm/s CAS', T.maxSpeedSL?.[0] ?? vmo, T.maxSpeedSL?.[1] ?? 0.03, { note: `after ${vmoT.toFixed(0)} s; thrust-limited speed is higher (overspeed warning)` });
    } else {
      row('maxSpeedSL', 'max level speed at sea level', s.mach, 'Mach', T.maxSpeedSL?.[0] ?? sp.maxSpeedSeaLevel / 340.3, T.maxSpeedSL?.[1] ?? 0.06, { note: `${s.ias.toFixed(0)} m/s CAS = ${(s.ias / KT).toFixed(0)} kt` });
    }
    row('maxSpeedSL', 'altitude held by autopilot', Math.abs(s.altitude - s.ap.altitude), 'm', null, null, { max: 30 });
    row('maxSpeedSL', 'no structural failure', !s.crashed, '', true, null, { note: s.crashReason });
  },

  maxSpeedAlt() {
    const alt = T.maxSpeedAltitude || 11000, a = isaAtmosphere(alt).a;
    const target = T.maxSpeedAlt?.[0] ?? sp.maxMach;
    const fl = flight({ alt, speed: a * Math.max(0.6, target - (target > 1 ? 0.55 : 0.06)) });
    const s = fl.s; fl.cmd('apAltHold'); fl.cmd('apHdgHold'); fl.c.throttle = 1;
    let prevV = s.tas, steady = 0, maxM = 0;
    fl.run(900, (t) => {
      maxM = Math.max(maxM, s.mach);
      if (Math.round(t * 30) % 60 === 0) {
        const acc = (s.tas - prevV) / 2; prevV = s.tas;
        steady = Math.abs(acc) < 0.02 ? steady + 1 : 0;
        log(`t=${t.toFixed(0)} M=${s.mach.toFixed(3)} cas=${s.ias.toFixed(1)} acc=${acc.toFixed(3)} alt=${s.altitude.toFixed(0)} aoa=${(s.aoa / DEG).toFixed(2)} thr=${(s.engines[0].thrust / 1000).toFixed(1)}`);
      }
      return steady >= 5 || s.crashed;
    }, 1 / 30);
    row('maxSpeedAlt', `max level speed at ${alt} m`, s.mach, 'Mach', target, T.maxSpeedAlt?.[1] ?? 0.06, { note: `${(s.ias / KT).toFixed(0)} KCAS, after ${fl.t.toFixed(0)} s` });
    row('maxSpeedAlt', 'altitude held by autopilot', Math.abs(s.altitude - s.ap.altitude), 'm', null, null, { max: 60 });
    row('maxSpeedAlt', 'no structural failure', !s.crashed, '', true, null, { note: s.crashReason });
  },

  ceiling() {
    const alt = T.ceiling || sp.serviceCeiling, a = isaAtmosphere(alt).a;
    const M = T.ceilingMach || (sp.maxMach > 1.2 ? 0.92 : Math.min(0.78, sp.maxMach - 0.04));
    const fl = flight({ alt, speed: a * M });
    const s = fl.s; fl.cmd('apAltHold'); fl.cmd('apHdgHold'); fl.c.throttle = 1;
    fl.run(15);
    const E0 = s.altitude + s.velocity.lengthSq() / (2 * G0); fl.run(6);
    const ps = (s.altitude + s.velocity.lengthSq() / (2 * G0) - E0) / 6;
    row('ceiling', `excess power at service ceiling ${alt} m, M${M.toFixed(2)}`, ps, 'm/s', null, null, { min: 0.5, note: 'service ceiling = 100 ft/min left' });
    row('ceiling', 'trimmed AoA at ceiling', fl.sim.trim.alpha / DEG, 'deg', null, null, { info: true });
  },

  stall() {
    for (const cfg of ['clean', 'landing']) {
      const landing = cfg === 'landing';
      const target = landing ? (T.stallSpeedLanding ?? [sp.stallSpeed, 0.1]) : (T.stallSpeedClean ?? [sp.stallSpeed * 1.25, 0.15]);
      const alt = 1500, v0 = tasFromCas(target[0] * 1.3, alt);
      const fl = flight({ alt, speed: v0, gearDown: landing, flaps: landing ? 1 : 0, extra: { gamma: 0, flapsIndex: landing ? fl0().sim.model.aero.flaps.n - 1 : 0 } });
      const s = fl.s, c = fl.c;
      c.throttle = 0;
      let thetaCmd = s.pitch, vStall = 0, minIas = 1e9, reason = '', maxAoa = 0, broke = false, rollOff = 0, wasStalled = false, vWarn = 0;
      fl.run(120, (t, dt) => {
        // hold altitude by raising the nose: integral pilot on vertical speed and height error
        thetaCmd = clamp(thetaCmd + (-0.012 * s.verticalSpeed - 0.0015 * (s.altitude - alt)) * dt, -0.2, 0.7);
        if (!broke) { pitchPilot(fl, thetaCmd + 0.02 * -s.verticalSpeed); wingsLevel(fl); }
        minIas = Math.min(minIas, s.ias); maxAoa = Math.max(maxAoa, s.aoa);
        if (!vWarn && s.stallWarning) vWarn = s.ias;
        if (!vStall) {
          if (s.stalled) { vStall = s.ias; reason = 'stall break'; broke = true; }
          else if (t > 4 && fbw && fl.sim.debug.fcs.alphaProt && s.verticalSpeed < -1.5) { vStall = s.ias; reason = 'AoA limiter, cannot hold altitude'; broke = true; }
        }
        if (broke) { c.pitch = 1; c.roll = 0; rollOff = Math.max(rollOff, Math.abs(s.roll)); if (s.stalled) wasStalled = true; }
        if (verbose && Math.round(t * 60) % 120 === 0) log(`${cfg} t=${t.toFixed(0)} cas=${s.ias.toFixed(1)} aoa=${(s.aoa / DEG).toFixed(1)} pitch=${(s.pitch / DEG).toFixed(1)} vs=${s.verticalSpeed.toFixed(1)} stick=${c.pitch.toFixed(2)} g=${s.gLoad.toFixed(2)} ${s.stallWarning ? 'WARN' : ''} ${s.stalled ? 'STALL' : ''}`);
        return s.crashed || (broke && t > 8 && fl.t - t > 0) || (broke && (fl._tb = (fl._tb || 0) + dt) > 6);
      });
      row('stall', `${landing ? 'landing config' : 'clean'} stall / minimum speed`, vStall, 'm/s CAS', target[0], target[1], { note: `${reason}, AoA ${(maxAoa / DEG).toFixed(1)}°, ${(vStall / KT).toFixed(0)} kt` });
      row('stall', `${landing ? 'landing' : 'clean'}: warning before the stall`, vWarn > vStall && vWarn > 0, '', true, null, { note: `warning at ${vWarn.toFixed(1)} m/s` });
      if (!fbw) row('stall', `${landing ? 'landing' : 'clean'}: roll-off with stick held back 6 s`, rollOff / DEG, 'deg', null, null, { info: true, note: wasStalled ? 'stalled' : '' });
    }
    function fl0() { return flight({ alt: 1000, speed: 150 }); }
  },

  trim() {
    const fl = flight({ alt: 3000, speed: sp.cruiseSpeed * 0.8 });
    const s = fl.s, a0 = s.altitude, v0 = s.ias, h0 = s.heading;
    row('trim', 'trim solver converged', !!fl.sim.trim.converged, '', true);
    let dA = 0, dV = 0, dH = 0, dR = 0, g0 = 0;
    fl.run(0.5, () => { g0 = Math.max(g0, Math.abs(s.gLoad - 1)); });
    fl.run(60, () => { dA = Math.max(dA, Math.abs(s.altitude - a0)); dV = Math.max(dV, Math.abs(s.ias - v0)); dH = Math.max(dH, Math.abs(wrapPi(s.heading - h0))); dR = Math.max(dR, Math.abs(s.roll)); });
    row('trim', 'initial lurch (|g-1| in first 0.5 s)', g0, 'g', null, null, { max: 0.03 });
    row('trim', 'hands-off 60 s: altitude deviation', dA, 'm', null, null, { max: 30 });
    row('trim', 'hands-off 60 s: airspeed deviation', dV, 'm/s', null, null, { max: 2 });
    row('trim', 'hands-off 60 s: heading deviation', dH / DEG, 'deg', null, null, { max: 2 });
    row('trim', 'hands-off 60 s: max bank', dR / DEG, 'deg', null, null, { max: 2 });
  },

  dynamics() {
    // short period: 1 s stick pulse, then release — pitch rate must settle quickly without sustained oscillation
    const fl = flight({ alt: 3000, speed: sp.cruiseSpeed * 0.8 });
    fl.sim.model.fcs.trimFollow = 0;
    const s = fl.s, c = fl.c;
    let peak = 0, cross = 0, lastSign = 0, settle = 0, gPeak = 0;
    fl.run(8, (t) => {
      c.pitch = t > 1 && t < 2 ? 0.3 : 0;
      const q = s.bodyRates.q;
      if (t < 2.2) { peak = Math.max(peak, Math.abs(q)); gPeak = Math.max(gPeak, s.gLoad); }
      else {
        const sg = q > 0.004 ? 1 : q < -0.004 ? -1 : 0;
        if (sg && lastSign && sg !== lastSign) cross++;
        if (sg) lastSign = sg;
        if (Math.abs(q) > 0.1 * peak) settle = t - 2;
      }
    });
    row('dynamics', 'pitch pulse: g reached with 30 % stick for 1 s', gPeak, 'g', null, null, { info: true });
    row('dynamics', 'short period: time to settle within 10 %', settle, 's', null, null, { max: fbw ? 1.5 : 4 });
    row('dynamics', 'short period: pitch-rate reversals after release', cross, '', null, null, { max: 3 });
    // phugoid (stick-fixed aircraft without flight-path hold only): speed disturbance, look at the vertical-speed oscillation
    if (!fbw) {
      const f2 = flight({ alt: 3000, speed: sp.cruiseSpeed * 0.8 });
      f2.sim.model.fcs.trimFollow = 0;
      const s2 = f2.s; s2.velocity.multiplyScalar(1.06);
      const zc = []; let prev = s2.verticalSpeed, peaks = [], lastPeak = 0;
      f2.run(400, (t) => {
        const vs = s2.verticalSpeed;
        if (prev < 0 && vs >= 0) zc.push(t);
        if (Math.abs(vs) > lastPeak) lastPeak = Math.abs(vs);
        if ((prev < 0 && vs >= 0) || (prev > 0 && vs <= 0)) { peaks.push(lastPeak); lastPeak = 0; }
        prev = vs;
      }, 1 / 30);
      const period = zc.length > 2 ? (zc[zc.length - 1] - zc[1]) / (zc.length - 2) : 0;
      const theory = Math.SQRT2 * Math.PI * s2.tas / G0;
      row('dynamics', 'phugoid period', period, 's', theory, 0.3, { note: 'Lanchester estimate √2·π·V/g' });
      const ratio = peaks.length > 4 ? peaks[4] / peaks[2] : 1;
      const zeta = -Math.log(Math.max(ratio, 1e-6)) / (2 * Math.PI);
      row('dynamics', 'phugoid damping ratio', zeta, '', null, null, { min: 0.005, note: 'lightly damped is realistic' });
    }
    // dutch roll / spiral: rudder kick, sideslip must decay
    const f3 = flight({ alt: 3000, speed: sp.cruiseSpeed * 0.8 });
    let bPeak = 0, bEnd = 0;
    f3.run(12, (t) => { f3.c.yaw = t > 1 && t < 1.8 ? 0.6 : 0; if (t < 3) bPeak = Math.max(bPeak, Math.abs(f3.s.beta)); if (t > 10) bEnd = Math.max(bEnd, Math.abs(f3.s.beta)); });
    row('dynamics', 'rudder kick: sideslip remaining after 8 s', bPeak > 0 ? bEnd / bPeak : 0, 'ratio', null, null, { max: 0.15, note: `peak ${(bPeak / DEG).toFixed(1)}°` });
  },

  roll() {
    const V = T.rollSpeed || sp.cruiseSpeed * 0.8, landingCfg = !fbw;
    const fl = flight({ alt: 2000, speed: tasFromCas(V, 2000), gearDown: false, flaps: 0, extra: landingCfg ? { flapsIndex: fl0().sim.model.aero.flaps.landing } : {} });
    const s = fl.s, c = fl.c;
    let pMax = 0, t45 = 0, bMax = 0;
    const bankTarget = fbw ? 90 * DEG : 30 * DEG;
    let turned = 0, prevRoll = 0;
    fl.run(4, (t, dt) => {
      c.roll = t > 0.5 ? 1 : 0;
      pMax = Math.max(pMax, s.bodyRates.p); bMax = Math.max(bMax, Math.abs(s.beta));
      turned += wrapPi(s.roll - prevRoll); prevRoll = s.roll;
      if (!t45 && turned >= bankTarget) t45 = t - 0.5;
      return turned > 2 * Math.PI * 1.5;
    });
    row('roll', `max roll rate at ${V} m/s CAS`, pMax / DEG, 'deg/s', T.rollRate?.[0], T.rollRate?.[1] ?? 0.25);
    row('roll', `time to bank ${(bankTarget / DEG).toFixed(0)}°`, t45, 's', null, null, { max: fbw ? 1.2 : 3.2 });
    row('roll', 'peak sideslip in the roll', bMax / DEG, 'deg', null, null, { max: fbw ? 4 : 8 });
    function fl0() { return flight({ alt: 1000, speed: 150 }); }
    // roll stops when the stick is released (FBW) / spiral is benign (conventional)
    c.roll = 0; fl.run(3);
    row('roll', 'residual roll rate 3 s after release', Math.abs(s.bodyRates.p) / DEG, 'deg/s', null, null, { max: fbw ? 3 : 6 });
  },

  turn() {
    if (T.maxG) {
      // max G and max instantaneous turn rate: roll to 78° and pull fully
      const lim = flight({ alt: 1000, speed: 150 }).sim.model.limits.gMax;
      const pull = (V) => {
        const fl = flight({ alt: 1500, speed: tasFromCas(V, 1500) });
        const s = fl.s, c = fl.c; c.throttle = 1;
        const r = { g: 0, w: 0, aoa: 0, crash: '' };
        fl.run(9, (t) => {
          wingsLevel(fl, t > 1 ? 78 * DEG : 0);
          c.pitch = t > 2.2 ? 1 : 0;
          if (t > 2.2) { r.g = Math.max(r.g, s.gLoad); r.aoa = Math.max(r.aoa, s.aoa); if (t > 3) r.w = Math.max(r.w, (G0 * Math.sqrt(Math.max(0, s.gLoad * s.gLoad - 1))) / s.tas); }
          return s.crashed;
        });
        r.crash = s.crashReason; return r;
      };
      const Vg = T.maxGSpeed || sp.cruiseSpeed, a = pull(Vg);
      if (fbw) {
        row('turn', `max G, full aft stick at ${Vg} m/s CAS`, a.g, 'g', T.maxG[0], T.maxG[1], { note: `AoA ${(a.aoa / DEG).toFixed(1)}°` });
        row('turn', 'G limiter respected (no over-G)', a.g <= lim + 0.5 && !a.crash, '', true, null, { note: a.crash });
      } else row('turn', `max G, full aft column at ${Vg} m/s CAS`, a.g, 'g', null, null, { info: true, note: `limit ${lim} g; AoA ${(a.aoa / DEG).toFixed(1)}° ${a.crash}` });
      if (T.instantTurn?.[0]) { const V = T.instantTurnSpeed || sp.cruiseSpeed, b = pull(V); row('turn', `instantaneous turn rate at ${V} m/s CAS (corner)`, b.w / DEG, 'deg/s', T.instantTurn[0], T.instantTurn[1], { note: `${b.g.toFixed(1)} g, AoA ${(b.aoa / DEG).toFixed(1)}°` }); }
    }
    if (T.sustainedTurn?.[0]) {
      // sustained level turn at constant speed, max power: bank (= load factor) is increased until the speed holds
      const V = T.sustainedTurnSpeed, alt = T.sustainedTurnAltitude ?? 300;
      const fl = flight({ alt, speed: tasFromCas(V, alt) });
      const s = fl.s, c = fl.c; c.throttle = 1;
      let nI = 3, stickI = 0.2, hdgPrev = s.heading, turned = 0, tMeas = 0, gAvg = 0, cnt = 0, altErr = 0, thrAvg = 0, thrI = 1;
      const nMax = fl.sim.model.limits.gMax;
      fl.run(100, (t, dt) => {
        // load factor is raised while the speed is above target (PI); bank follows for a level turn; when the G
        // limit is reached first (G-limited, not thrust-limited) the throttle holds the speed instead
        const ev = s.ias - V;
        nI = clamp(nI + 0.03 * ev * dt, 1.2, nMax);
        const n = clamp(nI + 0.15 * ev, 1.2, nMax);
        if (n >= nMax - 1e-6 && ev > 0) thrI = clamp(thrI - 0.02 * ev * dt, 0.3, 1); else thrI = clamp(thrI + 0.05 * dt, 0.3, 1);
        c.throttle = thrI;
        wingsLevel(fl, clamp(Math.acos(1 / n) + clamp(0.015 * s.verticalSpeed + 0.005 * (s.altitude - alt), -0.3, 0.3), 0, 1.5));
        stickI = clamp(stickI + 0.6 * (n - s.gLoad) * dt, 0, 1);
        c.pitch = clamp(stickI + 0.08 * (n - s.gLoad), 0, 1);
        const dh = wrapPi(s.heading - hdgPrev); hdgPrev = s.heading;
        if (t > 70) { turned += dh; tMeas += dt; gAvg += s.gLoad; thrAvg += c.throttle; cnt++; altErr = Math.max(altErr, Math.abs(s.altitude - alt)); }
        if (verbose && Math.round(t * 60) % 300 === 0) log(`t=${t.toFixed(0)} cas=${s.ias.toFixed(1)} g=${s.gLoad.toFixed(2)} n=${n.toFixed(2)} bank=${(s.roll / DEG).toFixed(0)} alt=${s.altitude.toFixed(0)} aoa=${(s.aoa / DEG).toFixed(1)} stick=${c.pitch.toFixed(2)} thr=${c.throttle.toFixed(2)}`);
        return s.crashed;
      });
      row('turn', `sustained turn rate at ${alt} m, ${V} m/s CAS, max power`, Math.abs(turned / tMeas) / DEG, 'deg/s', T.sustainedTurn[0], T.sustainedTurn[1], { note: `${(gAvg / cnt).toFixed(1)} g, ${s.ias.toFixed(0)} m/s CAS, M${s.mach.toFixed(2)}, alt err ${altErr.toFixed(0)} m${thrAvg / cnt < 0.99 ? ', G-limited (throttle ' + (thrAvg / cnt).toFixed(2) + ')' : ''}` });
    }
    if (!fbw) {
      // airliner: 25° bank level turn under autopilot heading hold
      const fl = flight({ alt: 3000, speed: sp.cruiseSpeed * 0.8 });
      const s = fl.s; fl.cmd('apToggle');
      fl.run(2); fl.sim.debug.ap.hdgRef += 90 * DEG;
      let bank = 0, altDev = 0, betaMax = 0;
      fl.run(110, () => { bank = Math.max(bank, Math.abs(s.roll)); altDev = Math.max(altDev, Math.abs(s.altitude - s.ap.altitude)); betaMax = Math.max(betaMax, Math.abs(s.beta)); });
      row('turn', 'autopilot 90° heading change: max bank', bank / DEG, 'deg', 25, 0.15);
      row('turn', 'autopilot turn: altitude deviation', altDev, 'm', null, null, { max: 25 });
      row('turn', 'autopilot turn: heading captured', Math.abs(wrapPi(s.heading - fl.sim.debug.ap.hdgRef)) / DEG, 'deg', null, null, { max: 1 });
      row('turn', 'autopilot turn: max sideslip', betaMax / DEG, 'deg', null, null, { max: 2.5 });
    }
  },

  glide() {
    const V = T.glideSpeed || sp.cruiseSpeed * 0.5;
    const fl = flight({ alt: 4000, speed: tasFromCas(V, 4000) });
    const s = fl.s, c = fl.c;
    fl.cmd('engineToggle');                                         // all engines off
    fl.sim.model.fcs.trimFollow = 0;
    let theta = s.pitch - 0.05, ld = 0, cnt = 0, ePrev = null, dEmax = -1e9, eh0 = 0, d0 = 0, dist = 0, vAvg = 0;
    fl.run(150, (t, dt) => {
      theta = clamp(theta + 0.0015 * (s.ias - V) * dt, -0.4, 0.3);
      pitchPilot(fl, theta + 0.012 * (s.ias - V)); wingsLevel(fl);
      dist += s.groundSpeed * dt;
      if (Math.abs(t - 70) < dt / 2) { eh0 = s.altitude + s.velocity.lengthSq() / (2 * G0); d0 = dist; }
      if (t > 70) { ld += fl.sim.debug.aero.CL / fl.sim.debug.aero.CD; vAvg += s.ias; cnt++; }
      const E = G0 * s.altitude + 0.5 * s.velocity.lengthSq();
      if (ePrev !== null) dEmax = Math.max(dEmax, (E - ePrev) / dt);
      ePrev = E;
    });
    const drop = eh0 - (s.altitude + s.velocity.lengthSq() / (2 * G0)); dist -= d0;
    row('glide', `aerodynamic L/D at ${V} m/s CAS, clean`, ld / cnt, '', T.glideRatio?.[0], T.glideRatio?.[1] ?? 0.15);
    row('glide', 'engines-out glide ratio (windmilling), energy-corrected', dist / drop, '', null, null, { info: true, note: `sink ${(drop / 80).toFixed(1)} m/s at ${(vAvg / cnt).toFixed(0)} m/s CAS` });
    row('glide', 'energy: max dE/dt, engines off, calm air', dEmax, 'W/kg', null, null, { max: 1e-6, note: 'must never gain energy' });
    // energy sanity under violent manoeuvring, engines off
    const f2 = flight({ alt: 6000, speed: sp.cruiseSpeed * 0.8 });
    f2.cmd('engineToggle');
    let worst = -1e9, e0 = null;
    f2.run(40, (t, dt) => {
      f2.c.pitch = Math.sin(t * 1.3) * 0.9; f2.c.roll = Math.sin(t * 2.1 + 1) * 0.9; f2.c.yaw = Math.sin(t * 0.7) * 0.8; f2.c.speedbrake = t % 10 > 5 ? 1 : 0;
      const E = G0 * f2.s.altitude + 0.5 * f2.s.velocity.lengthSq();
      if (e0 !== null) worst = Math.max(worst, (E - e0) / dt);
      e0 = E;
    });
    row('glide', 'energy: max dE/dt while manoeuvring hard, engines off', worst, 'W/kg', null, null, { max: 1e-6 });
  },

  cruise() {
    const cr = T.cruise; if (!cr) return;
    const a = isaAtmosphere(cr.altitude);
    const fl = flight({ alt: cr.altitude, speed: cr.mach * a.a });
    const s = fl.s; fl.run(5);
    const ff = s.engines.reduce((x, e) => x + e.fuelFlow, 0) * 3600;
    row('cruise', `fuel flow at ${cr.altitude} m, M${cr.mach}`, ff, 'kg/h', cr.fuelFlow?.[0], cr.fuelFlow?.[1] ?? 0.2);
    row('cruise', 'cruise L/D', fl.sim.debug.aero.CL / fl.sim.debug.aero.CD, '', null, null, { info: true, note: `AoA ${(s.aoa / DEG).toFixed(1)}°, N1 ${(s.engines[0].n1 * 100).toFixed(0)} %, lever ${s.throttle.toFixed(2)}` });
    row('cruise', 'specific range', (s.tas * 3.6) / ff, 'km/kg', null, null, { info: true });
    row('cruise', 'trim converged at cruise', !!fl.sim.trim.converged, '', true);
  },

  approach() {
    const v = sp.approachSpeed * 1.08;
    const fl = flight({ alt: 600, speed: v, gearDown: true, flaps: 1 });
    const s = fl.s;
    row('approach', 'trim solver converged', !!fl.sim.trim.converged, '', true);
    const v0 = s.ias; let g0 = 0;
    fl.run(0.5, () => { g0 = Math.max(g0, Math.abs(s.gLoad - Math.cos(3 * DEG))); });
    fl.run(25);
    const gamma = Math.atan2(s.verticalSpeed, s.groundSpeed) / DEG;
    row('approach', 'initial lurch (first 0.5 s)', g0, 'g', null, null, { max: 0.03 });
    row('approach', 'flight-path angle hands-off after 25 s', gamma, 'deg', -3, 0.5, { abs: true });
    row('approach', 'airspeed drift hands-off after 25 s', Math.abs(s.ias - v0), 'm/s', null, null, { max: 2.5 });
    row('approach', 'approach angle of attack', s.aoa / DEG, 'deg', T.approachAoA?.[0], T.approachAoA?.[1] ?? 0.3, { note: `pitch ${(s.pitch / DEG).toFixed(1)}°, N1 ${(s.engines[0].n1 * 100).toFixed(0)} %, lever ${s.throttle.toFixed(2)}` });
    row('approach', 'gear down, landing flap set', s.surfaces.gear === 1 && s.flapsIndex === fl.sim.model.aero.flaps.landing, '', true);
  },

  landing() {
    const v = sp.approachSpeed * 1.08;
    const fl = flight({ alt: 80 + def.geometry.cgHeight, speed: v, gearDown: true, flaps: 1 });
    const s = fl.s, c = fl.c;
    const flareH = fbw ? 5 : 11;
    let td = null, tdPos = null, stopDist = 0, theta = s.pitch, flare = false, tail = false, bounce = 0, tdSpeed = 0, noseDown = 0, maxDecel = 0;
    const thr0 = c.throttle, vref = s.ias;
    fl.run(160, (t, dt) => {
      if (s.tailStrike) tail = true;
      if (!td) {
        if (!flare && s.agl < flareH) { flare = true; theta = s.pitch; }
        if (!flare) { c.throttle = clamp(thr0 + 0.02 * (vref - s.ias), 0, 1); }
        else {
          c.throttle = Math.max(0, c.throttle - dt * 0.5);
          const sinkCmd = -0.5 - 0.3 * Math.max(0, s.agl - 0.5);
          theta = clamp(theta + (fbw ? 0.035 : 0.05) * (sinkCmd - s.verticalSpeed) * dt, -0.05, fbw ? 0.24 : 0.13);
          pitchPilot(fl, theta + (fbw ? 0.01 : 0.02) * (sinkCmd - s.verticalSpeed));
        }
        wingsLevel(fl);
        const e = fl.events('touchdown');
        if (e.length) { td = e[0]; tdPos = s.position.clone(); tdSpeed = s.groundSpeed; }
      } else {
        c.throttle = 0; c.roll = 0;
        c.pitch = fbw ? 0 : -0.1;
        if (s.gear[0].onGround) { c.brakes = 1; if (!noseDown) noseDown = t; }
        if (!s.onGround) bounce = Math.max(bounce, s.agl);
        maxDecel = Math.max(maxDecel, -s.acceleration.dot(s.velocity) / Math.max(1, s.velocity.length()));
        if (s.groundSpeed < 0.5 && !stopDist) stopDist = s.position.distanceTo(tdPos);
        if (s.groundSpeed < 0.005) return true;
      }
      if (verbose && Math.round(t * 60) % 60 === 0) log(`t=${t.toFixed(0)} agl=${s.agl.toFixed(1)} cas=${s.ias.toFixed(1)} vs=${s.verticalSpeed.toFixed(2)} pitch=${(s.pitch / DEG).toFixed(1)} thr=${c.throttle.toFixed(2)} gs=${s.groundSpeed.toFixed(1)} rev=${s.engines[0].reverser.toFixed(1)} spl=${s.surfaces.spoilerL.toFixed(1)} brk=${s.brakes}`);
      return s.crashed;
    });
    const tds = fl.events('touchdown');
    row('landing', 'touchdown sink rate (scripted flare)', td ? td.sinkRate : 99, 'm/s', null, null, { max: fl.sim.model.gear.maxSink, note: td ? `${(td.sinkRate / 0.00508).toFixed(0)} ft/min at ${tdSpeed.toFixed(1)} m/s` : 'no touchdown' });
    row('landing', 'rollout distance, touchdown to stop', stopDist, 'm', T.landingRoll?.[0], T.landingRoll?.[1] ?? 0.35, { note: `peak decel ${(maxDecel / G0).toFixed(2)} g` });
    row('landing', 'bounce height', bounce, 'm', null, null, { max: 0.5 });
    row('landing', 'no crash / tail strike', !s.crashed && !tail, '', true, null, { note: s.crashReason });
    row('landing', 'touchdown events emitted (one per gear unit)', tds.length, '', null, null, { min: def.geometry.gear.length, note: tds.map((e) => `#${e.gear}:${e.sinkRate.toFixed(1)}`).join(' ') });
    // after stopping: stays put
    const p = s.position.clone(); c.brakes = 0; fl.run(10);
    row('landing', 'movement in 10 s after stopping, brakes released', s.position.distanceTo(p) * 1000, 'mm', null, null, { max: 80, note: 'strut rebound only' });
    row('landing', 'speed 10 s after stopping', s.velocity.length() * 1000, 'mm/s', null, null, { max: 1 });
    // hard landing / crash thresholds
    const f2 = flight({ alt: 40 + def.geometry.cgHeight, speed: v, gearDown: true, flaps: 1, extra: { gamma: -9 * DEG } });
    f2.run(20, () => f2.s.crashed || f2.s.onGround);
    row('landing', 'unflared 9° descent is a hard landing / crash', f2.s.crashed || f2.events('touchdown').some((e) => e.hard), '', true, null, { note: f2.s.crashReason || 'hard touchdown flagged' });
    const f3 = flight({ alt: 30 + def.geometry.cgHeight, speed: v, gearDown: false, flaps: 1, extra: { gamma: -2 * DEG } });
    f3.run(40, () => f3.s.crashed);
    row('landing', 'gear-up landing detected', f3.s.crashReason, '', 'Gear-up landing', null);
    f3.run(40);
    row('landing', 'wreck comes to rest', f3.s.velocity.length(), 'm/s', null, null, { max: 0.01 });
  },

  autopilot() {
    const fl = flight({ alt: 4000, speed: sp.cruiseSpeed * 0.85 });
    const s = fl.s, c = fl.c;
    // disturb, then engage: climb at a few m/s in a shallow bank
    fl.run(2, (t) => { c.pitch = 0.12; c.roll = fbw ? 0.07 : 0.3; }); c.pitch = 0; c.roll = 0;
    fl.cmd('apToggle'); fl.run(1 / 60);
    const ref = { ...s.ap };
    let overshoot = 0, gMax = 0;
    fl.run(90, () => { overshoot = Math.max(overshoot, Math.abs(s.altitude - ref.altitude)); gMax = Math.max(gMax, Math.abs(s.gLoad - 1)); });
    row('autopilot', 'engages (ALT + HDG + SPD)', s.ap.engaged && s.ap.autothrottle && s.ap.mode.trim() === 'ALT HDG SPD', '', true, null, { note: s.ap.mode });
    row('autopilot', 'altitude error after 90 s', Math.abs(s.altitude - ref.altitude), 'm', null, null, { max: 5 });
    row('autopilot', 'heading error after 90 s', Math.abs(wrapPi(s.heading - ref.heading)) / DEG, 'deg', null, null, { max: 0.5 });
    row('autopilot', 'airspeed error after 90 s', Math.abs(s.ias - ref.speed), 'm/s', null, null, { max: 1 });
    row('autopilot', 'capture: peak altitude excursion', overshoot, 'm', null, null, { max: 120 });
    row('autopilot', 'capture: peak |g-1|', gMax, 'g', null, null, { max: fbw ? 1.0 : 0.5 });
    // turbulence: holds within tolerance
    const f2 = flight({ alt: 4000, speed: sp.cruiseSpeed * 0.85 }, { turbulence: 0.4, wind: [8, 0, 3] });
    f2.cmd('apToggle'); let aErr = 0, vErr = 0;
    f2.run(120, (t) => { if (t > 20) { aErr = Math.max(aErr, Math.abs(f2.s.altitude - f2.s.ap.altitude)); vErr = Math.max(vErr, Math.abs(f2.s.ias - f2.s.ap.speed)); } });
    row('autopilot', 'moderate turbulence: max altitude error', aErr, 'm', null, null, { max: 40 });
    row('autopilot', 'moderate turbulence: max airspeed error', vErr, 'm/s', null, null, { max: 6 });
    // stick input disconnects
    f2.c.pitch = 0.8; f2.run(0.2); f2.c.pitch = 0;
    row('autopilot', 'large stick input disconnects ALT/HDG', !f2.s.ap.altHold && !f2.s.ap.hdgHold, '', true);
  },

  robustness() {
    // random control thrash with big / irregular frame times, wind and severe turbulence: state must stay finite
    let bad = 0, recov = 0, runs = 0;
    const starts = [{ onGround: true }, { alt: 2000, speed: sp.cruiseSpeed * 0.7 }, { alt: 300, speed: sp.approachSpeed * 1.1, gearDown: true, flaps: 1 }, { alt: 9000, speed: sp.cruiseSpeed }];
    for (const st of starts) for (const dt of [1 / 60, 1 / 20, 0.1]) {
      const fl = flight(st, { turbulence: 1, wind: [14, 0, -9], seed: 7 + runs });
      const rnd = fl.ctx.rng, c = fl.c; let k = 0;
      fl.run(60, (t) => {
        if (k++ % 15 === 0) { c.pitch = rnd() * 2 - 1; c.roll = rnd() * 2 - 1; c.yaw = rnd() * 2 - 1; c.throttle = rnd(); c.brakes = rnd() > 0.7 ? 1 : 0; c.speedbrake = rnd() > 0.5 ? 1 : 0;
          if (rnd() > 0.8) fl.cmd(['gearToggle', 'flapsDown', 'flapsUp', 'apToggle', 'engineToggle', 'hookToggle', 'trimUp'][Math.floor(rnd() * 7)]); }
      }, dt);
      runs++;
      const s = fl.s;
      const vals = [s.position.x, s.position.y, s.position.z, s.velocity.x, s.velocity.y, s.velocity.z, s.quaternion.x, s.quaternion.y, s.quaternion.z, s.quaternion.w, s.tas, s.ias, s.mach, s.aoa, s.beta, s.gLoad, s.mass, s.fuel, s.heading, s.pitch, s.roll, s.agl, s.bodyRates.p, s.bodyRates.q, s.bodyRates.r,
        ...s.engines.flatMap((e) => [e.n1, e.n2, e.thrust, e.fuelFlow, e.egt]), ...Object.values(s.surfaces), ...s.gear.flatMap((g) => [g.compression, g.wheelSpeed, g.steer, g.skid])];
      if (fl.nan || vals.some((v) => typeof v !== 'number' || !isFinite(v))) bad++;
      recov += s.nanRecoveries || 0;
    }
    row('robustness', `runs with non-finite state (of ${runs}: thrash, turbulence, dt up to 0.1 s)`, bad, '', null, null, { max: 0 });
    row('robustness', 'NaN-guard recoveries needed', recov, '', null, null, { max: 0 });
    // time acceleration: 8× at 60 fps (dt = 0.133 s per frame) on autopilot
    const fl = flight({ alt: 5000, speed: sp.cruiseSpeed * 0.85 }); fl.cmd('apToggle');
    fl.run(600, null, 8 / 60);
    row('robustness', '8× time acceleration, 10 min on autopilot: altitude error', Math.abs(fl.s.altitude - fl.s.ap.altitude), 'm', null, null, { max: 10 });
    // determinism
    const run = () => { const f = flight({ alt: 2000, speed: sp.cruiseSpeed * 0.7 }, { turbulence: 0.6, seed: 99 }); f.run(20, (t) => { f.c.pitch = Math.sin(t); f.c.roll = Math.cos(t * 1.7); }); return f.s.position.x + f.s.position.y * 3 + f.s.position.z * 7; };
    row('robustness', 'deterministic for a given seed', run() === run(), '', true);
  },

  performance() {
    const fl = flight({ alt: 2000, speed: sp.cruiseSpeed * 0.8 }, { turbulence: 0.3 });
    fl.run(5);
    let t0 = performance.now(); const N = 6000;
    for (let i = 0; i < N; i++) { fl.c.pitch = Math.sin(i * 0.01) * 0.3; fl.sim.step(1 / 60, fl.c); }
    const air = ((performance.now() - t0) / N) * 1000;
    const f2 = flight({ onGround: true }); f2.c.throttle = 0.3; f2.run(5);
    t0 = performance.now();
    for (let i = 0; i < N; i++) { f2.c.yaw = Math.sin(i * 0.01) * 0.5; f2.c.brakes = i % 600 > 400 ? 1 : 0; f2.sim.step(1 / 60, f2.c); }
    const gnd = ((performance.now() - t0) / N) * 1000;
    row('performance', 'cost of one 16.7 ms frame step, airborne', air, 'µs', null, null, { max: 500 });
    row('performance', 'cost of one 16.7 ms frame step, taxiing', gnd, 'µs', null, null, { max: 500 });
  },
};

if (args.includes('--list')) { console.log(Object.keys(tests).join('\n')); process.exit(0); }

// ---------------------------------------------------------------------------------------------------------------------
const t0 = performance.now();
for (const [name, fn] of Object.entries(tests)) {
  if (only && !only.includes(name)) continue;
  if (verbose) console.log(`-- ${name}`);
  try { fn(); } catch (e) { rows.push({ test: name, name: 'test threw: ' + (e && e.stack || e), value: NaN, unit: '', target: '', pass: false, note: '' }); }
}

if (args.includes('--json')) { console.log(JSON.stringify(rows, null, 1)); process.exit(rows.some((r) => r.pass === false) ? 1 : 0); }

const m = (createSimModel()).mass;
function createSimModel() { return flight({ alt: 1000, speed: sp.cruiseSpeed }).sim.model; }
console.log(`\nFLIGHT TEST — ${def.name} (${id})   mass ${m.refMass.toFixed(0)} kg (empty ${m.empty}, payload ${m.payload}, fuel ${m.fuelInit}/${m.fuelCap})   ISA, calm, runway at 0 m`);
const W = [12, 58, 12, 9, 16, 6];
const line = (cells) => cells.map((c, i) => (i === 2 ? String(c).padStart(W[i]) : String(c).padEnd(W[i]))).join(' ');
console.log(line(['test', 'measurement', 'value', ' unit', 'target', 'result']) + ' note');
console.log('-'.repeat(132));
let fail = 0, passN = 0;
for (const r of rows) {
  const val = typeof r.value === 'boolean' ? (r.value ? 'yes' : 'no') : typeof r.value === 'number' ? fmt(r.value) : String(r.value);
  const res = r.pass === null ? '  -' : r.pass ? 'PASS' : 'FAIL';
  if (r.pass === false) fail++; else if (r.pass) passN++;
  console.log(line([r.test, r.name.slice(0, W[1]), val, ' ' + r.unit, r.target, res]) + ' ' + r.note);
}
console.log('-'.repeat(132));
console.log(`${passN} passed, ${fail} failed, ${rows.length - passN - fail} informational   (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
