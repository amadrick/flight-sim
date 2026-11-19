// Unit tests for the flight-dynamics engine (node --test). Performance numbers and the tuned handling of each aircraft
// are covered by tools/flight-test.mjs; these tests pin the engine's contracts and exercise every config-driven path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSim, isaAtmosphere, casFromMach, machFromCas, resolveConfig } from './index.js';
import { createAeroIn, createAeroOut, computeAero } from './aero.js';
import { createMockContext, makeInit } from './testing.js';
import f16 from '../aircraft/f16/index.js';
import b738 from '../aircraft/b738/index.js';

const DEG = Math.PI / 180;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);

/** Deep-merge a patch into an aircraft definition's physics config (arrays and scalars are replaced). */
function variant(def, patch, extra = {}) {
  const merge = (a, b) => {
    if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
    const o = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
    for (const k of Object.keys(b)) o[k] = merge(o[k], b[k]);
    return o;
  };
  return { ...def, ...extra, physics: merge(def.physics, patch) };
}
function fly(def, init, opts) {
  const ctx = createMockContext(opts);
  const sim = createSim(ctx, def, makeInit(init));
  const run = (sec, fn, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) { if (fn && fn(t, dt) === true) break; sim.step(dt, ctx.controls); } };
  return { ctx, sim, s: sim.state, c: ctx.controls, run, ev: (n) => ctx.log.filter((e) => e.name === n) };
}
function finite(s) {
  for (const v of [s.position.x, s.position.y, s.position.z, s.velocity.x, s.velocity.y, s.velocity.z, s.quaternion.x, s.quaternion.w,
    s.ias, s.tas, s.mach, s.aoa, s.beta, s.gLoad, s.pitch, s.roll, s.heading, s.fuel, s.mass]) if (!Number.isFinite(v)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------- atmosphere
test('ISA atmosphere matches the 1976 standard', () => {
  const a0 = isaAtmosphere(0);
  close(a0.T, 288.15, 1e-6); close(a0.p, 101325, 1e-3); close(a0.rho, 1.225, 1e-4); close(a0.a, 340.294, 0.01);
  const a11 = isaAtmosphere(11000);
  close(a11.T, 216.77, 0.1); close(a11.p, 22700, 60); close(a11.rho, 0.3648, 0.002);
  const a20 = isaAtmosphere(20000);
  close(a20.T, 216.65, 0.1); close(a20.p, 5529, 30);
  const a30 = isaAtmosphere(30000);
  close(a30.T, 226.5, 0.5); close(a30.p, 1197, 15);
  const a48 = isaAtmosphere(48500);
  close(a48.T, 270.65, 0.01);
  let prev = Infinity;
  for (let h = -500; h <= 80000; h += 500) { const a = isaAtmosphere(h); assert.ok(a.p < prev && a.p > 0 && a.rho > 0 && a.T > 150 && a.a > 250); prev = a.p; }
  const out = {}; assert.equal(isaAtmosphere(1000, out), out);
});

test('CAS <-> Mach conversions are consistent, including supersonic', () => {
  close(casFromMach(0.5, 101325), 0.5 * 340.294, 0.01);
  for (const h of [0, 5000, 11000, 15000]) for (const M of [0.2, 0.6, 0.85, 1.3, 2.0]) {
    const p = isaAtmosphere(h).p; close(machFromCas(casFromMach(M, p), p), M, 2e-3, `M${M} at ${h} m`);
  }
  assert.ok(casFromMach(0.8, isaAtmosphere(11000).p) < 0.8 * 340.294 * 0.6);       // CAS << TAS at altitude
});

// ---------------------------------------------------------------------------------------------------------- config / aero
test('config resolves with sensible values for both aircraft and for an empty config', () => {
  for (const def of [f16, b738, { ...b738, physics: {} }, { ...f16, physics: { stub: true } }]) {
    const m = resolveConfig(def);
    assert.ok(m.mass.refMass > m.mass.empty && m.mass.ixx > 0 && m.mass.iyy > 0 && m.mass.izz > 0);
    assert.equal(m.engines.length, def.specs.engineCount);
    assert.equal(m.gear.wheels.length, def.geometry.gear.length);
    for (const w of m.gear.wheels) assert.ok(w.load > 0 && w.k > 0 && w.gasL > w.x0 && w.travel >= w.xCap);
    const sum = m.gear.wheels.reduce((a, w) => a + w.load, 0); close(sum, m.mass.refMass * 9.80665, 1, 'static gear loads');
    for (const t of [m.aero.tCla, m.aero.tClmax, m.aero.tCd0, m.aero.tK, m.aero.tCtrl]) for (const v of t) assert.ok(Number.isFinite(v) && v > 0);
    assert.ok(m.points.some((p) => p.type === 'tail') && m.points.some((p) => p.type === 'belly'));
  }
});

test('lift curve: peak CL equals the configured clMax per flap detent, then stalls', () => {
  for (const def of [f16, b738]) {
    const m = resolveConfig(def), A = m.aero, i = createAeroIn(), o = createAeroOut();
    for (let d = 0; d < A.flaps.n; d++) {
      let best = 0, at = 0, deep = 0;
      for (let a = 0; a <= 60; a += 0.25) {
        Object.assign(i, { u: 60 * Math.cos(a * DEG), v: 0, w: 60 * Math.sin(a * DEG), p: 0, q: 0, r: 0, rho: 1.225, a: 340, de: 0, da: 0, dr: 0, trim: 0,
          flap: A.flaps.pos[d], slat: m.slatAuto ? 1 : A.flaps.slat[d], spL: 0, spR: 0, sb: 0, gear: 0, sweep: 0, hWing: 1000, nBuffet: 0, nDrop: 0, drSplit: 0 });
        computeAero(A, i, o);
        if (o.CL > best && a < 35) { best = o.CL; at = a; }
        if (a === 45) deep = o.CL;
      }
      close(best, A.flaps.clMax[d], 0.05, `${def.id} detent ${d} CLmax`);
      assert.ok(at > 8 && at < 35, `${def.id} stall angle ${at}`);
      assert.ok(deep < best, 'lift falls after the stall');
    }
  }
});

test('aero: drag is always dissipative and symmetric flight has no lateral forces', () => {
  const m = resolveConfig(f16), i = createAeroIn(), o = createAeroOut();
  for (let a = -90; a <= 180; a += 7) for (const M of [0.2, 0.9, 1.6]) {
    const V = M * 340;
    Object.assign(i, { u: V * Math.cos(a * DEG), v: 0, w: V * Math.sin(a * DEG), p: 0, q: 0, r: 0, rho: 0.9, a: 340, de: 0, da: 0, dr: 0, trim: 0, flap: 0, slat: 0,
      spL: 0, spR: 0, sb: 0, gear: 0, sweep: 0, hWing: 1000, nBuffet: 0, nDrop: 0, drSplit: 0 });
    computeAero(m.aero, i, o);
    assert.ok(o.X * i.u + o.Y * i.v + o.Z * i.w < 0, `aero force does negative work at alpha ${a}, M ${M}`);
    close(o.Y, 0, 1e-6); close(o.L, 0, 1e-6); close(o.N, 0, 1e-6);
  }
});

// ---------------------------------------------------------------------------------------------------------- start states
test('ground start: settled, static, engines idle, brakes hold', () => {
  for (const def of [f16, b738]) {
    const f = fly(def, { onGround: true, alt: 50 }, { groundHeight: 50 });
    const s = f.s;
    assert.ok(s.onGround && s.surfaces.gear === 1 && !s.crashed);
    close(s.position.y, 50 + def.geometry.cgHeight, 0.25, 'rests at cgHeight above the ground');
    assert.ok(s.engines.every((e) => e.running && e.n1 > 0.15 && e.n1 < 0.75));
    assert.equal(f.c.throttle, 0);
    const p0 = s.position.clone();
    f.c.brakes = 1; f.run(20);
    assert.ok(s.position.distanceTo(p0) < 0.005, `${def.id} moved ${s.position.distanceTo(p0)} m at rest`);
    assert.ok(s.groundSpeed < 1e-3 && Math.abs(s.gLoad - 1) < 0.01);
    assert.ok(s.gear.every((g) => g.onGround && g.compression > 0.3 && g.compression < 0.95));
  }
});

test('air start: trimmed level flight, hands off; approach start: 3 degree descent', () => {
  for (const [def, v] of [[f16, 200], [b738, 130]]) {
    const f = fly(def, { alt: 3000, speed: v, throttle: 0.5 });
    const s = f.s, a0 = s.position.y;
    assert.ok(!s.onGround && s.surfaces.gear === 0);
    assert.ok(f.c.throttle > 0.05 && f.c.throttle < 0.95, 'controls.throttle set to the trimmed lever');
    let gmax = 0; f.run(20, () => { gmax = Math.max(gmax, Math.abs(s.gLoad - 1)); });
    assert.ok(gmax < 0.06, `${def.id} lurch ${gmax} g`);
    close(s.position.y, a0, 25, `${def.id} altitude after 20 s`); close(s.tas, v, 3); close(s.roll, 0, 0.02);
  }
  for (const def of [f16, b738]) {
    const f = fly(def, { alt: 600, speed: def.specs.approachSpeed, gearDown: true, flaps: 1 });
    f.run(15);
    const gamma = Math.atan2(f.s.verticalSpeed, f.s.groundSpeed) / DEG;
    close(gamma, -3, 0.6, `${def.id} approach path`); assert.ok(f.s.surfaces.gear === 1 && f.s.surfaces.flaps > 0.7);
  }
});

test('every AircraftState field is filled with finite, typed values', () => {
  const f = fly(b738, { alt: 2000, speed: 120 }); f.run(1);
  const s = f.s;
  assert.ok(finite(s));
  for (const k of ['altitude', 'agl', 'ias', 'tas', 'mach', 'groundSpeed', 'verticalSpeed', 'aoa', 'beta', 'gLoad', 'heading', 'pitch', 'roll',
    'throttle', 'track', 'gLateral', 'brakes', 'flapsIndex', 'fuel', 'fuelCapacity', 'mass']) assert.ok(Number.isFinite(s[k]), `state.${k}`);
  for (const k of ['onGround', 'parkingBrake', 'stalled', 'stallWarning', 'overspeed', 'overG', 'crashed']) assert.equal(typeof s[k], 'boolean', `state.${k}`);
  for (const k of ['aileronL', 'aileronR', 'elevatorL', 'elevatorR', 'rudder', 'flaps', 'slats', 'spoilerL', 'spoilerR', 'speedbrake', 'gear', 'hook', 'wingSweep', 'canopy', 'nozzlePitch'])
    assert.ok(Number.isFinite(s.surfaces[k]), `surfaces.${k}`);
  assert.equal(s.engines.length, 2);
  for (const e of s.engines) for (const k of ['n1', 'n2', 'egt', 'fuelFlow', 'thrust', 'afterburner', 'nozzle', 'reverser']) assert.ok(Number.isFinite(e[k]), `engine.${k}`);
  assert.equal(s.gear.length, 3);
  assert.ok(Math.abs(s.quaternion.length() - 1) < 1e-9);
  close(s.altitude, s.position.y, 1e-9); close(s.agl, s.position.y - b738.geometry.cgHeight, 0.5);
});

// ---------------------------------------------------------------------------------------------------------- conventions
test('sign conventions: stick, surfaces, body rates', () => {
  const f = fly(f16, { alt: 3000, speed: 220 }); const s = f.s;
  f.c.pitch = 0.4; f.run(1.0);
  assert.ok(s.pitch > 0.1 && s.gLoad > 1.5, 'back stick pitches up');
  assert.ok(s.surfaces.elevatorL > 0, 'elevator + = trailing edge up (nose up)');
  const g = fly(f16, { alt: 3000, speed: 220 });
  g.c.roll = 0.5; g.run(0.6);
  assert.ok(g.s.roll > 0.3, 'right stick rolls right (roll + = right wing down)');
  assert.ok(g.s.bodyRates.p > 0.3);
  const h = fly(b738, { alt: 3000, speed: 130 }); const h0 = h.s.heading;
  h.c.yaw = 0.6; h.run(2.5);
  let dh = h.s.heading - h0; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
  assert.ok(dh > 0.01, 'right pedal yaws the nose right (heading increases)');
  assert.ok(h.s.surfaces.rudder > 0.05);
});

test('heading convention: 0 = north (-Z), 90 = east (+X)', () => {
  const n = fly(f16, { alt: 2000, speed: 200, heading: 0 }); assert.ok(n.s.velocity.z < -190);
  const e = fly(f16, { alt: 2000, speed: 200, heading: Math.PI / 2 }); assert.ok(e.s.velocity.x > 190);
  close(e.s.heading, Math.PI / 2, 0.01);
});

// ---------------------------------------------------------------------------------------------------------- systems / events
test('cmd events drive gear, flaps, autopilot; events are emitted', () => {
  const f = fly(b738, { alt: 1500, speed: 110 }); const s = f.s;
  f.ctx.events.emit('cmd', { name: 'gearToggle' }); f.run(0.1);
  assert.equal(f.ev('gear:moved').length, 1); assert.ok(s.surfaces.gear < 0.5);
  f.run(15); assert.equal(s.surfaces.gear, 1, 'gear travels and locks');
  f.ctx.events.emit('cmd', { name: 'flapsDown' }); f.ctx.events.emit('cmd', { name: 'flapsDown' }); f.run(0.1);
  assert.equal(f.ev('flaps:moved').length, 2);
  f.run(25); assert.ok(s.flapsIndex === 2 && s.surfaces.flaps > 0.2);
  f.ctx.events.emit('cmd', { name: 'apToggle' }); f.run(0.1);
  assert.ok(s.ap.engaged && Number.isFinite(s.ap.altitude) && Number.isFinite(s.ap.heading) && Number.isFinite(s.ap.speed));
  f.ctx.events.emit('cmd', { name: 'apToggle' }); f.run(0.1); assert.ok(!s.ap.engaged);
});

test('gear retraction is refused on the ground; parking brake holds against idle thrust', () => {
  const f = fly(b738, { onGround: true });
  f.sim.command('gearToggle'); f.sim.command('gearUp'); f.run(2);
  assert.ok(f.s.surfaces.gear === 1 && f.ev('gear:moved').length === 0);
  f.sim.command('parkingBrakeToggle'); const p = f.s.position.clone(); f.c.throttle = 0.3; f.run(15);
  assert.ok(f.s.position.distanceTo(p) < 0.05);
});

test('autopilot holds altitude, heading and speed; stick input disconnects it', () => {
  const f = fly(b738, { alt: 3000, speed: 130 }); const s = f.s;
  f.run(1); f.sim.command('apToggle'); f.run(60);
  close(s.position.y, s.ap.altitude, 8); close(s.ias, s.ap.speed, 1.5);
  let dh = s.heading - s.ap.heading; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI; close(dh, 0, 0.02);
  f.c.pitch = 0.8; f.run(0.5); assert.ok(!s.ap.altHold, 'ALT hold drops out when the pilot pulls');
});

test('engine: spool-up lag, afterburner band, fuel burn, shutdown and restart', () => {
  const f = fly(f16, { onGround: true }); const s = f.s, e = s.engines[0];
  f.c.brakes = 1; const n0 = e.n1, fuel0 = s.fuel;
  f.c.throttle = 0.9; f.run(0.5);
  assert.ok(e.n1 < 0.75, 'engine does not jump to power'); f.run(6);
  assert.ok(e.n1 > 0.93 && e.afterburner === 0 && e.n1 > n0);
  const tMil = e.thrust;      // installed static thrust is below the uninstalled rating
  assert.ok(tMil > 0.8 * f16.specs.thrustDry && tMil <= 1.02 * f16.specs.thrustDry, `static military thrust ${tMil}`);
  f.c.throttle = 1; f.c.brakes = 0; f.sim.command('parkingBrakeToggle'); f.run(4);
  assert.ok(e.afterburner > 0.9 && e.thrust > 1.4 * tMil && e.nozzle > 0.5, 'full afterburner');
  assert.ok(s.fuel < fuel0 && e.fuelFlow > 3 && e.egt > 600);
  f.c.throttle = 0; f.sim.command('engineToggle'); f.run(25);
  assert.ok(!e.running && e.n1 < 0.1 && e.thrust < 2000 && e.fuelFlow === 0);
  f.sim.command('engineToggle'); f.run(40);
  assert.ok(e.running && e.n1 > 0.2);
});

test('fuel starvation flames the engines out', () => {
  const f = fly(variant(f16, { mass: { fuel: 30 } }), { alt: 4000, speed: 200 });
  f.c.throttle = 1; f.run(60);
  assert.ok(f.s.fuel <= 0.01 && !f.s.engines[0].running && f.s.engines[0].thrust < 3000);
});

test('touchdown event and hard-landing / gear-up / terrain crash detection', () => {
  // gentle: drop from 0.6 m
  let f = fly(b738, { alt: b738.geometry.cgHeight + 0.6, speed: 70, gearDown: true, flaps: 1 });
  f.c.throttle = 0; f.run(6);
  assert.ok(f.ev('touchdown').length >= 1 && !f.s.crashed);
  assert.ok(Number.isFinite(f.ev('touchdown')[0].verticalSpeed) && f.ev('touchdown')[0].verticalSpeed <= 0);
  // dive into the ground
  f = fly(f16, { alt: 400, speed: 220 }); f.c.pitch = -1; f.run(20, () => f.s.crashed);
  assert.ok(f.s.crashed && typeof f.s.crashReason === 'string' && f.s.crashReason.length > 0);
  assert.equal(f.ev('crash').length, 1); assert.equal(f.ev('crash')[0].reason, f.s.crashReason);
  f.run(40); const p = f.s.position.clone(); f.run(2);
  assert.ok(f.s.position.distanceTo(p) < 1e-3 && finite(f.s), 'wreck stays put');
  assert.ok(f.s.position.y > -1 && f.s.position.y < 6, 'wreck lies on the ground');
  // gear up
  f = fly(b738, { alt: b738.geometry.cgHeight + 3, speed: 75, gearDown: false, flaps: 1 }); f.c.throttle = 0; f.run(20, () => f.s.crashed);
  assert.equal(f.s.crashReason, 'Gear-up landing');
  // water
  f = fly(b738, { alt: 20, speed: 75, gearDown: true, flaps: 1 }, { surface: 'water' }); f.c.throttle = 0; f.run(30, () => f.s.crashed);
  assert.match(f.s.crashReason, /water/i);
  // reset clears the crash
  f.sim.reset(makeInit({ alt: 2000, speed: 130 })); assert.ok(!f.s.crashed && f.s.crashReason === '');
  f.run(1); assert.ok(!f.s.crashed && finite(f.s));
});

test('sonic boom event when accelerating through Mach 1', () => {
  const f = fly(f16, { alt: 9000, speed: 285 }); f.c.throttle = 1;
  f.run(60, () => f.s.mach > 1.05);
  assert.ok(f.s.mach > 1.05); assert.equal(f.ev('sonicBoom').length, 1);
});

// ---------------------------------------------------------------------------------------------------------- environment
test('wind: airspeed is relative to the air mass; steady wind does not disturb trimmed flight', () => {
  const f = fly(b738, { alt: 3000, speed: 130, heading: 0 }, { wind: [0, 0, 20] });       // 20 m/s headwind (air moving south)
  f.run(10);
  close(f.s.tas, 130, 3); close(f.s.groundSpeed, 110, 4);
});

test('turbulence is deterministic for a seed and bounded', () => {
  const runOnce = (seed) => { const f = fly(b738, { alt: 800, speed: 110 }, { turbulence: 0.8, seed, wind: [8, 0, 0] }); let g = 0; f.run(20, () => { g = Math.max(g, Math.abs(f.s.gLoad - 1)); }); return [f.s.position.x, f.s.position.y, f.s.roll, g]; };
  const a = runOnce(7), b = runOnce(7), c = runOnce(8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a[3] > 0.03 && a[3] < 1.5, `turbulence g excursions ${a[3]}`);
});

test('ground effect, runway vs grass friction, wet runway braking', () => {
  const stop = (opts) => { const f = fly(b738, { onGround: true, speed: 50 }, opts); f.c.brakes = 1; const p = f.s.position.clone(); f.run(90, () => f.s.groundSpeed < 0.3); return f.s.position.distanceTo(p); };
  const dry = stop({}), wet = stop({ precipitation: 1 });
  assert.ok(wet > dry * 1.15, `wet ${wet} vs dry ${dry}`);
  const roll = (surface) => { const f = fly(b738, { onGround: true, speed: 30 }, { surface }); const p = f.s.position.clone(); f.run(10); return f.s.position.distanceTo(p); };
  assert.ok(roll('terrain') < roll('runway') - 5, 'soft ground has more rolling resistance');
});

// ---------------------------------------------------------------------------------------------------------- robustness
test('never NaN: huge dt, time acceleration, control thrash, absurd start states', () => {
  for (const def of [f16, b738]) {
    const f = fly(def, { alt: 1500, speed: 150 }); let k = 0;
    for (let i = 0; i < 3000; i++) {
      if (i % 20 === 0) { k++; f.c.pitch = Math.sin(k * 1.7); f.c.roll = Math.cos(k * 2.3); f.c.yaw = Math.sin(k * 0.9); f.c.throttle = (k % 3) / 2; f.c.speedbrake = k % 2; }
      f.sim.step(i % 7 === 0 ? 0.1 : i % 5 === 0 ? 0.5 : 1 / 60, f.c);
      assert.ok(finite(f.s), `${def.id} finite at step ${i}`);
    }
    for (const init of [{ alt: 30000, speed: 900 }, { alt: 100, speed: 1 }, { alt: 5, speed: 300 }, { alt: 12000, speed: 0 }]) {
      const g = fly(def, init); g.run(8, null, 1 / 30); assert.ok(finite(g.s), `${def.id} ${JSON.stringify(init)}`);
    }
  }
  const f = fly(f16, { alt: 3000, speed: 200 });
  f.sim.step(NaN, f.c); f.sim.step(-1, f.c); f.sim.step(0, f.c); f.c.pitch = NaN; f.c.throttle = Infinity; f.sim.step(1 / 60, f.c);
  assert.ok(finite(f.s));
});

test('dt invariance: 30, 60 and 144 Hz frames give the same trajectory', () => {
  const runAt = (hz) => { const f = fly(f16, { alt: 3000, speed: 220 }); f.run(6, (t) => { f.c.pitch = t > 1 && t < 2.5 ? 0.5 : 0; f.c.roll = t > 3 && t < 3.6 ? 0.6 : 0; }, 1 / hz); return f.s; };
  const a = runAt(30), b = runAt(60), c = runAt(144);
  close(a.position.y, b.position.y, 6); close(c.position.y, b.position.y, 6); close(a.roll, b.roll, 0.06); close(c.roll, b.roll, 0.06);
});

test('no module-level state: two sims are independent and reset() restores the start state', () => {
  const a = fly(f16, { alt: 3000, speed: 200 }), b = fly(f16, { alt: 3000, speed: 200 });
  a.c.pitch = 1; a.run(3); b.run(3);
  close(b.s.position.y, 3000, 10); assert.ok(a.s.position.y > 3100);
  a.c.pitch = 0; a.sim.reset(makeInit({ alt: 3000, speed: 200 }));
  close(a.s.position.y, 3000, 1e-6); close(a.s.tas, 200, 0.5); assert.ok(!a.s.crashed);
  a.sim.dispose(); a.ctx.events.emit('cmd', { name: 'gearToggle' }); a.sim.step(1 / 60, a.c);
  assert.equal(a.ev('gear:moved').length, 0, 'dispose() unsubscribes from cmd');
});

// ---------------------------------------------------------------------------------------------------------- config-driven paths
test('fbw-airliner normal law: flight-path hold, bank and load-factor protections', () => {
  const def = variant(b738, { fcs: { type: 'fbw-airliner' } });
  const f = fly(def, { alt: 3000, speed: 130 }); const s = f.s;
  f.c.roll = 1; f.run(15);
  assert.ok(Math.abs(s.roll) < 70 * DEG && Math.abs(s.roll) > 55 * DEG, `bank limited near 67°, got ${s.roll / DEG}`);
  f.c.roll = 0; f.run(12);
  assert.ok(Math.abs(s.roll) < 36 * DEG, 'returns to 33° when released');
  const g = fly(def, { alt: 3000, speed: 150 }); let gmax = 0, amax = 0;
  g.c.pitch = 1; g.run(8, () => { gmax = Math.max(gmax, g.s.gLoad); amax = Math.max(amax, g.s.aoa); });
  assert.ok(gmax < 2.75 && gmax > 1.5, `g limited to 2.5, got ${gmax}`);
  g.run(25, () => { amax = Math.max(amax, g.s.aoa); });
  assert.ok(amax < 17 * DEG && !g.s.stalled, `alpha protection, max ${amax / DEG}`);
  assert.ok(g.s.pitch < 33 * DEG);
  const h = fly(def, { alt: 3000, speed: 130 }); h.run(20);
  close(h.s.position.y, 3000, 20, 'hands-off flight path hold');
});

test('multi-engine: four engines, asymmetric failure yaws towards the dead engine', () => {
  const eng = [-16, -9, 9, 16].map((x) => ({ nozzle: [x, -1.2, 2], intake: [x, -1.2, -1], nozzleRadius: 0.8 }));
  const def = variant(b738, { engines: { count: 4 } }, { geometry: { ...b738.geometry, engines: eng }, specs: { ...b738.specs, engineCount: 4 } });
  const f = fly(def, { alt: 2500, speed: 130 }); const s = f.s;
  assert.equal(s.engines.length, 4);
  f.c.throttle = 0.9; f.run(8); const t0 = s.engines.map((e) => e.thrust);
  assert.ok(t0.every((t) => Math.abs(t - t0[0]) < 0.02 * t0[0]));
  const h0 = s.heading; f.sim.debug.engines[3].running = false; f.run(6);            // right outboard
  let dh = s.heading - h0; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
  assert.ok(s.engines[3].thrust < 0.3 * t0[3] && (dh > 0.002 || s.surfaces.rudder < -0.02), 'yaws right / SAS holds left rudder');
});

test('thrust vectoring, split drag rudders, variable sweep and thrust tables resolve and fly', () => {
  const tv = variant(f16, { engines: { vectoring: { pitch: 20, rate: 60 } } });
  const a = fly(tv, { alt: 3000, speed: 50 }), b = fly(f16, { alt: 3000, speed: 50 }); let noz = 0;
  for (const x of [a, b]) { x.c.throttle = 1; x.c.pitch = 1; x.run(2, () => { noz = Math.max(noz, Math.abs(x.s.surfaces.nozzlePitch)); }); }
  assert.ok(noz > 0.2 && b.s.surfaces.nozzlePitch === 0 && finite(a.s), 'nozzle deflects with pitch demand');
  assert.ok(a.s.aoa > b.s.aoa + 1 * DEG, 'vectoring adds pitch authority where the tail has run out');
  const split = variant(f16, { controls: { rudder: { split: true } }, aero: { drag: { splitRudder: 0.05 } } });
  const c = fly(split, { alt: 3000, speed: 200 }); c.c.yaw = 0.5; c.run(3); assert.ok(finite(c.s) && Math.abs(c.s.beta) < 0.5);
  const sw = variant(f16, { aero: { sweep: { time: 6 } } });
  const d = fly(sw, { alt: 6000, speed: 200 }); d.run(2); const s0 = d.s.surfaces.wingSweep; d.c.throttle = 1; d.run(40);
  assert.ok(finite(d.s) && d.s.mach > 0.85); assert.ok(d.s.surfaces.wingSweep > s0 + 0.3, 'wings sweep back with Mach');
  const tab = variant(f16, { engines: { thrustTable: { mach: [0, 1, 2], alt: [0, 10000, 20000], mil: [[1, 0.9, 0.5], [0.4, 0.45, 0.4], [0.1, 0.12, 0.15]], ab: [[1, 1.3, 1.2], [0.4, 0.6, 0.8], [0.1, 0.16, 0.3]] } } });
  const e = fly(tab, { onGround: true }); e.c.throttle = 1; e.c.brakes = 1; e.sim.command('parkingBrakeToggle'); e.run(8);
  close(e.s.engines[0].thrust, f16.specs.thrustMax, 0.1 * f16.specs.thrustMax, 'table gives sea-level static thrust');
});

test('carrier operations: catapult launch and arrested landing on a moving deck', () => {
  const def = variant(f16, { hook: true, gear: { catapult: { accel: 30, stroke: 90 } } });
  const deck = { groundFn: (x, z, out) => { out.type = 'deck'; out.height = 20; out.velocity = { x: 0, y: 0, z: -12 }; } };
  const f = fly(def, { onGround: true, alt: 20 }, deck); const s = f.s;
  f.run(3); f.c.throttle = 1; f.run(3.2);
  const rel = Math.hypot(s.velocity.x, s.velocity.z + 12);
  assert.ok(rel > 55, `catapult end speed over the deck ${rel}`);
  const g = fly(def, { alt: 20 + def.geometry.cgHeight + 0.5, speed: 72, gearDown: true, flaps: 1 }, deck);
  g.sim.command('hookToggle'); g.c.throttle = 0; let p = null;
  g.run(12, () => { if (!p && g.s.onGround) p = g.s.position.clone(); });
  assert.ok(p && !g.s.crashed);
  assert.ok(Math.abs(g.s.velocity.z + 12) < 1.5, 'stopped relative to the deck');
});

test('speedbrake and spoilers add drag; reverse thrust and ground spoilers deploy on landing rollout', () => {
  const dec = (sb) => { const f = fly(f16, { alt: 3000, speed: 220 }); f.c.speedbrake = sb; f.run(6); return 220 - f.s.tas; };
  assert.ok(dec(1) > dec(0) + 4);
  const f = fly(b738, { onGround: true, speed: 65, flaps: 1 }); f.c.throttle = 0; f.c.brakes = 1; f.run(4);
  assert.ok(f.s.surfaces.spoilerL > 0.8 && f.s.surfaces.spoilerR > 0.8, 'ground spoilers');
  assert.ok(f.s.engines[0].reverser > 0.5, 'reversers deployed');
  f.run(40); assert.ok(f.s.groundSpeed < 0.5 && f.s.engines[0].reverser < 0.1, 'stowed at low speed');
});

test('keyboard-style handling: held back key at Vr does not strike the tail; crosswind roll stays on the runway', () => {
  for (const def of [b738, f16]) {
    const f = fly(def, { onGround: true }, { wind: [8, 0, 0] }); const s = f.s; f.c.throttle = 1; let lift = 0;
    f.run(70, (t, dt) => {
      const key = s.ias >= def.specs.rotateSpeed && (!lift || t - lift < 1) ? 1 : 0;
      f.c.pitch += (key - f.c.pitch) * Math.min(1, dt * 6);
      if (!lift && !s.onGround) lift = t;
      if (lift) f.c.roll = Math.max(-1, Math.min(1, -3 * s.roll));
      return s.crashed || (lift && t - lift > 6);
    });
    assert.ok(lift > 0 && !s.crashed && !s.tailStrike, `${def.id}: ${s.crashReason}`);
    assert.ok(s.agl > 5 && s.verticalSpeed > 0);
    assert.ok(Math.abs(s.position.x) < 40, `${def.id} lateral excursion ${s.position.x}`);
  }
});
