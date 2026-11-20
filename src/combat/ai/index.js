// AI PILOTS — placeholder implementation written by the integrator so the rest of combat runs.
// The AI agent replaces the internals; the API below (documented in COMBAT.md §7) must be kept.
import * as THREE from 'three';
import { clamp, toBody, headingVec } from '../util.js';

export function createAi(combat) {
  const v = new THREE.Vector3(), aim = new THREE.Vector3(), sol = { point: new THREE.Vector3() };
  /**
   * createPilot(entity, { skill: 0..1, order }) -> pilot. The pilot writes entity.controls every update, chooses entity.target and
   * uses combat.weapons (setTrigger / launchMissile / dropFlares) like a human would.
   */
  function createPilot(e, o = {}) {
    const skill = clamp(o.skill ?? e.skill ?? 0.5, 0, 1);
    let order = o.order || { type: 'engage' }, think = 0, flareT = 0, mslT = 3 + 6 * combat.rng();
    const pilot = {
      entity: e, skill, mode: 'cruise',          // mode: short label of what the pilot is doing (HUD / radio / debug)
      setOrder(ord) { order = ord || { type: 'engage' }; },
      get order() { return order; },
      update(dt) {
        const s = e.state, c = e.controls, W = combat.weapons;
        if ((think -= dt) <= 0) {
          think = 0.5;
          if (order.type === 'engage') e.target = (order.target && order.target.alive ? order.target : null) || combat.world.nearestEnemy(e, 60000);
          else e.target = null;
        }
        const t = e.target && e.target.alive ? e.target : null;
        const ground = combat.ctx.world.groundHeightAt(s.position.x, s.position.z);
        const agl = s.position.y - ground;
        let fire = false;
        if (t) {
          pilot.mode = 'pursuit';
          const g = W.gunSolution(e, t, sol);
          aim.copy(g.range < 1500 ? g.point : t.state.position);
        } else if (order.type === 'patrol' && order.waypoints?.length) {
          pilot.mode = 'patrol';
          const wp = order.waypoints[(order.index || 0) % order.waypoints.length];
          aim.copy(wp); if (v.copy(wp).sub(s.position).setY(0).length() < 1500) order.index = ((order.index || 0) + 1) % order.waypoints.length;
        } else if (order.type === 'escort' && order.leader?.alive) {
          pilot.mode = 'formation';
          const L = order.leader; aim.copy(L.state.position).addScaledVector(L.forward, 600).addScaledVector(L.right, order.offset?.x ?? 60).addScaledVector(L.up, order.offset?.y ?? 0);
        } else {
          pilot.mode = 'cruise';
          headingVec(order.heading ?? 0, aim).multiplyScalar(5000).add(s.position); aim.y = order.alt ?? Math.max(s.position.y, ground + 1500);
        }
        // steer: roll the lift vector onto the aim point, then pull
        toBody(s, aim, v);
        const off = Math.atan2(Math.hypot(v.x, v.y), -v.z);
        let rollErr = Math.atan2(v.x, v.y);
        if (off < 0.05) rollErr = -s.roll;               // nearly on the nose: wings toward level, fine-track with pitch/yaw
        let pitch = clamp(off * 3 * Math.cos(clamp(rollErr, -1.4, 1.4)), -0.4, 1);
        if (off < 0.05) { pitch = clamp(v.y / Math.max(-v.z, 1) * 14, -1, 1); c.yaw = clamp(v.x / Math.max(-v.z, 1) * 10, -1, 1); } else c.yaw = 0;
        // ground avoidance wins over everything
        const sink = -s.verticalSpeed, floor = 450 + sink * 6;
        if (agl < floor) { pilot.mode = 'recover'; rollErr = -s.roll; pitch = Math.abs(s.roll) < 1.2 ? 1 : 0.2; }
        c.roll = clamp(rollErr * 2.2 - s.bodyRates.p * 0.35, -1, 1);
        c.pitch = pitch * (0.65 + 0.35 * skill);
        c.throttle = s.ias < 230 || pitch > 0.6 ? 1 : 0.85;
        c.speedbrake = 0;
        if (t) {
          const r = v.length();
          fire = off < 0.03 + 0.02 * (1 - skill) && r < 1100;
          if ((mslT -= dt) <= 0 && e.lock?.state === 'locked') { if (W.launchMissile(e)) mslT = 12 - 6 * skill + 6 * combat.rng(); }
        }
        W.setTrigger(e, fire);
        // flares when a missile is inbound
        if ((flareT -= dt) <= 0) for (const m of W.missiles) if (m.target === e && m.state.position.distanceToSquared(s.position) < 3000 * 3000) { if (combat.rng() < 0.3 + 0.6 * skill) W.dropFlares(e); flareT = 0.7; break; }
      },
    };
    return pilot;
  }
  return { createPilot };
}
