// Training: three short lessons with Ridgeback, the squadron's weapons instructor.
import { mission, GUNS_ONLY, UNARMED, briefMap } from './common.js';
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
    location: 'KHVN', locationName: 'Gull Shoal Range, south of Haven', map: briefMap(6000, 30000, 15000, [6000, 34000, 0], [[7200, 27000]]), tod: 9.5, weather: 'clear', aircraft: 'f16', threat: 1, minutes: 4,
    objectivesPreview: ['Shoot down target drone Clay 1', 'Shoot down Clay 2, which jinks', 'Optional: use fewer than 300 rounds'],
    start: { at: 'gullShoal', alt: 3000, hdg: 0, spd: 210 },
    loadout: GUNS_ONLY, noDamageBonus: true, quietKills: true,
    script(s) {
      const drone = (cs, extra) => ({ type: 'f16', callsign: cs, single: true, passive: true, loadout: UNARMED, hp: s.n(25, 35, 50),
        skill: 'target', role: 'drone', points: 100, mark: cs, thrust: 0.55, speed: 190, fair: false, ...extra });
      // Clay 1 starts dead ahead, flying away from you, then settles into a wide box: the first target is easy to find
      const box = [[0, 7000], [3500, 11000], [7000, 7000], [3500, 3000]].map(([r, f]) => s.at({ from: s.at({ rel: 0, dist: f }), rel: 90, dist: r }));
      const c1 = s.group('clay1', drone('Clay 1', { at: { rel: 0, dist: 2200 }, heading: { rel: 0 }, speed: 175, order: s.orders.patrol(s.route(box, { alt: s.anchor.y }), { passive: true }) }));
      const c2 = s.declare('clay2', drone('Clay 2', {
        at: () => s.at({ rel: s.pick([-35, 35]), dist: 8000 }), heading: { rel: 60 }, skill: s.skill('target', 0.3),
        order: (i, p) => s.orders.patrol(s.route([0, 1, 2, 3, 4, 5].map((k) => ({ x: p.x + (k % 2 ? 1 : -1) * s.n(1200, 2500, 3200), z: p.z - 4000 * k })), { alt: p.y }), { passive: true }),
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
        [6, 'instructor', 'Clay 1 is dead ahead, just over a mile. Follow it, put the pipper on it and squeeze short bursts. Long bursts melt barrels and impress nobody.'],
        [7, 'instructor', 'Controls refresher: Space fires the gun. Tab picks a target, O swings your view onto it.', { key: 'hint-keys' }],
      ]);
      // range control reloads an empty gun: the lesson is about hitting, not about counting
      s.every(2, () => {
        const g = s.player?.loadout?.gun; if (!g || (c1.alive === 0 && c2.spawned && c2.alive === 0)) return;
        const left = typeof g === 'number' ? g : g.rounds;
        if (left > 0) return;
        if (typeof g === 'number') s.player.loadout.gun = 510; else g.rounds = g.max ?? 510;
        s.say('range', ['Range control: gun reloaded. Again, with feeling.', 'Fresh rounds loaded. Ridgeback says aim this time.'], { priority: 1 });
      });
      s.after(45, () => { if (c1.alive && s.combat.director.stats.shots === 0) s.say('instructor', 'Any time you like, {cs}. Space is the trigger. Close inside half a mile first.', { priority: 1 }); });
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
    location: 'KHVN', locationName: 'Gull Shoal Range, south of Haven', map: briefMap(9000, 42000, 15000, [6000, 42000, 90], [[13000, 42000]]), tod: 14, weather: 'fair', aircraft: 'f16', threat: 1, minutes: 5,
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
      s.boundary(s.anchor, 90000);
      s.countdown(s.n(480, 360, 300), 'Range time', () => s.lose('Range time expired'));
      s.chat([
        [1, 'instructor', 'Afternoon, {cs}. Missile day. Clay 3 is ahead of you. Keep it inside the seeker circle until you hear the lock tone.'],
        [6, 'instructor', 'Locked means locked. Not "nearly". Then squeeze.'],
      ]);
      const rearm = (n) => { const m = s.player?.loadout?.missiles; if (m) m.ir = Math.max(m.ir || 0, n); };
      s.every(2, () => {
        if ((c3.alive > 0 || phase === 3) && s.player?.loadout?.missiles && (s.player.loadout.missiles.ir || 0) + (s.player.loadout.missiles.radar || 0) === 0) {
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
          // its shot is spent: Clay 4 goes back to being a drone and flies a wide, gently weaving circuit
          if (e.pilot) { e.pilot.passive = true; e.pilot.setOrder(s.orders.orbit(s.at({ from: e, rel: 0, dist: 5000 }), s.n(4000, 3500, 3000), e.state.position.y, { passive: true })); }
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
      'Both jets are firing training rounds: every hit is scored, nobody gets hurt. To pass, sit in her six o\'clock with your nose on her long enough, or land enough hits, before she lands too many on you and before the range clock runs out.',
      'Keep your speed up through the merge, use the vertical, and do not get greedy with the trigger.',
    ],
    location: 'KRDR', locationName: 'Tinplate Range, west of Redrock AFB', map: briefMap(115000, -8000, 14000, [112000, -8000, 90], [[119000, -8000]]), tod: 11, weather: 'clear', aircraft: 'f16', threat: 2, minutes: 4,
    objectivesPreview: ['Hold a guns position behind Ridgeback, or score hits with training rounds', 'Take fewer hits than the limit', 'Optional: first hit inside 60 seconds'],
    start: { at: 'tinplate', alt: 4500, hdg: 90, spd: 240 },
    loadout: { ...GUNS_ONLY, invulnerable: true }, noDamageBonus: true, quietKills: true, winReason: 'Ridgeback beaten',
    script(s) {
      // Two ways to pass: hold a guns-tracking position behind Ridgeback for a total of `hold` seconds, or land `need`
      // scored gun hits. Ridgeback flies well below her real skill on rookie.
      const need = s.n(4, 6, 8), hold = s.n(12, 18, 22), limit = s.n(24, 16, 12);
      const rb = s.group('instructor', {
        type: 'f16', callsign: 'Ridgeback', single: true, loadout: { ...GUNS_ONLY, invulnerable: true }, invulnerable: true, skill: s.n(0.12, 0.38, 0.6),
        at: { rel: -6, dist: 7000 }, heading: { rel: 180 }, role: 'instructor', noCount: true, points: 0, mark: 'RIDGEBACK',
      });
      const pass = s.objective('pass', `Hold guns position behind Ridgeback for ${hold} s, or score ${need} hits`, { progress: `0 / ${hold} s · hits 0 / ${need}`, points: 400 });
      const taken = s.objective('taken', `Take fewer than ${limit} gun hits`, { standing: true, progress: `0 / ${limit}`, points: 200 });
      const first = s.objective('first', 'First hit inside 60 seconds', { optional: true });
      const clean = s.objective('clean', 'Win without taking a hit', { hidden: true, points: 300 });
      s.countdown(s.n(270, 240, 240), 'Fight time', () => s.lose('Out of time', [[0.5, 'instructor', 'Knock it off, knock it off. Time. We\'ll debrief the part where you didn\'t shoot me.']]));
      s.steer(rb.leader, 'RIDGEBACK');
      s.chat([
        [1, 'instructor', 'Ridgeback is head-on, {cs}. Training rounds hot. Pass left to left.'],
        [5, 'instructor', 'Two ways to pass: sit in my six o\'clock inside a mile with your nose on me, or put rounds on me. Space is the trigger.'],
        [6, 'instructor', 'Fight\'s on! Fight\'s on!', { priority: 2 }],
      ]);
      let mine = 0, his = 0, mineT = -1, hisT = -1, held = 0, inPos = false, posT = -99;
      const show = () => pass.set(`${Math.floor(held)} / ${hold} s · hits ${Math.min(mine, need)} / ${need}`);
      const finish = () => {
        if (pass.state !== 'active') return;
        if (his === 0) clean.done();
        pass.done();
      };
      // guns position: inside 1500 m, the nose (velocity) within 25° of her, and in her rear hemisphere (within 70° of her tail)
      s.every(0.25, () => {
        const e = rb.leader, p = s.player; if (!e || !p || pass.state !== 'active') return;
        const a = p.state.position, b = e.state.position, va = p.state.velocity, vb = e.state.velocity;
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 1;
        const sa = Math.hypot(va.x, va.y, va.z) || 1, sb = Math.hypot(vb.x, vb.y, vb.z) || 1;
        const ata = (va.x * dx + va.y * dy + va.z * dz) / (sa * d), tail = (vb.x * dx + vb.y * dy + vb.z * dz) / (sb * d);
        const now = d < 1500 && ata > 0.906 && tail > 0.342;
        if (now) {
          held += 0.25; show();
          if (!inPos && s.t - posT > 12) { posT = s.t; s.say('instructor', ['You\'re in my six. Stay there.', 'Okay, you\'re in the saddle. Don\'t fall out.', 'I see you back there. Hold it.'], { priority: 0 }); }
          if (held >= hold * 0.5 && held - 0.25 < hold * 0.5) s.say('instructor', 'Halfway there. I\'m not making it easy on purpose.', { priority: 0 });
          if (held >= hold) finish();
        }
        inPos = now;
      });
      // hits are scored in "tracking windows": at least one hit inside a quarter second counts once, so the tally does not
      // depend on the gun's rate of fire or on how the weapons module splits a burst into hits
      const marks = [Math.max(2, Math.round(need * 0.33)), Math.round(need * 0.66)];
      const scored = (target, source) => {
        const e = rb.leader; if (!e) return;
        if (source === s.player && target === e) {
          if (s.t - mineT < 0.25) return; mineT = s.t;
          mine++; show();
          if (mine === 1 && s.t < 60) first.done();
          if (mine === marks[0]) s.say('instructor', ['Okay, that one I felt.', 'Lucky. Do it again.'], { priority: 0 });
          if (mine === marks[1]) s.say('instructor', ['Now you\'re flying. Keep it up.', 'Stop smiling, I can hear it.'], { priority: 0 });
          if (mine >= need) finish();
        } else if (source === e && target === s.player) {
          if (s.t - hisT < 0.25) return; hisT = s.t;
          his++; taken.set(`${Math.min(his, limit)} / ${limit}`);
          if (his === Math.round(limit / 2)) s.say('instructor', ['You\'re wearing a lot of my paint, {cs}.', 'Tracking you like a lighthouse. Move!'], { priority: 0 });
          if (his >= limit && taken.state === 'active') taken.fail('Ridgeback gunned you');
        }
      };
      s.on('bullet:hit', ({ target, shooter }) => scored(target, shooter));
      s.on('damage', ({ target, source, weapon }) => { if (!weapon || weapon === 'gun') scored(target, source); });
      // a coaching beat if the fight stalls
      s.after(100, () => { if (pass.state === 'active' && held < hold * 0.3 && mine < 2) s.say('instructor', 'Stop chasing my canopy. Pull for where I\'m going to be, and use the vertical when we go nose to nose.', { priority: 1 }); });
    },
  }),
];
