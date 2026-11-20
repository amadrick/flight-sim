// MISSION DIRECTOR (COMBAT.md §8). createDirector(combat) → director:
//   missions[], getMission(id), prepare(mission, options), start(mission, options), update(dt), stop(),
//   objectives[], stats, radio(from, text, opts)
// plus (additive, see README.md): waypoint, timer, markers[], runtime, scoring, radioQ, finish(outcome, reason).
// Missions are compact scripts (defs/*.js) written against the toolkit in runtime.js.
import { createRadio, clockDir } from './radio.js';
import { createScoring } from './scoring.js';
import { createRuntime } from './runtime.js';
import { AI_CALLS } from './lines.js';
import { MISSIONS } from './defs/index.js';
import { PLACES, offset, safeAlt, groundAt, groundMax } from './geo.js';
import { getAirport, runwayEnd } from '../../data/airports.js';

export { MISSIONS };


export function createDirector(combat) {
  const ev = combat.events, world = combat.world;
  const radioQ = createRadio(combat), scoring = createScoring(combat);
  let rt = null, chkT = 0;
  const warned = { guns: false, missiles: false, winch: false, bingo: false, burning: false, hitT: -99, hadMissiles: false };

  const director = {
    missions: MISSIONS,
    objectives: [],      // [{ id, text, state: 'active'|'done'|'failed', optional?, hidden?, progress?, points }]
    stats: null,         // see scoring.js newStats(); also world.player.stats
    waypoint: null,      // { position: Vector3, label, entity? } | null   — current steer point
    timer: null,         // { label, seconds } | null                      — countdown for the HUD
    markers: [],         // [{ id, label, kind: 'target'|'protect'|'nav'|'zone'|'friendly', position: Vector3, entity?, radius }]
    markerSeq: 0,
    anchor: null,        // where the player started { x, y, z, hdg, aircraft, callsign, flight }
    runtime: null,       // the running script runtime (runtime.js) | null
    radioQ, scoring,
    redKills: 0,

    getMission(id) { return MISSIONS.find((m) => m.id === id) || null; },

    /** Where / when / in what the player starts (core starts the flight session with it). */
    prepare(m, o = {}) {
      const st = (typeof m.start === 'function' ? m.start(o, combat) : m.start) || {};
      const gw = combat.ctx.world;
      const base = typeof st.at === 'string' ? PLACES[st.at] || PLACES.haven : st.at || PLACES.haven;
      let x = base.x, z = base.z;
      if (st.brg != null && st.dist) { const p = offset(base, st.brg, st.dist); x = p.x; z = p.z; }
      const aircraft = o.aircraft || m.aircraft || 'f16';
      const callsign = m.callsign || 'Halyard 1';
      let mode = st.mode || 'air', hdg = st.hdg ?? 0, spd = st.spd ?? 220, alt, airport = st.airport;
      if (mode === 'runway') {
        const ap = getAirport(airport), rwy = runwayEnd(ap.runways[0], 0);
        airport = ap.id; hdg = rwy.heading;
        if (combat.headless) {
          // node bench: no runway physics for the bot, so it starts just airborne past the far end
          mode = 'air'; spd = 150;
          x = rwy.farEnd.x + rwy.dir.x * 1500; z = rwy.farEnd.z + rwy.dir.z * 1500;
          alt = safeAlt(gw, x, z, ap.elevation + 450, 300);
        } else { x = rwy.threshold.x; z = rwy.threshold.z; alt = ap.elevation; spd = 0; }
      } else if (st.agl != null) alt = Math.max(groundAt(gw, x, z) + st.agl, groundMax(gw, x, z, 2000) + Math.min(st.agl, 250));
      else alt = safeAlt(gw, x, z, st.alt ?? 4000, 500);
      director.anchor = { x, y: alt, z, hdg, aircraft, callsign, flight: callsign.replace(/\s*\d+$/, '') };
      const loadout = typeof m.loadout === 'function' ? m.loadout(o) : m.loadout;
      return {
        aircraft, airport, mode, position: { x, z }, alt, hdg, spd, tod: st.tod ?? m.tod, weather: st.weather ?? m.weather,
        livery: o.livery, stores: 'a2a', callsign, loadout,
      };
    },

    start(m, o = {}) {
      if (rt) { rt.stop(); rt = null; }
      if (!director.anchor) director.prepare(m, o);
      director.stats = scoring.reset();
      director.redKills = 0;
      const p = world.player;
      if (p) p.stats = director.stats;
      // optional per-mission toughness (difficulty already scales damage taken inside weapons: DAMAGE_TAKEN)
      const tough = m.toughness?.[combat.difficulty] ?? 1;
      if (p && p.maxHp > 0 && tough !== 1 && p.maxHp < 1e4) { p.maxHp *= tough; p.hp = p.maxHp; }
      Object.assign(warned, { guns: false, missiles: false, winch: false, bingo: false, burning: false, hitT: -99, hadMissiles: missilesOf(p) > 0 });
      radioQ.reset(m.cast, director.anchor.callsign);
      rt = createRuntime(combat, director, m, o);
      director.runtime = rt;
      m.script(rt.s);
      scoring.par = m.par ?? estimatePar(rt, m);
      rt.update(0);
    },

    update(dt) {
      radioQ.update(dt);
      if (!rt) return;
      rt.update(dt);
      if ((chkT -= dt) <= 0) { chkT = 1; checkPlayer(); }
    },

    stop() {
      rt?.stop(); rt = null; director.runtime = null;
      director.objectives.length = 0; director.timer = null; director.waypoint = null; director.markers.length = 0;
      director.anchor = null;
    },

    /** Radio line (HUD subtitle + audio voice). from: cast key ('awacs'…), entity, or a name. opts: { priority, delay, voice, team, now } */
    radio(from, text, o = {}) {
      if (o.now) { const sp = radioQ.speaker(from) || { name: String(from), voice: o.voice || 'awacs', team: o.team || 'blue' }; ev.emit('radio', { from: sp.name, text, priority: o.priority || 0, team: o.team || sp.team, voice: o.voice || sp.voice }); return; }
      radioQ.say(from, text, o);
    },

    /** Close the books and decide the mission (called by the runtime after the final radio beat). */
    finish(outcome, reason) {
      if (combat.result || !combat.active) return;
      let wa = 0, wt = 0, optDone = 0, optTotal = 0, protOk = true;
      if (rt) {
        for (const g of rt.groups) if (g.role === 'wing' || g.spec.role === 'wing') { wt += g.size; wa += g.alive; }
        for (const ob of rt.objectives) {
          if (ob.optional && !ob.hidden) { optTotal++; if (ob.state === 'done') optDone++; }
          if (ob.standing && ob.state === 'failed') protOk = false;
        }
      }
      const m = combat.mission || {};
      scoring.finalize({ outcome, time: combat.clock, parTime: (m.minutes || 6) * 60, wingmenAlive: wa, wingmenTotal: wt, protectedOk: protOk, optionalDone: optDone, optionalTotal: optTotal, noTimeBonus: m.noTimeBonus, noDamageBonus: m.noDamageBonus });
      combat.end(outcome, reason);
    },
  };

  // ------------------------------------------------------------------ reactions to the fight
  const live = () => combat.active && rt && director.stats;
  const wingman = () => rt?.s.wingman() || null;

  ev.on('damage', ({ target, amount, source } = {}) => {
    if (!live() || !target) return;
    const p = world.player;
    scoring.onDamage(target, amount || 0, source);
    if (source && source === p && target !== p) target.tags && (target.tags.playerHitT = combat.clock);
    if (target === p && !rt.ended) {
      const w = wingman();
      const frac = target.maxHp ? target.hp / target.maxHp : 1;
      if (frac < 0.4 && !warned.burning && frac > 0) { warned.burning = true; radioQ.say(w || 'awacs', w ? '@wing.playerBadlyHit' : ['{cs}, you\'re badly hit. Get out of the fight!'], { priority: 1 }); }
      else if (combat.clock - warned.hitT > 12 && w) { warned.hitT = combat.clock; radioQ.say(w, '@wing.playerHit', { priority: 0, key: 'phit', window: 10 }); }
    } else if (source === p && target.team === p?.team && target.kind === 'aircraft') {
      radioQ.say(target, ['Check fire! Check fire! That\'s me, {cs}!', 'Hey! Friendly! Friendly!', '{cs}, you\'re shooting at me!'], { priority: 2, key: 'ff', window: 6 });
    }
  });

  ev.on('fire:start', ({ target } = {}) => {
    if (!live() || rt.ended || !target || !target.alive || (target.hp != null && target.hp <= 0)) return;
    const p = world.player, w = wingman();
    if (target === p && w) radioQ.say(w, ['Lead, you\'re on fire! Get out of there!', '{cs}, fire on your jet! Extend and pray!'], { priority: 2, key: 'pfire', window: 15 });
    else if (target.team === 'red' && combat.rng() < 0.15) radioQ.say(target, ['{me}, fire light! Fire light!', '{me}: I\'m burning, I\'m burning!'], { priority: 0, voice: 'enemy', team: 'red', key: `fire:${target.id}`, window: 20 });
    else if (target.team === 'blue' && !target.isPlayer && target.tags?.role === 'wing') radioQ.say(target, ['{me}, I\'m on fire! Still flying!', '{me}, fire warning. This is getting warm.'], { priority: 1, key: `fire:${target.id}`, window: 20 });
  });
  ev.on('engine:out', ({ target } = {}) => {
    if (!live() || rt.ended || !target || !target.alive || (target.hp != null && target.hp <= 0)) return;
    if (target === world.player) radioQ.say('awacs', ['{cs}, Cathedral shows you lost an engine. Nurse it.', '{cs}, engine out. Keep your speed up.'], { priority: 1, key: 'peng', window: 20 });
    else if (target.team === 'blue' && target.tags?.role === 'wing') radioQ.say(target, ['{me}, lost an engine. Still in it, sort of.', '{me}, engine out. Somebody cover me.'], { priority: 1, key: `eng:${target.id}`, window: 20 });
  });

  ev.on('missile:hit', ({ missile, target } = {}) => { if (live()) scoring.onMissileHit(missile, target); });

  ev.on('missile:launch', ({ shooter, type } = {}) => {
    if (!live() || rt.ended || !shooter?.isPlayer) return;
    radioQ.say('lead', type === 'radar' ? '@lead.fox3' : '@lead.fox2', { priority: 1, key: 'pfox', window: 2.5 });
  });

  ev.on('rwr:launch', ({ source, target, missile } = {}) => {
    const p = world.player;
    if (!live() || rt.ended || !p || target !== p || !p.alive) return;
    const from = missile?.state?.position || source?.state?.position;
    const dir = from ? clockDir(p.state, from) : 'check six';
    const w = wingman();
    radioQ.say(w && combat.rng() < 0.6 ? w : 'awacs', w ? '@wing.warnPlayer' : '@awacs.missileInbound', { priority: 2, key: 'rwr', window: 3.5, vars: { dir } });
  });

  ev.on('missile:decoyed', ({ flare } = {}) => {
    const p = world.player;
    if (!live() || rt.ended || !p || flare?.owner !== p) return;
    const w = wingman();
    if (w && combat.rng() < 0.5) radioQ.say(w, '@wing.missileMissed', { priority: 0, key: 'mmiss', window: 12, delay: 0.8 });
  });

  ev.on('ai:call', ({ entity: e, call, target } = {}) => {
    if (!live() || rt.ended || !e || e.isPlayer || !e.alive && call !== 'mayday') return;
    const spec = AI_CALLS[call]; if (!spec) return;
    const key = e.team === 'blue' ? spec.blue : spec.red;
    if (!key) return;
    if (e.team !== 'blue' && combat.rng() > (call === 'mayday' ? 0.35 : 0.1)) return;
    const rc = e.tags.radioT || (e.tags.radioT = {});
    if (rc[call] != null && combat.clock - rc[call] < spec.gap) return;
    rc[call] = combat.clock;
    const dkey = call === 'splash' ? `splash:${e.id}` : call === 'mayday' ? `down:${e.id}` : undefined;
    radioQ.say(e, '@' + key, { priority: e.team === 'blue' ? spec.pr : 0, key: dkey, window: 3, vars: { t: target?.callsign || target?.def?.name || 'the bandit' } });
  });

  ev.on('kill', ({ victim, killer, weapon, info } = {}) => {
    if (!live() || !victim || victim.kind !== 'aircraft') return;
    const s = director.stats, p = world.player;
    if (victim === p) { rt.playerDown(killer, weapon); return; }
    const friendly = p && victim.team === p.team;
    if (victim.team === 'red') director.redKills++;
    if (friendly || victim.team === 'neutral') {
      if (friendly) s.losses++;
      if (killer && killer === p) { s.friendlyFire++; scoring.add(-500, 'Friendly fire', `Friendly fire: ${victim.callsign}`); }
      else if (friendly && victim.tags?.role === 'wing') scoring.add(-100, 'Wingmen lost', `${victim.callsign} lost`);
      if (!rt.ended && friendly) {
        radioQ.say('awacs', '@awacs.friendlyDown', { priority: 1, key: `down:${victim.id}`, window: 10, vars: { who: victim.callsign || 'a friendly' } });
        if (combat.rng() < 0.6) radioQ.say('awacs', '@awacs.chute', { priority: 0, delay: 4, vars: { who: victim.callsign || 'them' } });
      }
      return;
    }
    // an enemy went down
    if (killer && killer === p) {
      s.kills++;
      if (weapon === 'gun') s.gunKills++; else if (weapon === 'missile') s.missileKills++;
      const pts = scoring.killValue(victim, weapon);
      scoring.add(pts, weapon === 'gun' ? 'Gun kills' : weapon === 'missile' ? 'Missile kills' : 'Kills', `${victim.callsign || victim.name}${weapon === 'gun' ? ' (guns)' : ''}`);
      if (!rt.ended) {
        radioQ.say('lead', weapon === 'gun' ? '@lead.splashGun' : '@lead.splash', { priority: 1, key: `splash:${p.id}`, window: 1.5 });
        const w = wingman();
        if (w && combat.rng() < 0.55) radioQ.say(w, weapon === 'gun' && combat.rng() < 0.6 ? '@wing.playerGunKill' : '@wing.playerSplash', { priority: 0, delay: 1.4 });
        hostileCount();
      }
    } else {
      const assisted = (info?.assists && info.assists.includes?.(p)) || (victim.tags?.playerHitT != null && combat.clock - victim.tags.playerHitT < 30);
      if (assisted) { s.assists++; scoring.add(40, 'Assists', `Assist: ${victim.callsign || victim.name}`); }
      if (!rt.ended && killer && killer.team === 'blue' && !killer.isPlayer) { radioQ.say(killer, '@wing.splash', { priority: 1, key: `splash:${killer.id}`, window: 3, delay: 0.4 }); hostileCount(); }
    }
    if (!rt.ended && combat.rng() < 0.1) radioQ.say(victim, '@enemy.mayday', { priority: 0, key: `down:${victim.id}`, window: 10, voice: 'enemy', team: 'red' });
  });

  function hostileCount() {
    if (combat.mission?.quietKills) return;
    const n = rt.s.hostilesLeft();
    if (n === 1) radioQ.say('awacs', '@awacs.lastOne', { priority: 1, delay: 2.5, key: 'last', window: 20 });
    else if (n > 1 && combat.rng() < 0.5) radioQ.say('awacs', '@awacs.remaining', { priority: 0, delay: 2.5, vars: { n } });
    else if (n > 1) radioQ.say('awacs', '@awacs.splash', { priority: 0, delay: 2.5 });
  }

  function missilesOf(p) { const m = p?.loadout?.missiles; return m ? (m.ir || 0) + (m.radar || 0) : 0; }
  function roundsOf(p) { const g = p?.loadout?.gun; return typeof g === 'number' ? g : g?.rounds ?? 0; }
  function checkPlayer() {
    const p = world.player; if (!p || !p.alive || rt.ended || !p.loadout) return;
    const g = p.loadout.gun, max = (typeof g === 'object' && g?.max) || 510, r = roundsOf(p), ms = missilesOf(p);
    if (!warned.guns && r > 0 && r < max * 0.15) { warned.guns = true; radioQ.say('awacs', '@awacs.gunsLow', { priority: 0 }); }
    if (!warned.missiles && warned.hadMissiles && ms === 0 && r > 0) { warned.missiles = true; radioQ.say('awacs', '@awacs.missilesOut', { priority: 0 }); }
    if (!warned.winch && ms === 0 && r === 0) { warned.winch = true; radioQ.say('awacs', '@awacs.winchester', { priority: 1 }); }
    const s = p.state;
    if (!warned.bingo && s.fuelCapacity > 0 && s.fuel / s.fuelCapacity < 0.12) { warned.bingo = true; radioQ.say('awacs', '@awacs.bingo', { priority: 1 }); }
  }

  function estimatePar(r, m) {
    let pts = 150 + (m.noTimeBonus ? 0 : 300) + (m.noDamageBonus ? 0 : 250);
    for (const g of r.groups) {
      if (g.team === 'red' && !g.noCount) pts += g.size * (g.spec.points ?? (g.spec.passive ? 120 : 115));
      if (g.role === 'wing') pts += 75 * g.size;
    }
    for (const ob of r.objectives) if (!ob.hidden) pts += ob.points;
    return Math.round(pts * (m.parScale ?? 0.85));
  }

  return director;
}
