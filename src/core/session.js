// Flight session: spawns the player's aircraft, steps physics, keeps the visual in sync. Owned by the integrator.
import * as THREE from 'three';
import { getAircraft, AIRCRAFT } from '../aircraft/registry.js';
import { getAirport, runwayEnd, AIRPORTS } from '../data/airports.js';
import { DEG } from './constants.js';
import { createSim } from '../physics/index.js';

export function createSession(ctx) {
  const tmp = new THREE.Vector3();
  let last = null;
  const session = {
    active: false,
    options: null,
    /**
     * opts: { aircraft: id, airport: id, runway: index (0), end: 0|1, start: 'runway'|'air'|'approach',
     *         alt (m MSL), spd (m/s TAS), hdg (deg true) }
     */
    start(opts = {}) {
      session.end();
      const def = getAircraft(opts.aircraft || ctx.params.aircraft || AIRCRAFT[0].id);
      const airport = getAirport(opts.airport || ctx.params.airport || AIRPORTS[0].id);
      const rwy = runwayEnd(airport.runways[opts.runway || 0], opts.end || 0);
      const mode = opts.start || ctx.params.start || 'runway';
      const init = { position: new THREE.Vector3(), heading: rwy.heading * DEG, speed: 0, onGround: true, gearDown: true, throttle: 0, flaps: 0 };
      if (mode === 'air') {
        const hdg = (opts.hdg ?? ctx.params.hdg ?? rwy.heading);
        const alt = opts.alt ?? ctx.params.alt ?? airport.elevation + 1500;
        init.position.set(rwy.threshold.x, alt, rwy.threshold.z);
        init.heading = hdg * DEG; init.speed = opts.spd ?? ctx.params.spd ?? def.specs.cruiseSpeed * 0.8;
        init.onGround = false; init.gearDown = false; init.throttle = 0.7;
      } else if (mode === 'approach') {
        const dist = 9000, gs = 3 * DEG;
        init.position.set(rwy.threshold.x - rwy.dir.x * dist, airport.elevation + 15 + Math.tan(gs) * dist, rwy.threshold.z - rwy.dir.z * dist);
        init.speed = def.specs.approachSpeed * 1.08; init.onGround = false; init.gearDown = true; init.throttle = 0.45; init.flaps = 1;
      } else {
        const x = rwy.threshold.x + rwy.dir.x * 80, z = rwy.threshold.z + rwy.dir.z * 80;
        init.position.set(x, ctx.world.groundHeightAt(x, z) + def.geometry.cgHeight, z);
      }
      const visual = def.createVisual(ctx);
      ctx.scene.add(visual.object3D);
      const sim = createSim(ctx, def, init);
      ctx.player = { id: def.id, def, sim, state: sim.state, visual, airport, runway: rwy };
      ctx.world.updateOrigin(sim.state.position);
      session.active = true; session.options = { ...opts, aircraft: def.id, airport: airport.id, start: mode }; last = session.options;
      syncVisual(0);
      ctx.events.emit('session:start', ctx.player);
      return ctx.player;
    },
    restart() { if (last) session.start(last); },
    end() {
      if (!ctx.player) return;
      ctx.events.emit('session:end', ctx.player);
      ctx.scene.remove(ctx.player.visual.object3D);
      // a failing dispose must never leave a dead session behind
      try { ctx.player.visual.dispose?.(); } catch (e) { console.warn('[session] visual dispose failed', e); }
      try { ctx.player.sim.dispose?.(); } catch (e) { console.warn('[session] sim dispose failed', e); }
      ctx.player = null; session.active = false;
    },
    update(dt) {
      const p = ctx.player; if (!p) return;
      if (dt > 0) p.sim.step(dt, ctx.controls);
      ctx.world.updateOrigin(p.state.position);
      syncVisual(dt);
    },
  };
  function syncVisual(dt) {
    const p = ctx.player;
    ctx.world.toRender(p.state.position, tmp);
    p.visual.object3D.position.copy(tmp);
    p.visual.object3D.quaternion.copy(p.state.quaternion);
    p.visual.update?.(p.state, dt);
  }
  ctx.events.on('cmd', ({ name }) => { if (name === 'reset') session.restart(); });
  return session;
}
