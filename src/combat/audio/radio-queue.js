// Radio line queue and voice casting. Pure (node-tested).
//   priority 0 chatter, 1 normal, 2 urgent ("missile launch!", "break right!"): urgent lines pre-empt a line being spoken.
//   Lines that waited too long are dropped instead of being read out late (the HUD already showed the subtitle).
export const RADIO_CFG = { maxQueue: 4, stale: [5, 7, 3.5], dedupe: 2.5 };

// Per role: speech pitch/rate, which installed voice to prefer (index into the sorted English voices), radio colour.
export const ROLES = {
  awacs:   { pitch: 0.85, rate: 1.0,  pick: 0, f0: 105, band: [380, 3000], staticLvl: 0.05, roger: [1300, 0.05], drive: 1.5 },
  lead:    { pitch: 0.95, rate: 1.12, pick: 1, f0: 118, band: [330, 3300], staticLvl: 0.06, roger: [1500, 0.04], drive: 2 },
  wingman: { pitch: 1.15, rate: 1.18, pick: 2, f0: 142, band: [330, 3300], staticLvl: 0.07, roger: [1700, 0.04], drive: 2.2 },
  enemy:   { pitch: 0.7,  rate: 1.2,  pick: 3, f0: 96,  band: [500, 2400], staticLvl: 0.1,  roger: null, drive: 3.5 },
  tower:   { pitch: 1.0,  rate: 0.98, pick: 4, f0: 124, band: [300, 3400], staticLvl: 0.04, roger: [1200, 0.06], drive: 1.3 },
  player:  { pitch: 1.0,  rate: 1.12, pick: 5, f0: 128, band: [330, 3300], staticLvl: 0.05, roger: [1600, 0.04], drive: 1.8 },
};

/** Which character speaks a 'radio' event. */
export function roleOf(line, playerCallsign = '') {
  if (line?.voice && ROLES[line.voice]) return line.voice;
  const from = String(line?.from || '');
  if (line?.team === 'red') return 'enemy';
  if (/awacs|control/i.test(from)) return 'awacs';
  if (/tower|ground|approach/i.test(from)) return 'tower';
  if (playerCallsign && from === playerCallsign) return 'player';
  if (/ 1$|lead/i.test(from)) return 'lead';
  return 'wingman';
}
/** Rough spoken duration of a line in seconds (for the murmur fallback and as a safety timeout). */
export const speechSeconds = (text, rate = 1) => Math.min(6, Math.max(0.7, String(text || '').length * 0.062 / rate));

export function createRadioQueue(cfg = RADIO_CFG) {
  const q = [], recent = [];
  const st = { dropped: 0, preempted: 0 };
  return {
    items: q, stats: st,
    /** Add a line; returns true if it should pre-empt `current` (the line on air, or null). */
    push(line, now, current = null) {
      const text = String(line.text || ''); if (!text) return false;
      for (const r of recent) if (r.text === text && now - r.t < cfg.dedupe) return false;
      recent.push({ text, t: now }); if (recent.length > 8) recent.shift();
      const item = { text, from: line.from || '', role: line.role || 'wingman', priority: Math.max(0, Math.min(2, line.priority | 0)), t: now };
      if (item.priority >= 2 && current && current.priority < 2) { st.preempted++; q.unshift(item); return true; }
      // insert after every line of the same or higher priority
      let i = 0; while (i < q.length && q[i].priority >= item.priority) i++;
      q.splice(i, 0, item);
      while (q.length > cfg.maxQueue) { // drop the lowest-priority, oldest line
        let worst = 0; for (let k = 1; k < q.length; k++) if (q[k].priority < q[worst].priority || (q[k].priority === q[worst].priority && q[k].t < q[worst].t)) worst = k;
        q.splice(worst, 1); st.dropped++;
      }
      return false;
    },
    /** Next line to speak (drops stale lines). */
    next(now) {
      while (q.length) { const it = q.shift(); if (now - it.t <= cfg.stale[it.priority]) return it; st.dropped++; }
      return null;
    },
    clear() { q.length = 0; },
  };
}
