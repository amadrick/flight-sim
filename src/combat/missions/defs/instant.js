// Instant action: quick fights with no story. instant-1v1 and instant-2v2 are used by tests; keep those ids.
import { mission, GUNS_ONLY, FIGHTERS, briefMap } from './common.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const TYPES = [...FIGHTERS, 'a10', 'sr71', 'b2', 'c17', 'b738', 'a320', 'b789', 'b77w', 'b748', 'a388'];

/** options.custom → validated settings (every field optional). */
export function customSettings(o = {}) {
  const c = o.custom || {};
  const num = (v, d) => (Number.isFinite(+v) && v !== null && v !== '' ? +v : d);
  return {
    enemies: clamp(Math.round(num(c.enemies, 2)), 1, 8),
    wingmen: clamp(Math.round(num(c.wingmen, 1)), 0, 3),
    enemyType: TYPES.includes(c.enemyType) ? c.enemyType : 'mixed',
    gunsOnly: !!c.gunsOnly,
    startRange: clamp(num(c.startRange, 18000), 2500, 80000),
    altitude: clamp(num(c.altitude, 5000), 300, 14000),
    advantage: ['neutral', 'offensive', 'defensive'].includes(c.advantage) ? c.advantage : 'neutral',
    tod: c.tod != null && Number.isFinite(+c.tod) ? +c.tod : undefined,
    weather: typeof c.weather === 'string' ? c.weather : undefined,
  };
}

export const INSTANT = [
  mission({
    id: 'instant-1v1', category: 'instant', order: 1,
    title: 'One on One', tagline: 'One bandit, head-on merge.',
    brief: ['A single Directorate fighter is inbound at your altitude, nose hot. Merge, get on its tail, and shoot it down. Nobody else is coming to help, and nobody else is coming to help it either.'],
    location: 'KHVN', locationName: 'Off the coast south of Haven', map: briefMap(-3000, 9000, 12000, [-4790, 13160, 20], [[-1710, 4700]]), tod: 15, weather: 'fair', threat: 2, minutes: 3,
    objectivesPreview: ['Shoot down the bandit'],
    start: { at: 'haven', brg: 200, dist: 14000, alt: 4500, hdg: 20, spd: 230 },
    script(s) {
      const b = s.group('bandit', { type: s.n('f16', 'f16', 'f15'), count: 1, callsign: 'Bandit', at: { rel: 0, dist: 9000 }, heading: 'player' });
      s.destroy('splash', 'Shoot down the bandit', b);
      s.picture(b);
    },
  }),

  mission({
    id: 'instant-2v2', category: 'instant', order: 2,
    title: 'Two on Two', tagline: 'You and a wingman against a pair.',
    brief: ['Two bandits are inbound. Halyard 2 is on your wing. Sort the targets, support each other, splash both.'],
    location: 'KHVN', locationName: 'Off the coast south of Haven', map: briefMap(-3000, 8000, 12000, [-4790, 13160, 20], [[-1000, 2800], [-300, 3000]]), tod: 17.2, weather: 'scattered', threat: 2, minutes: 4,
    objectivesPreview: ['Shoot down both bandits', 'Optional: Halyard 2 comes home'],
    start: { at: 'haven', brg: 200, dist: 14000, alt: 5000, hdg: 20, spd: 240 },
    script(s) {
      const wing = s.wingmen(1);
      const b = s.group('bandits', { type: ['f15', 'f16'], count: 2, callsign: 'Bandit', at: { rel: 0, dist: 11000, alt: 5200 }, heading: 'player', formation: 'line', spacing: 700 });
      s.destroy('splash', 'Shoot down both bandits', b);
      s.protect('h2', 'Halyard 2 comes home', wing, { optional: true, points: 150 });
      s.picture(b);
    },
  }),

  mission({
    id: 'instant-custom', category: 'instant', order: 3, custom: true,
    title: 'Custom Fight', tagline: 'Pick the odds, the jets and the geometry.',
    brief: ['Your fight, your rules. Choose how many bandits, what they fly, how many wingmen you bring, whether it is guns only, and who starts with the advantage.'],
    location: 'KHVN', locationName: 'Off the coast south of Haven', map: briefMap(-3000, 8000, 22000, [-7520, 20670, 20], [[-1360, 3760]]), tod: 15.5, weather: 'fair', threat: 3, minutes: 5,
    objectivesPreview: ['Shoot down every bandit'],
    start: (o) => { const c = customSettings(o); return { at: 'haven', brg: 200, dist: 22000, alt: c.altitude, hdg: 20, spd: 230, tod: c.tod, weather: c.weather }; },
    loadout: (o) => (customSettings(o).gunsOnly ? GUNS_ONLY : undefined),
    script(s) {
      const c = customSettings(s.options);
      const lo = c.gunsOnly ? GUNS_ONLY : undefined;
      if (c.wingmen) s.wingmen(c.wingmen, lo ? { loadout: lo } : {});
      const geo = c.advantage === 'offensive' ? { at: { rel: 0, dist: Math.max(c.startRange, 3000), alt: c.altitude }, heading: { rel: 0 } }
        : c.advantage === 'defensive' ? { at: { rel: 180, dist: Math.max(c.startRange, 5500), alt: c.altitude }, heading: { rel: 0 }, fair: false }
          : { at: { rel: 0, dist: c.startRange, alt: c.altitude }, heading: 'player' };
      const b = s.group('bandits', { type: c.enemyType, count: c.enemies, callsign: 'Bandit', formation: c.enemies > 3 ? 'wedge' : 'line', spacing: 700, loadout: lo, ...geo });
      s.destroy('splash', c.enemies > 1 ? 'Shoot down every bandit' : 'Shoot down the bandit', b);
      if (c.advantage === 'defensive') s.say('awacs', '{cs}, bandits at your six, {rng} miles! Defend!', { priority: 2, vars: { rng: Math.max(1, Math.round(c.startRange / 1852)) } });
      else if (c.advantage === 'offensive') s.say('awacs', '{cs}, you\'re behind them and they haven\'t seen you. Make it count.', { priority: 1 });
      else s.picture(b);
    },
  }),

  mission({
    id: 'instant-survival', category: 'instant', order: 4,
    title: 'Last One Flying', tagline: 'Endless waves, rising skill, one jet.',
    brief: [
      'Wave after wave of Directorate fighters, each one bigger and sharper than the last. Between waves you get a breather, a few missiles and a quick patch-up. Nothing else.',
      'Clear three waves to call it a win. Clear ten and Cathedral will run out of things to say.',
    ],
    location: 'KHVN', locationName: 'Over the sea south of Haven', map: briefMap(0, 30000, 26000, [0, 40000, 0]), tod: 17.6, weather: 'scattered', threat: 5, minutes: 10,
    objectivesPreview: ['Survive as many waves as you can', 'Three waves cleared counts as a win'],
    start: { at: 'haven', brg: 180, dist: 40000, alt: 5000, hdg: 0, spd: 240 },
    noTimeBonus: true, quietKills: true, par: 4000,
    script(s) {
      const MAX = 10;
      s.autoWin = false;
      let wave = 0;
      const ob = s.objective('survive', 'Survive the waves', { progress: 'wave 1', standing: true, points: 0, quiet: true });
      const names = ['Cinder', 'Slag', 'Flint', 'Gravel', 'Kiln', 'Clinker', 'Ash', 'Tallow', 'Soot', 'Coke'];
      const rearm = () => {
        const p = s.player; if (!p || !p.alive || !p.loadout) return;
        const m = p.loadout.missiles; if (m) { m.ir = Math.min(4, (m.ir || 0) + 2); m.radar = Math.min(2, (m.radar || 0) + 1); }
        const g = p.loadout.gun;
        if (typeof g === 'number') p.loadout.gun = Math.min(510, g + 250); else if (g) g.rounds = Math.min(g.max ?? 510, (g.rounds || 0) + 250);
        if (typeof p.loadout.flares === 'number') p.loadout.flares = Math.min(30, p.loadout.flares + 10);
        if (p.hp != null && p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.5);
      };
      const next = () => {
        if (s.ended) return;
        wave++;
        const n = Math.min(6, 1 + Math.floor((wave - 1) / 2) + s.n(0, 0, 1));
        const skill = Math.min(0.97, s.skill('enemy', -0.2) + 0.05 * wave);
        // the first waves warm you up: guns only, then one heater each, then full racks
        const loadout = wave <= 2 ? { ir: 0, radar: 0 } : wave <= 4 ? { ir: 1, radar: 0 } : undefined;
        const g = s.group(`wave${wave}`, { type: wave < 3 ? 'f16' : 'mixed', count: n, callsign: names[(wave - 1) % names.length], skill, spacing: 700, loadout,
          at: { rel: s.between(-45, 45), dist: s.between(17000, 24000) }, call: '@awacs.wave' });
        ob.set(`wave ${wave}`);
        s.when(() => g.alive === 0, () => cleared());
      };
      const cleared = () => {
        if (s.ended) return;
        s.score(100 * wave, 'Waves cleared', `Wave ${wave} cleared`);
        if (wave >= MAX) { s.win(`Survived all ${MAX} waves`, [[1, 'awacs', 'That\'s ten. I\'ve run out of things to say, {cs}. Go home.']]); return; }
        rearm();
        s.say('awacs', [`Wave ${wave} down. Rearm and patch up. Next group in a moment.`, `That's wave ${wave}. Breathe. They're coming again.`, `Wave ${wave} clear, {cs}. The next ones are angrier.`], { priority: 1 });
        s.after(9, next);
      };
      s.onPlayerDown = () => {
        const done = wave - 1;
        ob.set(`${done} cleared`);
        if (done >= 3) s.win(`Survived ${done} waves`, [[0.5, 'awacs', `{cs} is down after ${done} waves. That's a fine night's work. Rescue is inbound.`]]);
        else s.lose(done === 1 ? 'Shot down after 1 wave' : `Shot down after ${done} waves`, [[0.5, 'awacs', '{cs} is down. Rescue is inbound. Shake it off and go again.']]);
      };
      s.say('awacs', 'Cathedral: endless waves tonight, {cs}. Stay alive as long as you can.', { priority: 1 });
      // tanker time: after nine minutes the night is over either way
      s.countdown(540, 'Fuel', () => {
        const done = wave - 1;
        if (done >= 3) s.win(`Survived ${done} waves`, [[0.5, 'awacs', 'That\'s fuel, {cs}. ' + done + ' waves. Come home and tell everyone.']]);
        else s.lose('Out of fuel', [[0.5, 'awacs', '{cs}, you\'re out of gas and out of time. Come home.']]);
      }, { warn: false });
      s.after(1, next);
    },
  }),
];
