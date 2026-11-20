// Combat world: every live thing in a mission (aircraft, missiles, flares, ground units) as one flat entity list.
// CORE — owned by the integrator. The entity shape is documented in COMBAT.md §3.
import * as THREE from 'three';
import { Events } from '../core/events.js';
import { createControls } from '../core/state.js';
import { createSim } from '../physics/index.js';
import { getAircraft } from '../aircraft/registry.js';
import { DEG } from './util.js';

const WRECK_TIME = 30;          // s a shot-down aircraft keeps falling before it is removed
const FWD = new THREE.Vector3(0, 0, -1), UP = new THREE.Vector3(0, 1, 0), RIGHT = new THREE.Vector3(1, 0, 0);

export function createWorld(combat) {
  const ctx = combat.ctx;
  let nextId = 1;
  const tmp = new THREE.Vector3();
  const world = {
    entities: [],      // everything alive: aircraft, missiles, flares, ground units (player included)
    aircraft: [],      // live aircraft only (player included)
    wrecks: [],        // shot-down aircraft still falling (alive === false)
    player: null,
    byId(id) { for (const e of world.entities) if (e.id === id) return e; return null; },

    /** Generic entity record. Weapons use it for missiles / flares, missions for ground units. */
    create(fields) {
      const e = {
        id: nextId++, kind: 'object', team: 'neutral', alive: true, isPlayer: false, callsign: '', name: '',
        state: null, radius: 5, target: null, tags: {},
        forward: new THREE.Vector3(0, 0, -1), up: new THREE.Vector3(0, 1, 0), right: new THREE.Vector3(1, 0, 0),
        ...fields,
      };
      if (!e.state) e.state = { position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion() };
      return e;
    },
    add(e) {
      world.entities.push(e);
      if (e.kind === 'aircraft') world.aircraft.push(e);
      refreshAxes(e);
      combat.events.emit('spawn', { entity: e });
      return e;
    },
    remove(e) {
      let i = world.entities.indexOf(e); if (i >= 0) world.entities.splice(i, 1);
      i = world.aircraft.indexOf(e); if (i >= 0) world.aircraft.splice(i, 1);
      i = world.wrecks.indexOf(e); if (i >= 0) world.wrecks.splice(i, 1);
      e.alive = false;
      combat.events.emit('despawn', { entity: e });
      disposeAircraft(e);
    },

    /**
     * Spawn an AI aircraft flying the real flight model.
     * o: { aircraft: id ('f16'), team: 'red'|'blue', position: Vector3 (world, y = altitude MSL), heading (deg true),
     *      speed (m/s TAS), callsign, name, skill (0..1), livery, stores, order (see ai/), tags, asPlayer (headless only) }
     */
    spawnAircraft(o) {
      const def = getAircraft(o.aircraft || 'f16');
      const controls = createControls();
      const bus = new Events();
      // AI sims get their own event bus and controls so their 'crash' / 'touchdown' / gear events never reach the player's systems
      const simCtx = { params: ctx.params, events: bus, world: ctx.world, weather: ctx.weather, rng: ctx.rng, controls, time: ctx.time };
      const init = {
        position: new THREE.Vector3().copy(o.position), heading: (o.heading || 0) * DEG, speed: o.speed ?? def.specs.cruiseSpeed,
        onGround: false, gearDown: false, throttle: 0.8, flaps: 0, player: false,
      };
      const sim = createSim(simCtx, def, init);
      let visual = null;
      if (!combat.headless) {
        // the adversary flies its own paint scheme where an aircraft has one (visuals fall back to their default livery)
        visual = def.createVisual(ctx, { livery: o.livery ?? ((o.team || 'red') === 'red' ? 'aggressor' : undefined), stores: o.stores });
        visual.object3D.name = `combat-${o.team || 'red'}-${def.id}`;
        ctx.scene.add(visual.object3D);
      }
      const e = world.create({
        kind: 'aircraft', team: o.team || 'red', callsign: o.callsign || '', name: o.name || def.name,
        def, sim, state: sim.state, controls, bus, visual, object3D: visual ? visual.object3D : null,
        radius: 0.32 * Math.max(def.geometry?.length || 15, def.geometry?.span || 10),
        skill: o.skill ?? 0.5, tags: { ...(o.tags || {}) }, pilot: null, ownsSim: true,
      });
      bus.on('crash', (p) => { if (e.alive) combat.kill(e, e.lastHitBy || null, e.lastHitBy ? (e.lastHitWeapon || 'gun') : 'terrain', p);  });
      combat.weapons?.equip?.(e, o.loadout);
      if (o.asPlayer) { e.isPlayer = true; world.player = e; }
      if (!o.asPlayer || o.bot) e.pilot = combat.ai?.createPilot?.(e, { skill: e.skill, order: o.order }) || null;
      world.add(e);
      syncVisual(e, 0);
      return e;
    },

    /** Wrap the session's player aircraft (ctx.player) as the blue-team player entity. */
    adoptPlayer(p, o = {}) {
      const def = p.def;
      const e = world.create({
        kind: 'aircraft', team: 'blue', isPlayer: true, callsign: o.callsign || 'Player', name: def.name,
        def, sim: p.sim, state: p.state, controls: ctx.controls, visual: p.visual, object3D: p.visual?.object3D || null,
        radius: 0.32 * Math.max(def.geometry?.length || 15, def.geometry?.span || 10),
        skill: 1, pilot: null, ownsSim: false,
      });
      world.player = e;
      combat.weapons?.equip?.(e, o.loadout);
      if (o.bot) e.pilot = combat.ai?.createPilot?.(e, { skill: o.botSkill ?? 0.7 }) || null;
      world.add(e);
      return e;
    },

    /** An aircraft was shot down / crashed: it leaves the live lists and falls as a wreck. Called by combat.kill(). */
    toWreck(e) {
      let i = world.entities.indexOf(e); if (i >= 0) world.entities.splice(i, 1);
      i = world.aircraft.indexOf(e); if (i >= 0) world.aircraft.splice(i, 1);
      e.alive = false; e.wreckT = 0;
      if (e.kind === 'aircraft' && !e.isPlayer) world.wrecks.push(e);
    },

    clear() {
      for (const e of [...world.entities, ...world.wrecks]) { e.alive = false; disposeAircraft(e); }
      world.entities.length = 0; world.aircraft.length = 0; world.wrecks.length = 0; world.player = null;
    },

    /** Fill `out` with live entities hostile to `e` (optionally only one kind). */
    enemiesOf(e, out = [], kind = 'aircraft') {
      out.length = 0;
      const team = typeof e === 'string' ? e : e.team;
      for (const o of world.entities) if (o.alive && o.team !== team && o.team !== 'neutral' && (!kind || o.kind === kind)) out.push(o);
      return out;
    },
    friendsOf(e, out = [], kind = 'aircraft') {
      out.length = 0;
      for (const o of world.entities) if (o.alive && o !== e && o.team === e.team && (!kind || o.kind === kind)) out.push(o);
      return out;
    },
    nearestEnemy(e, maxRange = Infinity, kind = 'aircraft') {
      let best = null, bd = maxRange * maxRange;
      for (const o of world.entities) {
        if (!o.alive || o.team === e.team || o.team === 'neutral' || (kind && o.kind !== kind)) continue;
        const d = o.state.position.distanceToSquared(e.state.position);
        if (d < bd) { bd = d; best = o; }
      }
      return best;
    },
    count(team, kind = 'aircraft') { let n = 0; for (const o of world.entities) if (o.alive && o.team === team && (!kind || o.kind === kind)) n++; return n; },

    /** Step every AI aircraft (pilot → flight model), then wrecks. Called by combat.step(). */
    stepAircraft(dt) {
      for (let i = 0; i < world.aircraft.length; i++) {
        const e = world.aircraft[i];
        if (e.ownsSim) {
          if (e.pilot) e.pilot.update(dt);
          e.sim.step(dt, e.controls);
        }
        refreshAxes(e);
      }
      for (let i = world.wrecks.length - 1; i >= 0; i--) {
        const e = world.wrecks[i];
        e.sim.step(dt, e.controls); e.wreckT += dt;
        refreshAxes(e);
        const s = e.state;
        if (!e.impacted && (s.onGround || s.position.y <= ctx.world.groundHeightAt(s.position.x, s.position.z) + 3)) e.impacted = true;
        if (e.impacted && !e.impactSent) { e.impactSent = true; combat.events.emit('wreck:impact', { entity: e, position: s.position }); }
        if (e.wreckT > WRECK_TIME || (e.impactSent && e.wreckT > (e.impactT ??= e.wreckT) + 0.05)) world.remove(e);
      }
    },
    /** Position every AI aircraft visual in render space. Called by combat.step() after the origin is final for the frame. */
    syncVisuals(dt) {
      for (let i = 0; i < world.aircraft.length; i++) { const e = world.aircraft[i]; if (e.ownsSim) syncVisual(e, dt); }
      for (let i = 0; i < world.wrecks.length; i++) syncVisual(world.wrecks[i], dt);
    },
  };

  function refreshAxes(e) {
    const q = e.state.quaternion;
    e.forward.copy(FWD).applyQuaternion(q); e.up.copy(UP).applyQuaternion(q); e.right.copy(RIGHT).applyQuaternion(q);
  }
  function syncVisual(e, dt) {
    const o = e.object3D; if (!o) return;
    o.visible = !e.hidden;
    if (e.hidden) return;
    ctx.world.toRender(e.state.position, tmp);
    o.position.copy(tmp); o.quaternion.copy(e.state.quaternion);
    e.visual.update?.(e.state, dt);
  }
  function disposeAircraft(e) {
    if (!e.ownsSim) return;
    e.ownsSim = false;
    if (e.object3D) ctx.scene.remove(e.object3D);
    try { e.visual?.dispose?.(); } catch (err) { console.warn('[combat] visual dispose failed', err); }
    try { e.sim?.dispose?.(); } catch (err) { console.warn('[combat] sim dispose failed', err); }
  }
  return world;
}
