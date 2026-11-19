// Before/after of the neural aerodynamics layer in three telling manoeuvres, flown by the same scripted inputs with
// the analytic model (aero=classic) and with the networks on.
//
//   node tools/neural/aero/manoeuvres.mjs [id ...]        (default: f16 a10 b738 b2)
//
// 1. stall with sideslip: idle power, 35 % rudder held, stick eased fully back over 12 s and held (22 s in all)
// 2. flare in ground effect: trimmed hands-off approach flown into the runway (no flare input); third column with the
//    learned ground-effect pitch term switched on (aeroGe=1; it is off by default, see src/neural/AERO.md)
// 3. high-alpha roll: decelerate to the stall warning, freeze the stick, full roll input for 2 s
// 4. full aileron with the stick held back: idle power, stick eased fully back over 8 s, wings held level, then full
//    roll input for 2 s
// and the effective stability / control derivatives of both models past the stall (finite differences).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
globalThis.window ??= globalThis;
globalThis.document ??= { createElement: () => ({ getContext: () => null, style: {} }), body: {}, addEventListener() {} };
const imp = (p) => import(pathToFileURL(resolve(root, p)).href);
const { createSim } = await imp('src/physics/index.js');
const { createMockContext, makeInit } = await imp('src/physics/testing.js');
const DEG = Math.PI / 180, clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI;

function flight(def, init, opts) {
  const ctx = createMockContext(opts), sim = createSim(ctx, def, makeInit(init)), c = ctx.controls, s = sim.state;
  const fl = { ctx, sim, s, c, t: 0, run(sec, fn, dt = 1 / 60) { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) { if (fn && fn(fl.t, dt) === true) return true; sim.step(dt, c); fl.t += dt; } return false; } };
  return fl;
}

function stallSideslip(def, opts) {
  const fl = flight(def, { alt: 4000, speed: def.specs.approachSpeed * 1.35 }, opts), s = fl.s, c = fl.c;
  const r = { maxRoll: 0, t45: null, maxYawRate: 0, maxBeta: 0, maxAoa: 0, heading: 0, altLoss: 0 };
  const p0 = c.pitch, h0 = s.altitude; let hd = 0, prev = s.heading;
  fl.run(22, (t) => {
    c.throttle = 0; c.roll = 0; c.yaw = t > 1 ? 0.35 : 0; c.pitch = p0 + (1 - p0) * clamp((t - 1) / 12, 0, 1);
    hd += wrap(s.heading - prev); prev = s.heading;
    r.maxRoll = Math.max(r.maxRoll, Math.abs(s.roll) / DEG); if (r.t45 === null && Math.abs(s.roll) > 45 * DEG) r.t45 = t;
    r.maxYawRate = Math.max(r.maxYawRate, Math.abs(s.bodyRates.r) / DEG); r.maxBeta = Math.max(r.maxBeta, Math.abs(s.beta) / DEG);
    r.maxAoa = Math.max(r.maxAoa, s.aoa / DEG);
  });
  r.heading = hd / DEG; r.altLoss = h0 - s.altitude;
  return { 'peak AoA [deg]': r.maxAoa, 'largest bank [deg]': r.maxRoll, 'time to 45 deg bank [s]': r.t45 ?? NaN, 'peak yaw rate [deg/s]': r.maxYawRate,
    'peak sideslip [deg]': r.maxBeta, 'heading change [deg]': r.heading, 'height lost [m]': r.altLoss };
}

function flare(def, opts) {
  const span = def.geometry.span;
  const fl = flight(def, { alt: def.geometry.cgHeight + 1.6 * span, speed: def.specs.approachSpeed * 1.08, gearDown: true, flaps: 1 }, opts), s = fl.s;
  let th15 = null, vs15 = 0, thTd = 0, vsTd = 0, vsPrev = 0, thPrev = 0, minVs = 0;
  fl.run(60, () => {
    if (th15 === null && s.agl < 1.5 * span) { th15 = s.pitch; vs15 = s.verticalSpeed; }
    if (s.onGround) { thTd = thPrev; vsTd = vsPrev; return true; }
    vsPrev = s.verticalSpeed; thPrev = s.pitch; minVs = Math.min(minVs, s.verticalSpeed);
    return false;
  });
  return { 'sink rate entering ground effect [m/s]': -vs15, 'sink rate at touchdown [m/s]': -vsTd, 'pitch change in ground effect [deg]': (thTd - th15) / DEG };
}

function highAlphaRoll(def, opts) {
  const fl = flight(def, { alt: 4000, speed: def.specs.approachSpeed * 1.35 }, opts), s = fl.s, c = fl.c;
  let th = s.pitch;
  fl.run(60, (t, dt) => {                                   // level deceleration at idle to the stall warning
    c.throttle = 0; c.roll = clamp(-2.5 * s.roll - 0.6 * s.bodyRates.p, -1, 1);
    th += clamp(-0.02 * s.verticalSpeed, -1, 1) * DEG * dt * 3;
    c.pitch = clamp(c.pitch + (4 * (th - s.pitch) - 2 * s.bodyRates.q) * dt * 2, -1, 1);
    return s.stallWarning && t > 3;
  });
  const a0 = s.aoa, roll0 = s.roll, hd0 = s.heading, t0 = fl.t;
  let pMax = 0, bMax = 0, r1 = 0, bank1 = 0;
  fl.run(2, (t) => {
    c.roll = 1; pMax = Math.max(pMax, s.bodyRates.p / DEG); bMax = Math.abs(s.beta) > Math.abs(bMax) ? s.beta / DEG : bMax;
    if (t - t0 <= 1) { r1 = s.bodyRates.r / DEG; bank1 = (s.roll - roll0) / DEG; }
  });
  return { 'AoA at entry [deg]': a0 / DEG, 'bank after 1 s [deg]': bank1, 'bank after 2 s [deg]': wrap(s.roll - roll0) / DEG, 'peak roll rate [deg/s]': pMax,
    'yaw rate at 1 s [deg/s]': r1, 'largest sideslip [deg]': bMax, 'heading change [deg]': wrap(s.heading - hd0) / DEG };
}

function aileronInStall(def, opts) {
  const fl = flight(def, { alt: 4000, speed: def.specs.approachSpeed * 1.35 }, opts), s = fl.s, c = fl.c;
  const p0 = c.pitch;
  fl.run(11, (t) => { c.throttle = 0; c.pitch = p0 + (1 - p0) * clamp(t / 8, 0, 1); c.roll = clamp(-2.5 * s.roll - 0.6 * s.bodyRates.p, -1, 1); });
  const roll0 = s.roll, a0 = s.aoa; let pMax = -1e9, pMin = 1e9, turned = 0, prev = s.roll;
  fl.run(2, () => { c.pitch = 1; c.roll = 1; pMax = Math.max(pMax, s.bodyRates.p / DEG); pMin = Math.min(pMin, s.bodyRates.p / DEG); turned += wrap(s.roll - prev); prev = s.roll; });
  return { 'AoA when the aileron goes in [deg]': a0 / DEG, 'bank at that moment [deg]': roll0 / DEG, 'bank gained in 2 s of full aileron [deg]': turned / DEG, 'peak roll rate [deg/s]': pMax };
}

/** Effective derivatives by finite differences at a fraction `an` of the angle of maximum lift (clean, 80 m/s). */
function derivatives(def, an, neural) {
  const A = resolveConfig(def).aero; if (neural) attachNeural(A, def.id);
  const i = createAeroIn(), o = createAeroOut();
  const run = (alpha, ex) => { const b = (ex && ex.beta) || 0, V = 80; Object.assign(i, createAeroIn()); i.u = V * Math.cos(alpha) * Math.cos(b); i.v = V * Math.sin(b); i.w = V * Math.sin(alpha) * Math.cos(b); i.slat = 1; Object.assign(i, ex || {}); computeAero(A, i, o); return { Cl: o.Cl, Cm: o.Cm, Cn: o.Cn, CY: o.CY, pk: o.alphaStall - A.peakOff }; };
  const pk = run(0.05).pk, al = an * pk, base = run(al), d = (ex, k, den) => (run(al, ex)[k] - base[k]) / den;
  const b = 5 * DEG, ph = 0.05, rate = (x) => x * 2 * 80 / A.b;
  return { 'Cl_beta [/rad]': d({ beta: b }, 'Cl', Math.sin(b)), 'Cn_beta [/rad]': d({ beta: b }, 'Cn', Math.sin(b)), 'CY_beta [/rad]': d({ beta: b }, 'CY', Math.sin(b)),
    'Cl_p': d({ p: rate(ph) }, 'Cl', ph), 'Cn_p': d({ p: rate(ph) }, 'Cn', ph), 'Cl_r': d({ r: rate(ph) }, 'Cl', ph), 'Cn_r': d({ r: rate(ph) }, 'Cn', ph),
    'Cl, full aileron': d({ da: 1 }, 'Cl', 1), 'Cn, full aileron': d({ da: 1 }, 'Cn', 1), 'Cn, full rudder': d({ dr: 1 }, 'Cn', 1),
    'Cm, half nose-up elevator': d({ de: 0.5 }, 'Cm', 1), 'Cm_q': d({ q: 0.01 * 2 * 80 / A.c }, 'Cm', 0.01), 'Cm (controls neutral)': base.Cm };
}

const { resolveConfig } = await imp('src/physics/config.js');
const { computeAero, createAeroIn, createAeroOut, attachNeural } = await imp('src/physics/aero.js');
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['f16', 'a10', 'b738', 'b2'];
const f = (v) => (Number.isNaN(v) ? '-' : v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2)).padStart(9);
const f3 = (v) => v.toFixed(3).padStart(9);
for (const id of ids) {
  const def = (await imp(`src/aircraft/${id}/index.js`)).default;
  console.log(`\n${id}  ${def.name}`);
  for (const [name, fn, withGe] of [['stall with sideslip', stallSideslip, false], ['flare in ground effect (hands off)', flare, true], ['high-alpha roll', highAlphaRoll, false], ['full aileron with the stick held back', aileronInStall, false]]) {
    const a = fn(def, { aero: 'classic' }), b = fn(def, { aero: 'neural' }), g = withGe ? fn(def, { aero: 'neural', aeroGe: 1 }) : null;
    console.log(`  ${name.padEnd(46)} ${'analytic'.padStart(9)} ${'neural'.padStart(9)}${g ? '  +ground pitch term' : ''}`);
    for (const k of Object.keys(a)) console.log(`    ${k.padEnd(44)} ${f(a[k])} ${f(b[k])}${g ? ' ' + f(g[k]) : ''}`);
  }
  for (const an of [1.15, 1.5]) {
    const a = derivatives(def, an, false), b = derivatives(def, an, true);
    console.log(`  derivatives at ${an} x angle of maximum lift`.padEnd(48) + ` ${'analytic'.padStart(9)} ${'neural'.padStart(9)}`);
    for (const k of Object.keys(a)) console.log(`    ${k.padEnd(44)} ${f3(a[k])} ${f3(b[k])}`);
  }
}
