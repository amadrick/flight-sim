// 6-DOF rigid-body flight simulation core: integrates one aircraft, ties together aerodynamics, propulsion, landing
// gear, flight controls, autopilot, atmosphere and turbulence, and fills the canonical AircraftState.
//
// Frames
//   world        +X east, +Y up, +Z south (see ARCHITECTURE.md)
//   export body  +X right wing, +Y up, -Z nose      (state.quaternion maps this to world)
//   aero body    x forward, y right, z down          (all dynamics: u,v,w / p,q,r / X,Y,Z / L,M,N)
// Integration: semi-implicit Euler at >= 240 Hz sub-steps (dt_frame / ceil(dt_frame·240)), exact relaxation for the
// tyre brush model, so the stiffest modes (gear ~1.5 Hz, tyres ~2 Hz, short period, roll mode) are far inside the
// stability limit. No allocation inside step().
import * as THREE from 'three';
import { createAircraftState } from '../core/state.js';
import { resolveConfig } from './config.js';
import { isaAtmosphere, casFromMach, P0, T0 } from './atmosphere.js';
import { computeAero, createAeroIn, createAeroOut } from './aero.js';
import { createEngineState, thrustLapse, setEngineSteady, engineOutput, stepEngine } from './propulsion.js';
import { createFcsState, createApState, updateFcs, updateAutopilot } from './fcs.js';
import { createTurbulence } from './turbulence.js';

const G0 = 9.80665, H_MAX = 1 / 240, MAX_FRAME = 2.0;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const toward = (c, t, m) => (Math.abs(t - c) <= m ? t : c + (t > c ? m : -m));
const sstep = (a, b, x) => { let t = (x - a) / (b - a); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
const fin = (x) => x === x && x !== Infinity && x !== -Infinity;

export function createSim(ctx, def, init) {
  const model = resolveConfig(def);
  const A = model.aero, C = model.ctl, GR = model.gear, FL = A.flaps, LIM = model.limits;
  const wheels = GR.wheels, points = model.points, nW = wheels.length, nE = model.engines.length;
  const s = createAircraftState();
  const pos = s.position, vel = s.velocity, Q = s.quaternion;
  const isPlayer = !init || init.player !== false;

  // ---- internal state (per sim; no module-level mutable state) ------------------------------------------------------
  let p = 0, q = 0, r = 0;                                     // body rates (aero axes)
  let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
  let mass = model.mass.refMass, ixx = 1, iyy = 1, izz = 1, ixz = 0, fuel = 0;
  const eng = model.engines.map(() => createEngineState());
  const lap = { mil: 1, ab: 1 };
  const fcs = createFcsState(), ap = createApState();
  const ai = createAeroIn(), ao = createAeroOut();
  const turb = createTurbulence(ctx.rng ? ctx.rng() : 0.5);
  const atm = { T: 288.15, p: 101325, rho: 1.225, a: 340.3 };
  const wind = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const gq = { height: 0, type: 'terrain', friction: undefined, velocity: undefined };
  const G = { h0: 0, x0: 0, z0: 0, gx: 0, gz: 0, nx: 0, ny: 1, nz: 0, type: 'terrain', vx: 0, vy: 0, vz: 0, near: false, water: false };
  const wst = wheels.map(() => ({ x: 0, defLat: 0, defLong: 0, omega: 0, onGround: false, airTime: 1, steer: 0, skid: 0, N: 0, dh: 0, mu: 0.8, rollF: 1, rough: 0, water: false, deck: false }));
  const X = { V: 0, ias: 0, iasDot: 0, mach: 0, qbar: 0, alpha: 0, beta: 0, p: 0, q: 0, r: 0, nz: 1, theta: 0, phi: 0, psi: 0, cth: 1, sth: 0, cphi: 1, sphi: 0,
    vs: 0, alt: 0, wow: false, gearHandle: true, iyy: 1, ixx: 1, izz: 1, fCtrl: 1, fCla: 1 };
  const stick = { pitch: 0, roll: 0, yaw: 0 };
  const evq = [];
  // systems
  let gearTarget = 1, gearPos = 1, flapIndex = 0, flapPos = 0, slatPos = 0, sbCmd = 0, sbPos = 0, spL = 0, spR = 0, lastCtlSb = 0, sbToggles = 0;
  let hookTarget = 0, hookPos = 0, canopyTarget = 0, canopyPos = 0, sweepMode = -1, sweepPos = 0;
  let parkingBrake = false, lever = 0, brakeCmd = 0, groundSpoilers = false, reverse = false, lastLeverWritten = -1;
  let wowMain = false, anyGround = false, airTime = 0, groundTime = 0;
  let nzAero = 1, nzOut = 1, nyOut = 0, nzSlow = 1, machPrev = 0, boomArmed = true, iasPrev = 0, osTime = 0;
  let quiet = false, wreckGround = false, arrested = false, catTravel = -1, settleBrake = false, stoppedWreck = false;
  let lastInit = init, trimInfo = null, tailScrape = false;
  let accX = 0, accY = 0, accZ = 0;
  // snapshot for NaN recovery
  const snap = { px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

  function emit(name, payload) { if (!quiet) evq.push(name, payload); }
  function flushEvents() {
    if (!evq.length) return;
    const list = evq.splice(0, evq.length);
    for (let i = 0; i < list.length; i += 2) ctx.events.emit(list[i], list[i + 1]);
  }

  // ---- commands -----------------------------------------------------------------------------------------------------
  function setFlaps(idx) {
    idx = clamp(idx | 0, 0, FL.n - 1);
    if (idx === flapIndex) return;
    flapIndex = idx;
    emit('flaps:moved', { target: FL.pos[idx], index: idx, name: FL.names[idx] });
  }
  function setGear(t) {
    if (t === gearTarget) return;
    gearTarget = t; emit('gear:moved', { target: t });
    if (FL.autoWithGear) setFlaps(t ? FL.landing : 0);
  }
  function command(name) {
    if (s.crashed) return;
    switch (name) {
      case 'gearToggle': if (!anyGround) setGear(gearTarget ? 0 : 1); break;
      case 'gearUp': if (!anyGround) setGear(0); break;
      case 'gearDown': setGear(1); break;
      case 'flapsDown': setFlaps(flapIndex + 1); break;
      case 'flapsUp': setFlaps(flapIndex - 1); break;
      case 'speedbrakeToggle': sbToggles++; break;
      case 'parkingBrakeToggle': parkingBrake = !parkingBrake; break;
      case 'hookToggle': if (C.hook) hookTarget = hookTarget ? 0 : 1; break;
      case 'engineToggle': {
        let any = false; for (let i = 0; i < nE; i++) any = any || eng[i].running;
        for (let i = 0; i < nE; i++) {
          const e = eng[i];
          if (any) { e.running = false; e.starting = false; }
          else if (fuel > 0) { e.running = true; e.starting = true; e.startT = 0; }
        }
        break;
      }
      case 'apToggle':
        if (ap.alt || ap.hdg || ap.spd) apOff();
        else if (!anyGround) { apEngage('alt'); apEngage('hdg'); apEngage('spd'); }
        break;
      case 'apAltHold': if (ap.alt) ap.alt = false; else if (!anyGround) apEngage('alt'); break;
      case 'apHdgHold': if (ap.hdg) ap.hdg = false; else if (!anyGround) apEngage('hdg'); break;
      case 'apSpdHold': if (ap.spd) ap.spd = false; else apEngage('spd'); break;
      case 'trimUp': fcs.trimTarget = clamp(fcs.trimTarget + 0.02, -C.trimAuth, C.trimAuth); break;
      case 'trimDown': fcs.trimTarget = clamp(fcs.trimTarget - 0.02, -C.trimAuth, C.trimAuth); break;
      case 'trimReset': fcs.trimTarget = model.fcs.fbw ? 0 : (trimInfo ? trimInfo.trim : 0); break;
      case 'lightsToggle': s.lights.landing = !s.lights.landing; s.lights.taxi = s.lights.landing; break;
      case 'canopyToggle': if (C.canopy && anyGround && s.groundSpeed < 15) canopyTarget = canopyTarget ? 0 : 1; break;
      case 'wingSweepToggle': if (model.sweep) sweepMode = sweepMode < 0 ? 0 : sweepMode === 0 ? 0.5 : sweepMode === 0.5 ? 1 : -1; break;
      default: break;
    }
  }
  function apEngage(mode) {
    if (mode === 'alt') {
      // smooth capture: aim for the altitude the aircraft would level off at with a gentle push/pull
      const lead = clamp(X.vs * Math.abs(X.vs) / (2 * model.ap.accMax * 0.6), -600, 600);
      ap.alt = true; ap.altRef = pos.y + lead;
    } else if (mode === 'hdg') { ap.hdg = true; ap.hdgRef = X.psi + clamp(X.phi * 0.6, -0.5, 0.5); }
    else if (mode === 'spd') { ap.spd = true; ap.spdRef = X.ias; ap.lever = lever; lastLeverWritten = lever; }
  }
  function apOff() { ap.alt = ap.hdg = ap.spd = false; }
  const off = isPlayer && ctx.events ? ctx.events.on('cmd', (c) => { if (c && c.name) command(c.name); }) : null;

  // ---- helpers ------------------------------------------------------------------------------------------------------
  function computeR() {
    const x = Q.x, y = Q.y, z = Q.z, w = Q.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    r00 = 1 - (yy + zz); r01 = xy - wz; r02 = xz + wy;
    r10 = xy + wz; r11 = 1 - (xx + zz); r12 = yz - wx;
    r20 = xz - wy; r21 = yz + wx; r22 = 1 - (xx + yy);
  }
  function updateMass() {
    mass = model.mass.empty + model.mass.payload + fuel;
    const k = mass / model.mass.inertiaMass;
    ixx = model.mass.ixx * k; iyy = model.mass.iyy * k; izz = model.mass.izz * k; ixz = model.mass.ixz * k;
  }
  function surfaceProps(t, type, friction) {
    const wet = ctx.weather ? clamp(ctx.weather.precipitation || 0, 0, 1) : 0;
    t.water = false; t.deck = false;
    if (type === 'terrain') { t.mu = 0.55 * (1 - 0.3 * wet); t.rollF = 4.5; t.rough = 0.03; }
    else if (type === 'water') { t.mu = 0.3; t.rollF = 20; t.rough = 0; t.water = true; }
    else { t.mu = 0.8 * (1 - 0.4 * wet); t.rollF = 1; t.rough = 0; t.deck = type === 'deck'; }
    if (typeof friction === 'number' && friction > 0) t.mu = friction;
  }
  function sampleGround() {
    const w = ctx.world;
    w.groundAt(pos.x, pos.z, gq);
    G.h0 = gq.height; G.x0 = pos.x; G.z0 = pos.z; G.type = gq.type; G.water = gq.type === 'water';
    const gv = gq.velocity;
    if (gv) { G.vx = gv.x || 0; G.vy = gv.y || 0; G.vz = gv.z || 0; } else { G.vx = G.vy = G.vz = 0; }
    const clearance = pos.y - G.h0;
    G.near = clearance < Math.max(40, 1.2 * model.b) + Math.abs(vel.y) * 0.3;
    G.gx = G.gz = 0; G.nx = 0; G.ny = 1; G.nz = 0;
    if (!G.near) return;
    const hx = w.groundAt(pos.x + 3, pos.z, gq).height, hz = w.groundAt(pos.x, pos.z + 3, gq).height;
    let gx = (hx - G.h0) / 3, gz = (hz - G.h0) / 3;
    if (Math.abs(gx) > 0.6 || Math.abs(gz) > 0.6) { gx = 0; gz = 0; }      // edge / cliff: treat as a step, not a slope
    G.gx = gx; G.gz = gz;
    const inv = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
    G.nx = -gx * inv; G.ny = inv; G.nz = -gz * inv;
    computeR();
    for (let i = 0; i < nW; i++) {
      const W = wheels[i], t = wst[i], by = W.py - W.x0;
      const wx = pos.x + r00 * W.px + r01 * by + r02 * W.pz, wz = pos.z + r20 * W.px + r21 * by + r22 * W.pz;
      w.groundAt(wx, wz, gq);
      t.dh = gq.height - (G.h0 + gx * (wx - G.x0) + gz * (wz - G.z0));
      surfaceProps(t, gq.type, gq.friction);
    }
  }
  function slatSchedule(alpha, mach) {
    const sa = model.slatAuto;
    if (!sa) return FL.slat[flapIndex];
    let v = clamp((alpha - sa.a0) / (sa.a1 - sa.a0), 0, 1);
    if (gearTarget > 0.5 && sa.gearDown > v) v = sa.gearDown;
    return v * (1 - sstep(sa.m0, sa.m1, mach));
  }

  // ---- systems: gear, flaps, slats, spoilers, speedbrake, hook, canopy, sweep ---------------------------------------
  function updateSystems(h) {
    if (gearPos !== gearTarget) gearPos = toward(gearPos, gearTarget, h / (gearTarget > gearPos ? GR.extendTime : GR.retractTime));
    const ft = FL.pos[flapIndex];
    if (flapPos !== ft) flapPos = toward(flapPos, ft, h / FL.time);
    const st = slatSchedule(ao.alpha, ao.mach);
    if (slatPos !== st) slatPos = toward(slatPos, st, h / (model.slatAuto ? 0.8 : FL.slatTime));
    const gs = Math.hypot(vel.x - G.vx, vel.z - G.vz);
    const sp = C.spoilers;
    if (sp) {
      if (sp.autoGround && wowMain && lever < 0.12 && gs > 25 && groundTime > 0.15) groundSpoilers = true;
      else if (groundSpoilers && (lever > 0.3 || !anyGround || (gs < 6 && sbCmd < 0.5))) groundSpoilers = false;
      const base = groundSpoilers || (wowMain && sbCmd > 0.5 && sp.ground) ? 1 : sbCmd * sp.flight;
      const dl = -fcs.da - sp.rollDead, dr = fcs.da - sp.rollDead;
      const lim = base >= 1 ? 1 : sp.rollMax;
      const tl = clamp(base + (dl > 0 ? sp.rollGain * dl : 0), 0, lim), tr = clamp(base + (dr > 0 ? sp.rollGain * dr : 0), 0, lim);
      const m = h / sp.time;
      spL = toward(spL, tl, m); spR = toward(spR, tr, m);
      sbPos = toward(sbPos, groundSpoilers ? 1 : sbCmd, m);
    } else {
      sbPos = toward(sbPos, sbCmd, h / C.sbTime);
    }
    // reversers: auto-deploy on the ground with idle thrust and ground spoilers up, above the cut-off speed
    let rev = false;
    if (groundSpoilers && wowMain && lever < 0.12) {
      const rv = model.engines[0].reverser;
      if (rv) rev = reverse ? gs > rv.stowSpeed : gs > rv.minSpeed;
    }
    reverse = rev;
    if (C.hook && hookPos !== hookTarget) hookPos = toward(hookPos, hookTarget, h / C.hookTime);
    if (canopyPos !== canopyTarget) canopyPos = toward(canopyPos, canopyTarget, h / C.canopyTime);
    if (canopyTarget && gs > 20) canopyTarget = 0;
    if (model.sweep) {
      let t = sweepMode;
      if (t < 0) { const tb = model.sweep.auto; t = tb[tb.length - 1][1]; for (let i = 1; i < tb.length; i++) if (ao.mach <= tb[i][0]) { const a = tb[i - 1], b = tb[i]; t = a[1] + (b[1] - a[1]) * clamp((ao.mach - a[0]) / (b[0] - a[0]), 0, 1); break; } }
      sweepPos = toward(sweepPos, t, h / model.sweep.time);
    }
  }

  // ---- landing gear -------------------------------------------------------------------------------------------------
  let FwX = 0, FwY = 0, FwZ = 0, TwX = 0, TwY = 0, TwZ = 0;      // world force / torque accumulators (contacts)
  function gearForces(h) {
    const nx = G.nx, ny = G.ny, nz = G.nz;
    const wx = r00 * q - r01 * r - r02 * p, wy = r10 * q - r11 * r - r12 * p, wz = r20 * q - r21 * r - r22 * p;
    const upn = r01 * nx + r11 * ny + r21 * nz;
    const brake = settleBrake || parkingBrake ? 1 : brakeCmd;
    const gsp = Math.hypot(vel.x - G.vx, vel.z - G.vz);
    const steerMax = GR.steerLow + (GR.steerHigh - GR.steerLow) * sstep(GR.steerV0, GR.steerV1, gsp);
    let main = false, any = false;
    for (let i = 0; i < nW; i++) {
      const W = wheels[i], t = wst[i];
      if (W.steerable) t.steer = toward(t.steer, stick.yaw * steerMax, GR.steerRate * h);
      const by = W.py - W.x0;
      const rx = r00 * W.px + r01 * by + r02 * W.pz, ry = r10 * W.px + r11 * by + r12 * W.pz, rz = r20 * W.px + r21 * by + r22 * W.pz;
      const Xw = pos.x + rx, Zw = pos.z + rz;
      let hg = G.h0 + G.gx * (Xw - G.x0) + G.gz * (Zw - G.z0) + t.dh;
      if (t.rough > 0) hg += t.rough * (Math.sin(0.83 * Xw + 1.31 * Zw) * Math.sin(1.13 * Zw - 0.71 * Xw) + 0.5 * Math.sin(2.9 * Xw + 2.3 * Zw) - 1.5);
      const pen = (hg - (pos.y + ry)) * ny;
      if (!(pen > 0) || upn < 0.25 || gearPos < 0.98) {
        t.onGround = false; t.airTime += h; t.x = 0; t.N = 0; t.defLat = 0; t.defLong = 0;
        t.omega *= 1 - Math.min(1, h * (gearPos < 0.98 ? 3 : 0.12)); t.skid = 0;
        continue;
      }
      if (t.water) { crash('Ditched in water'); return; }
      let x = pen / upn;
      // contact point (offset from the body origin, world axes) and its velocity relative to the surface
      const xc = x > W.travel ? W.travel : x;
      const cx = rx + r01 * xc, cy = ry + r11 * xc, cz = rz + r21 * xc;
      const vcx = vel.x + wy * cz - wz * cy - G.vx, vcy = vel.y + wz * cx - wx * cz - G.vy, vcz = vel.z + wx * cy - wy * cx - G.vz;
      const vn = vcx * nx + vcy * ny + vcz * nz;
      const xd = -vn / upn;
      if (!t.onGround) {
        const sink = -vn;
        if (t.airTime > 0.25) {
          emit('touchdown', { verticalSpeed: -sink, sinkRate: sink, gear: i, hard: sink > GR.maxSink, speed: gsp });
          if (sink > GR.crashSink) { crash('Hard landing'); return; }
        }
        t.onGround = true; t.airTime = 0;
      }
      let N = W.k * x + (xd > 0 ? W.cC : W.cR) * xd * (x < 0.04 ? x * 25 : 1);
      if (x > W.travel) N += 30 * W.k * (x - W.travel) + 2 * W.cC * (xd > 0 ? xd : 0);
      if (N < 0) N = 0;
      t.x = x; t.N = N;
      any = true; if (!W.steerable) main = true;
      // tyre axes on the surface
      const sd = Math.sin(t.steer), cd = Math.cos(t.steer);
      let fx = r00 * sd - r02 * cd, fy = r10 * sd - r12 * cd, fz = r20 * sd - r22 * cd;
      const fn = fx * nx + fy * ny + fz * nz;
      fx -= fn * nx; fy -= fn * ny; fz -= fn * nz;
      const fl = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      const lx = fy * nz - fz * ny, ly = fz * nx - fx * nz, lz = fx * ny - fy * nx;
      const vlong = vcx * fx + vcy * fy + vcz * fz, vlat = vcx * lx + vcy * ly + vcz * lz;
      const avl = vlong < 0 ? -vlong : vlong;
      const muN = t.mu * N;
      // wheel spin-up
      const wTarget = vlong / W.radius;
      const slip = clamp(Math.abs(vlong - t.omega * W.radius) / (avl > 3 ? avl : 3), 0, 1);
      t.omega += (wTarget - t.omega) * Math.min(1, h / 0.12);
      // longitudinal: rolling resistance + brakes (+ spin-up drag) as elasto-plastic friction (no creep at rest)
      let bmu = 0, locked = 0;
      if (W.braked && brake > 0) {
        bmu = brake * GR.brakeMu;
        if (GR.antiskid) { if (bmu > 0.92 * t.mu) bmu = 0.92 * t.mu; }
        else if (bmu > t.mu) { bmu = 0.75 * t.mu; locked = 1; }
      }
      const cap = (GR.rollMu * t.rollF * (1 + avl * 0.004) + bmu) * N + 0.4 * muN * slip;
      t.defLong += vlong * h;
      let Fl = -(W.kt * t.defLong + W.ct * vlong);
      if (Fl > cap) { Fl = cap; t.defLong = -cap / W.kt; } else if (Fl < -cap) { Fl = -cap; t.defLong = cap / W.kt; }
      // lateral: relaxation-length brush model (exact exponential update), pure spring at rest
      const a = avl / W.relax;
      if (a * h < 1e-3) t.defLat += vlat * h; else { const ss = vlat / a; t.defLat = ss + (t.defLat - ss) * Math.exp(-a * h); }
      let Flat = -(W.kt * t.defLat + W.ct * vlat / (1 + 0.25 * vlong * vlong));
      let rem = muN * muN - Fl * Fl; rem = rem > 0 ? Math.sqrt(rem) : 0;
      let sat = 0;
      if (Flat > rem) { Flat = rem; t.defLat = -rem / W.kt; sat = 1; } else if (Flat < -rem) { Flat = -rem; t.defLat = rem / W.kt; sat = 1; }
      if (Fl > muN) Fl = muN; else if (Fl < -muN) Fl = -muN;
      const sk = Math.max(slip, locked, sat * clamp((Math.abs(vlat) - 1) / 4, 0, 1));
      t.skid += (sk - t.skid) * Math.min(1, h * 12);
      // accumulate
      const Fx = N * nx + Fl * fx + Flat * lx, Fy = N * ny + Fl * fy + Flat * ly, Fz = N * nz + Fl * fz + Flat * lz;
      FwX += Fx; FwY += Fy; FwZ += Fz;
      TwX += cy * Fz - cz * Fy; TwY += cz * Fx - cx * Fz; TwZ += cx * Fy - cy * Fx;
    }
    wowMain = main; anyGround = any;
    // arrestor hook on a carrier deck; catapult
    if (!arrested && C.hook && hookPos > 0.9 && main && wst[nW - 1].deck && gsp > 8) { arrested = true; emit('hook:trap', { speed: gsp }); }
    if (arrested) {
      const f = gsp > 0.5 ? (mass * GR.arrestDecel) / gsp : mass * 8;
      FwX -= f * (vel.x - G.vx); FwZ -= f * (vel.z - G.vz);
      if (!any || hookPos < 0.5) arrested = false;
    }
    if (GR.catapult && main && wst[nW - 1].deck) {
      if (catTravel < 0 && gsp < 3 && lever > 0.88 && brake < 0.1 && groundTime > 1) { catTravel = 0; emit('catapult', {}); }
      if (catTravel >= 0) {
        catTravel += gsp * h;
        if (catTravel < GR.catapult.stroke) { const f = mass * GR.catapult.accel; FwX -= f * r02; FwZ -= f * r22; } else catTravel = -1;
      }
    } else catTravel = -1;
  }

  // ---- structure contact (tail / belly / nose / wingtips / nacelles) -------------------------------------------------
  function structureForces() {
    const nx = G.nx, ny = G.ny, nz = G.nz;
    const wx = r00 * q - r01 * r - r02 * p, wy = r10 * q - r11 * r - r12 * p, wz = r20 * q - r21 * r - r22 * p;
    const gsp = Math.hypot(vel.x - G.vx, vel.z - G.vz);
    for (let i = 0; i < points.length; i++) {
      const P = points[i];
      const rx = r00 * P.x + r01 * P.y + r02 * P.z, ry = r10 * P.x + r11 * P.y + r12 * P.z, rz = r20 * P.x + r21 * P.y + r22 * P.z;
      const hg = G.h0 + G.gx * (pos.x + rx - G.x0) + G.gz * (pos.z + rz - G.z0);
      const pen = (hg - (pos.y + ry)) * ny;
      if (!(pen > 0)) continue;
      const vcx = vel.x + wy * rz - wz * ry - G.vx, vcy = vel.y + wz * rx - wx * rz - G.vy, vcz = vel.z + wx * ry - wy * rx - G.vz;
      const vn = vcx * nx + vcy * ny + vcz * nz, sink = -vn;
      if (G.water) { crash('Ditched in water'); return; }
      if (P.type === 'tail') { if (sink > 2.2 || pen > 0.4) { crash('Tail strike'); return; } tailScrape = true; }
      else if (P.type === 'belly') { crash(gearPos < 0.98 ? 'Gear-up landing' : sink > 4 || gsp > 60 ? 'Collision with terrain' : 'Hard landing'); return; }
      else if (P.type === 'nose') { crash(gsp > 40 || sink > 6 ? 'Collision with terrain' : 'Nose impact'); return; }
      else if (P.type === 'wingtip') { if (gsp > 8 || sink > 2) { crash('Wingtip strike'); return; } }
      else if (P.type === 'nacelle') { if (gsp > 8 || sink > 1.5) { crash('Engine pod strike'); return; } }
      const kS = (mass * G0) / 0.06, cS = Math.sqrt(kS * mass);
      let N = kS * pen - cS * vn; if (N < 0) N = 0;
      const tx = vcx - vn * nx, ty = vcy - vn * ny, tz = vcz - vn * nz, vt = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const ff = (-0.5 * N) / (vt + 0.3);
      const Fx = N * nx + ff * tx, Fy = N * ny + ff * ty, Fz = N * nz + ff * tz;
      FwX += Fx; FwY += Fy; FwZ += Fz;
      TwX += ry * Fz - rz * Fy; TwY += rz * Fx - rx * Fz; TwZ += rx * Fy - ry * Fx;
      anyGround = true;
    }
  }

  function crash(reason) {
    if (s.crashed) return;
    s.crashed = true; s.crashReason = reason;
    emit('crash', { reason, speed: Math.hypot(vel.x, vel.y, vel.z) });
    for (let i = 0; i < nE; i++) { eng[i].running = false; eng[i].starting = false; eng[i].ab = 0; }
    apOff();
    wreckGround = pos.y - G.h0 < 2 * model.cgHeight + 2;
    stoppedWreck = false;
    if (wreckGround && vel.y < 0) vel.y = 0;
  }

  // After a crash: ballistic until the ground, then the wreck slides to a stop and settles on its belly.
  function wreckStep(h) {
    for (let i = 0; i < nE; i++) stepEngine(model.engines[i], eng[i], h, 0, atm.T - 273.15, 0, 0);
    if (stoppedWreck) return;
    const hg = G.h0 + G.gx * (pos.x - G.x0) + G.gz * (pos.z - G.z0);
    const rest = hg + (G.water ? 0.25 * model.restBelly : model.restBelly);
    if (!wreckGround) {
      const sp = Math.hypot(vel.x, vel.y, vel.z), k = (0.5 * atm.rho * A.S * 0.6) / mass;
      vel.x -= k * sp * vel.x * h; vel.y -= (G0 + k * sp * vel.y) * h; vel.z -= k * sp * vel.z * h;
      pos.x += vel.x * h; pos.y += vel.y * h; pos.z += vel.z * h;
      const d = Math.exp(-0.4 * h); p *= d; q *= d; r *= d;
      integrateAttitude(h);
      if (pos.y <= rest) { pos.y = rest; wreckGround = true; vel.y = 0; emit('crash:impact', { speed: sp }); }
      accX = accY = accZ = 0;
      return;
    }
    const sp = Math.hypot(vel.x, vel.z);
    const dec = (G.water ? 14 : 7.5) + 0.004 * sp * sp;
    if (sp > 0.25) { const k = Math.max(0, sp - dec * h) / sp; accX = (vel.x * (k - 1)) / h; accZ = (vel.z * (k - 1)) / h; vel.x *= k; vel.z *= k; }
    else { vel.x = vel.z = 0; accX = accZ = 0; }
    vel.y = 0; accY = 0;
    pos.x += vel.x * h; pos.z += vel.z * h;
    pos.y += (rest - pos.y) * Math.min(1, 5 * h);
    // settle the attitude onto the surface, keeping the heading
    const hdg = Math.atan2(-r02, r22);
    tmpQ.setFromAxisAngle(UP, -hdg);
    Q.slerp(tmpQ, 1 - Math.exp(-2.5 * h)); Q.normalize();
    p = q = r = 0;
    if (sp <= 0.25 && Math.abs(rest - pos.y) < 0.01) stoppedWreck = true;
  }

  function integrateAttitude(h) {
    // Q <- Q ⊗ exp(ω_export · h), ω in export body axes = (q, -r, -p)
    const ox = q * h, oy = -r * h, oz = -p * h;
    const th = Math.sqrt(ox * ox + oy * oy + oz * oz);
    let bx, by, bz, bw;
    if (th < 1e-6) { bx = 0.5 * ox; by = 0.5 * oy; bz = 0.5 * oz; bw = 1; }
    else { const sh = Math.sin(0.5 * th) / th; bx = ox * sh; by = oy * sh; bz = oz * sh; bw = Math.cos(0.5 * th); }
    const ax = Q.x, ay = Q.y, az = Q.z, aw = Q.w;
    let x = ax * bw + aw * bx + ay * bz - az * by, y = ay * bw + aw * by + az * bx - ax * bz;
    let z = az * bw + aw * bz + ax * by - ay * bx, w = aw * bw - ax * bx - ay * by - az * bz;
    const n = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    Q.x = x * n; Q.y = y * n; Q.z = z * n; Q.w = w * n;
  }

  // ---- one integration sub-step ---------------------------------------------------------------------------------------
  function substep(h) {
    computeR();
    if (s.crashed) { wreckStep(h); return; }
    // air-relative velocity in aero body axes (wind + turbulence)
    turb.step(h, ao.V, model.b);
    const vax = vel.x - wind.x, vay = vel.y - wind.y, vaz = vel.z - wind.z;
    const u = -(r02 * vax + r12 * vay + r22 * vaz) - turb.u;
    const v = r00 * vax + r10 * vay + r20 * vaz - turb.v;
    const w = -(r01 * vax + r11 * vay + r21 * vaz) - turb.w;

    updateSystems(h);

    // ---- sensors for the FCS / autopilot
    const sth = -r12, cth = Math.sqrt(1 - sth * sth);
    const phi = Math.atan2(-r10, r11);
    X.V = ao.V; X.mach = ao.mach; X.qbar = ao.qbar; X.alpha = ao.V > 8 ? ao.alpha : 0; X.beta = ao.V > 8 ? ao.beta : 0;
    X.p = p; X.q = q; X.r = r; X.nz = nzAero; X.theta = Math.asin(clamp(sth, -1, 1)); X.phi = phi; X.sth = sth; X.cth = cth;
    X.cphi = Math.cos(phi); X.sphi = Math.sin(phi); X.psi = Math.atan2(-r02, r22); X.vs = vel.y; X.alt = pos.y;
    X.wow = wowMain; X.gearHandle = gearTarget > 0.5; X.iyy = iyy; X.ixx = ixx; X.izz = izz; X.fCtrl = ao.fCtrl; X.fCla = ao.fCla;
    if (ap.alt || ap.hdg || ap.spd) { updateAutopilot(model.ap, ap, X, h); if (ap.spd) lever = ap.lever; }
    updateFcs(model, fcs, X, stick, ap, h);

    // ---- propulsion
    const theta = atm.T / T0, delta = atm.p / P0, tamb = atm.T - 273.15;
    let Tx = 0, Tz = 0, TL = 0, TM = 0, TN = 0, ff = 0;
    for (let i = 0; i < nE; i++) {
      const E = model.engines[i], e = eng[i];
      e.revCmd = reverse;
      if (e.running && !(fuel > 0)) { e.running = false; e.starting = false; }
      stepEngine(E, e, h, lever, tamb, ao.mach, E.vectoring ? fcs.tvec * clamp(1 - ao.qbar / E.vectoring.qFade, 0, 1) : 0);
      if (i === 0 || E !== model.engines[0]) thrustLapse(E, ao.mach, theta, delta, pos.y, lap);
      const T = engineOutput(E, e, lap, ao.mach, theta, delta, ao.qbar);
      ff += e.ff;
      const ang = E.cant + e.vec;                           // + = nozzle deflected to give a nose-up moment
      const fx = ang !== 0 ? T * Math.cos(ang) : T, fz = ang !== 0 ? T * Math.sin(ang) : 0;
      Tx += fx; Tz += fz;
      TL += E.y * fz; TM += E.z * fx - E.x * fz; TN += -E.y * fx;
    }
    if (ff > 0) { fuel -= ff * h; if (fuel < 0) fuel = 0; updateMass(); }

    // ---- aerodynamics
    ai.u = u; ai.v = v; ai.w = w; ai.p = p - turb.p; ai.q = q; ai.r = r; ai.rho = atm.rho; ai.a = atm.a;
    ai.de = fcs.de; ai.da = fcs.da; ai.dr = fcs.dr; ai.trim = model.fcs.fbw ? 0 : fcs.trim;
    ai.flap = flapPos; ai.slat = slatPos; ai.spL = spL; ai.spR = spR; ai.sb = C.spoilers ? 0 : sbPos; ai.gear = gearPos; ai.sweep = sweepPos;
    ai.drSplit = C.splitRudder ? sbPos : 0;
    ai.hWing = pos.y - G.h0; ai.nBuffet = turb.fast; ai.nDrop = turb.slow;
    computeAero(A, ai, ao);

    // ---- body forces/moments (aero axes), contacts in world axes
    const bX = ao.X + Tx, bY = ao.Y, bZ = ao.Z + Tz;
    let Lm = ao.L + TL, Mm = ao.M + TM, Nm = ao.N + TN;
    nzAero = -bZ / (mass * G0);
    FwX = FwY = FwZ = TwX = TwY = TwZ = 0;
    if (G.near) {
      gearForces(h);
      if (s.crashed) return;
      structureForces();
      if (s.crashed) return;
    } else {
      wowMain = false; anyGround = false;
      for (let i = 0; i < nW; i++) { const t = wst[i]; t.onGround = false; t.airTime += h; t.x = 0; t.N = 0; t.skid = 0; t.omega *= 1 - Math.min(1, h * (gearPos < 0.98 ? 3 : 0.12)); }
    }
    if (anyGround) { groundTime += h; airTime = 0; } else { airTime += h; groundTime = 0; }
    // world force: body (fwd = -col2, right = col0, down = -col1) + contacts
    const Fx = -r02 * bX + r00 * bY - r01 * bZ + FwX;
    const Fy = -r12 * bX + r10 * bY - r11 * bZ + FwY;
    const Fz = -r22 * bX + r20 * bY - r21 * bZ + FwZ;
    if (TwX !== 0 || TwY !== 0 || TwZ !== 0) {
      Lm += -(r02 * TwX + r12 * TwY + r22 * TwZ);
      Mm += r00 * TwX + r10 * TwY + r20 * TwZ;
      Nm += -(r01 * TwX + r11 * TwY + r21 * TwZ);
    }
    // specific force felt at the CG (body axes)
    const im = 1 / mass;
    const sfz = -(r01 * Fx + r11 * Fy + r21 * Fz) * im, sfy = (r00 * Fx + r10 * Fy + r20 * Fz) * im;
    const kf = Math.min(1, h / 0.04);
    nzOut += (-sfz / G0 - nzOut) * kf; nyOut += (sfy / G0 - nyOut) * kf;
    nzSlow += (nzAero - nzSlow) * Math.min(1, h / 0.15);

    // ---- integrate (semi-implicit Euler)
    accX = Fx * im; accY = Fy * im - G0; accZ = Fz * im;
    vel.x += accX * h; vel.y += accY * h; vel.z += accZ * h;
    pos.x += vel.x * h; pos.y += vel.y * h; pos.z += vel.z * h;
    const hx = ixx * p - ixz * r, hy = iyy * q, hz = -ixz * p + izz * r;
    const Lp = Lm - (q * hz - r * hy), Mp = Mm - (r * hx - p * hz), Np = Nm - (p * hy - q * hx);
    const gam = ixx * izz - ixz * ixz;
    p += ((izz * Lp + ixz * Np) / gam) * h; q += (Mp / iyy) * h; r += ((ixz * Lp + ixx * Np) / gam) * h;
    if (p > 15) p = 15; else if (p < -15) p = -15;
    if (q > 8) q = 8; else if (q < -8) q = -8;
    if (r > 8) r = 8; else if (r < -8) r = -8;
    integrateAttitude(h);

    // ---- limits / structural checks (airborne aerodynamic loads only)
    if (!anyGround) {
      if (nzSlow > LIM.gMax * LIM.ultimate + 0.5 || nzSlow < LIM.gMin * LIM.ultimate - 0.5) { crash('Structural failure (over-G)'); return; }
    }
    if (pos.y < G.h0 + 0.15) { crash(G.water ? 'Ditched in water' : 'Collision with terrain'); return; }
  }

  // ---- frame step -----------------------------------------------------------------------------------------------------
  function readControls(c) {
    const f = (x, lo, hi) => (x === x ? (x < lo ? lo : x > hi ? hi : x) : 0);
    stick.pitch = f(c.pitch, -1, 1); stick.roll = f(c.roll, -1, 1); stick.yaw = f(c.yaw, -1, 1);
    brakeCmd = f(c.brakes, 0, 1);
    // speedbrake: the Controls field wins when it changes, otherwise the toggle command flips the latch
    const cs = f(c.speedbrake, 0, 1);
    if (cs !== lastCtlSb) { sbCmd = cs; lastCtlSb = cs; }
    else if (sbToggles & 1) { sbCmd = sbCmd > 0.5 ? 0 : 1; if (isPlayer) { c.speedbrake = sbCmd; lastCtlSb = sbCmd; } }
    sbToggles = 0;
    // throttle / autothrottle
    const ct = f(c.throttle, 0, 1);
    if (ap.spd) {
      if (lastLeverWritten >= 0 && Math.abs(ct - lastLeverWritten) > 0.02) { ap.spd = false; lever = ct; }      // pilot moved the lever
    } else lever = ct;
    // large stick input disconnects the autopilot
    if ((ap.alt || ap.hdg) && (Math.abs(stick.pitch) > model.ap.disengage || Math.abs(stick.roll) > model.ap.disengage)) { ap.alt = false; ap.hdg = false; }
  }

  function environment() {
    isaAtmosphere(pos.y, atm);
    if (ctx.weather && ctx.weather.windAt) ctx.weather.windAt(pos, wind); else wind.set(0, 0, 0);
    sampleGround();
    const wx = ctx.weather;
    turb.configure(wx ? clamp(wx.turbulence || 0, 0, 2) : 0, wx && wx.wind ? Math.hypot(wx.wind.x, wx.wind.z) : 0, Math.max(0, pos.y - G.h0 - model.cgHeight), pos.y, wx);
  }

  function step(dtFrame, controls) {
    if (!(dtFrame > 0)) return;
    if (dtFrame > MAX_FRAME) dtFrame = MAX_FRAME;
    const c = controls || ctx.controls;
    if (!s.crashed) readControls(c);
    environment();
    const n = Math.ceil(dtFrame / H_MAX - 1e-9), h = dtFrame / n;
    snap.px = pos.x; snap.py = pos.y; snap.pz = pos.z; snap.vx = vel.x; snap.vy = vel.y; snap.vz = vel.z; snap.qx = Q.x; snap.qy = Q.y; snap.qz = Q.z; snap.qw = Q.w;
    for (let i = 0; i < n; i++) substep(h);
    if (!(fin(pos.x) && fin(pos.y) && fin(pos.z) && fin(vel.x) && fin(vel.y) && fin(vel.z) && fin(Q.x) && fin(Q.y) && fin(Q.z) && fin(Q.w) && fin(p) && fin(q) && fin(r))) recover();
    exportState(dtFrame);
    if (ap.spd && isPlayer && c) { c.throttle = lever; lastLeverWritten = lever; }
    flushEvents();
  }

  function recover() {
    // numerical blow-up guard: restore the last good frame, kill rotation and transient states
    pos.set(snap.px, snap.py, snap.pz); Q.set(snap.qx, snap.qy, snap.qz, snap.qw).normalize();
    vel.set(fin(snap.vx) ? snap.vx : 0, fin(snap.vy) ? snap.vy : 0, fin(snap.vz) ? snap.vz : 0);
    p = q = r = 0; fcs.integ = 0; fcs.de = fcs.da = fcs.dr = 0; turb.reset();
    nzAero = nzOut = nzSlow = 1; nyOut = 0;
    for (let i = 0; i < nW; i++) { const t = wst[i]; t.defLat = t.defLong = 0; t.omega = 0; }
    if (!fin(fuel)) fuel = 0;
    updateMass(); computeR();
    ai.u = 1; ai.v = 0; ai.w = 0; computeAero(A, ai, ao);
    s.nanRecoveries = (s.nanRecoveries || 0) + 1;
  }

  // ---- export the canonical state -------------------------------------------------------------------------------------
  function exportState(dt) {
    computeR();
    const V = ao.V;
    s.acceleration.set(accX, accY, accZ);
    s.bodyRates.p = p; s.bodyRates.q = q; s.bodyRates.r = r;
    s.tas = V; s.mach = ao.mach; s.ias = casFromMach(ao.mach, atm.p);
    s.aoa = V > 3 ? ao.alpha : 0; s.beta = V > 3 ? ao.beta : 0;
    s.altitude = pos.y; s.agl = pos.y - G.h0 - model.cgHeight;
    s.verticalSpeed = vel.y; s.groundSpeed = Math.hypot(vel.x, vel.z);
    let hdg = Math.atan2(-r02, r22); if (hdg < 0) hdg += 2 * Math.PI; s.heading = hdg;
    if (s.groundSpeed > 0.5) { let tr = Math.atan2(vel.x, -vel.z); if (tr < 0) tr += 2 * Math.PI; s.track = tr; } else s.track = hdg;
    s.pitch = Math.asin(clamp(-r12, -1, 1)); s.roll = Math.atan2(-r10, r11);
    s.gLoad = nzOut; s.gLateral = nyOut;
    s.throttle = lever;
    for (let i = 0; i < nE; i++) {
      const e = eng[i], o = s.engines[i];
      o.running = e.running; o.n1 = e.n1; o.n2 = e.n2; o.thrust = e.thrust; o.afterburner = e.ab; o.nozzle = e.nozzle; o.fuelFlow = e.ff; o.egt = e.egt; o.reverser = e.rev;
      o.starting = e.starting;
    }
    const sf = s.surfaces, dt2 = C.dtGain * (A.dtMax / A.deMax);
    sf.aileronR = fcs.da; sf.aileronL = -fcs.da;
    sf.elevatorL = clamp(fcs.de - dt2 * fcs.da, -1, 1); sf.elevatorR = clamp(fcs.de + dt2 * fcs.da, -1, 1);
    sf.rudder = fcs.dr; sf.flaps = flapPos; sf.slats = slatPos;
    sf.spoilerL = spL; sf.spoilerR = spR; sf.speedbrake = sbPos; sf.gear = gearPos; sf.hook = hookPos; sf.wingSweep = sweepPos; sf.canopy = canopyPos;
    sf.nozzlePitch = model.engines[0].vectoring ? eng[0].vec / model.engines[0].vectoring.max : 0;
    sf.trim = fcs.trim;
    for (let i = 0; i < nW; i++) { const t = wst[i], o = s.gear[i]; o.onGround = t.onGround; o.compression = clamp(t.x / wheels[i].travel, 0, 1); o.wheelSpeed = t.omega; o.steer = t.steer; o.skid = t.skid; }
    s.onGround = anyGround || (s.crashed && wreckGround);
    s.brakes = parkingBrake ? 1 : brakeCmd; s.parkingBrake = parkingBrake; s.flapsIndex = flapIndex;
    s.mass = mass; s.fuel = fuel; s.fuelCapacity = model.mass.fuelCap;
    const flying = !anyGround && V > 12 && !s.crashed;
    s.stalled = flying && (ao.stallMargin < 0 || ao.alpha < -(A.a0n - A.peakOff));
    s.stallWarning = flying && (ao.stallMargin < A.warnMargin || (model.fcs.fbw && fcs.alphaProt && nzSlow < 2.5));
    s.buffet = flying ? ao.buffet * clamp(ao.qbar / 3000, 0, 1) : 0;
    s.overspeed = s.ias > LIM.vmo || ao.mach > LIM.mmo;
    s.overG = flying && (nzSlow > LIM.gMax + 0.25 || nzSlow < LIM.gMin - 0.25);
    s.tailStrike = tailScrape; tailScrape = false;
    s.reverse = reverse; s.groundSpoilers = groundSpoilers; s.arrested = arrested;
    const a = s.ap; a.engaged = ap.alt || ap.hdg || ap.spd;
    a.mode = (ap.alt ? 'ALT ' : '') + (ap.hdg ? 'HDG ' : '') + (ap.spd ? 'SPD' : '');
    a.altitude = ap.altRef; a.heading = ap.hdgRef < 0 ? ap.hdgRef + 2 * Math.PI : ap.hdgRef; a.speed = ap.spdRef; a.verticalSpeed = ap.vsCmd; a.autothrottle = ap.spd;
    a.altHold = ap.alt; a.hdgHold = ap.hdg;
    // air-data derived rates for the autothrottle
    if (dt > 0) { const d = (s.ias - iasPrev) / dt; X.iasDot += (d - X.iasDot) * Math.min(1, dt / 0.6); }
    iasPrev = s.ias; X.ias = s.ias;
    // events from thresholds
    if (!quiet && !s.crashed) {
      if (boomArmed && machPrev < 1 && ao.mach >= 1) { emit('sonicBoom', undefined); boomArmed = false; }
      if (ao.mach < 0.96) boomArmed = true;
      // sustained gross overspeed breaks the airframe
      if (s.ias > LIM.vmo * LIM.overspeedFactor || ao.mach > LIM.mmo + 0.25) { osTime += dt; if (osTime > 3) crash('Structural failure (overspeed)'); } else osTime = 0;
    }
    machPrev = ao.mach;
  }

  // ---- trim solver ------------------------------------------------------------------------------------------------------
  const tr = { Fx: 0, Fz: 0, My: 0 };
  function evalTrim(alpha, de, lev, V, gamma) {
    const th = alpha + gamma;
    ai.u = V * Math.cos(alpha); ai.v = 0; ai.w = V * Math.sin(alpha); ai.p = ai.q = ai.r = 0; ai.rho = atm.rho; ai.a = atm.a;
    ai.de = de; ai.da = 0; ai.dr = 0; ai.trim = 0;
    ai.flap = flapPos; ai.slat = slatSchedule(alpha, V / atm.a); ai.spL = ai.spR = 0; ai.sb = 0; ai.gear = gearPos; ai.sweep = sweepPos; ai.drSplit = 0;
    ai.hWing = 1e4; ai.nBuffet = 0; ai.nDrop = 0;
    computeAero(A, ai, ao);
    const theta = atm.T / T0, delta = atm.p / P0;
    let Tx = 0, Tz = 0, TM = 0;
    for (let i = 0; i < nE; i++) {
      const E = model.engines[i], e = eng[i];
      setEngineSteady(E, e, lev, true);
      thrustLapse(E, ao.mach, theta, delta, pos.y, lap);
      const T = engineOutput(E, e, lap, ao.mach, theta, delta, ao.qbar);
      const fx = T * Math.cos(E.cant), fz = T * Math.sin(E.cant);
      Tx += fx; Tz += fz; TM += E.z * fx - E.x * fz;
    }
    tr.Fx = ao.X + Tx - mass * G0 * Math.sin(th);
    tr.Fz = ao.Z + Tz + mass * G0 * Math.cos(th);
    tr.My = ao.M + TM;
  }
  function trimSolve(V, gamma) {
    let alpha = 0.06, de = 0, lev = 0.5;
    const aLo = -0.14, aHi = FL.a0[flapIndex] * 0.97;
    let ok = false;
    for (let it = 0; it < 40; it++) {
      // elevator for zero pitching moment (two-point secant; nearly linear)
      evalTrim(alpha, de, lev, V, gamma); const m0 = tr.My;
      evalTrim(alpha, de + 0.05, lev, V, gamma); const m1 = tr.My;
      if (Math.abs(m1 - m0) > 1e-9) de = clamp(de - (m0 * 0.05) / (m1 - m0), -1, 1);
      // alpha for zero normal force (Newton, numeric slope)
      evalTrim(alpha, de, lev, V, gamma); const z0 = tr.Fz;
      evalTrim(alpha + 0.002, de, lev, V, gamma); const z1 = tr.Fz;
      let da = Math.abs(z1 - z0) > 1e-9 ? (-z0 * 0.002) / (z1 - z0) : 0;
      alpha = clamp(alpha + clamp(da, -0.05, 0.05), aLo, aHi);
      // lever for zero axial force (bisection; thrust is monotonic in the lever)
      let lo = 0, hi = 1;
      evalTrim(alpha, de, 1, V, gamma);
      if (tr.Fx < 0) lev = 1;
      else {
        evalTrim(alpha, de, 0, V, gamma);
        if (tr.Fx > 0) lev = 0;
        else { for (let k = 0; k < 28; k++) { lev = 0.5 * (lo + hi); evalTrim(alpha, de, lev, V, gamma); if (tr.Fx > 0) hi = lev; else lo = lev; } }
      }
      evalTrim(alpha, de, lev, V, gamma);
      if (Math.abs(tr.Fz) < 1e-4 * mass * G0 && Math.abs(tr.My) < 1e-5 * mass * G0 * A.c && Math.abs(da) < 1e-6) { ok = Math.abs(tr.Fx) < 2e-3 * mass * G0; if (it > 2) break; }
    }
    return { alpha, de, lever: lev, converged: ok, fx: tr.Fx / (mass * G0), fz: tr.Fz / (mass * G0) };
  }

  // ---- reset / initial conditions ---------------------------------------------------------------------------------------
  function reset(i) {
    i = i || lastInit || {}; lastInit = i;
    const fresh = createAircraftState();
    s.acceleration.set(0, 0, 0); s.bodyRates.p = s.bodyRates.q = s.bodyRates.r = 0;
    s.crashed = false; s.crashReason = ''; s.stalled = s.stallWarning = s.overspeed = s.overG = false;
    Object.assign(s.lights, fresh.lights); Object.assign(s.ap, fresh.ap);
    evq.length = 0;
    p = q = r = 0; wreckGround = false; stoppedWreck = false; arrested = false; catTravel = -1; reverse = false; groundSpoilers = false;
    nzAero = nzOut = nzSlow = 1; nyOut = 0; osTime = 0; boomArmed = true; tailScrape = false;
    apOff(); Object.assign(fcs, createFcsState()); turb.reset();
    fuel = clamp(typeof i.fuel === 'number' ? (i.fuel <= 1 ? i.fuel * model.mass.fuelCap : i.fuel) : model.mass.fuelInit, 0, model.mass.fuelCap);
    updateMass();
    const onGround = !!i.onGround;
    const hdg = i.heading || 0;
    gearTarget = gearPos = (i.gearDown || onGround) ? 1 : 0;
    // flaps: explicit detent index, else nearest detent to the 0..1 request; ground starts get the take-off setting
    const fr = typeof i.flaps === 'number' ? i.flaps : 0;
    if (typeof i.flapsIndex === 'number') flapIndex = clamp(i.flapsIndex | 0, 0, FL.n - 1);
    else if (fr >= 0.99) flapIndex = FL.landing;
    else if (fr <= 0.01) flapIndex = onGround ? FL.takeoff : 0;
    else { flapIndex = 0; let bd = 9; for (let k = 0; k < FL.n; k++) { const d = Math.abs(FL.pos[k] - fr); if (d < bd) { bd = d; flapIndex = k; } } }
    if (FL.autoWithGear) flapIndex = gearTarget ? FL.landing : 0;
    flapPos = FL.pos[flapIndex]; slatPos = model.slatAuto ? 0 : FL.slat[flapIndex];
    sbCmd = sbPos = spL = spR = 0; sbToggles = 0; lastCtlSb = ctx.controls && isPlayer ? (ctx.controls.speedbrake = 0) : 0;
    hookTarget = hookPos = 0; canopyTarget = canopyPos = 0; sweepMode = -1; sweepPos = 0;
    parkingBrake = !!i.parkingBrake; brakeCmd = 0; lastLeverWritten = -1;
    s.lights.landing = gearTarget > 0.5; s.lights.taxi = onGround;
    s.engines.length = 0; for (let k = 0; k < nE; k++) s.engines.push({ running: true, n1: 0, n2: 0, thrust: 0, afterburner: 0, nozzle: 0, fuelFlow: 0, egt: 0, reverser: 0, starting: false });
    s.gear.length = 0; for (let k = 0; k < nW; k++) { s.gear.push({ onGround: false, compression: 0, wheelSpeed: 0, steer: 0, skid: 0 }); const t = wst[k]; t.x = 0; t.defLat = t.defLong = 0; t.omega = 0; t.onGround = false; t.airTime = 1; t.steer = 0; t.skid = 0; t.N = 0; }
    pos.copy(i.position || pos);
    stick.pitch = stick.roll = stick.yaw = 0;
    trimInfo = null;
    const running = i.enginesRunning !== false;

    if (onGround) {
      // static equilibrium on the gear: park at the reference height, let the struts settle, then freeze
      const gh = ctx.world.groundHeightAt ? ctx.world.groundHeightAt(pos.x, pos.z) : ctx.world.groundAt(pos.x, pos.z, gq).height;
      pos.y = gh + model.cgHeight;
      Q.setFromAxisAngle(UP, -hdg);
      const v0 = i.speed || 0;
      vel.set(Math.sin(hdg) * v0, 0, -Math.cos(hdg) * v0);
      lever = clamp(i.throttle || 0, 0, 1);
      for (let k = 0; k < nE; k++) setEngineSteady(model.engines[k], eng[k], v0 > 1 ? lever : 0, running);
      if (model.sweep) sweepPos = model.sweep.auto[0][1];
      isaAtmosphere(pos.y, atm); wind.set(0, 0, 0);
      ai.u = Math.max(v0, 0.2); ai.v = 0; ai.w = 0; ai.rho = atm.rho; ai.a = atm.a; computeAero(A, ai, ao);
      if (v0 < 1) {
        quiet = true; settleBrake = true;
        const x0 = pos.x, z0 = pos.z, savedLever = lever; lever = 0;
        environment(); wind.set(0, 0, 0); turb.sigma = 0;
        for (let k = 0; k < 720; k++) { substep(H_MAX); if (k % 60 === 59) { pos.x = x0; pos.z = z0; } }
        // remove any residual motion; keep the settled height and attitude
        const yaw = Math.atan2(-r02, r22);
        tmpQ.setFromAxisAngle(UP, yaw - hdg); Q.premultiply(tmpQ).normalize();
        pos.x = x0; pos.z = z0; vel.set(0, 0, 0); p = q = r = 0;
        for (let k = 0; k < nW; k++) { wst[k].defLat = 0; wst[k].defLong = 0; wst[k].omega = 0; wst[k].airTime = 0; }
        quiet = false; settleBrake = false; lever = savedLever; s.crashed = false; s.crashReason = '';
        groundTime = 1; airTime = 0; fcs.law = 0; fcs.integ = 0;
        fuel = clamp(typeof i.fuel === 'number' ? (i.fuel <= 1 ? i.fuel * model.mass.fuelCap : i.fuel) : model.mass.fuelInit, 0, model.mass.fuelCap); updateMass();
      }
    } else {
      // trimmed flight: level, or on a 3° descent for an approach start (gear down + landing flap)
      const approach = gearTarget > 0.5 && fr > 0.5;
      const gamma = typeof i.gamma === 'number' ? i.gamma : approach ? -3 * Math.PI / 180 : 0;
      const V = Math.max(20, i.speed || (model.specs.cruiseSpeed || 150));
      isaAtmosphere(pos.y, atm);
      if (model.sweep) { const tb = model.sweep.auto, M = V / atm.a; sweepPos = tb[tb.length - 1][1]; for (let k = 1; k < tb.length; k++) if (M <= tb[k][0]) { const a = tb[k - 1], b = tb[k]; sweepPos = a[1] + (b[1] - a[1]) * clamp((M - a[0]) / (b[0] - a[0]), 0, 1); break; } }
      const t = trimSolve(V, gamma);
      trimInfo = { alpha: t.alpha, elevator: t.de, lever: t.lever, converged: t.converged, gamma, speed: V, trim: 0 };
      const th = t.alpha + gamma;
      Q.setFromAxisAngle(UP, -hdg); tmpQ.setFromAxisAngle(tmpV.set(1, 0, 0), th); Q.multiply(tmpQ).normalize();
      if (ctx.weather && ctx.weather.windAt) ctx.weather.windAt(pos, wind); else wind.set(0, 0, 0);
      const ch = Math.cos(gamma) * V;
      vel.set(Math.sin(hdg) * ch + wind.x, Math.sin(gamma) * V + wind.y, -Math.cos(hdg) * ch + wind.z);
      lever = t.lever;
      for (let k = 0; k < nE; k++) setEngineSteady(model.engines[k], eng[k], lever, running);
      slatPos = slatSchedule(t.alpha, V / atm.a);
      fcs.law = 1;
      if (model.fcs.fbw) { fcs.integ = t.de; fcs.de = fcs.deCmd = t.de; }
      else {
        const tn = clamp(t.de * (A.deMax / A.trimMax), -C.trimAuth, C.trimAuth);
        fcs.trim = fcs.trimTarget = tn; trimInfo.trim = tn;
        fcs.de = fcs.deCmd = t.de - tn * (A.trimMax / A.deMax);
      }
      airTime = 5; groundTime = 0; wowMain = false; anyGround = false;
      for (let k = 0; k < nW; k++) wst[k].airTime = 5;
      nzAero = nzOut = nzSlow = Math.cos(gamma);
      computeR();
      ai.u = V * Math.cos(t.alpha); ai.w = V * Math.sin(t.alpha); ai.v = 0; ai.de = fcs.de; ai.trim = model.fcs.fbw ? 0 : fcs.trim; ai.slat = slatPos; computeAero(A, ai, ao);
    }
    if (isPlayer && ctx.controls) { ctx.controls.throttle = lever; }
    computeR();
    environment();
    machPrev = ao.mach; iasPrev = casFromMach(ao.mach, atm.p); X.ias = iasPrev; X.iasDot = 0;
    exportState(0);
    evq.length = 0;
  }

  reset(init);

  return {
    state: s, step, reset, command,
    dispose() { if (off) off(); },
    /** Read-only handles for tools/tests (flight-test, HUD debug). Not part of the cross-module contract. */
    model,
    get trim() { return trimInfo; },
    debug: { aero: ao, fcs, ap, engines: eng, wheels: wst, atmosphere: atm, sensors: X, turbulence: turb },
  };
}
