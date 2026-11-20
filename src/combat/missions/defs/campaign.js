// Campaign: "Lantern Line". The Cendrine Directorate — a junta that runs the valleys beyond the northern range —
// has started testing the coast. The 88th Fighter Squadron (call sign Halyard) out of Haven is in the way.
import * as THREE from 'three';
import { mission, UNARMED, briefMap } from './common.js';
import { clockDir } from '../radio.js';
import { bearing, NM } from '../../util.js';

const ETA = (e, p, fallback = 600) => {
  if (!e || !e.alive) return fallback;
  const d = Math.hypot(e.state.position.x - p.x, e.state.position.z - p.z);
  return d / Math.max(80, Math.hypot(e.state.velocity.x, e.state.velocity.z));
};
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

export const CAMPAIGN = [
  // ------------------------------------------------------------------------------------------------ 1
  mission({
    id: 'c1-doorbell', order: 1, title: 'Doorbell', tagline: 'Scramble. Somebody is knocking on the coast.',
    brief: [
      'Dawn at Haven. For three weeks the Cendrine Directorate, the junta that runs the valleys beyond the northern range, has been flying "navigation exercises" a little closer to our coast each time.',
      'This morning two aircraft crossed the range with their transponders off and are descending toward Haven. You are on alert. Get airborne, intercept, and find out what they want. Halyard 2 is already up on a weather check and will join you.',
      'Rules of engagement: hold fire unless they show hostile intent. Cathedral makes the call.',
    ],
    location: 'KHVN', locationName: 'Haven International', map: briefMap(9000, -20000, 34000, [-1900, -900, 90], [[19440, -41690], [19900, -41500]]), tod: 6.4, weather: 'fair', aircraft: 'f16', threat: 2, minutes: 6,
    objectivesPreview: ['Scramble and intercept the unknown aircraft', 'Shoot down the hostiles', 'Optional: keep them 10 km from Haven', 'Optional: land back at Haven'],
    start: { mode: 'runway', airport: 'KHVN' },
    script(s) {
      const haven = s.places.haven;
      const unknowns = s.group('unknowns', {
        team: 'neutral', type: 'f15', count: 2, callsign: 'Unknown', at: { from: haven, brg: 25, dist: 46000, alt: 6000 }, heading: haven,
        passive: true, spacing: 500, skill: s.skill('enemy', -0.08), order: () => s.orders.patrol(s.route([haven, { x: haven.x - 25000, z: haven.z + 8000 }], { alt: 4500 }), { passive: true }),
      });
      const more = s.declare('cinder34', { type: ['f16', 'f15'], count: s.n(1, 1, 2), callsign: 'Cinder', startIndex: 3, skill: s.skill('enemy', -0.08), at: () => s.at({ from: haven, brg: s.between(0, 40), dist: 38000, alt: 6500 }), call: true });
      const wing = s.declare('wingmen', { team: 'blue', type: s.combat.director.anchor.aircraft, count: 1, callsign: 'Halyard', startIndex: 2, managed: 'wing', role: 'wing',
        at: () => s.at({ from: haven, brg: 70, dist: 7000, alt: 2000 }), heading: 25, order: () => s.orders.escort(s.player, { x: 90, y: 0, z: 60 }) });
      const icpt = s.objective('intercept', 'Intercept the unknown aircraft');
      const kill = s.destroy('hostiles', 'Shoot down the hostiles', [unknowns, more]);
      const keep = s.objective('keepaway', 'Keep them 10 km from Haven', { optional: true, standing: true });
      s.mark(haven, 'HAVEN', 'protect');
      s.steer(unknowns.leader, 'UNKNOWNS');
      s.chat([
        [0.5, 'tower', 'Halyard 1, Haven Tower. Scramble, scramble! Runway zero niner left, cleared for immediate takeoff. Climb heading zero two zero.', { priority: 2 }],
        [8, 'awacs', 'Halyard 1, Cathedral. Two unknowns, bearing zero two five from Haven, twenty-five miles, descending. No squawk, no flight plan, no manners.'],
        [22, 'awacs', 'Halyard 2 is airborne and will join on you.'],
      ]);
      s.after(24, () => { wing.spawn(); s.say(wing.leader, 'Halyard 2, joining. Nice morning to be woken up.', { priority: 0 }); });
      let hostile = false;
      const turn = () => {
        if (hostile) return; hostile = true;
        icpt.done();
        s.chat([
          [0.5, 'awacs', 'Unknown aircraft, this is Cathedral on guard. You are approaching Haven airspace. Turn north immediately.'],
          [5, 'furnace', 'Cathedral, this is Cinder flight. We are exactly where we intend to be.', { voice: 'enemy', team: 'red' }],
          [4, 'furnace', 'Cinder flight: weapons free.', { voice: 'enemy', team: 'red' }],
          [2.5, 'awacs', 'Hostile intent! Halyard, you are cleared hot. Cleared hot!', { priority: 2 }],
        ]);
        s.after(10.5, () => {
          unknowns.team = 'red';
          // Cinder 1 dives for the airfield (a raider: stop it short of Haven), Cinder 2 turns on you; on rookie and
          // veteran Cinder 1 only joins the fight once it has been chased off the field
          unknowns.each((e, i) => {
            e.team = 'red'; e.callsign = `Cinder ${i + 1}`;
            if (e.loadout?.missiles) { e.loadout.missiles.ir = s.n(0, 1, 2); e.loadout.missiles.radar = 0; }
            if (!e.pilot) return;
            if (i === 0 && s.difficulty !== 'ace') { e.tags.role = 'raider'; e.pilot.setOrder(s.orders.patrol(s.route([haven], { alt: 1800 }), { passive: true, loop: false })); }
            else { e.pilot.passive = false; e.pilot.setOrder(s.orders.engage()); }
          });
          unknowns.mark('', 'target');
          s.steer(null);
          s.say('awacs', 'Cinder 1 is diving for the field! Don\'t let it reach Haven!', { priority: 2, delay: 3 });
          s.after(s.n(40, 30, 0), () => { const e = unknowns.members[0]; if (e?.alive && e.pilot) { e.pilot.passive = false; e.pilot.setOrder(s.orders.engage()); } });
        });
        s.after(s.n(70, 45, 30), () => more.spawn());
        // the Directorate will not loiter forever: at bingo whatever is left runs for the range
        s.bingo(s.n(330, 300, 280), { decide: () => unknowns.lost >= 1, win: 'Intruders driven off', lose: 'The intruders got away' });
      };
      s.trigger({ or: [() => { for (const e of unknowns.members) if (e.alive && s.player && flat(e.state.position, s.player.state.position) < 7000) return true; return false; }, { after: s.n(170, 140, 120) }] }, turn);
      s.every(1, () => {
        if (keep.state !== 'active') return;
        for (const g of [unknowns, more]) for (const e of g.members) if (e.alive && flat(e.state.position, haven) < 10000) { keep.fail(); s.say('tower', 'Haven Tower: hostile aircraft over the field! Everyone is diving under desks.', { priority: 1 }); return; }
      });
      s.autoWin = false;
      let recovering = false;
      s.when(() => kill.state === 'done', () => {
        if (s.combat.headless) { s.win('Intruders destroyed'); return; }
        recovering = true;
        const land = s.objective('land', 'Land at Haven', { optional: true, points: 200 });
        s.steer({ x: haven.x, y: 300, z: haven.z }, 'HAVEN');
        s.chat([[1.5, 'awacs', 'Scope is clean. Nicely done, Halyard. Bring them home.'], [4, 'tower', 'Haven Tower: runways are yours, Halyard. The coffee is not.']]);
        s.countdown(300, 'Recover at Haven', () => s.win('Intruders destroyed'), { warn: false });
        s.onTouchdown(() => { if (s.player && flat(s.player.state.position, haven) < 6000 && !s.ended) { land.done(); s.win('Intruders destroyed, recovered at Haven', [[1, 'tower', 'Welcome home, Halyard. Taxi to the hot pit.']]); } });
      });
      s.onPlayerDown = () => { if (recovering) s.win('Intruders destroyed (aircraft lost on recovery)', [[0.5, 'tower', 'Halyard 1 is down on the recovery! Crash crews rolling.']]); };
    },
  }),

  // ------------------------------------------------------------------------------------------------ 2
  mission({
    id: 'c2-needle', order: 2, title: 'Needle and Thread', tagline: 'Escort a heavy transport up the Saddle to Pinecrest.',
    brief: [
      'Pinecrest sits in a high valley with one good way in: the Saddle, a pass that climbs straight out of the coastal plain. After this morning, the valley needs a long-range radar, and the radar is riding in Bundle 1, a C-17 that climbs like a filing cabinet.',
      'The Directorate knows it is coming. Expect fighters to come over the ridgelines at Bundle 1, not at you. Stay close, stay between them and the transport, and do not chase anyone into the next valley.',
      'Bundle 1 must reach Pinecrest. Everything else is negotiable.',
    ],
    location: 'KPNC', locationName: 'The Saddle, north of Haven', map: briefMap(-14000, -66000, 36000, [-9000, -40000, 349], [], [[-9480, -42450]]), tod: 13, weather: 'scattered', aircraft: 'f16', threat: 3, minutes: 7,
    objectivesPreview: ['Keep Bundle 1 alive', 'Escort Bundle 1 to Pinecrest', 'Optional: destroy every attacker'],
    start: { at: { x: -9000, z: -40000 }, alt: 3200, hdg: 349, spd: 200 },
    script(s) {
      const pine = s.places.pinecrest, saddle = s.places.saddle;
      const bundle = s.group('bundle', {
        team: 'blue', type: 'c17', count: 1, callsign: 'Bundle 1', single: true, at: { rel: 0, dist: 2500 }, heading: { rel: 0 }, passive: true,
        hp: s.n(900, 700, 1200), role: 'protect', mark: 'BUNDLE 1', markKind: 'protect',
        order: (i, p) => s.orders.patrol(s.route([saddle, pine, { x: pine.x - 6000, z: pine.z - 20000 }], { alt: p.y, clear: 600 }), { passive: true, loop: false }),
      });
      const B = () => bundle.leader;
      const fromB = (brg, dist, up = 1500) => () => { const b = B() || s.player; return s.at({ from: b, brg, dist, alt: b.state.position.y + up }); };
      const wing = s.wingmen(1);
      // Halyard 2 peels off onto whichever attacker goes for the transport
      const cover = (g) => s.after(3, () => {
        const w = wing.leader, a = g.leader; if (!w?.pilot || !a) return;
        w.pilot.setOrder(s.orders.engage(a));
        s.say(w, ['Halyard 2, I\'ve got the one going for Bundle.', 'Halyard 2, taking the bandit on the transport.'], { priority: 1 });
      });
      const w1 = s.wave('flint', { type: ['f16', 'fa18'], count: s.n(1, 1, 2), callsign: 'Flint', at: fromB(40, 22000), loadout: { ir: s.n(0, 1, 1), radar: 0 }, heading: 'player', call: true,
        order: (i) => (i === 0 ? s.orders.engage(B()) : s.orders.engage()) }, 35, cover);
      const saddleZone = s.zone(saddle, 5000);
      const w2 = s.wave('slag', { type: 'mixed', count: s.n(1, 2, 2), callsign: 'Slag', at: fromB(285, 20000), loadout: { ir: s.n(0, 1, 1), radar: 0 }, call: true,
        order: (i) => (i === 0 ? s.orders.engage(B()) : s.orders.engage(s.player)) }, { or: [() => B() && saddleZone.contains(B()) && s.t > 100, { after: 170 }] }, cover);
      const w3 = s.wave('gravel', { type: ['f15', 'f14'], count: s.n(0, 1, 1), callsign: 'Gravel', at: fromB(350, 24000, 2000), loadout: { ir: s.n(0, 1, 1), radar: 0 }, call: true,
        order: (i) => (i === 0 ? s.orders.engage(B()) : s.orders.engage()) }, { or: [{ dead: w2 }, { after: 230 }] }, cover);
      s.protect('bundle', 'Keep Bundle 1 alive', bundle, { points: 300 });
      const deliver = s.objective('deliver', 'Escort Bundle 1 to Pinecrest');
      s.destroy('clear', 'Destroy every attacker', [w1, w2, w3], { optional: true });
      s.steer({ x: pine.x, y: 2500, z: pine.z }, 'PINECREST');
      s.mark({ x: pine.x, y: pine.elev, z: pine.z }, 'PINECREST', 'nav');
      s.countdown(0, 'Bundle 1 ETA', null, { dynamic: () => ETA(B(), pine) });
      s.chat([
        [1, 'bundle', 'Halyard, Bundle 1. Glad to have you. We\'re heavy, slow, and very easy to see.'],
        [6, 'awacs', 'Cathedral copies. Halyard, expect visitors over the ridgelines. They want the big jet, not you.'],
      ]);
      s.when(() => B() && flat(B().state.position, pine) < 6000, () => { deliver.done(); });
      // the loadmaster has extinguishers and opinions: fires on Bundle 1 usually go out
      s.on('fire:start', ({ target }) => {
        if (target !== B()) return;
        s.say('bundle', ['Bundle 1, fire in number three! Fighting it!', 'Bundle 1: fire light! Extinguishers going!'], { priority: 2 });
        s.after(s.n(2, 4, 6), () => {
          const e = B(); if (!e || !e.damage || !(s.n(1, 1, 0.5) > s.rng())) return;
          e.damage.fire = 0;
          s.say('bundle', ['Bundle 1, fire\'s out. Mostly smoke now. We\'re still flying.', 'Fire\'s out on Bundle 1. Loadmaster says thanks for asking.'], { priority: 1 });
        });
      });
      let hitT = -99;
      // a gun pass on Bundle 1 ends with the attacker overshooting the big jet and extending: it has to come round again
      // (on the player, if the player is close), so a single bandit cannot saw the transport in half in one pass
      s.on('damage', ({ target, source, weapon }) => {
        if (target !== B() || weapon !== 'gun' || !source?.pilot || source.team !== 'red' || source.tags.extending) return;
        source.tags.extending = true;
        s.after(s.n(0.6, 1, 1.5), () => {
          if (!source.alive || !source.pilot) return;
          source.pilot.setOrder(s.orders.engage(s.player || null));
          s.after(s.n(30, 24, 20), () => { source.tags.extending = false; if (source.alive && source.pilot && B()) source.pilot.setOrder(s.orders.engage(B())); });
        });
      });
      s.on('damage', ({ target }) => {
        if (target !== B() || s.t - hitT < 10) return; hitT = s.t;
        const f = target.hp / (target.maxHp || 1);
        s.say('bundle', f < 0.4 ? ['Bundle 1, we\'re hit bad! Number two engine is on fire!', 'Bundle 1: losing hydraulics, we need help now!'] : ['Bundle 1 taking fire!', 'Bundle 1, rounds on the fuselage! Get them off us!'], { priority: 2 });
      });
    },
    winReason: 'Bundle 1 delivered to Pinecrest',
  }),

  // ------------------------------------------------------------------------------------------------ 3
  mission({
    id: 'c3-broom', order: 3, title: 'Broom Closet', tagline: 'Four-ship fighter sweep over the Glass Flats.',
    brief: [
      'The Directorate has moved a fighter squadron, Slag, to forward strips beyond the range. They have spent two days flying combat air patrols over the Glass Flats as if they own them.',
      'Today the whole Halyard four-ship goes out together to sweep them away. Halyard 2 is steady, Halyard 3 is new and very keen, Halyard 4 has been doing this longer than the jets have existed.',
      'Expect four fighters in a wall, and more if they decide to reinforce. Bring everyone home.',
    ],
    location: 'KRDR', locationName: 'The Glass Flats', map: briefMap(87000, -38000, 26000, [70000, -40000, 85], [[103870, -42960], [103980, -41660], [103760, -44260], [104090, -40360]], [[69800, -39700], [69800, -40300], [69500, -39500]]), tod: 16, weather: 'fair', aircraft: 'f16', threat: 3, minutes: 6,
    objectivesPreview: ['Destroy the Slag patrol and any reinforcements', 'Optional: bring all three wingmen home'],
    start: { at: 'glassFlats', alt: 6000, hdg: 85, spd: 240 },
    script(s) {
      const wing = s.wingmen(3);
      const [h2, h3, h4] = wing.members;
      const slag = s.group('slag', { type: 'mixed', count: 4, callsign: 'Slag', at: { rel: 0, dist: 34000, alt: 6500 }, formation: 'line', spacing: 1300 });
      const reinf = s.wave('slag2', { type: ['f15', 'f14', 'f16'], count: s.n(1, 1, 3), callsign: 'Slag', startIndex: 5, skill: s.skill('enemy', s.n(-0.1, 0, 0)), at: () => s.at({ rel: s.pick([-35, 35]), dist: 26000, alt: 7000 }), call: '@awacs.wave' }, { or: [{ kills: 3 }, { after: 200 }] }, () => {
        s.say('furnace', 'Slag lead to base: we are being swept. Send everyone.', { voice: 'enemy', team: 'red', priority: 1, delay: 3 });
        s.say(h4 || 'awacs', 'Here comes the rest of their squadron. Pick your shots.', { priority: 1, delay: 8 });
      });
      s.bingo(s.n(420, 400, 380), { fraction: s.n(0.5, 0.5, 0.5), win: 'Slag swept from the Flats', lose: 'Slag held the Glass Flats' });
      s.destroy('sweep', 'Destroy the Slag patrol and reinforcements', [slag, reinf]);
      s.protect('home', 'Bring all three wingmen home', wing, { optional: true, points: 250 });
      const flags = {};
      s.chat([
        [1, h2, 'Halyard 2, in.'],
        [2.5, h3, 'Halyard 3, in! What a day for it.'],
        [3, h4, 'Halyard 4. Somebody tell three to breathe.'],
        [3.5, 'awacs', 'Halyard, Cathedral. Group of four, bearing {brg}, wall formation, hostile. Sweep is cleared.', { vars: { brg: String(Math.round(bearing(s.anchor, slag.members[0].state.position) / 10) * 10).padStart(3, '0') } }],
      ]);
      s.on('kill', ({ victim, killer }) => {
        if (killer === h3 && victim.team === 'red' && !flags.h3) { flags.h3 = true; s.say(h3, 'I got one! I actually got one!', { priority: 1, delay: 1.5 }); s.say(h4, 'Congratulations. There are more.', { priority: 0, delay: 4 }); }
      });
    },
  }),

  // ------------------------------------------------------------------------------------------------ 4
  mission({
    id: 'c4-door', order: 4, title: 'Hold the Door', tagline: 'Bombers inbound to Redrock. Stop them short.',
    brief: [
      'The sweep embarrassed the Directorate, and embarrassment makes juntas loud. Cathedral has a strike package lifting off from beyond the range: flying-wing bombers with a fighter escort, heading for Redrock Air Force Base.',
      'You are the only flight close enough. The bombers are the target; the escorts exist to waste your time and missiles. Ignore them if you can, kill them if you must.',
      'Redrock Tower is already clearing the ramp. Every bomber that reaches the base will hurt.',
    ],
    location: 'KRDR', locationName: 'Redrock Air Force Base', map: briefMap(158000, -62000, 46000, [150600, -46960, 32], [[177000, -94090], [178400, -93300], [175600, -94900]]), tod: 10.5, weather: 'broken', aircraft: 'f15', threat: 4, minutes: 7,
    objectivesPreview: ['Shoot down the bombers', 'Do not let the bombers reach Redrock', 'Optional: destroy the escorts'],
    start: { at: 'redrock', brg: 32, dist: 20000, alt: 6500, hdg: 32, spd: 240 },
    script(s) {
      const base = s.places.redrock;
      const kiln = s.group('kiln', {
        type: 'b2', count: s.n(2, 3, 3), callsign: 'Kiln', at: { from: base, brg: 30, dist: 74000, alt: 7000 }, heading: base, formation: 'line', spacing: 1600,
        passive: true, loadout: UNARMED, hp: s.n(100, 150, 200), points: 160, mark: 'BOMBER', role: 'bomber', speed: 220,
        order: () => s.orders.patrol([V(base.x, 7000, base.z), V(base.x - 30000, 7000, base.z + 30000)], { passive: true }),
      });
      const flint = s.group('flint', {
        type: ['f16', 'f15', 'fa18'], count: s.n(1, 2, 3), callsign: 'Flint', at: { from: base, brg: 31, dist: 70000, alt: 7800 }, heading: base, spacing: 600,
        engageWithin: 16000, order: (i) => s.orders.escort(kiln.members[i % kiln.members.length], { x: (i % 2 ? -1 : 1) * 500, y: 600, z: 400 }),
      });
      s.wingmen(s.n(2, 1, 1));
      const allowed = s.n(2, 1, 1);
      let bombed = 0;
      const kill = s.destroy('bombers', 'Shoot down the bombers', kiln);
      const door = s.objective('door', 'Keep the bombers off Redrock', { standing: true, progress: `hits 0 / ${allowed}`, points: 300 });
      s.destroy('escorts', 'Destroy the escorts', flint, { optional: true });
      s.mark({ x: base.x, y: base.elev, z: base.z }, 'REDROCK', 'protect');
      s.steer(kiln.leader, 'BOMBERS');
      s.countdown(0, 'Bombers on Redrock', null, { dynamic: () => { let t = 999; for (const e of kiln.members) if (e.alive && !e.tags.bombed) t = Math.min(t, ETA(e, base)); return t; } });
      s.chat([
        [1, 'awacs', 'Halyard, Cathedral. Strike package, bearing zero three zero from Redrock, forty-five miles. Bombers in front, escorts high. Bombers are priority.', { priority: 2 }],
        [7, 'redrock', 'Redrock Tower to all aircraft: base is under air raid warning. Halyard, we\'d really appreciate it.'],
      ]);
      s.every(0.5, () => {
        for (const e of kiln.members) {
          if (!e.alive || e.tags.bombed || flat(e.state.position, base) > 7000) continue;
          e.tags.bombed = true; bombed++;
          door.set(`hits ${bombed} / ${allowed}`);
          s.unmark(e);
          if (e.pilot) e.pilot.setOrder(s.orders.flee(bearing(base, e.state.position), 8000));
          s.say('redrock', bombed >= allowed ? ['Redrock Tower: direct hits on the runway! We\'re closed.', 'Bombs on the base! The ramp is burning!'] : ['Redrock Tower: bombs on the field! Somebody stop the rest!', 'Redrock: impacts on the south ramp. Keep them off us!'], { priority: 2 });
          if (bombed >= allowed) door.fail('Redrock was bombed');
        }
      });
      s.when(() => kill.state === 'done', () => {
        flint.order((e) => s.orders.flee(bearing(base, e.state.position), 9000));
        s.say(flint.leader || 'furnace', '@enemy.retreat', { priority: 1, voice: 'enemy', team: 'red' });
      });
      // bombers that dropped and ran still count as shot down when they escape (the raid is over either way)
      s.every(1, () => { for (const e of kiln.members) if (e.alive && e.tags.bombed && flat(e.state.position, base) > 60000) { s.combat.world.remove(e); } });
    },
    winReason: 'Strike package stopped',
  }),

  // ------------------------------------------------------------------------------------------------ 5
  mission({
    id: 'c5-lowroad', order: 5, title: 'The Low Road', tagline: 'Catch a thief in a thunderstorm before it crosses the line.',
    brief: [
      'During the raid on Redrock, somebody walked out of a hangar with the flight recorder of our newest test aircraft. It is now in the back of a Directorate transport, call sign Mule, running north through the Cobbler valleys to the Lantern Line, the old ceasefire line on the far side of the range.',
      'Mule is flying low inside a thunderstorm with a couple of escorts. Visibility is miserable and the ridges are close. If it crosses the line, it is gone.',
      'Catch it, kill it, and do not fly into a mountain doing it.',
    ],
    location: 'KPNC', locationName: 'Cobbler Valleys, high range', map: briefMap(40000, -118000, 36000, [40000, -92000, 0], [[40000, -107000], [40000, -104000]]), tod: 15, weather: 'storm', aircraft: 'f16', threat: 4, minutes: 5,
    objectivesPreview: ['Shoot down Mule before it crosses the Lantern Line', 'Optional: destroy the escorts', 'Hidden: there is a stylish way to do it'],
    start: { at: { x: 40000, z: -92000 }, agl: 900, hdg: 0, spd: 250 },
    script(s) {
      const lineZ = s.places.lanternLine.z;
      const z0 = s.anchor.z - s.n(20000, 31500, 28000);
      const path = s.route([{ x: 40000, z: z0 }, { x: 46000, z: z0 - 14000 }, { x: 37000, z: z0 - 28000 }, { x: 43000, z: lineZ - 20000 }, { x: 40000, z: lineZ - 60000 }], { agl: 600 });
      const mule = s.group('mule', {
        type: 'c17', count: 1, callsign: 'Mule', single: true, at: path[0].clone(), heading: 0, passive: true, loadout: { ...UNARMED, flares: s.n(10, 45, 60) },
        hp: s.n(160, 460, 520), points: 300, role: 'hva', mark: 'MULE', order: () => s.orders.patrol(path.slice(1), { passive: true, loop: false }),
      });
      const M = () => mule.leader;
      const gravel = s.group('gravel', {
        type: ['f16', 'fa18'], count: s.n(1, 2, 2), callsign: 'Gravel', skill: s.skill('enemy', s.n(0, 0.1, 0.1)), at: () => s.at({ from: M(), brg: 180, dist: 3000, alt: M().state.position.y + 600 }), heading: 0,
        order: (i) => ({ ...s.orders.escort(M(), { x: (i % 2 ? -1 : 1) * 400, y: 300, z: 500 }), weaponsHold: true }),
      });
      // inside the storm Gravel has not seen you yet: they hold formation until you get close, shoot, or hit something
      let awake = false;
      const wake = (why) => {
        if (awake) return; awake = true;
        gravel.order(() => s.orders.engage(s.player));
        s.say(gravel.leader || 'furnace', why === 'shot' ? 'Gravel lead: missile in the cloud! Break, break! Somebody is behind us!' : 'Gravel lead: contact low, six o\'clock! Turning in!', { voice: 'enemy', team: 'red', priority: 1 });
        s.say('awacs', 'Gravel has seen you, {cs}. Mule is the target. Don\'t get dragged off.', { priority: 1, delay: 3 });
      };
      s.on('missile:launch', ({ shooter }) => { if (shooter === s.player) s.after(s.n(4, 2, 1), () => wake('shot')); });
      s.on('damage', ({ target }) => { if (target === M() || gravel.members.includes(target)) wake('shot'); });
      s.when(() => { const p = s.player, m = M(); return p && m && flat(p.state.position, m.state.position) < s.n(3000, 12000, 15000); }, () => wake('seen'));
      const kill = s.destroy('mule', 'Shoot down Mule before the Lantern Line', mule);
      s.destroy('escorts', 'Destroy the escorts', gravel, { optional: true });
      const style = s.objective('gun', 'Bring Mule down with the gun', { hidden: true, points: 300 });
      s.mark({ x: s.anchor.x, y: 1500, z: lineZ }, 'LANTERN LINE', 'zone');
      s.steer(M(), 'MULE');
      s.countdown(0, 'Mule crosses the line', null, { dynamic: () => { const e = M(); if (!e) return 0; return Math.max(0, (e.state.position.z - lineZ) / Math.max(60, -e.state.velocity.z)); } });
      s.chat([
        [1, 'awacs', 'Halyard 1, Cathedral. Mule is on your nose, {rng} miles, low and heading for the line. You\'re the only one under this weather.', { vars: { rng: Math.round(flat(s.anchor, path[0]) / NM) } }],
        [7, 'awacs', 'Terrain is rising ahead. I\'ll call the ridges, you watch the ground.'],
      ]);
      s.on('kill', ({ victim, weapon, killer }) => { if (victim === mule.members[0] && killer === s.player && weapon === 'gun') { style.done(); s.medal('close-shave', 'Close Shave', 'Brought down a fleeing transport with the cannon, in a thunderstorm.'); } });
      s.when(() => { const e = M(); return e && e.state.position.z < lineZ; }, () => {
        if (kill.state === 'active') kill.fail('Mule crossed the Lantern Line');
      });
      s.when(() => kill.state === 'done', () => s.say('furnace', 'Furnace to Gravel: the package is lost. Come home.', { priority: 1, voice: 'enemy', team: 'red' }));
    },
    winReason: 'Mule destroyed short of the line',
  }),

  // ------------------------------------------------------------------------------------------------ 6
  mission({
    id: 'c6-meridian', order: 6, title: 'Lantern at Sea', tagline: 'Three strike waves against the carrier, as the sun goes down.',
    brief: [
      'USS Meridian has moved in close to the coast to give us more jets. The Directorate has noticed. Cathedral expects three waves of strike fighters to come in low over the water at dusk, each trying to get close enough to put a missile into the boat.',
      'You launch from Meridian with two wingmen. Strikers that get within launch range will fire and run. A carrier can take a hit or two. It cannot take many.',
      'Meet each wave far out. The sun will be in your eyes for the first one, and gone for the last.',
    ],
    home: 'carrier', location: 'KHVN', locationName: 'USS Meridian, off the coast', map: briefMap(-6000, 64000, 46000, [3530, 53030, 235], [[-32500, 84850], [-32000, 85500]], [[15000, 45000]]), tod: 18.9, weather: 'scattered', aircraft: 'fa18', threat: 4, minutes: 8,
    objectivesPreview: ['Protect USS Meridian', 'Break all three strike waves', 'Optional: shoot down every striker before it fires'],
    start: { at: 'carrier', brg: 235, dist: 14000, alt: 4000, hdg: 235, spd: 230 },
    script(s) {
      const boat = s.places.carrier;
      const maxHits = s.n(4, 3, 2);
      let hits = 0, launches = 0;
      s.wingmen(2);
      const strike = (brg, extra = {}) => () => s.at({ from: boat, brg: brg + s.between(-12, 12), dist: 62000, agl: 900 });
      const toBoat = () => s.orders.patrol([V(boat.x, 900, boat.z)], { passive: true });
      const sw = (name, brg, n, idx) => ({ type: ['fa18', 'f16'], count: n, callsign: name, startIndex: idx, at: strike(brg), heading: boat, passive: true, points: 120, role: 'striker', mark: 'STRIKER', order: toBoat, speed: 210, thrust: 0.45, drag: 0.02, call: true });
      const esc = (name, brg, n, lead) => ({ type: ['f15', 'f14'], count: n, callsign: name, at: () => s.at({ from: s.byName(lead).leader || boat, brg: 180, dist: 2500, alt: 3500 }), heading: boat, engageWithin: 20000, order: () => s.orders.escort(s.byName(lead).leader, { x: 400, y: 1500, z: 800 }) });
      const w1 = s.group('cinder', sw('Cinder', 230, s.n(2, 2, 3), 1));
      const w2 = s.wave('slag', sw('Slag', 260, 2, 1), { or: [{ dead: w1 }, { after: 200 }] }, (g) => s.steer(g.leader, 'WAVE 2'));
      const w3 = s.wave('kiln', sw('Kiln', 200, s.n(2, 3, 3), 1), { or: [{ dead: w2 }, { after: 330 }] }, (g) => s.steer(g.leader, 'WAVE 3'));
      // escorts launch with their strikers
      const e2 = s.declare('slag-escort', esc('Flint', 260, s.n(1, 2, 2), 'slag'));
      const e3 = s.declare('kiln-escort', esc('Gravel', 200, s.n(1, 2, 3), 'kiln'));
      s.when(() => w2.spawned, () => e2.spawn());
      s.when(() => w3.spawned, () => e3.spawn());
      const protect = s.objective('boat', 'Protect USS Meridian', { standing: true, progress: `hits 0 / ${maxHits}`, points: 400 });
      const waves = s.objective('waves', 'Break all three strike waves', { progress: 'wave 1 / 3', points: 300 });
      const clean = s.objective('clean', 'Shoot down every striker before it fires', { optional: true, standing: true, points: 250 });
      s.mark({ x: boat.x, y: 20, z: boat.z }, 'MERIDIAN', 'protect');
      s.steer(w1.leader, 'WAVE 1');
      s.chat([
        [1, 'boat', 'Halyard, Meridian. You\'re the umbrella tonight. Please don\'t let it rain.'],
        [5, 'awacs', 'Cathedral: first wave low on the water, bearing two three zero from the boat, thirty-plus miles. Strike fighters. Go get them.'],
      ]);
      s.every(0.5, () => {
        for (const g of [w1, w2, w3]) for (const e of g.members) {
          if (!e.alive || e.tags.spent || flat(e.state.position, boat) > 12000) continue;
          e.tags.spent = true; launches++; s.unmark(e);
          clean.fail();
          if (e.pilot) e.pilot.setOrder(s.orders.flee(bearing(boat, e.state.position), 1200));
          s.say('boat', ['Vampire, vampire! Missile inbound to Meridian!', 'Meridian: launch detected! Brace, brace, brace!'], { priority: 2 });
          s.after(9, () => {
            hits++; protect.set(`hits ${hits} / ${maxHits}`);
            if (hits >= maxHits) protect.fail('USS Meridian was crippled');
            else s.say('boat', ['Meridian took a hit. Fires on the hangar deck. We\'re still afloat. Mostly.', 'Impact aft! Meridian is damaged but steaming.'], { priority: 2 });
          });
        }
        const wave = w3.spawned ? 3 : w2.spawned ? 2 : 1;
        waves.set(`wave ${wave} / 3`);
        if (w3.spawned && waves.state === 'active') {
          let open = 0;
          for (const g of [w1, w2, w3]) for (const e of g.members) if (e.alive && !e.tags.spent) open++;
          if (open === 0) waves.done();
        }
      });
      s.on('kill', ({ victim }) => { if (victim.tags.role === 'striker' && !victim.tags.spent && s.chance(0.4)) s.say('boat', ['Meridian copies the splash. The galley sends its regards.', 'Nice shooting, Halyard. One less on the scope.'], { priority: 0, delay: 2 }); });
    },
    winReason: 'Strike waves broken, Meridian afloat',
  }),

  // ------------------------------------------------------------------------------------------------ 7
  mission({
    id: 'c7-blackout', order: 7, title: 'Blackout', tagline: 'Night intercept. Not everything on the scope is the real threat.',
    brief: [
      'Two in the morning. Cathedral picks up bombers far out over the sea, lights off, swinging around the south of the coast toward Haven. It is the first time the Directorate has tried the long way round.',
      'You are already airborne on night patrol with your wingman, Halyard 2. Stars are out, the moon is thin, and the sea is black.',
      'Cathedral has a feeling about this one. So do I. Keep half an eye on the coast.',
    ],
    location: 'KHVN', locationName: 'Off the coast south of Haven', map: briefMap(-24000, 30000, 44000, [-14910, 21300, 215], [[-50850, 56480], [-49800, 57500]], [[0, 0]]), tod: 23.4, weather: 'clear', aircraft: 'f16', threat: 4, minutes: 7,
    objectivesPreview: ['Destroy the raid before it reaches Haven', 'Optional: destroy the escorts'],
    start: { at: 'haven', brg: 215, dist: 26000, alt: 6500, hdg: 215, spd: 240 },
    script(s) {
      const haven = s.places.haven;
      const wing = s.wingmen(s.n(1, 1, 2));
      const ember = s.group('ember', { type: 'b2', count: 2, callsign: 'Ember', at: { from: haven, brg: 222, dist: s.n(76000, 76000, 78000), alt: 7000 }, heading: haven, spacing: 1500, formation: 'line',
        passive: true, loadout: UNARMED, hp: s.n(110, 160, 200), points: 160, mark: 'BOMBER', speed: 220, role: 'bomber',
        order: () => s.orders.patrol([V(haven.x, 7000, haven.z)], { passive: true }) });
      const cinder = s.group('cinder', { type: ['f16', 'f14'], count: s.n(1, 1, 2), callsign: 'Cinder', at: { from: haven, brg: 221, dist: s.n(72000, 72000, 74000), alt: 8000 }, heading: haven,
        loadout: s.n({ ir: 0, radar: 0 }, undefined, undefined), skill: s.skill('enemy', s.n(-0.08, 0, 0)),
        engageWithin: 15000, order: (i) => s.orders.escort(ember.members[i % 2], { x: 600, y: 800, z: 500 }) });
      const lamp = s.wave('lamp', { type: 'a10', count: s.n(1, 1, 2), callsign: 'Lamp', at: { from: haven, brg: 105, dist: s.n(85000, 72000, 70000), agl: 1700 }, heading: haven,
        passive: true, loadout: { gun: 0, ir: 0, radar: 0 }, points: 150, mark: 'LOW RAIDER', role: 'raider', speed: 190, spacing: 800,
        order: () => s.orders.patrol([V(haven.x, 1700, haven.z)], { passive: true }) }, { or: [{ dead: ember }, { after: s.n(170, 120, 90) }] }, (g) => {
        // on rookie the escorts are at the end of their fuel when the real raid shows itself
        if (s.difficulty === 'rookie' && cinder.alive) s.after(12, () => { cinder.order((e) => s.orders.flee(bearing(haven, e.state.position), 9000)); s.say(cinder.leader || 'furnace', 'Cinder flight, bingo. Heading home. Lamp, you\'re on your own.', { priority: 1, voice: 'enemy', team: 'red' }); });
        s.chat([
          [0, 'awacs', 'Cathedral: pop-up contacts! Low, on the coast, bearing one zero five from Haven, coming in under everything. That\'s the real raid!', { priority: 2 }],
          [5, 'awacs', 'Halyard 2, break off and take the low group. Halyard 1, finish the bombers if you can, then help.'],
          [3, wing.leader || 'awacs', 'Halyard 2, going low. Wish me luck finding them.'],
        ]);
        s.after(8, () => { const w = wing.leader; if (w?.pilot && g.leader) w.pilot.setOrder(s.orders.engage(g.leader)); });
        s.after(30, () => { if (g.alive) s.steer(g.leader, 'LOW RAIDERS'); });
      });
      const raid = s.destroy('raid', 'Destroy the raid before it reaches Haven', [ember, lamp]);
      s.destroy('escorts', 'Destroy the escorts', cinder, { optional: true });
      s.mark({ x: haven.x, y: 20, z: haven.z }, 'HAVEN', 'protect');
      s.steer(ember.leader, 'BOMBERS');
      s.countdown(0, 'Raid reaches Haven', null, { dynamic: () => { let t = 999; for (const g of [ember, lamp]) for (const e of g.members) if (e.alive) t = Math.min(t, ETA(e, haven)); return t; } });
      s.chat([
        [1, 'awacs', 'Halyard, Cathedral. Two heavies, bearing two two zero, fifty miles, angels twenty-six, lights out. Escorts above them. Cleared hot.'],
        [6, wing.leader, 'Halyard 2. Can\'t see a thing out here. Love it.'],
      ]);
      s.every(0.5, () => {
        if (raid.state !== 'active') return;
        for (const g of [ember, lamp]) for (const e of g.members) if (e.alive && flat(e.state.position, haven) < 9000) {
          s.say('tower', 'Haven Tower: explosions on the field! We\'ve been hit!', { priority: 2 });
          raid.fail('The raid reached Haven');
          return;
        }
      });
      s.when(() => ember.spawned && ember.alive === 0 && cinder.alive > 0, () => {
        cinder.order((e) => s.orders.flee(bearing(haven, e.state.position), 9000));
        s.say(cinder.leader || 'furnace', '@enemy.retreat', { priority: 1, voice: 'enemy', team: 'red' });
      });
    },
    winReason: 'Night raid destroyed',
  }),

  // ------------------------------------------------------------------------------------------------ 8
  mission({
    id: 'c8-ceiling', order: 8, title: 'Glass Ceiling', tagline: 'Outnumbered, above a floor of solid cloud.',
    brief: [
      'The Directorate is massing fighters for something big, and they are using the overcast over the Glass Flats to hide it. Cathedral can see them, roughly. Nobody else can see anything.',
      'Your flight is going up through the deck to break up their formation before it forms: Halyard 2 for certain, Halyard 3 if the maintainers win their argument with her jet. You will be outnumbered. The cloud tops are at about ten thousand feet; anything below is soup.',
      'Watch the cloud tops. Things come out of them.',
    ],
    location: 'KRDR', locationName: 'Above the overcast, Glass Flats', map: briefMap(67000, -40000, 24000, [64870, -25900, 10], [[70080, -55450], [69200, -54800], [70900, -54800]]), tod: 12, weather: 'overcast', aircraft: 'f16', threat: 4, minutes: 7,
    objectivesPreview: ['Destroy every Directorate fighter', 'Optional: your wingmen come home', 'Hidden: something about the cannon'],
    start: { at: 'glassFlats', brg: 200, dist: 15000, alt: 6200, hdg: 10, spd: 240 },
    script(s) {
      const wing = s.wingmen(2);
      // Flint is still forming up, crossing your nose: catch them before they turn in
      const flint = s.group('flint', { type: 'mixed', count: s.n(2, 2, 2), callsign: 'Flint', at: { rel: 10, dist: 26000, alt: 6800 }, heading: { rel: 95 }, formation: 'wedge', spacing: 900,
        engageWithin: s.n(7000, 9000, 14000), order: (i, p) => s.orders.patrol([s.at({ from: p, rel: 95, dist: 40000, alt: p.y }), s.at({ from: p, rel: -85, dist: 10000, alt: p.y })]) });
      const slag = s.wave('slag', { type: 'mixed', count: s.n(2, 2, 2), callsign: 'Slag', at: () => s.at({ rel: s.pick([-55, 55]), dist: 24000, alt: 7500 }), call: '@awacs.wave' }, { or: [{ kills: 2 }, { after: 100 }] });
      const pop = s.wave('kiln', { type: ['f16', 'fa18'], count: s.n(1, 1, 2), callsign: 'Kiln', at: () => s.at({ rel: s.pick([-15, 15]), dist: 9000, alt: 2600, clear: 300 }), heading: { rel: 180 } }, { or: [{ kills: 4 }, { after: 220 }] }, () => {
        s.say('awacs', 'Pop-up! Two contacts climbing out of the overcast, right under your nose. Look low!', { priority: 2 });
        s.say(wing.leader || 'awacs', 'Where did they come from? Oh. The clouds. Right.', { priority: 0, delay: 4 });
      });
      s.destroy('all', 'Destroy every Directorate fighter', [flint, slag, pop]);
      s.bingo(s.n(450, 420, 420), { fraction: s.n(0.5, 0.6, 0.5), win: 'Formation broken', lose: 'The formation held' });
      s.protect('h2', 'Bring your wingmen home', wing, { optional: true });
      let guns = 0;
      const gun = s.objective('guns', 'Three kills with the cannon', { hidden: true, points: 300 });
      s.on('kill', ({ killer, weapon, victim }) => { if (killer === s.player && weapon === 'gun' && victim.team === 'red' && ++guns >= 3) gun.done(); });
      s.chat([
        [1, 'awacs', 'Halyard, Cathedral. Lead group bearing {brg}, thirty-five miles, and more behind them. Break them up.', { vars: { brg: String(Math.round(bearing(s.anchor, flint.members[0].state.position) / 10) * 10).padStart(3, '0') } }],
        [6, wing.leader, 'Halyard 2. Lovely view up here. Shame about the company.'],
      ]);
    },
    winReason: 'Formation broken',
  }),

  // ------------------------------------------------------------------------------------------------ 9
  mission({
    id: 'c9-quillon', order: 9, title: 'Quillon', tagline: 'The Directorate sends its best. He wants to meet you.',
    brief: [
      'The Directorate\'s answer to a bad month is Colonel Anselm Drey, call sign Quillon: their top fighter pilot, their favourite poster, and by every account a genuinely brilliant flyer. Last night he broadcast an invitation on the guard frequency, addressed to "the pilot of Halyard 1". Dawn, over the Cobbler valleys.',
      'Command thinks it is a trap. It probably is. We are going anyway, with friends: his Hilt flight will come first, and Quillon likes to arrive once the stage is set.',
      'Ridgeback flew with Drey at an exchange course years ago, before the junta. Her advice: "He flies like he is being photographed. Make him work and he gets vain."',
    ],
    location: 'KPNC', locationName: 'Cobbler Valleys, high range', map: briefMap(40000, -110000, 26000, [40000, -94000, 0], [[40000, -124000], [41000, -124000], [39000, -124000]]), tod: 6.1, weather: 'broken', aircraft: 'f22', threat: 5, minutes: 8,
    objectivesPreview: ['Shoot down Quillon', 'Optional: destroy Hilt flight', 'Hidden: a fitting end'],
    start: { at: 'cobbler', brg: 180, dist: 26000, alt: 6000, hdg: 0, spd: 250 },
    script(s) {
      const wing = s.wingmen(s.n(2, 2, 1));
      const hilt = s.group('hilt', { type: ['f15', 'f14', 'fa18'], count: s.n(2, 3, 4), callsign: 'Hilt', startIndex: 2, at: { rel: 0, dist: 30000, alt: 6500 }, formation: 'line', spacing: 1000, skill: s.skill('elite', -0.12) });
      const ace = s.declare('quillon', {
        type: 'f22', count: 1, callsign: 'Quillon', single: true, skill: s.skill('elite', s.n(0, 0.1, 0.05)), hp: s.n(130, 170, 230), loadout: { ir: 2, radar: s.n(0, 0, 2), flares: s.n(20, 30, 40) },
        points: 600, role: 'ace', mark: 'QUILLON', at: () => s.at({ rel: s.pick([-35, 35]), dist: 15000, alt: (s.player ? s.player.state.position.y : 6000) + 1200 }),
      });
      const duel = s.destroy('quillon', 'Shoot down Quillon', ace, { points: 500 });
      s.destroy('hilt', 'Destroy Hilt flight', hilt, { optional: true });
      const fitting = s.objective('guns', 'Finish Quillon with the cannon', { hidden: true, points: 400 });
      s.chat([
        [1, 'ace', 'Good morning, Halyard 1. Thank you for coming. Hilt flight will see you first; consider them my opening remarks.', { voice: 'enemy', team: 'red' }],
        [7, 'awacs', 'Halyard, Cathedral. Hilt flight, bearing {brg}, thirty miles. Quillon is not on my scope yet. He will be.', { vars: { brg: String(Math.round(bearing(s.anchor, hilt.members[0].state.position) / 10) * 10).padStart(3, '0') } }],
        [5, wing.leader, 'Halyard 2. Opening remarks. Who talks like that?'],
      ]);
      const arrive = () => {
        ace.spawn();
        const q = ace.leader;
        s.steer(q, 'QUILLON');
        hilt.order(() => s.orders.flee(0, 7000));
        if (q?.pilot) q.pilot.setOrder(s.orders.engage(s.player));
        // the wingmen keep the ring: they cover the fleeing Hilt jets and leave the duel to you (on rookie they stay in)
        if (s.difficulty !== 'rookie') {
          wing.spec.managed = null;
          wing.order((e) => ({ ...s.orders.orbit(s.at({ from: e, rel: 0, dist: 4000 }), 6000, e.state.position.y), weaponsHold: true }));
          // honour lasts until it doesn't: they come in after a while, or as soon as lead takes a hit
          let joined = false;
          const join = (line) => {
            if (joined || s.ended) return; joined = true;
            wing.spec.managed = 'wing';
            const q2 = ace.leader; if (q2) wing.order(() => s.orders.engage(q2));
            s.say(wing.leader || 'awacs', line, { priority: 1 });
          };
          s.after(s.n(0, 75, 140), () => join('Enough watching. Coming in, lead. He can complain to the referee.'));
          s.on('damage', ({ target, source }) => { if (target === s.player && source === ace.leader) s.after(2, () => join('Lead\'s hit! Halyard 2 is in, breaking his rules and mine.')); });
        }
        s.chat([
          [0.5, 'awacs', 'New contact, single, fast, {dir}. That\'s him.', { priority: 2, vars: { dir: q && s.player ? clockDir(s.player.state, q.state.position) : 'high' } }],
          [4, 'ace', 'Hilt flight, clear the stage. Halyard 1, shall we?', { voice: 'enemy', team: 'red' }],
          [6, wing.leader || 'awacs', 'Lead, we\'ll keep the rest off you. Go.'],
        ]);
      };
      s.trigger({ or: [{ dead: hilt, count: Math.max(1, hilt.size - 1) }, { after: s.n(200, 170, 150) }] }, () => {
        arrive();
        // he came to be photographed, not to run dry: after a while Quillon calls it and leaves
        s.countdown(s.n(330, 300, 270), 'Quillon bingo', () => {
          const q = ace.leader; if (q?.pilot) q.pilot.setOrder(s.orders.flee(0, 8000));
          s.lose('Quillon got away', [[0.5, 'ace', 'Fuel, I am afraid. Another morning, Halyard 1. Do practise.', { voice: 'enemy', team: 'red' }], [4, 'awacs', 'He\'s extending north, too fast to catch. Bring it home, {cs}.']]);
        });
      });
      let said66 = false, said33 = false, hitT = -99;
      s.on('damage', ({ target, source }) => {
        const q = ace.leader; if (!q) return;
        if (target === q && source === s.player) {
          const f = q.hp / (q.maxHp || 1);
          if (!said66 && f < 0.66) { said66 = true; s.say('ace', 'First blood to you. I was beginning to worry you were ordinary.', { priority: 1 }); }
          if (!said33 && f < 0.33) { said33 = true; s.say('ace', 'Ah. You are actually good. How inconvenient.', { priority: 1 }); }
        } else if (target === s.player && source === q && s.t - hitT > 15) { hitT = s.t; s.say('ace', ['Forgive me. That was rude.', 'You flinched. I saw it.', 'Ridgeback taught you that break, didn\'t she? She taught me the counter.'], { priority: 1 }); }
      });
      s.on('missile:launch', ({ shooter }) => { if (shooter === ace.leader) s.say('ace', ['A gift, Halyard 1.', 'Catch.'], { priority: 1, key: 'qfox', window: 20 }); });
      s.on('kill', ({ victim, killer, weapon }) => {
        if (victim === ace.members[0]) {
          if (killer === s.player && weapon === 'gun') { fitting.done(); s.medal('broken-quillon', 'Broken Quillon', 'Defeated the Directorate\'s ace with the cannon.'); }
        } else if (killer && killer === ace.leader && victim.team === 'blue' && !victim.isPlayer) s.say('ace', 'My apologies to your friend. Nothing personal.', { priority: 1, delay: 1.5 });
      });
      s.winChat = [
        [1, 'ace', 'Well flown. Tell Ridgeback she still teaches the merge too well. I am leaving now, rather quickly.', { voice: 'enemy', team: 'red' }],
        [6, 'awacs', 'Good chute on Quillon. The Directorate just lost its favourite story. Halyard, come home.'],
        [5, () => wing.leader || 'awacs', 'Drinks are on two. I mean, on you. I mean, on somebody.'],
      ];
      void duel;
    },
    winReason: 'Quillon shot down',
  }),
];
