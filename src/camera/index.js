// Camera rig — Skyward. API: createCameraRig(ctx) -> { mode, modes, setMode(m), update(dt), worldPosition, velocity, isInterior }
//
// All persistent camera state is kept in WORLD space (doubles) or relative to the aircraft; the render-space camera
// position is recomputed every frame through ctx.world.toRender, so floating-origin shifts never cause a jump.
// update(dt) takes REAL seconds. Modes compute a target pose; the rig eases between poses on mode changes.
//
// Input conventions (see INTEGRATION.md): controls.lookX/lookY in -1..1 are *deflections* (look right / look up),
// controls.zoom > 0 zooms IN. Optional ctx.input.lookDelta ({x,y} or [x,y], px-ish per frame; x>0 = look right,
// y>0 = look up) and ctx.input.zoomDelta (wheel notches/frame, >0 = in) are used when present.
import * as THREE from 'three';
import { AIRPORTS } from '../data/airports.js';
import {
  clamp, saturate, lerp, smoothstep, damp, dampAngle, dampK, easeInOut, noise,
  buildFrame, lookQuat, chaseFrameTarget, framingDistance, trackFov, sizeFor,
} from './cammath.js';

const DEG = Math.PI / 180;
const MODES = ['chase', 'cockpit', 'orbit', 'flyby', 'tower', 'wing'];
const ALL_MODES = [...MODES, 'showcase'];
const FAR = 600000;
const BLEND_TIME = 0.6;

const V3 = () => new THREE.Vector3();
const pose = () => ({ pos: V3(), quat: new THREE.Quaternion(), fov: 60, near: 1 });
const Y_UP = new THREE.Vector3(0, 1, 0);

export async function createCameraRig(ctx) {
  const cam = ctx.camera;
  const world = ctx.world;
  const events = ctx.events;

  // ---------- scratch (no per-frame allocation) ----------
  const t1 = V3(), t2 = V3(), t3 = V3(), t4 = V3(), t5 = V3();
  const tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tq3 = new THREE.Quaternion();
  const eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const gnd = {};

  // ---------- aircraft info, refreshed every frame ----------
  const A = {
    has: false, def: null, size: sizeFor(null), pos: V3(), q: new THREE.Quaternion(), qInv: new THREE.Quaternion(),
    vel: V3(), speed: 0, vdir: V3(0, 0, -1), nose: V3(), up: V3(), right: V3(), acc: V3(), prevVel: V3(), accValid: false,
    g: 1, roll: 0, st: null, geo: null, pilotEye: [0, 1, -3], onGround: false, ab: 0, sf: 0, cruise: 240, category: '', roughness: 0,
  };
  function refresh(dt) {
    const p = ctx.player;
    A.has = !!p;
    if (!p) { A.st = null; A.accValid = false; return; }
    const st = A.st = p.state;
    if (p.def !== A.def) {
      A.def = p.def; A.geo = p.def?.geometry || {}; A.size = sizeFor(A.geo);
      A.pilotEye = A.geo.pilotEye || [0, A.size.H * 0.25, -A.size.L * 0.25];
      A.cruise = p.def?.specs?.cruiseSpeed || 240; A.category = p.def?.category || '';
    }
    A.pos.copy(st.position);
    A.q.copy(st.quaternion); if (A.q.lengthSq() < 0.5) A.q.identity(); else A.q.normalize();
    A.qInv.copy(A.q).invert();
    A.nose.set(0, 0, -1).applyQuaternion(A.q); A.up.set(0, 1, 0).applyQuaternion(A.q); A.right.set(1, 0, 0).applyQuaternion(A.q);
    A.vel.copy(st.velocity); A.speed = A.vel.length();
    if (A.speed > 0.5) A.vdir.copy(A.vel).multiplyScalar(1 / A.speed); else A.vdir.copy(A.nose);
    A.onGround = !!st.onGround;
    A.sf = clamp((st.tas || A.speed) / A.cruise, 0, 1.3);
    let ab = 0; const en = st.engines; if (en) for (let i = 0; i < en.length; i++) ab = Math.max(ab, en[i]?.afterburner || 0);
    A.ab = damp(A.ab, ab, 3, dt);
    // inertial acceleration from simulated dt (so pause / time scale behave)
    const sdt = ctx.time?.dt || 0;
    if (sdt > 1e-5) {
      if (A.accValid) {
        t1.copy(A.vel).sub(A.prevVel).multiplyScalar(1 / sdt);
        if (t1.lengthSq() > 1e6) t1.setLength(1000);     // teleports / resets
        A.acc.lerp(t1, dampK(8, dt > 0 ? dt : sdt));
      }
      A.prevVel.copy(A.vel); A.accValid = true;
    }
    const g = st.gLoad; A.g = damp(A.g, Number.isFinite(g) && g !== 0 ? g : 1, 8, dt);
    A.roll = Number.isFinite(st.roll) ? st.roll : 0;
  }

  // ---------- shared shake / events state ----------
  const S = { clk: 0, trauma: 0, gain: 1, joltY: 0, joltV: 0, joltP: 0, joltPV: 0 };
  function shakeLevel() {
    const st = A.st; if (!st) return 0;
    const turb = ctx.weather?.turbulence || 0;
    let a = turb * 0.35;
    if (st.stalled) a += 0.5; else if (st.stallWarning) a += 0.18;
    a += A.ab * 0.12;
    if (st.onGround) a += saturate((st.groundSpeed || A.speed) / 60) * 0.22;
    a += S.trauma * S.trauma;
    return clamp(a, 0, 1);
  }
  // writes small noise rotation into tq (Euler) and position noise into t5 (metres) for the current frame
  function shakeApply(amp, rotScale, posScale, outPos) {
    const a = amp * S.gain, t = S.clk;
    eul.set(noise(t * 9, 1) * a * rotScale, noise(t * 8.3, 2) * a * rotScale, noise(t * 7.1, 3) * a * rotScale * 0.7, 'YXZ');
    tq3.setFromEuler(eul);
    outPos.set(noise(t * 11, 4), noise(t * 12.7, 5), noise(t * 10.3, 6)).multiplyScalar(a * posScale);
    return tq3;
  }

  // ---------- user input helpers ----------
  function stepLook(s, dt, yawMax, pitchUp, pitchDown) {
    const c = ctx.controls || {};
    let lx = c.lookX || 0, ly = c.lookY || 0;
    const ty = clamp(lx, -1, 1) * yawMax, tp = ly >= 0 ? clamp(ly, 0, 1) * pitchUp : clamp(ly, -1, 0) * pitchDown;
    const active = Math.abs(lx) + Math.abs(ly) > 0.02;
    const lam = active ? 7 : 9;
    s.y = damp(s.y, ty, lam, dt); s.p = damp(s.p, tp, lam, dt);
  }
  function zoomInput(dt) {
    const z = (ctx.controls?.zoom || 0) * dt * 1.2 + (ctx.input?.zoomDelta || 0) * 0.1;
    return Number.isFinite(z) ? z : 0;
  }
  function lookDelta() {
    const d = ctx.input?.lookDelta; if (!d) return null;
    const x = d.x ?? d[0], y = d.y ?? d[1];
    return Number.isFinite(x) && Number.isFinite(y) ? d : null;
  }
  const newLook = () => ({ y: 0, p: 0 });

  function groundAt(wx, wz) { return world.groundAt ? world.groundAt(wx, wz, gnd).height : 0; }

  // ============================================================ CHASE
  const chase = {
    fresh: true, qT: new THREE.Quaternion(), q1: new THREE.Quaternion(), qf: new THREE.Quaternion(), qfInv: new THREE.Quaternion(),
    look: newLook(), zoom: 1, dist: 0, rollK: 0.0, lag: V3(), bank: 0, fov: 55,
    enter() { this.fresh = true; },
    compute(dt, out) {
      const { L, H, big } = A.size;
      this.zoom = clamp(this.zoom * Math.exp(-zoomInput(dt)), 0.45, 3.2);
      this.rollK = damp(this.rollK, A.onGround ? 0 : 0.35, 3, dt);
      chaseFrameTarget(this.qT, A.nose, A.vdir, A.speed, A.up, this.rollK);
      if (this.fresh) { this.q1.copy(this.qT); this.qf.copy(this.qT); this.lag.set(0, 0, 0); this.bank = 0; this.dist = 0; }
      this.q1.slerp(this.qT, dampK(3.6, dt));
      this.qf.slerp(this.q1, dampK(6.5, dt));
      stepLook(this.look, dt, 175 * DEG, 70 * DEG, 25 * DEG);

      const base = 1.5 * big;
      const gComp = 1 - 0.016 * clamp(A.g - 1, -1, 8);
      const dT = base * this.zoom * (1 + 0.16 * A.sf + 0.07 * A.ab) * gComp;
      this.dist = this.fresh ? dT : damp(this.dist, dT, 3, dt);
      const h = 0.11 * this.dist + 0.3 * H;

      // camera offset in the chase frame, orbited by look input
      t1.set(0, h, this.dist);
      eul.set(this.look.p, -this.look.y, 0, 'YXZ'); tq.setFromEuler(eul); t1.applyQuaternion(tq);
      // inertial lag: camera trails against acceleration
      this.qfInv.copy(this.qf).invert();
      t2.copy(A.acc).applyQuaternion(this.qfInv).multiplyScalar(-0.022 * (big / 15));
      const lim = 0.3 * L; t2.x = clamp(t2.x, -lim, lim); t2.y = clamp(t2.y, -lim, lim); t2.z = clamp(t2.z, -lim, lim);
      if (this.fresh) this.lag.copy(t2); else this.lag.lerp(t2, dampK(4, dt));
      t1.add(this.lag).applyQuaternion(this.qf);
      out.pos.copy(A.pos).add(t1);

      // shake
      const amp = shakeLevel();
      const sq = shakeApply(amp, 0.012, 0.03 * (big / 15), t5);
      out.pos.add(t5.applyQuaternion(this.qf));

      // keep out of the ground
      const gy = groundAt(out.pos.x, out.pos.z) + 2.0;
      if (out.pos.y < gy) out.pos.y = gy;

      // look target: slightly above the aircraft, biased into the turn
      this.bank = this.fresh ? A.roll : damp(this.bank, A.roll, 2.5, dt);
      t3.set(1, 0, 0).applyQuaternion(this.qf);   // frame right
      t4.set(0, 1, 0).applyQuaternion(this.qf);   // frame up
      t2.copy(A.pos).addScaledVector(t4, 0.1 * H + 0.04 * L).addScaledVector(t3, clamp(this.bank, -1.2, 1.2) * 0.3 * L);
      lookQuat(out.quat, out.pos, t2, t4);
      out.quat.multiply(sq);
      out.fov = this.fov = this.fresh ? 54 + 7 * A.sf : damp(this.fov, 54 + 7 * A.sf + 4 * A.ab + 1.5 * clamp(A.g - 1, 0, 6), 2.5, dt);
      out.near = clamp(L * 0.05, 0.8, 2);
      this.fresh = false;
    },
  };

  // ============================================================ COCKPIT
  const cockpit = {
    fresh: true, look: newLook(), fov: 72, sag: 0, aB: V3(), eye: V3(),
    enter() { this.fresh = true; },
    compute(dt, out) {
      this.fov = clamp(this.fov * Math.exp(-zoomInput(dt)), 30, 90);
      stepLook(this.look, dt, 150 * DEG, 80 * DEG, 40 * DEG);
      const e = A.pilotEye;
      this.aB.copy(A.acc).applyQuaternion(A.qInv);
      const aB = this.aB;
      const gx = clamp(0.011 * (A.g - 1), -0.05, 0.12);
      // head-in-body offset: g sag, inertial fore/aft and lateral shift
      this.eye.set(
        e[0] + clamp(-aB.x * 0.0022, -0.05, 0.05),
        e[1] - gx + S.joltY,
        e[2] + clamp(-aB.z * 0.0014, -0.06, 0.06),
      );
      // rumble on the ground
      const st = A.st;
      const sh = shakeLevel();
      const rough = st.onGround ? saturate((st.groundSpeed || A.speed) / 70) : 0;
      this.eye.y += noise(S.clk * 38, 7) * 0.0035 * rough * S.gain;
      const sq = shakeApply(sh, 0.0045, 0.004, t5);
      this.eye.add(t5);
      t1.copy(this.eye).applyQuaternion(A.q);
      out.pos.copy(A.pos).add(t1);

      const lean = clamp(-aB.x * 0.0024, -0.07, 0.07);
      eul.set(this.look.p + S.joltP, -this.look.y, lean, 'YXZ');
      tq.setFromEuler(eul);
      out.quat.copy(A.q).multiply(tq).multiply(sq);
      out.fov = this.fov; out.near = 0.1;
      this.fresh = false;
    },
  };

  // ============================================================ ORBIT
  const orbit = {
    fresh: true, az: 0.55, el: 0.2, dist: 0, zoom: 1, hdg: 0, crashed: false, centerUp: 0,
    enter() { this.fresh = true; },
    compute(dt, out) {
      const { L, H, big } = A.size;
      const ld = lookDelta(), c = ctx.controls || {};
      // look right -> camera swings left; look up -> camera drops (view tilts up), like the head-look in the cockpit
      if (ld) { this.az += (ld.x ?? ld[0]) * 0.005; this.el -= (ld.y ?? ld[1]) * 0.005; }
      else { this.az += (c.lookX || 0) * dt * 1.9; this.el -= (c.lookY || 0) * dt * 1.2; }
      this.el = clamp(this.el, -0.35, 1.4);
      this.zoom = clamp(this.zoom * Math.exp(-zoomInput(dt)), 0.35, 8);
      // heading reference follows the aircraft smoothly (stable through loops: horizontal projection of nose, else keep)
      const hl = Math.hypot(A.nose.x, A.nose.z);
      const hdg = hl > 0.05 ? Math.atan2(A.nose.x, -A.nose.z) : this.hdg;
      // near-vertical the heading is ill-defined: slow the follow rate to nothing so loops don't whip the view around
      this.hdg = this.fresh ? hdg : dampAngle(this.hdg, hdg, 2.5 * smoothstep(0.2, 0.7, hl), dt);
      const dT = 2.3 * big * this.zoom * (this.crashed ? 2.2 : 1);
      this.dist = this.fresh ? dT : damp(this.dist, dT, 4, dt);
      const th = this.hdg + this.az + Math.PI, ce = Math.cos(this.el);
      t1.set(Math.sin(th) * ce, Math.sin(this.el), -Math.cos(th) * ce).multiplyScalar(this.dist);
      t2.copy(A.pos); t2.y += 0.15 * H;
      out.pos.copy(t2).add(t1);
      const sq = shakeApply(this.crashed ? 0 : shakeLevel() * 0.5, 0.006, 0.01, t5);
      out.pos.add(t5);
      const gy = groundAt(out.pos.x, out.pos.z) + 2.0;
      if (out.pos.y < gy) out.pos.y = gy;
      lookQuat(out.quat, out.pos, t2, Y_UP);
      out.quat.multiply(sq);
      out.fov = 50; out.near = clamp(L * 0.06, 1, 2);
      this.fresh = false;
    },
  };

  // ============================================================ tracking helper (flyby / tower)
  function track(s, camPos, dt, out, lam, frac, minFov, maxFov, handheld) {
    const { H, big } = A.size;
    t2.copy(A.pos); t2.y += 0.1 * H;
    lookQuat(tq, camPos, t2, Y_UP);
    if (s.fresh) s.q.copy(tq); else s.q.slerp(tq, dampK(lam, dt));
    const d = camPos.distanceTo(t2);
    const fovT = trackFov(big, d, frac, minFov, maxFov);
    s.fov = s.fresh ? fovT : damp(s.fov, fovT, 3.5, dt);
    out.quat.copy(s.q);
    if (handheld > 0) {
      const a = handheld * (s.fov / 30);
      eul.set(noise(S.clk * 1.9, 11) * a, noise(S.clk * 1.6, 12) * a, noise(S.clk * 1.3, 13) * a * 0.3, 'YXZ');
      tq2.setFromEuler(eul); out.quat.multiply(tq2);
    }
    out.fov = s.fov;
    out.pos.copy(camPos);
  }

  // ============================================================ FLYBY
  const flyby = {
    fresh: true, placed: false, pos: V3(), q: new THREE.Quaternion(), fov: 30, side: 1, age: 0, D: 0, passDist: 0,
    enter() { this.fresh = true; this.placed = false; },
    place() {
      const { L, span, big } = A.size;
      const sp = A.speed;
      this.side = -this.side;
      // horizontal flight direction
      t3.set(A.vdir.x, 0, A.vdir.z);
      if (sp < 3 || t3.lengthSq() < 0.01) t3.set(A.nose.x, 0, A.nose.z);
      if (t3.lengthSq() < 1e-4) t3.set(0, 0, -1);
      t3.normalize();
      t4.set(-t3.z, 0, t3.x).multiplyScalar(this.side);       // lateral (perpendicular, either side)
      let ahead, lateral;
      if (sp < 12) { ahead = 2.2 * big; lateral = 1.5 * big; }
      else { ahead = clamp(sp * 5.5, 7 * big, 1800); lateral = Math.max(2.4 * span, Math.min(30 + sp * 0.28, 150)); }
      this.D = Math.hypot(ahead, lateral); this.passDist = sp < 12 ? 1e9 : Math.max(sp * 1.6, 4 * big);
      this.pos.copy(A.pos).addScaledVector(t3, ahead).addScaledVector(t4, lateral);
      const g = groundAt(this.pos.x, this.pos.z);
      const agl = A.pos.y - g;
      if (agl < 400) this.pos.y = g + clamp(agl * 0.2, 2.5, 18) + (sp < 12 ? 1.2 : 0);
      else this.pos.y = A.pos.y - Math.min(60, agl * 0.1);
      this.pos.y = Math.max(this.pos.y, g + 2.0);
      this.age = 0; this.placed = true;
      this.fresh = true;       // re-aim and re-zoom instantly on a new set-up (hard cut)
    },
    compute(dt, out) {
      this.age += dt;
      if (!this.placed) this.place();
      else {
        t1.copy(A.pos).sub(this.pos);
        t3.set(A.vdir.x, 0, A.vdir.z); if (t3.lengthSq() < 1e-4) t3.set(A.nose.x, 0, A.nose.z); t3.normalize();
        const along = t1.dot(t3);                         // + : aircraft is beyond the camera (already passed)
        const dist = t1.length();
        if (this.age > 2 && (along > this.passDist || dist > this.D * 2.6 + 400)) this.place();
      }
      this.pos.y = Math.max(this.pos.y, groundAt(this.pos.x, this.pos.z) + 2.0);
      track(this, this.pos, dt, out, 11, 0.22, 2.5, 55, 0.0012);
      out.near = 1.0;
      this.fresh = false;
    },
  };

  // ============================================================ TOWER
  const towers = new Map();
  const tower = {
    fresh: true, q: new THREE.Quaternion(), fov: 30, pos: V3(), idx: 0, ri: 0, timer: 0,
    enter() { this.fresh = true; this.timer = 0; },
    pickRunway() {
      const ap = AIRPORTS[this.idx]; let best = 1e18; this.ri = 0;
      for (let i = 0; i < ap.runways.length; i++) {
        const c = ap.runways[i].center, dx = A.pos.x - c.x, dz = A.pos.z - c.z, d = dx * dx + dz * dz;
        if (d < best) { best = d; this.ri = i; }
      }
    },
    towerFor(i) {
      const ap = AIRPORTS[i];
      const tp = ctx.scenery?.airports?.[i]?.towerPosition;
      if (tp && Number.isFinite(tp.x) && Number.isFinite(tp.z)) {
        const v = towers.get('s' + ap.id) || V3(); towers.set('s' + ap.id, v);
        return v.set(tp.x, Number.isFinite(tp.y) ? tp.y : ap.elevation + 35, tp.z);
      }
      const ri = Math.min(this.ri, ap.runways.length - 1), key = ap.id + ':' + ri;
      let v = towers.get(key);
      if (!v) {
        // beside the runway midpoint (400 m to its side), 35 m up
        const rw = ap.runways[ri], h = rw.heading * DEG;
        v = V3(rw.center.x + Math.cos(h) * 400, ap.elevation + 35, rw.center.z + Math.sin(h) * 400);
        towers.set(key, v);
      }
      return v;
    },
    compute(dt, out) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 1.0;
        let best = 1e18, bi = 0;
        for (let i = 0; i < AIRPORTS.length; i++) {
          const a = AIRPORTS[i]; const dx = A.pos.x - a.position.x, dz = A.pos.z - a.position.z; const d = dx * dx + dz * dz;
          if (d < best) { best = d; bi = i; }
        }
        // hysteresis: keep the current one unless clearly beaten
        if (bi !== this.idx) {
          const c = AIRPORTS[this.idx]; const dx = A.pos.x - c.position.x, dz = A.pos.z - c.position.z;
          if (this.fresh || best < (dx * dx + dz * dz) * 0.6) { this.idx = bi; this.fresh = true; this.pickRunway(); }
        } else if (this.fresh) this.pickRunway();
      }
      this.pos.copy(this.towerFor(this.idx));
      this.pos.y = Math.max(this.pos.y, groundAt(this.pos.x, this.pos.z) + 20);
      track(this, this.pos, dt, out, 8, 0.2, 1.5, 55, 0.0006);
      out.near = 2.0;
      this.fresh = false;
    },
  };

  // ============================================================ WING
  const wing = {
    fresh: true, look: newLook(), fov: 64, eye: V3(),
    enter() { this.fresh = true; },
    compute(dt, out) {
      const { L, span, H } = A.size;
      this.fov = clamp(this.fov * Math.exp(-zoomInput(dt)), 30, 90);
      stepLook(this.look, dt, 120 * DEG, 60 * DEG, 40 * DEG);
      const liner = A.category === 'airliner' || A.category === 'transport';
      let baseYaw, basePitch;
      if (liner) {
        // passenger window just ahead of the wing, looking out and slightly forward along it
        this.eye.set(span * 0.052, A.pilotEye[1] - 0.35, -L * 0.03);
        baseYaw = -72 * DEG; basePitch = -9 * DEG;
      } else {
        const wt = A.geo?.wingtips?.[1];
        if (wt) this.eye.set(wt[0] * 0.97, wt[1] + 0.55, wt[2] - 0.2); else this.eye.set(span * 0.5, 0.5, 0.5);
        baseYaw = 32 * DEG; basePitch = -5 * DEG;
      }
      const sh = shakeLevel();
      const sq = shakeApply(sh, 0.004, 0.003, t5);
      t1.copy(this.eye).add(t5).applyQuaternion(A.q);
      out.pos.copy(A.pos).add(t1);
      eul.set(basePitch + this.look.p + S.joltP, baseYaw - this.look.y, 0, 'YXZ');
      tq.setFromEuler(eul);
      out.quat.copy(A.q).multiply(tq).multiply(sq);
      out.fov = this.fov; out.near = 0.1;
      this.fresh = false;
    },
  };

  // ============================================================ SHOWCASE
  const show = {
    fresh: true, t: 0, dist: 0, fov: 32,
    enter() { this.fresh = true; },
    compute(dt, out) {
      const { L, H, big } = A.size;
      this.t += dt;
      const t = this.t;
      const aspect = cam.aspect || 16 / 9;
      const vfov = 32;
      // wide layouts: the hangar menu has panels left and right, the aircraft must fit the gap between them
      // (about 36 % of the width, centred slightly left of and above the screen centre)
      const wide = aspect > 1.25;
      const baseD = framingDistance(0.58 * big, vfov, wide ? aspect * 0.36 : aspect);
      const dT = baseD * (1 + 0.07 * Math.sin(t * 0.09 + 2));
      this.dist = this.fresh ? dT : damp(this.dist, dT, 1.2, dt);
      const az = 0.75 + 0.6 * Math.sin(t * 0.068);               // swings between near-front and 3/4 front
      const el = 0.06 + 0.035 * Math.sin(t * 0.11 + 1);          // low angle
      const hl = Math.hypot(A.nose.x, A.nose.z);
      const hdg = hl > 0.2 ? Math.atan2(A.nose.x, -A.nose.z) : 0;
      const th = hdg + az, ce = Math.cos(el);
      t2.copy(A.pos); t2.y += 0.1 * H;
      t1.set(Math.sin(th) * ce, Math.sin(el), -Math.cos(th) * ce).multiplyScalar(this.dist);
      out.pos.copy(t2).add(t1);
      const gy = groundAt(out.pos.x, out.pos.z) + 0.9;
      if (out.pos.y < gy) out.pos.y = gy;
      // shift framing so the aircraft sits right/centre (menu is left and bottom)
      const hf = Math.tan(vfov * DEG / 2);
      const sx = wide ? -0.03 : 0.0, sy = wide ? -0.16 : 0.22;
      lookQuat(tq, out.pos, t2, Y_UP);
      t3.set(1, 0, 0).applyQuaternion(tq); t4.set(0, 1, 0).applyQuaternion(tq);
      t2.addScaledVector(t3, -sx * this.dist * hf * aspect).addScaledVector(t4, sy * this.dist * hf);
      lookQuat(out.quat, out.pos, t2, Y_UP);
      out.fov = vfov; out.near = clamp(L * 0.05, 0.8, 2);
      this.fresh = false;
    },
  };

  // ============================================================ IDLE (no aircraft)
  const idle = {
    compute(dt, out) {
      const ap = AIRPORTS[0], r = ap.runways[0], h = r.heading * DEG;
      const fx = Math.sin(h), fz = -Math.cos(h);
      const c = r.center, t = S.clk;
      out.pos.set(c.x - fx * (r.length * 0.5 + 260) - fz * 70 + Math.sin(t * 0.05) * 25,
        ap.elevation + 22 + Math.sin(t * 0.07) * 4, c.z - fz * (r.length * 0.5 + 260) + fx * 70 + Math.cos(t * 0.05) * 15);
      t2.set(c.x + fx * 500, ap.elevation + 8, c.z + fz * 500);
      lookQuat(out.quat, out.pos, t2, Y_UP);
      out.fov = 55; out.near = 1;
    },
  };

  const impl = { chase, cockpit, orbit, flyby, tower, wing, showcase: show };

  // ============================================================ rig
  const tp = pose(), from = pose(), cur = pose();
  const prevPos = V3();
  let prevValid = false, blend = 1, blendDur = BLEND_TIME, snapNext = true;
  let prevMode = null, crashed = false;
  let lastFov = NaN, lastNear = NaN;
  const finite = (p) => Number.isFinite(p.pos.x + p.pos.y + p.pos.z + p.quat.x + p.quat.y + p.quat.z + p.quat.w + p.fov + p.near);

  const rig = {
    mode: 'chase', modes: MODES.slice(), allModes: ALL_MODES.slice(),
    worldPosition: new THREE.Vector3(), velocity: new THREE.Vector3(), isInterior: false,
    setMode(m, opts) {
      if (!ALL_MODES.includes(m)) return false;
      if (m === rig.mode && !opts?.force) return true;
      rig.mode = m; blend = 0; blendDur = opts?.duration ?? BLEND_TIME;
      from.pos.copy(cur.pos); from.quat.copy(cur.quat); from.fov = cur.fov; from.near = cur.near;
      if (prevValid === false) blend = 1;
      impl[m].enter?.();
      rig.isInterior = m === 'cockpit' || (m === 'wing' && A.category === 'airliner');
      events.emit('camera:mode', m);
      return true;
    },
    next(dir = 1) {
      const i = MODES.indexOf(rig.mode);
      const n = i < 0 ? (dir > 0 ? 0 : MODES.length - 1) : (i + dir + MODES.length) % MODES.length;
      rig.setMode(MODES[n]);
    },
    snap() { snapNext = true; },
    update(dt) {
      dt = Number.isFinite(dt) ? clamp(dt, 0, 0.25) : 0;
      S.clk += dt;
      S.gain = damp(S.gain, ctx.time?.paused ? 0 : 1, 6, dt);
      S.trauma = Math.max(0, S.trauma - dt * 0.9);
      // jolt springs (critically-ish damped, ~3 Hz)
      { const w = 19, c = 7; S.joltV += (-w * w * S.joltY - c * S.joltV) * dt; S.joltY += S.joltV * dt;
        S.joltPV += (-w * w * S.joltP - c * S.joltPV) * dt; S.joltP += S.joltPV * dt; }
      refresh(dt);

      if (!A.has) idle.compute(dt, tp); else impl[rig.mode].compute(dt, tp);
      if (!finite(tp)) { for (const k in impl) impl[k].enter?.(); S.joltY = S.joltV = S.joltP = S.joltPV = 0; return; }

      // blend
      const hasPose = prevValid;
      let snapped = false;
      if (snapNext) {
        blend = 1; snapNext = false; snapped = true;
      } else if (blend < 1 && hasPose) {
        const dd = from.pos.distanceTo(tp.pos);
        if (dd > 250 + 10 * A.size.L) blend = 1;           // too far apart to fly between: cut
        else blend = Math.min(1, blend + dt / blendDur);
      }
      if (blend >= 1) { cur.pos.copy(tp.pos); cur.quat.copy(tp.quat); cur.fov = tp.fov; cur.near = tp.near; }
      else {
        const e = easeInOut(blend);
        cur.pos.lerpVectors(from.pos, tp.pos, e); cur.quat.copy(from.quat).slerp(tp.quat, e);
        cur.fov = lerp(from.fov, tp.fov, e); cur.near = lerp(from.near, tp.near, e);
      }

      // apply (render space)
      world.toRender(cur.pos, cam.position);
      cam.quaternion.copy(cur.quat);
      let proj = false;
      if (Math.abs(cam.fov - cur.fov) > 1e-3) { cam.fov = cur.fov; proj = true; }
      if (Math.abs(cam.near - cur.near) > 1e-4) { cam.near = cur.near; proj = true; }
      if (cam.far !== FAR) { cam.far = FAR; proj = true; }
      if (proj) cam.updateProjectionMatrix();

      // bookkeeping + smoothed velocity (world)
      if (!prevValid || snapped) rig.velocity.set(0, 0, 0);
      else if (dt > 1e-4) {
        t1.copy(cur.pos).sub(prevPos).multiplyScalar(1 / dt);
        if (t1.lengthSq() > 1e8) rig.velocity.set(0, 0, 0); else rig.velocity.lerp(t1, dampK(10, dt));
      }
      prevPos.copy(cur.pos); prevValid = true;
      rig.worldPosition.copy(cur.pos);
    },
  };

  // ---------- events ----------
  events.on('cmd', ({ name } = {}) => {
    if (!name) return;
    if (name === 'cameraNext') rig.next(1);
    else if (name === 'cameraPrev') rig.next(-1);
    else if (name.startsWith('camera:')) rig.setMode(name.slice(7));
  });
  events.on('touchdown', (e) => {
    const vs = Math.abs(e?.verticalSpeed || 0);
    S.joltV -= Math.min(vs * 0.32, 2.2);
    S.joltPV -= Math.min(vs * 0.04, 0.3);
    S.trauma = Math.min(1, S.trauma + clamp(vs / 7, 0.05, 0.8));
  });
  events.on('crash', () => {
    if (crashed) return;
    crashed = true; prevMode = rig.mode;
    S.trauma = 1;
    orbit.crashed = true;
    orbit.el = 0.35;
    rig.setMode('orbit', { force: true, duration: 1.2 });
    orbit.crashed = true;
  });
  events.on('session:start', () => {
    refresh(0);
    A.accValid = false; A.acc.set(0, 0, 0); A.g = 1; A.ab = 0;
    S.joltY = S.joltV = S.joltP = S.joltPV = S.trauma = 0;
    orbit.crashed = false;
    towers.clear();
    if (crashed) { crashed = false; if (prevMode && prevMode !== 'orbit') rig.setMode(prevMode); prevMode = null; }
    for (const k in impl) impl[k].enter?.();
    if (rig.mode === 'showcase') { blend = 0; blendDur = 1.8; from.pos.copy(cur.pos); from.quat.copy(cur.quat); from.fov = cur.fov; from.near = cur.near; }
    else snapNext = true;
  });
  events.on('session:end', () => { A.accValid = false; });

  return rig;
}
