// Skyward combat: missions, AI aircraft, weapons, damage, targeting. CORE — owned by the integrator.
// API: createCombat(ctx, { headless? }) -> combat (see COMBAT.md). main.js calls combat.pre(dt) before the player's physics,
// combat.step(dt) right after it, and combat.late(dt) after the regular HUD has drawn.
import * as THREE from 'three';
import { Events } from '../core/events.js';
import { makeRng } from '../core/math.js';
import { createWorld } from './world.js';
import { createTargeting } from './targeting.js';
import { createAi } from './ai/index.js';
import { createWeapons } from './weapons/index.js';
import { createDirector } from './missions/index.js';
import { createCombatFx } from './fx/index.js';
import { createCombatHud } from './hud/index.js';
import { createCombatInput } from './input/index.js';
import { createCombatAudio } from './audio/index.js';
import { createCombatUi } from './ui/index.js';
import { createCombatCamera } from './camera/index.js';

export const DIFFICULTIES = ['rookie', 'veteran', 'ace'];

export async function createCombat(ctx, opts = {}) {
  const headless = !!opts.headless;
  const combat = {
    ctx, headless,
    events: new Events(),          // combat event bus (catalogue: COMBAT.md §5) — separate from ctx.events
    rng: makeRng((ctx.params?.seed ?? 1337) ^ 0x5eed),
    active: false,                 // a mission is loaded and its world is being simulated
    mission: null,                 // running mission definition
    options: null,                 // options the mission was started with (for restart)
    result: null,                  // null while the mission is undecided, else { outcome: 'success'|'failure', reason, stats }
    difficulty: DIFFICULTIES.includes(ctx.params?.raw?.difficulty) ? ctx.params.raw.difficulty : 'veteran',
    clock: 0,                      // mission time, simulated seconds
    world: null, targeting: null, ai: null, weapons: null, director: null, fx: null, hud: null, input: null, audio: null, ui: null, camera: null,
    start, restart, abort, end, kill, pre, step, cam, late,
  };
  combat.world = createWorld(combat);
  combat.weapons = createWeapons(combat);
  combat.ai = createAi(combat);
  combat.director = createDirector(combat);
  combat.targeting = createTargeting(combat);
  if (!headless) {
    combat.fx = await createCombatFx(combat);
    combat.audio = await createCombatAudio(combat);
    combat.hud = await createCombatHud(combat);
    combat.input = await createCombatInput(combat);
    combat.ui = await createCombatUi(combat);
    combat.camera = await createCombatCamera(combat);
  }
  const world = combat.world;
  let starting = false;

  /**
   * Start a mission. o: { aircraft, livery, difficulty, bot (player flown by the AI — tests / attract mode) }.
   * Returns false if the mission id is unknown.
   */
  function start(missionId, o = {}) {
    const mission = combat.director.getMission(missionId);
    if (!mission) { console.warn('[combat] unknown mission', missionId); return false; }
    abort();
    if (o.difficulty && DIFFICULTIES.includes(o.difficulty)) combat.difficulty = o.difficulty;
    combat.mission = mission; combat.options = { ...o, mission: mission.id }; combat.result = null; combat.clock = 0;
    // the director resolves where/when/in what the player starts: { aircraft, airport, mode, position {x,z}, alt, hdg, spd, tod, weather, livery, stores }
    const st = combat.director.prepare(mission, combat.options) || {};
    if (st.tod != null) ctx.time?.setTimeOfDay?.(st.tod);
    if (st.weather) ctx.weather?.setPreset?.(st.weather, true);
    const bot = o.bot ?? (ctx.params?.raw?.combatbot === '1');
    if (ctx.session) {
      starting = true;
      try {
        ctx.session.start({ aircraft: st.aircraft, airport: st.airport, start: st.mode || 'air', position: st.position, alt: st.alt, hdg: st.hdg, spd: st.spd, livery: st.livery, stores: st.stores });
      } finally { starting = false; }
      world.adoptPlayer(ctx.player, { callsign: st.callsign, loadout: st.loadout, bot });
    } else {
      // headless (node benches): the "player" is just another simulated aircraft, flown by the AI when bot is set
      world.spawnAircraft({ aircraft: st.aircraft, team: 'blue', position: new THREE.Vector3(st.position?.x || 0, st.alt ?? 4000, st.position?.z || 0),
        heading: st.hdg || 0, speed: st.spd, callsign: st.callsign || 'Player', asPlayer: true, bot: bot || o.bot !== false, loadout: st.loadout, skill: o.botSkill ?? 0.7 });
    }
    combat.active = true;
    combat.director.start(mission, combat.options);
    combat.events.emit('mission:start', { mission, options: combat.options });
    ctx.menu?.close?.();
    return true;
  }
  function restart() { if (combat.options) start(combat.options.mission, combat.options); }
  /** Leave combat: remove every entity and projectile. The player's flight session is left alone. */
  function abort() {
    if (!combat.active) return;
    combat.active = false;
    combat.events.emit('mission:abort', { mission: combat.mission });
    world.clear(); combat.weapons.reset?.(); combat.director.stop?.();
    combat.mission = null;
  }
  /** Decide the mission (called by the director). The world keeps running until the player leaves or restarts. */
  function end(outcome, reason = '') {
    if (!combat.active || combat.result) return;
    combat.result = { outcome, reason, stats: combat.director.stats || null, time: combat.clock };
    combat.events.emit('mission:end', combat.result);
  }
  /**
   * An entity is destroyed. victim leaves the live lists at once; aircraft keep falling as wrecks.
   * killer may be null (flew into the ground). weapon: 'gun' | 'missile' | 'terrain' | 'collision' | …
   */
  function kill(victim, killer, weapon, info) {
    if (!victim || !victim.alive) return;
    if (victim.kind === 'aircraft') {
      world.toWreck(victim);
      try { if (!victim.state.crashed) victim.sim.destroy?.(victim.isPlayer ? `Shot down${killer?.callsign ? ' by ' + killer.callsign : ''}` : 'Shot down'); } catch (e) { console.warn('[combat] destroy failed', e); }
    } else world.remove(victim);
    for (const e of world.entities) if (e.target === victim) e.target = null;
    combat.events.emit('kill', { victim, killer: killer || null, weapon: weapon || '', info: info || null });
    if (victim.isPlayer) combat.events.emit('player:down', { killer: killer || null, weapon: weapon || '' });
  }

  // the player's own crash (terrain, over-G, shot down) arrives on the simulator bus
  ctx.events.on('crash', () => {
    const p = world.player;
    if (combat.active && p && p.alive) kill(p, p.lastHitBy || null, p.lastHitBy ? (p.lastHitWeapon || 'gun') : 'terrain');
  });
  // leaving for the hangar / a free flight ends the mission
  ctx.events.on('session:start', () => { if (combat.active && !starting) abort(); });
  ctx.events.on('cmd', (c) => { if (c?.name === 'reset' && combat.active) restart(); });

  /** Before the player's physics step: combat input, and the bot when it flies the player's aircraft. */
  function pre(dt) {
    if (!combat.active) return;
    combat.input?.update?.(dt);
    const p = world.player;
    if (p && p.alive && p.pilot && !p.ownsSim && dt > 0) p.pilot.update(dt);
  }
  /** After the player's physics step: missions, AI aircraft, weapons, effects. */
  function step(dt) {
    if (!combat.active) return;
    if (dt > 0) {
      combat.clock += dt;
      combat.director.update(dt);
      world.stepAircraft(dt);
      combat.targeting.update(dt);
      combat.weapons.update(dt);
    }
    if (!headless) { world.syncVisuals(dt); combat.fx?.update?.(dt); }
  }
  /** Right after the simulator's camera rig: combat cameras may override the camera pose. */
  function cam(realDt) { if (!headless) combat.camera?.update?.(realDt); }
  /** After the regular HUD: combat overlay, audio, mission screens. */
  function late(dt) {
    if (headless) return;
    combat.hud?.update?.(dt); combat.audio?.update?.(dt); combat.ui?.update?.(dt);
  }
  return combat;
}
