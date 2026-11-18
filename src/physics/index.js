// STUB flight model (arcade) — the flight-dynamics agent replaces this with the real 6-DOF simulation.
// API to keep:  createSim(ctx, def, init) -> { state, step(dt, controls), reset(init), dispose() }
//   init = { position: Vector3 (world), heading (rad), speed (m/s TAS), onGround, gearDown, throttle (0..1), flaps (0..1) }
import * as THREE from 'three';
import { createAircraftState } from '../core/state.js';
import { G0 } from '../core/constants.js';
import { clamp, wrap2Pi, moveToward } from '../core/math.js';

export function isaAtmosphere(h) {
  const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
  const p = h < 11000 ? 101325 * Math.pow(T / 288.15, 5.2559) : 22632 * Math.exp(-(h - 11000) / 6341.6);
  return { T, p, rho: p / (287.053 * T), a: Math.sqrt(1.4 * 287.053 * T) };
}

export function createSim(ctx, def, init) {
  const s = createAircraftState(), sp = def.specs, g = def.geometry;
  const fwd = new THREE.Vector3(), up = new THREE.Vector3(), right = new THREE.Vector3(), F = new THREE.Vector3(), dq = new THREE.Quaternion(), e = new THREE.Euler(), vAir = new THREE.Vector3(), wind = new THREE.Vector3();
  const ground = {};
  let gearTarget = 1, flapTarget = 0, sbTarget = 0;
  const off = ctx.events.on('cmd', ({ name }) => {
    if (name === 'gearToggle' && !s.onGround) gearTarget = 1 - gearTarget;
    if (name === 'flapsDown') flapTarget = Math.min(1, flapTarget + 0.25);
    if (name === 'flapsUp') flapTarget = Math.max(0, flapTarget - 0.25);
    if (name === 'speedbrakeToggle') sbTarget = 1 - sbTarget;
  });
  function reset(i) {
    Object.assign(s, createAircraftState());
    s.position.copy(i.position); s.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -i.heading);
    fwd.set(0, 0, -1).applyQuaternion(s.quaternion); s.velocity.copy(fwd).multiplyScalar(i.speed || 0);
    s.mass = sp.typicalMass; s.fuel = sp.fuelCapacity * 0.6; s.fuelCapacity = sp.fuelCapacity; s.throttle = i.throttle || 0;
    gearTarget = i.gearDown ? 1 : 0; s.surfaces.gear = gearTarget; flapTarget = i.flaps || 0; s.surfaces.flaps = flapTarget;
    s.engines = Array.from({ length: sp.engineCount }, () => ({ running: true, n1: 0.3, n2: 0.6, thrust: 0, afterburner: 0, nozzle: 0, fuelFlow: 0, egt: 400, reverser: 0 }));
    s.gear = g.gear.map(() => ({ onGround: !!i.onGround, compression: 0.3, wheelSpeed: 0, steer: 0, skid: 0 }));
    s.onGround = !!i.onGround; ctx.controls.throttle = s.throttle;
    derive(0);
  }
  function derive(dt) {
    const atm = isaAtmosphere(s.position.y);
    fwd.set(0, 0, -1).applyQuaternion(s.quaternion); up.set(0, 1, 0).applyQuaternion(s.quaternion); right.set(1, 0, 0).applyQuaternion(s.quaternion);
    ctx.weather.windAt(s.position, wind); vAir.copy(s.velocity).sub(wind);
    s.tas = vAir.length(); s.ias = s.tas * Math.sqrt(atm.rho / 1.225); s.mach = s.tas / atm.a;
    const vf = vAir.dot(fwd), vu = vAir.dot(up), vr = vAir.dot(right);
    s.aoa = s.tas > 1 ? Math.atan2(-vu, vf) : 0; s.beta = s.tas > 1 ? Math.asin(clamp(vr / s.tas, -1, 1)) : 0;
    e.setFromQuaternion(s.quaternion, 'YXZ'); s.heading = wrap2Pi(-e.y); s.pitch = e.x; s.roll = -e.z;
    s.altitude = s.position.y; ctx.world.groundAt(s.position.x, s.position.z, ground); s.agl = s.position.y - ground.height - g.cgHeight;
    s.verticalSpeed = s.velocity.y; s.groundSpeed = Math.hypot(s.velocity.x, s.velocity.z); s.track = wrap2Pi(Math.atan2(s.velocity.x, -s.velocity.z));
    return atm;
  }
  function step(dtFrame, c) {
    const n = Math.max(1, Math.ceil(dtFrame / (1 / 120))), dt = dtFrame / n;
    for (let i = 0; i < n; i++) sub(dt, c);
  }
  function sub(dt, c) {
    if (s.crashed) return;
    const atm = derive(dt), q = 0.5 * atm.rho * s.tas * s.tas, S = g.wingArea;
    s.throttle = c.throttle; s.brakes = c.brakes;
    s.surfaces.gear = moveToward(s.surfaces.gear, gearTarget, dt / 5); s.surfaces.flaps = moveToward(s.surfaces.flaps, flapTarget, dt / 8); s.surfaces.speedbrake = moveToward(s.surfaces.speedbrake, sbTarget, dt * 2);
    const ab = sp.thrustMax > sp.thrustDry ? clamp((c.throttle - 0.9) / 0.1, 0, 1) : 0, mil = sp.thrustMax > sp.thrustDry ? clamp(c.throttle / 0.9, 0, 1) : c.throttle;
    const lapse = Math.pow(atm.rho / 1.225, 0.7);
    for (const en of s.engines) { en.n1 = moveToward(en.n1, 0.25 + 0.75 * mil, dt * 0.35); en.afterburner = moveToward(en.afterburner, ab, dt * 2); en.thrust = (sp.thrustDry * Math.max(0, (en.n1 - 0.25) / 0.75) ** 2 + (sp.thrustMax - sp.thrustDry) * en.afterburner) * lapse; en.nozzle = en.afterburner; }
    const thrust = s.engines.reduce((a, en) => a + en.thrust, 0);
    const clMax = 1.4 + 0.9 * s.surfaces.flaps, cl = clamp(5.0 * (s.aoa + 0.02 + 0.12 * s.surfaces.flaps), -clMax, clMax);
    const cd = 0.022 + 0.06 * cl * cl + 0.03 * s.surfaces.gear + 0.05 * s.surfaces.flaps + 0.06 * s.surfaces.speedbrake + (s.mach > 0.9 ? 0.03 : 0);
    F.set(0, -G0 * s.mass, 0).addScaledVector(fwd, thrust);
    if (s.tas > 0.5) { F.addScaledVector(vAir, (-q * S * cd) / s.tas); const liftDir = up.clone().addScaledVector(vAir, -up.dot(vAir) / (s.tas * s.tas)).normalize(); F.addScaledVector(liftDir, q * S * cl); F.addScaledVector(right, -q * S * 1.2 * s.beta); }
    s.gLoad = s.tas > 0.5 ? (q * S * cl) / (s.mass * G0) : 1;
    // kinematic rotation: rate ∝ control × dynamic-pressure authority, plus weathervaning
    const auth = clamp(q / 6000, 0, 1) * (def.category === 'airliner' ? 0.35 : 1);
    const pr = c.roll * 3.2 * auth, qr = c.pitch * 1.1 * auth - s.aoa * 0.9 * auth * (Math.abs(c.pitch) < 0.05 ? 1 : 0.3), rr = c.yaw * 0.4 * auth + s.beta * 1.5 * auth + (s.onGround ? c.yaw * 0.5 * clamp(s.groundSpeed / 10, 0, 1) : 0);
    s.bodyRates.p = pr; s.bodyRates.q = qr; s.bodyRates.r = rr;
    dq.setFromEuler(e.set(qr * dt, -rr * dt, -pr * dt, 'XYZ')); s.quaternion.multiply(dq).normalize();
    s.acceleration.copy(F).multiplyScalar(1 / s.mass); s.velocity.addScaledVector(s.acceleration, dt); s.position.addScaledVector(s.velocity, dt);
    s.surfaces.aileronR = c.roll; s.surfaces.aileronL = -c.roll; s.surfaces.elevatorL = s.surfaces.elevatorR = c.pitch; s.surfaces.rudder = c.yaw;
    // ground
    ctx.world.groundAt(s.position.x, s.position.z, ground);
    const minY = ground.height + g.cgHeight;
    s.onGround = false;
    if (s.position.y <= minY) {
      if (ground.type === 'water' || s.velocity.y < -8 || s.surfaces.gear < 0.9 || Math.abs(s.roll) > 0.5) { s.crashed = true; s.crashReason = ground.type === 'water' ? 'Ditched' : 'Hard impact'; s.velocity.set(0, 0, 0); ctx.events.emit('crash', { reason: s.crashReason }); }
      s.position.y = minY; if (s.velocity.y < 0) s.velocity.y = 0; s.onGround = true;
      const mu = 0.02 + 0.5 * c.brakes + (s.parkingBrake ? 0.5 : 0), sp2 = Math.hypot(s.velocity.x, s.velocity.z);
      if (sp2 > 0.01) { const dec = Math.min(sp2, mu * G0 * dt); s.velocity.x -= (s.velocity.x / sp2) * dec; s.velocity.z -= (s.velocity.z / sp2) * dec; }
      // kill sideways slip, keep nose from digging
      const side = s.velocity.dot(right); s.velocity.addScaledVector(right, -side * Math.min(1, dt * 8));
      e.setFromQuaternion(s.quaternion, 'YXZ'); if (e.x < 0) e.x *= Math.max(0, 1 - dt * 6); e.z *= Math.max(0, 1 - dt * 6); s.quaternion.setFromEuler(e);
    }
    for (const w of s.gear) w.onGround = s.onGround;
    s.stalled = Math.abs(s.aoa) > 0.3 && !s.onGround; s.stallWarning = Math.abs(s.aoa) > 0.24 && !s.onGround;
    s.fuel = Math.max(0, s.fuel - thrust * 2.2e-5 * dt);
  }
  reset(init);
  return { state: s, step, reset, dispose() { off(); } };
}
