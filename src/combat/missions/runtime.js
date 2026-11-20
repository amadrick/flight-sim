// Mission scripting toolkit. A mission is a definition plus `script(s)`, called once at start with the object built
// here. Everything a script needs is on `s`: placement (terrain-aware), groups and waves, orders, triggers and timers,
// objectives with fail conditions, steer points / markers / countdowns for the HUD, radio, scoring and the ending.
// See README.md for the full reference. Setup may allocate freely; the per-frame update does not.
import * as THREE from 'three';
import { headingVec, bearing, NM } from '../util.js';
import { PLACES, offset, safeAlt, groundMax, routeMax, groundAt } from './geo.js';

const MARK_COLOR = { target: '#ff5a4e', protect: '#5ad1ff', nav: '#ffd166', zone: '#ffb347', friendly: '#7cff8a' };

/** Skill by role and difficulty (0..1, passed to world.spawnAircraft). */
export const SKILLS = {
  enemy: { rookie: 0.18, veteran: 0.5, ace: 0.72 },
  elite: { rookie: 0.32, veteran: 0.66, ace: 0.88 },
  wing: { rookie: 0.8, veteran: 0.62, ace: 0.55 },
  target: { rookie: 0.1, veteran: 0.25, ace: 0.4 },
};
/** The Cendrine Directorate flies a mixed bag. */
/** Default missiles on Directorate fighters by difficulty. */
export const ENEMY_LOADOUT = { rookie: { ir: 1, radar: 0, flares: 4 }, veteran: { ir: 2, radar: 0, flares: 10 }, ace: { ir: 2, radar: 1, flares: 16 } };
export const ADVERSARY_MIX = ['f16', 'f15', 'fa18', 'f14', 'f16', 'f35'];

export function createRuntime(combat, director, mission, options = {}) {
  const world = combat.world, ev = combat.events, gw = combat.ctx.world;
  const radio = director.radioQ, scoring = director.scoring;
  const tasks = [];         // { at, period, cond, fn, live }
  const offs = [];          // unsubscribe functions
  const groups = [];
  const objectives = [];    // every objective, hidden ones included
  const killers = [];       // destroy-objective records
  const protects = [];
  const markerPool = [];
  const _p = new THREE.Vector3();
  let ended = false, endAt = 0, endOutcome = '', endReason = '', sent = false, groupT = 0, dirty = false;
  let boundary = null;
  const countdowns = [], timerView = { label: '', seconds: 0 };
  const anchor = director.anchor;

  const s = {
    mission, options, combat, world, director, radio, places: PLACES,
    custom: options.custom || {},
    difficulty: combat.difficulty,
    rng: combat.rng,
    anchor: new THREE.Vector3(anchor.x, anchor.y, anchor.z),
    heading: anchor.hdg,
    callsign: anchor.callsign,
    autoWin: true,
    /** called when the player is shot down / crashes; default: lose */
    onPlayerDown: null,
    get t() { return combat.clock; },
    get player() { return world.player; },
    get ended() { return ended; },
    groups,

    // ---------------- dice ----------------
    pick(arr) { return arr[Math.floor(combat.rng() * arr.length) % arr.length]; },
    chance(p) { return combat.rng() < p; },
    between(a, b) { return a + (b - a) * combat.rng(); },
    /** value by difficulty: s.n(rookie, veteran, ace) */
    n(r, v, a) { return combat.difficulty === 'rookie' ? r : combat.difficulty === 'ace' ? (a ?? v) : v; },
    skill(kind = 'enemy', delta = 0) { const t = SKILLS[kind] || SKILLS.enemy; return Math.max(0, Math.min(1, (t[combat.difficulty] ?? t.veteran) + delta)); },

    // ---------------- placement ----------------
    ground(x, z) { return groundAt(gw, x, z); },
    groundMax(x, z, r) { return groundMax(gw, x, z, r); },
    safeAlt(x, z, want, clearance = 450) { return safeAlt(gw, x, z, want, clearance); },
    /**
     * A world point. spec: { from ({x,z} | entity | Vector3; default: the player now, or the start point),
     *   brg (true bearing) | rel (relative to the player's heading), dist (m), alt (m MSL) | agl (m), clear (m, default 450) }
     */
    at(spec = {}) {
      const from = spec.from?.state ? spec.from.state.position : spec.from || (world.player ? world.player.state.position : s.anchor);
      const ph = world.player ? world.player.state.heading * 180 / Math.PI : s.heading;
      const brg = spec.brg ?? ph + (spec.rel ?? 0);
      const p = offset(from, brg, spec.dist ?? 0, 0);
      return s.lift(p, spec);
    },
    /** Give point p (Vector3) a terrain-safe altitude from spec { alt, agl, clear } (defaults: the player's altitude). */
    lift(p, spec = {}) {
      if (spec.agl != null) p.y = Math.max(groundAt(gw, p.x, p.z) + spec.agl, groundMax(gw, p.x, p.z, 1500) + Math.min(spec.agl, 200));
      else p.y = safeAlt(gw, p.x, p.z, spec.alt ?? (world.player ? world.player.state.position.y : s.anchor.y), spec.clear ?? 450);
      return p;
    },
    /** Waypoints with altitudes kept clear of the ground along every leg. pts: [{x,z}|Vector3], o: { alt, agl, clear } */
    route(pts, o = {}) {
      const out = pts.map((q) => new THREE.Vector3(q.x, 0, q.z));
      for (let i = 0; i < out.length; i++) {
        const a = out[i], b = out[Math.min(i + 1, out.length - 1)], prev = out[Math.max(0, i - 1)];
        const floor = Math.max(routeMax(gw, prev, a), routeMax(gw, a, b));
        if (o.agl != null) a.y = Math.max(groundAt(gw, a.x, a.z) + o.agl, floor + Math.min(o.agl, 250));
        else a.y = Math.max(o.alt ?? 4000, floor + (o.clear ?? 500));
      }
      return out;
    },
    /** A circular zone. o: { floor, ceiling } (m MSL). zone.contains(entity|Vector3) */
    zone(center, radius, o = {}) {
      const c = center.state ? center.state.position : center;
      return {
        center: c, radius, floor: o.floor ?? -1e9, ceiling: o.ceiling ?? 1e9,
        contains(e) { const p = e?.state ? e.state.position : e; if (!p) return false; const dx = p.x - c.x, dz = p.z - c.z; return dx * dx + dz * dz < radius * radius && p.y > this.floor && p.y < this.ceiling; },
      };
    },

    // ---------------- groups ----------------
    /** Declare a group (spawned later with g.spawn()). See README for the spec. */
    declare(name, spec) {
      const g = makeGroup(name, spec);
      groups.push(g);
      return g;
    },
    /** Declare and spawn now. */
    group(name, spec) { const g = s.declare(name, spec); g.spawn(); return g; },
    /** Declare now, spawn when the trigger fires. onSpawn(g) runs after the spawn. */
    wave(name, spec, trigger, onSpawn) {
      const g = s.declare(name, spec);
      s.trigger(trigger, () => { g.spawn(); onSpawn?.(g); });
      return g;
    },
    /** The player's wingmen in formation; they escort and join any fight within 25 km. */
    wingmen(count, spec = {}) {
      return s.group('wingmen', {
        team: 'blue', type: spec.type || director.anchor.aircraft, count, callsign: spec.callsign || director.anchor.flight,
        startIndex: 2, formation: 'wing', skill: spec.skill ?? s.skill('wing'), managed: 'wing', role: 'wing', ...spec,
      });
    },
    byName(name) { return groups.find((g) => g.name === name) || null; },
    /** Live red aircraft plus declared red aircraft not yet spawned. */
    hostilesLeft() {
      let n = 0;
      for (const g of groups) if (g.team === 'red' && !g.noCount) n += g.spawned ? g.alive : g.size;
      return n;
    },

    // ---------------- orders ----------------
    orders: {
      engage: (target) => ({ type: 'engage', target: target || null }),
      patrol: (waypoints, o = {}) => ({ type: 'patrol', waypoints, index: 0, loop: o.loop !== false, passive: !!o.passive, speed: o.speed }),
      escort: (leader, offset = { x: 80, y: 0, z: 60 }) => ({ type: 'escort', leader, offset }),
      cruise: (heading, alt, o = {}) => ({ type: 'cruise', heading, alt, passive: !!o.passive }),
      /** orbit a point: expressed as a patrol around a ring (works with every AI) and carrying center/radius */
      orbit: (center, radius, alt, o = {}) => {
        const wps = [];
        for (let k = 0; k < 6; k++) { const a = (k / 6) * 360 * (o.ccw ? -1 : 1); wps.push(offset(center, a, radius, alt)); }
        return { type: 'patrol', waypoints: wps, index: 0, loop: true, orbit: { center, radius, alt }, passive: !!o.passive };
      },
      /** run away along a heading (falls back to cruise on AIs that do not know 'flee') */
      flee: (heading, alt, o = {}) => ({ type: 'flee', heading, alt, passive: o.passive !== false }),
      rtb: (place, alt, from) => ({ type: 'rtb', airport: place, heading: from ? bearing(from, place) : 0, alt, passive: true }),
      intercept: (target, from) => ({ type: 'intercept', target, heading: from && target ? bearing(from, target.state.position) : 0, alt: target?.state.position.y }),
    },

    // ---------------- triggers and timers ----------------
    after(sec, fn) { const t = { at: combat.clock + sec, period: 0, cond: null, fn, live: true }; tasks.push(t); return t; },
    every(sec, fn) { const t = { at: combat.clock + sec, period: sec, cond: null, fn, live: true }; tasks.push(t); return t; },
    when(cond, fn) { const t = { at: 0, period: 0, cond, fn, live: true }; tasks.push(t); return t; },
    cancel(t) { if (t) t.live = false; },
    /** Subscribe to a combat event for the life of the mission. */
    on(name, fn) { offs.push(ev.on(name, (p) => { if (!ended || name === 'kill') fn(p); })); },
    /** The player's own touchdown (simulator event; never fires in the node bench). */
    onTouchdown(fn) { const e = combat.ctx.events; if (e?.on) offs.push(e.on('touchdown', (p) => { if (combat.active) fn(p); })); },
    /**
     * Run fn once when trig fires. trig: seconds | { after } | { dead: group|name, count? } | { kills: n }
     *   | { zone, who? } | { or: [trig…] } | () => boolean
     */
    trigger(trig, fn) {
      const cond = makeCond(trig);
      let fired = false;
      const once = () => { if (!fired) { fired = true; fn(); } };
      if (cond === true) return s.after(typeof trig === 'number' ? trig : trig.after, once);
      return s.when(cond, once);
    },

    // ---------------- objectives ----------------
    /** o: { optional, hidden, points, progress, standing (counts as done at the end unless failed), quiet } */
    objective(id, text, o = {}) {
      const ob = {
        id, text, state: 'active', optional: !!o.optional, hidden: !!o.hidden, progress: o.progress || '',
        points: o.points ?? (o.hidden ? 200 : o.optional ? 150 : 250), standing: !!o.standing, quiet: !!o.quiet, reason: '',
        done() { setState(ob, 'done'); return ob; },
        fail(reason) { ob.reason = reason || ob.text; setState(ob, 'failed'); return ob; },
        set(progress) { if (ob.progress !== progress) { ob.progress = progress; dirty = true; } return ob; },
      };
      objectives.push(ob); dirty = true;
      return ob;
    },
    /** Destroy every member (or o.count) of the given groups. Progress "k / n". */
    destroy(id, text, gs, o = {}) {
      const list = (Array.isArray(gs) ? gs : [gs]).map((g) => (typeof g === 'string' ? s.byName(g) : g));
      const ob = s.objective(id, text, o);
      let total = 0; for (const g of list) total += g.size;
      killers.push({ ob, list, need: o.count ?? total, total });
      ob.progress = `0 / ${o.count ?? total}`;
      return ob;
    },
    /** Keep at least o.min (default: all) of these alive. Fails the mission when they are lost. */
    protect(id, text, g, o = {}) {
      const ob = s.objective(id, text, { standing: true, points: 300, ...o });
      const list = Array.isArray(g) ? g : [g];
      let size = 0; for (const x of list) size += x.size ?? 1;
      protects.push({ ob, list, min: o.min ?? size, size });
      ob.progress = o.progress ?? '';
      return ob;
    },
    /** Fly into a zone. */
    reach(id, text, zone, o = {}) {
      const ob = s.objective(id, text, o);
      s.when(() => zone.contains(world.player), () => ob.done());
      return ob;
    },
    /** Hold out for `seconds`: shows a countdown, completes when it runs out. */
    hold(id, text, seconds, o = {}) {
      const ob = s.objective(id, text, { points: 300, ...o });
      s.countdown(seconds, o.label || text, () => ob.done());
      return ob;
    },
    /**
     * A visible countdown (director.timer; the newest live one is shown). onExpire defaults to losing with "Time ran out".
     * o: { warn: false (no one-minute call), dynamic: () => seconds (an estimate shown instead; never expires by itself) }
     */
    countdown(seconds, label, onExpire, o = {}) {
      const c = { label, end: combat.clock + seconds, live: true, warned: seconds <= 65 || o.warn === false, dynamic: o.dynamic || null, onExpire: onExpire || (() => s.lose('Time ran out')) };
      countdowns.push(c);
      return { cancel() { c.live = false; }, get remaining() { return Math.max(0, c.end - combat.clock); }, get live() { return c.live; } };
    },
    /** Stay within `radius` of center; after a warning the player has o.grace seconds to come back. */
    boundary(center, radius, o = {}) { boundary = { zone: s.zone(center, radius), grace: o.grace ?? 30, out: -1, timer: null }; },
    failIf(cond, reason) { s.when(cond, () => s.lose(reason)); },
    /**
     * The mission clock for fights that could otherwise run forever: when it runs out the hostiles still flying
     * disengage. o.decide(lost, total) says whether that is a win (default: at least o.fraction, 0.6, of the red aircraft
     * that showed up are down). o: { label, fraction, decide, win, lose, winChat, loseChat }
     */
    bingo(seconds, o = {}) {
      return s.countdown(seconds, o.label || 'Bingo fuel', () => {
        let total = 0, lost = 0;
        for (const g of groups) if (g.team === 'red' && !g.noCount && g.spawned) { total += g.size; lost += g.lost; }
        const p = world.player;
        for (const g of groups) if (g.team === 'red' && g.spawned && g.alive) g.order((e) => s.orders.flee(p ? bearing(p.state.position, e.state.position) : 0, e.state.position.y));
        const ok = o.decide ? o.decide(lost, total) : total > 0 && lost / total >= (o.fraction ?? 0.6);
        if (ok) s.win(o.win || 'Bandits disengaged', o.winChat || [[0.5, 'awacs', '@awacs.bugout'], [3, 'awacs', '@awacs.rtb']]);
        else s.lose(o.lose || 'Bingo fuel: the bandits held the airspace', o.loseChat || [[0.5, 'awacs', '@awacs.bugout'], [3, 'awacs', '@awacs.bingoFail']]);
      });
    },

    // ---------------- HUD: steer point, markers ----------------
    /** Set the steer point: a point, an entity (followed) or null. */
    steer(target, label = '') {
      if (!target) { director.waypoint = null; return; }
      const e = target.state ? target : null;
      const pos = e ? e.state.position.clone() : new THREE.Vector3(target.x, target.y ?? s.anchor.y, target.z);
      director.waypoint = { position: pos, label, entity: e };
    },
    /** Highlight a point or an entity. kind: 'target' | 'protect' | 'nav' | 'zone' | 'friendly'. */
    mark(target, label = '', kind = 'target', o = {}) {
      const e = target.state ? target : null;
      const m = markerPool.pop() || { id: 0, label: '', kind: '', color: '', position: new THREE.Vector3(), entity: null, radius: 0 };
      m.id = ++director.markerSeq; m.label = label; m.kind = kind; m.entity = e; m.radius = o.radius || 0; m.color = o.color || MARK_COLOR[kind] || '#ffffff';
      if (e) m.position.copy(e.state.position); else m.position.set(target.x, target.y ?? 0, target.z);
      director.markers.push(m);
      return m;
    },
    unmark(m) {
      const L = director.markers;
      for (let i = L.length - 1; i >= 0; i--) if (L[i] === m || L[i].entity === m || (typeof m === 'string' && L[i].label === m)) { markerPool.push(L[i]); L[i].entity = null; L.splice(i, 1); }
    },

    // ---------------- radio ----------------
    cast(map) { Object.assign(radio.cast, map); },
    say(who, text, o) { return radio.say(who, text, o); },
    /** A scripted exchange: [[delay, who, text, opts?], …] with delays cumulative from now. Returns its length (s). */
    chat(seq, o = {}) {
      let t = 0;
      for (const [d, who, text, so] of seq) {
        t += d;
        const opts = { priority: 1, ttl: 30, ...o, ...(so || {}) };
        s.after(t, () => { if (!ended || opts.final) radio.say(typeof who === 'function' ? who() : who, text, opts); });
      }
      return t;
    },
    /** Controller's picture call for a group (bearing / range from the player). */
    picture(g, key) {
      const p = world.player, e = g.firstAlive?.() || g;
      key = key || ((g.alive ?? 1) === 1 ? '@awacs.pictureSingle' : '@awacs.picture');
      if (!p || !e?.state) return;
      const b = Math.round(bearing(p.state.position, e.state.position) / 10) * 10 || 360;
      radio.say('awacs', key, { priority: 1, vars: { brg: String(b).padStart(3, '0'), rng: Math.max(1, Math.round(p.state.position.distanceTo(e.state.position) / NM)), n: g.alive ?? 1 } });
    },
    /** The first live member of the player's wingmen, if any (for lines like "Lead, check six"). */
    wingman() { const g = s.byName('wingmen'); return g ? g.firstAlive() : null; },

    // ---------------- score and ending ----------------
    score(points, label, reason) { scoring.add(points, label, reason); },
    medal(id, title, text) { scoring.medal(id, title, text); },
    /** default closing lines (a script may replace them) */
    winChat: [[0.8, 'awacs', '@awacs.rtb']],
    loseChat: [[0.6, 'awacs', '@awacs.fail']],
    win(reason = 'Mission complete', chat) { finish('success', reason, chat ?? s.winChat, 3.5); },
    lose(reason = 'Mission failed', chat) { finish('failure', reason, chat ?? s.loseChat, 3); },

    /** current objectives as the HUD sees them (hidden ones only once achieved) */
    objectives,
  };

  // ------------------------------------------------------------------ internals
  function makeCond(trig) {
    if (typeof trig === 'number') return true;
    if (typeof trig === 'function') return trig;
    if (trig.after != null && Object.keys(trig).length === 1) return true;
    if (trig.or) { const cs = trig.or.map((x) => { const c = makeCond(x); return c === true ? timeCond(typeof x === 'number' ? x : x.after) : c; }); return () => { for (const c of cs) if (c()) return true; return false; }; }
    if (trig.dead) {
      const g = typeof trig.dead === 'string' ? s.byName(trig.dead) : trig.dead;
      return () => g.spawned && (trig.count != null ? g.lost >= trig.count : g.alive === 0);
    }
    if (trig.kills != null) { const k0 = director.redKills; return () => director.redKills - k0 >= trig.kills; }
    if (trig.zone) return () => trig.zone.contains(trig.who || world.player);
    if (trig.after != null) return timeCond(trig.after);
    return () => false;
  }
  function timeCond(sec) { const at = combat.clock + sec; return () => combat.clock >= at; }

  function setState(ob, st) {
    if (ob.state === st || ob.state !== 'active') return;
    ob.state = st; dirty = true;
    if (st === 'done') {
      combat.director.stats.objectives++;
      scoring.add(ob.points, ob.hidden ? 'Hidden objectives' : ob.optional ? 'Optional objectives' : 'Objectives', ob.text);
      if (!ob.quiet && !ended) radio.say('awacs', ob.optional || ob.hidden ? '@awacs.optionalDone' : '@awacs.objectiveDone', { priority: 0, delay: 1.2 });
    } else if (st === 'failed') {
      combat.director.stats.objectivesFailed++;
      if (!ob.optional && !ob.hidden) s.lose(ob.reason || ob.text);
      else if (!ob.quiet && !ended) radio.say('awacs', '@awacs.objectiveFailed', { priority: 0, delay: 1 });
    }
  }

  function finish(outcome, reason, chat, beat) {
    if (ended) return;
    ended = true; endOutcome = outcome; endReason = reason;
    for (const ob of objectives) if (ob.standing && ob.state === 'active' && outcome === 'success') setState(ob, 'done');
    for (const c of countdowns) c.live = false;
    director.timer = null;
    radio.flush(1);
    const len = chat ? s.chat(chat, { final: true, priority: 1 }) : 0;
    endAt = combat.clock + Math.max(beat, len + 1.5);
    dirty = true;
  }

  function makeGroup(name, spec) {
    const count = Math.max(0, Math.round(spec.count ?? 1));
    const g = {
      name, spec, team: spec.team || 'red', size: count, members: [], spawned: false, noCount: !!spec.noCount, role: spec.role || '',
      get alive() { let n = 0; for (const e of g.members) if (e.alive) n++; return g.spawned ? n : 0; },
      get lost() { let n = 0; for (const e of g.members) if (!e.alive) n++; return n; },
      firstAlive() { for (const e of g.members) if (e.alive) return e; return null; },
      get leader() { return g.firstAlive(); },
      spawn() { if (!g.spawned) spawnGroup(g); return g; },
      /** give every live member an order (object, or fn(entity, index, group) → order) */
      order(o) { g.members.forEach((e, i) => { if (e.alive && e.pilot) e.pilot.setOrder(typeof o === 'function' ? o(e, i, g) : o); }); return g; },
      each(fn) { g.members.forEach((e, i) => { if (e.alive) fn(e, i); }); return g; },
      mark(label, kind = 'target') { g.each((e) => s.mark(e, label || e.callsign, kind)); return g; },
      engage(target) { return g.order(() => s.orders.engage(target)); },
    };
    return g;
  }

  function resolveAt(at, team) {
    if (typeof at === 'function') return at(s);
    if (at && at.isVector3) return at.clone();
    if (at && (at.dist != null || at.rel != null || at.brg != null)) return s.at(at);
    if (at && at.x != null) return s.lift(new THREE.Vector3(at.x, 0, at.z), at);
    return s.at({ rel: 0, dist: team === 'red' ? 20000 : 0 });
  }

  /** Keep red spawns out of the player's face and off their tail. */
  function fair(p) {
    const pl = world.player; if (!pl) return p;
    const pp = pl.state.position;
    let dx = p.x - pp.x, dz = p.z - pp.z, d = Math.hypot(dx, dz);
    if (d < 1) { dx = Math.sin(pl.state.heading); dz = -Math.cos(pl.state.heading); d = 1; }
    let rel = Math.atan2(dx, -dz) - pl.state.heading;
    rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const min = Math.abs(rel) > 1.75 ? 9000 : 4500;
    if (d < min) { p.x = pp.x + dx / d * min; p.z = pp.z + dz / d * min; s.lift(p, { alt: p.y }); }
    return p;
  }

  /** Target sorting: spread a group's opening targets over the blue side (player first) instead of all on one jet. */
  const blues = [];
  function sortTarget(i) {
    world.enemiesOf('red', blues, 'aircraft');
    if (blues.length < 2) return null;
    blues.sort((a, b) => (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0) || a.id - b.id);
    return blues[sortSeq++ % blues.length];
  }
  let sortSeq = 0;
  const reds = [];
  /** the i-th nearest hostile to e within range (wingmen do not all pile onto one bandit) */
  function spreadTarget(e, i, range) {
    world.enemiesOf(e, reds, 'aircraft');
    const p = e.state.position;
    for (let k = reds.length - 1; k >= 0; k--) if (reds[k].state.position.distanceToSquared(p) > range * range) reds.splice(k, 1);
    if (!reds.length) return null;
    reds.sort((a, b) => a.state.position.distanceToSquared(p) - b.state.position.distanceToSquared(p));
    return reds[(i + 1) % reds.length];
  }

  function spawnGroup(g) {
    g.spawned = true;
    const sp = g.spec, team = g.team, pl = world.player;
    const center = resolveAt(sp.at, team);
    if (team === 'red' && sp.fair !== false) fair(center);
    let hdg;
    if (typeof sp.heading === 'number') hdg = sp.heading;
    else if (sp.heading && sp.heading.rel != null) hdg = (pl ? pl.state.heading * 180 / Math.PI : s.heading) + sp.heading.rel;
    else if (sp.heading === 'player' || (sp.heading == null && team === 'red')) hdg = pl ? bearing(center, pl.state.position) : s.heading;
    else if (sp.heading && sp.heading.x != null) hdg = bearing(center, sp.heading);
    else hdg = pl ? pl.state.heading * 180 / Math.PI : s.heading;
    const fwd = headingVec(hdg, new THREE.Vector3()), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const spacing = sp.spacing ?? (sp.formation === 'wing' ? 160 : 350);
    const types = Array.isArray(sp.type) ? sp.type : sp.type === 'mixed' ? ADVERSARY_MIX : [sp.type || 'f16'];
    const typeOff = Math.floor(combat.rng() * types.length);
    for (let i = 0; i < g.size; i++) {
      const pos = center.clone();
      const side = i % 2 ? 1 : -1, row = Math.ceil(i / 2);
      switch (sp.formation || 'echelon') {
        case 'line': pos.addScaledVector(right, side * row * spacing); break;
        case 'trail': pos.addScaledVector(fwd, -i * spacing); break;
        case 'wedge': pos.addScaledVector(right, side * row * spacing).addScaledVector(fwd, -row * spacing * 0.6); break;
        case 'box': pos.addScaledVector(right, (i % 2) * spacing).addScaledVector(fwd, -Math.floor(i / 2) * spacing); break;
        case 'wing': { const k = i + 1; pos.addScaledVector(right, (k % 2 ? 1 : -1) * Math.ceil(k / 2) * spacing).addScaledVector(fwd, -Math.ceil(k / 2) * spacing * 0.7); break; }
        default: pos.addScaledVector(right, i * spacing).addScaledVector(fwd, -i * spacing * 0.5);
      }
      if (sp.formation === 'wing' && pl) pos.add(pl.state.position).sub(center);   // wingmen form on the player's actual position
      pos.y += (sp.stack ?? 0) * i;
      const floor = groundMax(gw, pos.x, pos.z, 2000) + (sp.agl != null ? Math.min(sp.agl, 200) : 300);
      if (pos.y < floor) pos.y = floor;
      const typ = sp.mixed === false ? types[0] : types[(typeOff + i) % types.length];
      const cs = Array.isArray(sp.callsign) ? sp.callsign[i] : sp.callsign ? (g.size === 1 && sp.single ? sp.callsign : `${sp.callsign} ${(sp.startIndex ?? 1) + i}`) : `${team === 'red' ? 'Bandit' : 'Friendly'} ${i + 1}`;
      // the Directorate's missile racks scale with difficulty (fighters only; explicit loadouts win)
      const rack = ENEMY_LOADOUT[combat.difficulty] || ENEMY_LOADOUT.veteran;
      const base = team === 'blue' ? null : !sp.loadout ? rack : sp.loadout.flares == null ? { flares: rack.flares } : null;
      const loadout = base || sp.loadout || sp.hp != null || sp.invulnerable ? { ...(base || {}), ...(sp.loadout || {}) } : undefined;
      if (loadout && sp.hp != null) loadout.hp = sp.hp;
      if (loadout && sp.invulnerable) loadout.invulnerable = true;
      const skill = typeof sp.skill === 'number' ? sp.skill : s.skill(sp.skill || (team === 'red' ? 'enemy' : 'wing'));
      let order = typeof sp.order === 'function' ? sp.order(i, pos, g) : sp.order;
      if (order === 'engage' || (!order && team === 'red' && !sp.passive)) order = s.orders.engage(sp.sort === false ? null : sortTarget(i));
      if (sp.formation === 'wing' && !order && pl) order = s.orders.escort(pl, { x: (i % 2 ? -1 : 1) * 90, y: 0, z: 60 });
      if (order && sp.passive) order.passive = true;
      if (!order && sp.passive) order = s.orders.cruise(hdg, pos.y, { passive: true });
      const def = { aircraft: typ, team, position: pos, heading: hdg, speed: sp.speed, callsign: cs, skill, stores: sp.stores || 'a2a', loadout, order: order || undefined,
        tags: { ...(sp.tags || {}), group: g.name, role: sp.role || '', points: sp.points } };
      if (def.speed == null && sp.formation === 'wing' && pl) def.speed = pl.state.velocity.length() || undefined;
      const e = world.spawnAircraft(def);
      if (!e) continue;
      if (sp.invulnerable) e.invulnerable = true;
      const tough = sp.toughness ?? 1;
      if (tough !== 1 && e.maxHp > 0) { e.maxHp *= tough; e.hp = e.maxHp; }
      if (sp.thrust != null && e.sim?.damage) e.sim.damage.thrust = sp.thrust;    // detuned engines (drones, laden strikers)
      if (sp.drag != null && e.sim?.damage) e.sim.damage.drag = sp.drag;          // external stores
      if (sp.passive && e.pilot) e.pilot.passive = true;
      e.tags.spawnT = combat.clock;
      g.members.push(e);
      if (sp.mark) s.mark(e, typeof sp.mark === 'string' ? sp.mark : cs, sp.markKind || (team === 'red' ? 'target' : 'protect'));
    }
    if (sp.call && pl) s.picture(g, typeof sp.call === 'string' ? sp.call : undefined);
    sp.onSpawn?.(g);
  }

  function updateGroups() {
    // wingmen: escort when nothing is near, engage when hostiles come within 25 km; red escorts: hold until blue is close
    for (const g of groups) {
      if (!g.spawned) continue;
      const sp = g.spec;
      if (sp.managed === 'wing') {
        const pl = world.player;
        for (let i = 0; i < g.members.length; i++) {
          const e = g.members[i]; if (!e.alive || !e.pilot) continue;
          const threat = world.nearestEnemy(e, sp.engageRange ?? 25000);
          const o = e.pilot.order;
          if (threat && o?.type !== 'engage') e.pilot.setOrder(s.orders.engage(spreadTarget(e, i, sp.engageRange ?? 25000) || threat));
          else if (!threat && o?.type === 'engage' && pl && pl.alive) e.pilot.setOrder(s.orders.escort(pl, { x: (i % 2 ? -1 : 1) * 90, y: 0, z: 60 }));
        }
      } else if (sp.engageWithin) {
        for (const e of g.members) {
          if (!e.alive || !e.pilot || e.pilot.order?.type === 'engage') continue;
          const t = world.nearestEnemy(e, sp.engageWithin);
          if (t) { e.pilot.setOrder(s.orders.engage(sortTarget(g.members.indexOf(e)) || t)); g.engaged = true; }
        }
      }
    }
    for (const k of killers) {
      if (k.ob.state !== 'active') continue;
      let dead = 0; for (const g of k.list) dead += g.lost;
      k.ob.set(`${Math.min(dead, k.need)} / ${k.need}`);
      if (dead >= k.need) k.ob.done();
    }
    for (const pr of protects) {
      if (pr.ob.state !== 'active') continue;
      let alive = 0;
      for (const x of pr.list) { if (x.members) { alive += x.spawned ? x.alive : x.size; } else alive += x.alive ? 1 : 0; }
      if (pr.size > 1 && !pr.ob.progressFixed) pr.ob.set(`${alive} / ${pr.size}`);
      if (alive < pr.min) pr.ob.fail(pr.ob.failText || `${pr.ob.text}: failed`);
    }
    // markers follow their entities; dead ones go away
    const L = director.markers;
    for (let i = L.length - 1; i >= 0; i--) {
      const m = L[i];
      if (m.entity) { if (!m.entity.alive) { markerPool.push(m); m.entity = null; L.splice(i, 1); } else m.position.copy(m.entity.state.position); }
    }
    const w = director.waypoint;
    if (w && w.entity) { if (w.entity.alive) w.position.copy(w.entity.state.position); else director.waypoint = null; }
    // operating area
    if (boundary && world.player && world.player.alive && !ended) {
      const inside = boundary.zone.contains(world.player);
      if (!inside && boundary.out < 0) {
        boundary.out = combat.clock;
        radio.say('awacs', '@awacs.leaving', { priority: 1 });
        boundary.timer = s.countdown(boundary.grace, 'Return to the area', () => s.lose('Left the area'), { warn: false });
      } else if (inside && boundary.out >= 0) { boundary.out = -1; boundary.timer?.cancel(); boundary.timer = null; }
    }
  }

  function checkObjectives() {
    if (ended) return;
    let primaries = 0, open = 0;
    for (const ob of objectives) {
      if (ob.optional || ob.hidden) continue;
      primaries++;
      if (ob.state === 'active' && !ob.standing) open++;
    }
    if (s.autoWin && primaries > 0 && open === 0) {
      let anyNonStanding = false; for (const ob of objectives) if (!ob.optional && !ob.hidden && !ob.standing) anyNonStanding = true;
      if (anyNonStanding) s.win(mission.winReason || 'All objectives complete');
    }
  }

  function publish() {
    const out = director.objectives;
    out.length = 0;
    for (const ob of objectives) if (!ob.hidden || ob.state === 'done') out.push(ob);
    ev.emit('objective:update', { objectives: out });
  }

  const rt = {
    s,
    get ended() { return ended; },
    get outcome() { return endOutcome; },
    update(dt) {
      // timers and triggers
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!t.live) continue;
        if (t.cond) { if (t.cond()) { t.live = false; t.fn(); } }
        else if (combat.clock >= t.at) { if (t.period > 0) t.at += t.period; else t.live = false; t.fn(); }
      }
      if (tasks.length > 64) { let j = 0; for (let i = 0; i < tasks.length; i++) if (tasks[i].live) tasks[j++] = tasks[i]; tasks.length = j; }
      let shown = null;
      for (let i = 0; i < countdowns.length; i++) {
        const c = countdowns[i];
        if (!c.live) continue;
        if (c.dynamic) { c.end = combat.clock + Math.max(0, c.dynamic()); shown = c; continue; }
        const left = c.end - combat.clock;
        if (left <= 0) { c.live = false; c.onExpire(); continue; }
        if (!c.warned && left < 60) { c.warned = true; radio.say('awacs', '@awacs.oneMinute', { priority: 1 }); }
        shown = c;
      }
      if (shown && !ended) { timerView.label = shown.label; timerView.seconds = Math.max(0, shown.end - combat.clock); director.timer = timerView; }
      else director.timer = null;
      if ((groupT -= dt) <= 0) { groupT = 0.25; updateGroups(); }
      if (dirty) { dirty = false; checkObjectives(); publish(); }
      if (ended && !sent && combat.clock >= endAt && (!radio.busy || combat.clock >= endAt + 4)) {
        sent = true;
        director.finish(endOutcome, endReason);
      }
    },
    playerDown(killer, weapon) {
      if (ended) return;
      if (s.onPlayerDown) { s.onPlayerDown(killer, weapon); if (ended) return; }
      radio.flush(3);
      const reason = killer ? 'Shot down' : weapon === 'terrain' ? 'Crashed' : weapon === 'collision' ? 'Mid-air collision' : 'Aircraft lost';
      finish('failure', reason, [[0.3, s.wingman() || 'awacs', s.wingman() ? '@wing.friendlyDown' : '@awacs.playerDown', { vars: { who: s.callsign } }]], 2.5);
    },
    finishNow(outcome, reason, chat, beat) { finish(outcome, reason, chat, beat); },
    stop() { for (const off of offs) off(); offs.length = 0; tasks.length = 0; countdowns.length = 0; director.timer = null; director.waypoint = null; director.markers.length = 0; },
    groups, objectives,
  };
  return rt;
}
