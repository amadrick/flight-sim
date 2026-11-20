// Training: three short lessons with Ridgeback, the squadron's weapons instructor.
import { mission, GUNS_ONLY, UNARMED } from './common.js';
import { clockDir } from '../radio.js';

const dirTo = (s, e) => (s.player && e ? clockDir(s.player.state, e.state.position) : 'off your nose');

export const TRAINING = [
  mission({
    id: 'train-gunnery', category: 'training', order: 1,
    title: 'First Rounds', tagline: 'Guns only. The targets do not shoot back.',
    brief: [
      'Gull Shoal Range, twenty miles off Haven. Two retired attack jets have been converted into target drones, Clay 1 and Clay 2. They fly patterns, they carry nothing, and they are entirely yours.',
      'You have the cannon and nothing else. Get behind the drone, let the pipper settle on it, and squeeze short bursts. Clay 2 jinks: lead the turn instead of chasing the tail.',
      'Ridgeback is on frequency. She grades hard and she counts rounds.',
    ],
    location: 'Gull Shoal Range, south of Haven', tod: 9.5, weather: 'clear', aircraft: 'f16', threat: 1, minutes: 4,
    objectivesPreview: ['Shoot down target drone Clay 1', 'Shoot down Clay 2, which jinks', 'Optional: use fewer than 300 rounds'],
    start: { at: 'gullShoal', alt: 3000, hdg: 0, spd: 210 },
    loadout: GUNS_ONLY, noDamageBonus: true, quietKills: true,
    script(s) {
      const drone = (cs, extra) => ({ type: 'f16', callsign: cs, single: true, passive: true, loadout: UNARMED, hp: s.n(35, 55, 75),
        skill: 'target', role: 'drone', points: 100, mark: cs, thrust: 0.55, speed: 190, ...extra });
      const ring = s.at({ rel: 0, dist: 9000 });
      const c1 = s.group('clay1', drone('Clay 1', { at: { rel: 10, dist: 7000 }, heading: { rel: 90 }, order: s.orders.orbit(ring, 3500, ring.y, { passive: true }) }));
      const c2 = s.declare('clay2', drone('Clay 2', {
        at: () => s.at({ rel: s.pick([-35, 35]), dist: 8000 }), heading: { rel: 60 }, skill: s.skill('target', 0.3),
        order: (i, p) => s.orders.patrol(s.route([0, 1, 2, 3, 4, 5].map((k) => ({ x: p.x + (k % 2 ? 2500 : -2500), z: p.z - 4000 * k })), { alt: p.y }), { passive: true }),
      }));
      s.destroy('clay1', 'Shoot down target drone Clay 1', c1);
      s.destroy('clay2', 'Shoot down Clay 2 (it jinks)', c2);
      const thrifty = s.objective('rounds', 'Use fewer than 300 rounds', { optional: true });
      const quick = s.objective('quick', 'Splash Clay 1 inside 60 seconds', { hidden: true });
      s.steer(c1.leader, 'CLAY 1');
      s.boundary(s.anchor, 45000);
      s.countdown(s.n(420, 300, 240), 'Range time', () => s.lose('Range time expired', [[0.5, 'instructor', 'Range time\'s up, {cs}. We\'ll go again tomorrow. Same drones, same disappointment.']]));
      s.chat([
        [1, 'instructor', 'Morning, {cs}. Ridgeback, your instructor today. Nothing out here is armed, so the only thing at risk is your pride.'],
        [6, 'instructor', 'Clay 1 is orbiting off your nose. Get behind it, settle the pipper, short bursts. Long bursts melt barrels and impress nobody.'],
      ]);
      s.on('kill', ({ victim }) => {
        if (victim.tags.group === 'clay1') {
          if (s.t < 60) quick.done();
          s.chat([[1, 'instructor', ['Good hits. That drone cost more than my house, by the way.', 'Clay 1 is fish food. Nicely done.']], [3, 'instructor', 'Next one moves. Don\'t chase its tail; pull lead.']]);
          s.after(5, () => { c2.spawn(); s.steer(c2.leader, 'CLAY 2'); s.say('range', 'Clay 2 is airborne, {dir}.', { priority: 1, vars: { dir: dirTo(s, c2.leader) } }); });
        } else if (victim.tags.group === 'clay2') {
          if (s.combat.director.stats.shots < 300) thrifty.done(); else thrifty.fail();
        }
      });
      s.when(() => c2.spawned && c2.alive === 0, () => s.win('Range qualification passed', [[1, 'instructor', 'That\'s a pass, {cs}. Bring it home and I\'ll pretend I wasn\'t impressed.']]));
      s.autoWin = false;
    },
  }),

  mission({
    id: 'train-missiles', category: 'training', order: 2,
    title: 'Heat and Light', tagline: 'Lock, shoot, then learn what it feels like from the other end.',
    brief: [
      'Today you learn both halves of the missile game. First, the shooting half: hold the target drone Clay 3 in front of you until the seeker growls a lock, then let it go.',
      'Then the unpleasant half. A second drone, Clay 4, will fire one training missile at you. It is inert and it will not hurt you, but treat it like it would: when the warning sounds, dump flares and turn hard.',
      'Defeat the shot and you are cleared to shoot Clay 4 down. Range control has spare missiles if you need them, and opinions if you do not.',
    ],
    location: 'Gull Shoal Range, south of Haven', tod: 14, weather: 'fair', aircraft: 'f16', threat: 1, minutes: 5,
    objectivesPreview: ['Lock and shoot down Clay 3 with a missile', 'Defeat a training shot with flares', 'Shoot down Clay 4'],
    start: { at: 'gullShoal', brg: 180, dist: 8000, alt: 4000, hdg: 90, spd: 230 },
    loadout: { gun: 0, ir: 4, radar: 2 }, noDamageBonus: true, quietKills: true,
    script(s) {
      const c3 = s.group('clay3', {
        type: 'a10', callsign: 'Clay 3', single: true, passive: true, loadout: { ...UNARMED, flares: s.n(0, 6, 12) }, hp: 60,
        skill: s.skill('target', 0.2), role: 'drone', points: 100, mark: 'Clay 3', at: { rel: 0, dist: 7000 }, heading: { rel: 0 },
        order: (i, p) => s.orders.patrol(s.route([1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ x: p.x + Math.sin(k * 1.3) * 3500 + k * 4000 * Math.sin(s.heading * Math.PI / 180), z: p.z + Math.cos(k * 1.7) * 3500 - k * 4000 * Math.cos(s.heading * Math.PI / 180) })), { alt: p.y }), { passive: true }),
      });
      // Clay 4 starts on the neutral team: nobody can lock it until its shot has been defeated
      const c4 = s.declare('clay4', {
        team: 'neutral', type: 'f16', callsign: 'Clay 4', single: true, loadout: { gun: 0, ir: 1, radar: 0, flares: 0 }, hp: 60,
        skill: 0.6, role: 'drone', points: 100, at: () => s.at({ rel: s.pick([-50, 50]), dist: 9000 }), heading: 'player', fair: false,
        order: () => s.orders.engage(s.player),
      });
      s.destroy('clay3', 'Lock and shoot down Clay 3 with a missile', c3);
      const defend = s.objective('defend', 'Defeat Clay 4\'s training shot (flares: V)');
      s.destroy('clay4', 'Shoot down Clay 4', c4);
      s.steer(c3.leader, 'CLAY 3');
      s.boundary(s.anchor, 50000);
      s.countdown(s.n(480, 360, 300), 'Range time', () => s.lose('Range time expired'));
      s.chat([
        [1, 'instructor', 'Afternoon, {cs}. Missile day. Clay 3 is ahead of you. Keep it inside the seeker circle until you hear the lock tone.'],
        [6, 'instructor', 'Locked means locked. Not "nearly". Then squeeze.'],
      ]);
      const rearm = (n) => { const m = s.player?.loadout?.missiles; if (m) m.ir = Math.max(m.ir || 0, n); };
      s.every(2, () => {
        if (c3.alive > 0 && s.player?.loadout?.missiles && (s.player.loadout.missiles.ir || 0) + (s.player.loadout.missiles.radar || 0) === 0) {
          rearm(2); s.say('range', ['Range control: two more heaters on the rail. We bill by the round.', 'Rearmed. Try pointing them at the drone this time.'], { priority: 1 });
        }
      });
      let shot = null, tries = 0, phase = 1;
      const startDefend = () => {
        phase = 2;
        if (s.player) s.player.invulnerable = true;
        c4.spawn();
        const e = c4.leader;
        s.steer(e, 'CLAY 4');
        if (e) s.mark(e, 'CLAY 4', 'nav');
        s.chat([[0.5, 'instructor', 'Clay 4 is coming for you, {dir}. When it shoots: flares, and turn hard across the missile.', { vars: { dir: dirTo(s, e) } }]]);
      };
      s.on('kill', ({ victim }) => { if (victim.tags.group === 'clay3' && phase === 1) { s.say('instructor', 'Splash Clay 3. Nice shot. Now the other half of the lesson.', { priority: 1 }); s.after(4, startDefend); } });
      s.on('missile:launch', ({ shooter, missile }) => {
        if (shooter !== c4.leader || phase !== 2) return;
        shot = missile;
        s.say('instructor', ['Shot, shot! Flares and break!', 'Missile in the air! Flares, now!'], { priority: 2 });
      });
      const beat = (msg) => {
        if (defend.state !== 'active') return;
        defend.done(); phase = 3;
        s.say('instructor', msg, { priority: 1 });
        s.after(3, () => {
          const e = c4.leader; if (!e) return;
          e.team = 'red'; c4.team = 'red';
          if (e.loadout?.missiles) e.loadout.missiles.ir = 0;
          if (s.player) s.player.invulnerable = false;
          rearm(2);
          s.unmark(e); s.mark(e, 'CLAY 4', 'target');
          s.say('instructor', 'Clay 4 is now a legal target and you have two fresh heaters. Finish the lesson.', { priority: 1 });
        });
      };
      s.on('missile:decoyed', ({ missile, flare }) => { if (phase === 2 && (missile === shot || flare?.owner === s.player)) beat('Seeker bit the flare. That\'s exactly how it\'s done.'); });
      s.on('missile:miss', ({ missile }) => { if (phase === 2 && missile === shot) beat('It went wide. Ugly, but a miss is a miss.'); });
      s.on('missile:hit', ({ missile }) => {
        if (phase !== 2 || missile !== shot) return;
        tries++;
        if (tries >= 3) { beat('We\'ll call that a pass. Do not tell anyone how.'); return; }
        s.say('instructor', ['That one would have ruined your week. Flares earlier. Again.', 'Hit. In real life that\'s a parachute ride. Once more.'], { priority: 1 });
        s.after(4, () => { const e = c4.leader; if (e?.loadout?.missiles) e.loadout.missiles.ir = 1; });
      });
      s.when(() => phase === 3 && c4.spawned && c4.alive === 0, () => s.win('Missile qualification passed', [[1, 'instructor', 'Both halves passed, {cs}. Shoot first, defend second, never the other way round.']]));
      s.autoWin = false;
      s.onPlayerDown = () => { if (s.player) s.player.invulnerable = false; };
    },
  }),

  mission({
    id: 'train-bfm', category: 'training', order: 3,
    title: 'Knife Fight School', tagline: 'One on one with your instructor. Training rounds, real manoeuvres.',
    brief: [
      'Tinplate Range, over the dry lake west of Redrock. You and Ridgeback start head-on. After the merge it is a turning fight with guns only.',
      'Both jets are firing training rounds: every hit is scored, nobody gets hurt. Land enough hits on her before she lands too many on you, and before the range clock runs out.',
      'Keep your speed up through the merge, use the vertical, and do not get greedy with the trigger.',
    ],
    location: 'Tinplate Range, west of Redrock AFB', tod: 11, weather: 'clear', aircraft: 'f16', threat: 2, minutes: 5,
    objectivesPreview: ['Score hits on Ridgeback with training rounds', 'Take fewer hits than the limit', 'Optional: first hit inside 60 seconds'],
    start: { at: 'tinplate', alt: 4500, hdg: 90, spd: 240 },
    loadout: { ...GUNS_ONLY, hp: 100000 }, noDamageBonus: true, quietKills: true, winReason: 'Ridgeback beaten',
    script(s) {
      const need = s.n(20, 30, 40), limit = s.n(60, 40, 28);
      const rb = s.group('instructor', {
        type: 'f16', callsign: 'Ridgeback', single: true, loadout: { ...GUNS_ONLY, hp: 100000 }, skill: s.n(0.3, 0.55, 0.8),
        at: { rel: 0, dist: 7000 }, heading: 'player', role: 'instructor', noCount: true, points: 0, mark: 'RIDGEBACK',
      });
      const hits = s.objective('hits', `Land ${need} hits on Ridgeback`, { progress: `0 / ${need}`, points: 400 });
      const taken = s.objective('taken', `Take fewer than ${limit} hits`, { standing: true, progress: `0 / ${limit}`, points: 200 });
      const first = s.objective('first', 'First hit inside 60 seconds', { optional: true });
      s.objective('clean', 'Win without taking a hit', { hidden: true, points: 300 });
      s.boundary(s.anchor, 40000);
      s.countdown(s.n(360, 300, 240), 'Fight time', () => s.lose('Out of time', [[0.5, 'instructor', 'Knock it off, knock it off. Time. We\'ll debrief the part where you didn\'t shoot me.']]));
      s.steer(rb.leader, 'RIDGEBACK');
      s.chat([
        [1, 'instructor', 'Ridgeback is head-on, {cs}. Training rounds hot. Pass left to left.'],
        [8, 'instructor', 'Fight\'s on! Fight\'s on!', { priority: 2 }],
      ]);
      let mine = 0, his = 0;
      const mine25 = [Math.round(need * 0.33), Math.round(need * 0.66)];
      s.on('damage', ({ target, source, weapon }) => {
        if (weapon && weapon !== 'gun') return;
        const e = rb.leader; if (!e) return;
        if (source === s.player && target === e) {
          mine++; hits.set(`${Math.min(mine, need)} / ${need}`);
          if (mine === 1 && s.t < 60) first.done();
          if (mine === mine25[0]) s.say('instructor', ['Okay, that one I felt.', 'Lucky. Do it again.'], { priority: 0 });
          if (mine === mine25[1]) s.say('instructor', ['Now you\'re flying. Keep it up.', 'Stop smiling, I can hear it.'], { priority: 0 });
          if (mine >= need && hits.state === 'active') {
            if (his === 0) s.objectives.find((o) => o.id === 'clean')?.done();
            hits.done();
          }
        } else if (source === e && target === s.player) {
          his++; taken.set(`${Math.min(his, limit)} / ${limit}`);
          if (his === Math.round(limit / 2)) s.say('instructor', ['You\'re wearing a lot of my paint, {cs}.', 'Tracking you like a lighthouse. Move!'], { priority: 0 });
          if (his >= limit && taken.state === 'active') { taken.reason = 'Ridgeback gunned you'; taken.fail('Ridgeback gunned you'); }
        }
      });
    },
  }),
];
