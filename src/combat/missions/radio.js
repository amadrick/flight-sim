// Radio: a small priority queue with spacing, a cast of speakers and the line bank.
// Lines are emitted as combat.events 'radio' { from, text, priority, team, voice, entity? }.
//   priority 0  chatter: dropped if it waits more than ~6 s
//   priority 1  tactical: waits up to ~12 s
//   priority 2  urgent (missile inbound, mayday): pre-empts the spacing, never waits long
import { LINES } from './lines.js';

export const DEFAULT_CAST = {
  awacs: { name: 'Cathedral', voice: 'awacs', team: 'blue' },
  tower: { name: 'Haven Tower', voice: 'tower', team: 'blue' },
  boat: { name: 'Meridian', voice: 'tower', team: 'blue' },
  enemy: { name: 'Furnace', voice: 'enemy', team: 'red' },
};

const TTL = [6, 12, 3.5];
const QN = 16;

export function createRadio(combat) {
  const ev = combat.events;
  const slots = [];
  for (let i = 0; i < QN; i++) slots.push({ used: false, from: '', text: '', priority: 0, team: 'blue', voice: 'awacs', entity: null, delay: 0, ttl: 0, seq: 0 });
  const lastVariant = new Map();
  const recent = new Map();
  let gap = 0, urgentGap = 0, seq = 0, lastText = '';

  const radio = {
    cast: { ...DEFAULT_CAST },
    callsign: 'Halyard 1',
    /** number of lines emitted since reset (tests / debrief) */
    count: 0,
    reset(cast = {}, callsign = 'Halyard 1') {
      radio.cast = { ...DEFAULT_CAST, ...cast };
      radio.callsign = callsign;
      for (const s of slots) { s.used = false; s.entity = null; }
      recent.clear(); gap = 0.5; urgentGap = 0; lastText = ''; radio.count = 0;
    },
    /** One variant of a bank key or of an array of strings, never the same one twice in a row. */
    pick(k) {
      const arr = typeof k === 'string' ? LINES[k] : k;
      if (!arr || !arr.length) return typeof k === 'string' && !LINES[k] ? k : '';
      if (arr.length === 1) return arr[0];
      const last = lastVariant.get(k) ?? -1;
      let i = Math.floor(combat.rng() * arr.length);
      if (i === last) i = (i + 1 + Math.floor(combat.rng() * (arr.length - 1))) % arr.length;
      lastVariant.set(k, i);
      return arr[i];
    },
    speaker(who) {
      if (who && typeof who === 'object') {
        if (who.kind) return { name: who.callsign || who.name || 'Unknown', voice: who.isPlayer ? 'player' : who.team === 'blue' ? 'wingman' : 'enemy', team: who.team, entity: who };
        return who;
      }
      if (who === 'lead' || who === 'player') return { name: radio.callsign, voice: 'player', team: 'blue', entity: combat.world.player };
      return radio.cast[who] || null;
    },
    /**
     * Queue a line. who: cast key ('awacs', 'tower', …), an entity, 'lead' (the player) or a literal name.
     * text: a string, an array of variants, or '@bank.key'. o: { priority, delay, vars, key (dedupe), window, voice, team }
     */
    say(who, text, o = {}) {
      const sp = radio.speaker(who) || { name: String(who), voice: o.voice || 'awacs', team: o.team || 'blue' };
      if (Array.isArray(text)) text = radio.pick(text);
      else if (typeof text === 'string' && text[0] === '@') text = radio.pick(text.slice(1));
      if (!text) return false;
      if (o.key) {
        const t = recent.get(o.key);
        if (t != null && combat.clock - t < (o.window ?? 4)) return false;
        recent.set(o.key, combat.clock);
      }
      text = fill(text, sp.name, o.vars);
      let s = null;
      for (const q of slots) if (!q.used) { s = q; break; }
      const pr = o.priority ?? 0;
      if (!s) {      // full: evict the lowest-priority, oldest line if this one matters more
        for (const q of slots) if (q.priority < pr && (!s || q.priority < s.priority || q.seq < s.seq)) s = q;
        if (!s) return false;
      }
      s.used = true; s.from = sp.name; s.text = text; s.priority = pr; s.team = o.team || sp.team || 'blue';
      s.voice = o.voice || sp.voice || 'awacs'; s.entity = sp.entity || null; s.delay = o.delay || 0;
      s.ttl = (o.ttl ?? TTL[pr]) + s.delay; s.seq = seq++;
      return true;
    },
    /** True while anything is queued or a line is still being spoken. */
    get busy() { if (gap > 0.2) return true; for (const q of slots) if (q.used) return true; return false; },
    update(dt) {
      gap -= dt; urgentGap -= dt;
      let best = null;
      for (const q of slots) {
        if (!q.used) continue;
        q.delay -= dt; q.ttl -= dt;
        if (q.ttl <= 0) { q.used = false; q.entity = null; continue; }
        if (q.delay > 0) continue;
        if (!best || q.priority > best.priority || (q.priority === best.priority && q.seq < best.seq)) best = q;
      }
      if (!best) return;
      const urgent = best.priority === 2 && urgentGap <= 0;
      if (gap > 0 && !urgent) return;
      best.used = false;
      if (best.text === lastText) { best.entity = null; return; }
      lastText = best.text;
      const len = best.text.length;
      gap = Math.min(6, Math.max(1.7, 0.9 + 0.055 * len));
      if (best.priority === 2) urgentGap = 1.8;
      radio.count++;
      const msg = { from: best.from, text: best.text, priority: best.priority, team: best.team, voice: best.voice };
      if (best.entity) msg.entity = best.entity;
      best.entity = null;
      ev.emit('radio', msg);
    },
  };
  function fill(text, me, vars) {
    if (text.indexOf('{') < 0) return text;
    return text.replace(/\{(\w+)\}/g, (m, k) => (k === 'cs' ? radio.callsign : k === 'me' ? me : vars && vars[k] != null ? String(vars[k]) : m));
  }
  return radio;
}

/** "four o'clock low" — where `pos` is relative to an aircraft state. */
export function clockDir(state, pos) {
  const dx = pos.x - state.position.x, dz = pos.z - state.position.z, dy = pos.y - state.position.y;
  let rel = Math.atan2(dx, -dz) - state.heading;
  rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  let h = Math.round(rel / (Math.PI / 6)) % 12; if (h === 0) h = 12;
  const words = ['twelve', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const horiz = Math.hypot(dx, dz);
  const v = dy > Math.max(400, horiz * 0.25) ? ' high' : dy < -Math.max(400, horiz * 0.25) ? ' low' : '';
  return `${words[h]} o'clock${v}`;
}
