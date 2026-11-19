// node --test src/neural/aero.test.js
// Neural aerodynamics layer: the JS forward pass against the Python reference, the conditions where the correction must
// vanish, bounds outside the trained range, smoothness (finite differences) and the cost per call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAeroNet, evalHead, aeroNetIds, headParams, GATE0, OUT } from './aero.js';
import { AERO_NETS } from './aero-weights.js';
import { resolveConfig } from '../physics/config.js';
import { computeAero, createAeroIn, createAeroOut, attachNeural } from '../physics/aero.js';

globalThis.window ??= globalThis;
globalThis.document ??= { createElement: () => ({ getContext: () => null, style: {} }), body: {}, addEventListener() {} };

const DEG = Math.PI / 180;
const vec = JSON.parse(readFileSync(fileURLToPath(new URL('./test-vectors-aero.json', import.meta.url)), 'utf8'));
const dir = fileURLToPath(new URL('../aircraft/', import.meta.url));
const defs = {};
for (const id of readdirSync(dir).sort()) {
  if (existsSync(`${dir}${id}/index.js`) && existsSync(`${dir}${id}/physics.js`)) defs[id] = (await import(new URL(`../aircraft/${id}/index.js`, import.meta.url).href)).default;
}
const ids = aeroNetIds();
const FIELDS = ['X', 'Y', 'Z', 'L', 'M', 'N', 'CL', 'CD', 'CY', 'Cm', 'Cl', 'Cn'];

/** The same aircraft with and without the network set. */
function pair(id) {
  const classic = resolveConfig(defs[id]).aero, neural = resolveConfig(defs[id]).aero;
  attachNeural(neural, id);
  return { classic, neural };
}
/** Fill an input record: alpha/beta [rad], speed [m/s], everything else by name. */
function setIn(i, alpha, beta, V, extra) {
  i.u = V * Math.cos(alpha) * Math.cos(beta); i.v = V * Math.sin(beta); i.w = V * Math.sin(alpha) * Math.cos(beta);
  i.p = i.q = i.r = 0; i.de = i.da = i.dr = 0; i.flap = 0; i.slat = 0; i.hWing = 1e4; i.bank = 0; i.rho = 1.225; i.a = 340;
  if (extra) Object.assign(i, extra);
  return i;
}
const peak = (A, o) => o.alphaStall - A.peakOff;

test('aero nets: every aircraft has a set, each a few thousand weights at most', () => {
  for (const id of Object.keys(defs)) assert.ok(ids.includes(id), `no network set for ${id}`);
  let n = 0;
  for (const [, k] of AERO_NETS.heads) n += headParams(k);
  console.log(`  ${ids.length} aircraft x ${AERO_NETS.heads.length} heads, ${n} weights per aircraft, hidden width ${AERO_NETS.hidden}`);
  assert.ok(n < 4000);
});

test('aero nets: JS forward pass reproduces the Python reference (1e-6)', () => {
  let maxDiff = 0, count = 0;
  for (const id of Object.keys(vec.aircraft)) {
    const net = createAeroNet(id), v = vec.aircraft[id];
    for (let k = 0; k < v.x.length; k++) {
      const [h, x0, x1, x2, x3] = v.x[k];
      evalHead(net, h, x0, x1, x2, x3);
      for (let c = 0; c < v.y[k].length; c++) { maxDiff = Math.max(maxDiff, Math.abs(net.o[net.oOff[h] + c] - v.y[k][c])); count++; }
    }
  }
  console.log(`  max |JS - Python| = ${maxDiff.toExponential(2)} over ${count} outputs`);
  assert.ok(count > 500 && maxDiff < 1e-6);
});

test('aero nets: outputs are bounded and finite far outside the trained range, and deterministic', () => {
  for (const id of ids) {
    const net = createAeroNet(id);
    for (let h = 0; h < net.nOut.length; h++) {
      for (const big of [1e3, -1e3, 1e9, -1e9]) {
        evalHead(net, h, big, -big, big, big);
        for (let c = 0; c < net.nOut[h]; c++) {
          const y = net.o[net.oOff[h] + c];
          assert.ok(Number.isFinite(y) && Math.abs(y) <= net.bound[net.oOff[h] + c] + 1e-12, `${id} head ${h}`);
        }
      }
      evalHead(net, h, 0.9, 0.3, 0.4, 0.5); const a = Array.from(net.o);
      evalHead(net, (h + 1) % net.nOut.length, 1, 1, 1, 1); evalHead(net, h, 0.9, 0.3, 0.4, 0.5);
      for (let c = 0; c < net.nOut[h]; c++) assert.equal(net.o[net.oOff[h] + c], a[net.oOff[h] + c]);
    }
  }
});

test('neural layer: identical to the analytic model below the gate (free air) for every aircraft', () => {
  const i = createAeroIn(), oc = createAeroOut(), on = createAeroOut();
  for (const id of ids) {
    const { classic, neural } = pair(id);
    let checked = 0;
    for (const flap of [0, 0.5, 1]) for (const mach of [0.2, 0.5, 0.8]) for (let f = -0.5; f <= 0.5001; f += 0.1) {
      setIn(i, 0.05, 0, mach * 340, { flap });
      computeAero(classic, i, oc);
      const alpha = f * (peak(classic, oc)) * 1.05;
      setIn(i, alpha, 8 * DEG, mach * 340, { flap, p: 0.4, q: 0.1, r: -0.1, de: 0.5, da: -0.7, dr: 0.6 });
      computeAero(classic, i, oc); computeAero(neural, i, on);
      if (Math.abs(alpha) / peak(classic, oc) > GATE0 && alpha > 0) continue;
      if (alpha < 0) continue;                                  // negative side has its own peak angle, tested below
      assert.equal(on.nnGate, 0);
      for (const k of FIELDS) assert.equal(on[k], oc[k], `${id} ${k} flap ${flap} M ${mach} alpha ${(alpha / DEG).toFixed(1)}`);
      checked++;
    }
    assert.ok(checked > 30);
    setIn(i, -0.02, 0.1, 100, { p: 0.3, da: 1 }); computeAero(classic, i, oc); computeAero(neural, i, on);
    for (const k of FIELDS) assert.equal(on[k], oc[k]);
  }
});

test('neural layer: lift and drag never move; symmetric flight stays symmetric', () => {
  const i = createAeroIn(), oc = createAeroOut(), on = createAeroOut();
  for (const id of ids) {
    const { classic, neural } = pair(id);
    for (let a = -40; a <= 80; a += 1.5) for (const h of [1e4, 0.2 * classic.b, 0.05 * classic.b]) {
      setIn(i, a * DEG, 10 * DEG, 80, { hWing: h, bank: 0.1, p: 0.5, q: 0.2, r: 0.2, de: -0.6, da: 0.8, dr: -0.5, flap: 0.5 });
      computeAero(classic, i, oc); computeAero(neural, i, on);
      assert.equal(on.CL, oc.CL); assert.equal(on.CD, oc.CD);
      setIn(i, a * DEG, 0, 80, { hWing: h, q: 0.2, de: -0.6, flap: 0.5 });
      computeAero(classic, i, oc); computeAero(neural, i, on);
      assert.equal(on.CL, oc.CL); assert.equal(on.CD, oc.CD);
      for (const k of ['Y', 'L', 'N']) assert.ok(Math.abs(on[k] - oc[k]) < 1e-9 * (1 + Math.abs(oc[k])), `${id} ${k} symmetric`);
    }
  }
});

test('neural layer: ground terms vanish above 1.5 spans; supersonic flight is analytic', () => {
  const i = createAeroIn(), oc = createAeroOut(), on = createAeroOut();
  for (const id of ids) {
    const { classic, neural } = pair(id);
    setIn(i, 4 * DEG, 0.05, 70, { hWing: 1.5 * classic.b, bank: 0.15, flap: 1 });
    computeAero(classic, i, oc); computeAero(neural, i, on);
    for (const k of FIELDS) assert.equal(on[k], oc[k], `${id} ${k} at 1.5 spans`);
    for (const a of [5, 15, 30, 50]) {
      setIn(i, a * DEG, 0.1, 1.06 * 340, { p: 0.3, r: 0.1, da: 0.5, dr: 0.5, de: 0.3 });
      computeAero(classic, i, oc); computeAero(neural, i, on);
      for (const k of FIELDS) assert.equal(on[k], oc[k], `${id} ${k} at Mach 1.06`);
    }
  }
});

test('neural layer: no NaN and no jumps across the input range (finite differences)', () => {
  const i = createAeroIn(), o = createAeroOut(), prev = new Float64Array(3), worst = { neural: [0, 0, 0], classic: [0, 0, 0] };
  const cases = [];
  for (const beta of [0, 6, -15, 30]) for (const rates of [0, 1]) for (const ctl of [0, 1, -1]) for (const h of [1e4, 0.12]) for (const flap of [0, 1]) cases.push({ beta, rates, ctl, h, flap });
  for (const id of ids) {
    const m = pair(id);
    for (const kind of ['neural', 'classic']) {
      const A = m[kind];
      const coef = (out) => { out[0] = o.Cl; out[1] = o.Cm; out[2] = o.Cn; };
      const sweep = (n, set) => {
        const cur = new Float64Array(3);
        for (let k = 0; k <= n; k++) {
          set(k / n); computeAero(A, i, o); coef(cur);
          for (let c = 0; c < 3; c++) {
            assert.ok(Number.isFinite(cur[c]) && Number.isFinite(o.X) && Number.isFinite(o.Y) && Number.isFinite(o.Z), `${id} ${kind} NaN`);
            if (k > 0) worst[kind][c] = Math.max(worst[kind][c], Math.abs(cur[c] - prev[c]));
            prev[c] = cur[c];
          }
        }
      };
      for (const cs of cases) {
        const ex = { flap: cs.flap, p: 0.5 * cs.rates, q: 0.15 * cs.rates, r: -0.2 * cs.rates, de: 0.7 * cs.ctl, da: cs.ctl, dr: -cs.ctl, hWing: cs.h * A.b, bank: 0.1 * cs.ctl };
        sweep(4800, (t) => setIn(i, (-40 + 120 * t) * DEG, cs.beta * DEG, 90, ex));                    // alpha, 0.025 deg steps
        sweep(2000, (t) => setIn(i, 14 * DEG, (-40 + 80 * t) * DEG, 90, ex));                          // sideslip
        sweep(2000, (t) => setIn(i, 16 * DEG, cs.beta * DEG, (0.1 + 1.2 * t) * 340, ex));              // Mach
        sweep(2000, (t) => setIn(i, 9 * DEG, cs.beta * DEG, 70, { ...ex, hWing: 2 * t * A.b }));       // height
        sweep(2000, (t) => setIn(i, 9 * DEG, cs.beta * DEG, 70, { ...ex, bank: -0.6 + 1.2 * t }));     // bank near the ground
        sweep(2000, (t) => setIn(i, 20 * DEG, cs.beta * DEG, 90, { ...ex, p: -3 + 6 * t, r: 1 - 2 * t, q: -0.5 + t }));
        sweep(2000, (t) => setIn(i, 20 * DEG, cs.beta * DEG, 90, { ...ex, de: -1 + 2 * t, da: 1 - 2 * t, dr: -1 + 2 * t }));
        sweep(1000, (t) => setIn(i, 15 * DEG, cs.beta * DEG, 90, { ...ex, flap: t }));
      }
    }
  }
  const f = (a) => a.map((x) => x.toExponential(2)).join(', ');
  console.log(`  largest step of [Cl, Cm, Cn] between neighbouring samples: neural ${f(worst.neural)}; analytic ${f(worst.classic)}`);
  // a jump would show as a step far above the analytic model's own largest step (its stall sigmoid over 0.025 deg)
  assert.ok(worst.neural[0] < 0.01 && worst.neural[1] < 0.03 && worst.neural[2] < 0.01);
});

test('neural layer: past the stall aileron power drops; roll damping stays analytic (see AERO.md)', () => {
  const i = createAeroIn(), o = createAeroOut(), oc = createAeroOut();
  for (const id of ['a10', 'b738']) {
    const { neural, classic } = pair(id);
    setIn(i, 0.05, 0, 70); computeAero(neural, i, o);
    const pk = peak(neural, o);
    const roll = (A, an, extra, out) => { setIn(i, an * pk, 0, 70, extra); computeAero(A, i, out); return out.Cl; };
    const lo = roll(neural, 0.4, { da: 0.5 }, o), hi = roll(neural, 1.4, { da: 0.5 }, o);
    assert.ok(lo > 0 && hi < 0.6 * lo, `${id}: aileron power must drop past the stall (${lo} -> ${hi})`);
    assert.ok(o.nnGate === 1 && neural.neural.valid[OUT.clda] === 1 && neural.neural.valid[OUT.clp] === 0);
    assert.equal(roll(neural, 1.4, { p: 0.2 }, o), roll(classic, 1.4, { p: 0.2 }, oc));
  }
});

test('neural layer: Lipschitz in every input (steps shrink 16x on a 16x finer sweep)', () => {
  const i = createAeroIn(), o = createAeroOut();
  for (const id of ['f16', 'a10', 'b738', 'b2']) {
    const { neural: A } = pair(id);
    attachNeural(A, id, undefined, 1);                            // with the optional ground pitch term
    const sweeps = [
      (t) => setIn(i, (-40 + 120 * t) * DEG, 0.1, 90, { p: 0.5, q: 0.15, r: -0.2, de: 0.7, da: 1, dr: -1, flap: 1 }),
      (t) => setIn(i, 22 * DEG, (-40 + 80 * t) * DEG, 90, { p: 0.5, r: -0.2, da: 1, dr: -1 }),
      (t) => setIn(i, 22 * DEG, 0.1, (0.1 + 1.2 * t) * 340, { p: 0.5, da: 1, de: 0.5 }),
      (t) => setIn(i, 9 * DEG, 0.1, 70, { hWing: 2 * t * A.b, bank: 0.1, flap: 1 }),
      (t) => setIn(i, 9 * DEG, 0.1, 70, { hWing: 0.12 * A.b, bank: -0.6 + 1.2 * t }),
      (t) => setIn(i, 24 * DEG, 0.1, 90, { p: -3 + 6 * t, r: 1 - 2 * t, q: -0.5 + t }),
      (t) => setIn(i, 24 * DEG, 0.1, 90, { de: -1 + 2 * t, da: 1 - 2 * t, dr: -1 + 2 * t }),
    ];
    for (const set of sweeps) {
      const worst = [2000, 32000].map((n) => {
        let w = 0, a = 0, b = 0, c = 0;
        for (let k = 0; k <= n; k++) { set(k / n); computeAero(A, i, o); if (k) w = Math.max(w, Math.abs(o.Cl - a), Math.abs(o.Cm - b), Math.abs(o.Cn - c)); a = o.Cl; b = o.Cm; c = o.Cn; }
        return w;
      });
      assert.ok(worst[1] < worst[0] / 12 + 1e-12, `${id}: step ${worst[0]} -> ${worst[1]}`);
    }
  }
});

test('neural layer: cost per computeAero call with every head active', () => {
  const i = createAeroIn(), o = createAeroOut(), { classic, neural } = pair('b738');
  setIn(i, 0.05, 0, 70); computeAero(neural, i, o);
  const pk = peak(neural, o), n = 200000;
  const time = (A) => {
    let acc = 0;
    const t0 = process.hrtime.bigint();
    for (let k = 0; k < n; k++) { setIn(i, (0.9 + 0.4 * (k % 100) / 100) * pk, 0.1, 70, { p: 0.2, r: 0.05, q: 0.02, de: 0.3, da: 0.4, dr: 0.2, hWing: 0.15 * A.b, bank: 0.05 }); computeAero(A, i, o); acc += o.M; }
    return [Number(process.hrtime.bigint() - t0) / n / 1000, acc];
  };
  time(classic); time(neural);
  const [tc] = time(classic), [tn] = time(neural);
  console.log(`  computeAero: analytic ${tc.toFixed(2)} us, neural (9 heads active) ${tn.toFixed(2)} us per call`);
  assert.ok(tn < 50);
});
