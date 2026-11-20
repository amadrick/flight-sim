// MISSION DIRECTOR — placeholder implementation written by the integrator so the rest of combat runs.
// The missions agent replaces the internals; the API below (documented in COMBAT.md §8) must be kept.
import * as THREE from 'three';
import { headingVec } from '../util.js';

const SKILL = { rookie: 0.25, veteran: 0.55, ace: 0.9 };

export const MISSIONS = [
  {
    id: 'instant-1v1', category: 'instant', title: 'Guns only: one on one', tagline: 'One bandit, head-on merge.',
    brief: 'A single bandit is inbound at your altitude. Merge, get on its tail and shoot it down.',
    aircraft: 'f16', start: { airport: 'KHVN', offset: { bearing: 200, distance: 14000 }, alt: 4500, hdg: 20, spd: 230, tod: 15, weather: 'fair' },
    enemies: [{ aircraft: 'f16', bearing: 20, distance: 7000, alt: 4600, hdg: 200, callsign: 'Bandit 1' }],
  },
  {
    id: 'instant-2v2', category: 'instant', title: 'Furball: two on two', tagline: 'You and a wingman against a pair.',
    brief: 'Two bandits are inbound. Your wingman is on your right. Splash both.',
    aircraft: 'f16', start: { airport: 'KHVN', offset: { bearing: 200, distance: 14000 }, alt: 5000, hdg: 20, spd: 240, tod: 17.2, weather: 'scattered' },
    enemies: [{ aircraft: 'f15', bearing: 15, distance: 9000, alt: 5200, hdg: 200, callsign: 'Bandit 1' }, { aircraft: 'f16', bearing: 25, distance: 9500, alt: 4800, hdg: 200, callsign: 'Bandit 2' }],
    friends: [{ aircraft: 'f16', bearing: 110, distance: 250, alt: 5000, hdg: 20, callsign: 'Viper 2' }],
  },
];

export function createDirector(combat) {
  const ev = combat.events, world = combat.world;
  const v = new THREE.Vector3();
  const director = {
    missions: MISSIONS,
    objectives: [],       // [{ id, text, state: 'active'|'done'|'failed', optional?, progress? }]
    stats: null,          // { kills, losses, shots, hits, missiles, score, … } — also referenced as world.player.stats
    getMission(id) { return MISSIONS.find((m) => m.id === id) || null; },
    /** Where / when / in what the player starts. Returned to core, which starts the flight session with it. */
    prepare(m, o = {}) {
      const st = m.start || {};
      const base = AIRPORT_POS[st.airport] || { x: 0, z: 0 };
      headingVec(st.offset?.bearing || 0, v).multiplyScalar(st.offset?.distance || 0);
      director.anchor = { x: base.x + v.x, z: base.z + v.z };
      return { aircraft: o.aircraft || m.aircraft || 'f16', airport: st.airport, mode: 'air', position: director.anchor, alt: st.alt, hdg: st.hdg, spd: st.spd,
        tod: st.tod, weather: st.weather, livery: o.livery, callsign: 'Viper 1', stores: 'a2a' };
    },
    start(m) {
      const p = world.player, skill = SKILL[combat.difficulty] ?? 0.55;
      director.stats = { kills: 0, losses: 0, shots: 0, hits: 0, missiles: 0, score: 0 };
      if (p) p.stats = director.stats;
      const at = (d) => headingVec(d.bearing, v).multiplyScalar(d.distance).add(new THREE.Vector3(director.anchor.x, d.alt, director.anchor.z)).clone();
      for (const d of m.enemies || []) world.spawnAircraft({ aircraft: d.aircraft, team: 'red', position: at(d), heading: d.hdg, speed: 240, callsign: d.callsign, skill, stores: 'a2a' });
      for (const d of m.friends || []) world.spawnAircraft({ aircraft: d.aircraft, team: 'blue', position: at(d), heading: d.hdg, speed: 240, callsign: d.callsign, skill: 0.6, stores: 'a2a' });
      director.objectives = [{ id: 'splash', text: 'Shoot down all bandits', state: 'active', progress: `0 / ${(m.enemies || []).length}` }];
      ev.emit('objective:update', { objectives: director.objectives });
      director.radio('AWACS', `${(m.enemies || []).length > 1 ? 'Bandits' : 'Bandit'} inbound, cleared hot.`);
    },
    stop() { director.objectives = []; },
    /** Radio line: shown as a subtitle by the HUD and voiced by the audio module. */
    radio(from, text, o = {}) { ev.emit('radio', { from, text, priority: o.priority || 0, team: o.team || 'blue' }); },
    update() {
      if (combat.result) return;
      const m = combat.mission, total = (m.enemies || []).length, left = world.count('red');
      const o = director.objectives[0];
      if (o) o.progress = `${total - left} / ${total}`;
      if (left === 0) { if (o) o.state = 'done'; ev.emit('objective:update', { objectives: director.objectives }); director.radio('AWACS', 'Picture clean. Good work.'); combat.end('success', 'All bandits destroyed'); }
    },
  };
  ev.on('kill', ({ victim, killer }) => {
    const s = director.stats; if (!s) return;
    if (killer && killer.isPlayer && victim.kind === 'aircraft') { s.kills++; s.score += 1000; ev.emit('score', { points: 1000, reason: 'Kill', total: s.score }); director.radio('Viper 1', 'Splash one!'); }
    if (victim.team === 'blue' && !victim.isPlayer && victim.kind === 'aircraft') s.losses++;
    if (victim.isPlayer && !combat.result) combat.end('failure', killer ? 'Shot down' : 'Crashed');
  });
  return director;
}

const AIRPORT_POS = { KHVN: { x: 0, z: 0 }, KRDR: { x: 140000, z: -30000 }, KPNC: { x: -20000, z: -95000 }, PCRK: { x: -85000, z: 85000 }, KBAY: { x: -260000, z: -60000 } };
