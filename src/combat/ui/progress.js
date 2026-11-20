// Saved combat progress + combat settings, one localStorage key ('skyward.combat.v1'). Pure: the storage object is
// injected (tests pass a fake, or one that throws). Every read and write is guarded; without storage it all still
// works for the session, it just is not remembered.
import { ratingRank } from './logic.js';

export const STORE_KEY = 'skyward.combat.v1';
const DIFFS = ['rookie', 'veteran', 'ace'];

/** window.localStorage, or null when it is missing or access throws (private windows, sandboxed previews). */
export function safeLocalStorage() {
  try { const s = globalThis.localStorage; if (!s) return null; s.getItem(STORE_KEY); return s; } catch { return null; }
}

function blank() { return { v: 1, missions: {}, settings: {} }; }

export function createProgressStore(storage = safeLocalStorage(), key = STORE_KEY) {
  let data = blank();
  try {
    const raw = storage?.getItem?.(key);
    if (raw) {
      const d = JSON.parse(raw);
      if (d && typeof d === 'object') {
        data.missions = d.missions && typeof d.missions === 'object' ? d.missions : {};
        data.settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
      }
    }
  } catch { data = blank(); }

  function save() {
    try { storage?.setItem?.(key, JSON.stringify(data)); return true; } catch { return false; }
  }
  const entry = (id) => (data.missions[id] && typeof data.missions[id] === 'object' ? data.missions[id] : null);

  return {
    get data() { return data; },
    /** { completed, attempts, best: { [difficulty]: { score, rating, time } } } | null */
    mission(id) { return entry(id); },
    /** Best result over all difficulties: { score, rating, difficulty } | null. */
    best(id) {
      const e = entry(id); if (!e?.best) return null;
      let out = null;
      for (const d of DIFFS) {
        const b = e.best[d]; if (!b) continue;
        if (!out || ratingRank(b.rating) > ratingRank(out.rating) || (ratingRank(b.rating) === ratingRank(out.rating) && (b.score || 0) > (out.score || 0))) out = { ...b, difficulty: d };
      }
      return out;
    },
    completed(id) { return !!entry(id)?.completed; },
    /**
     * Record a finished mission. result: combat.result. Returns { newBest, firstClear }.
     * A failure counts as an attempt; only successes set best score / rating.
     */
    record(id, difficulty, result) {
      if (!id) return { newBest: false, firstClear: false };
      const d = DIFFS.includes(difficulty) ? difficulty : 'veteran';
      const e = entry(id) || { completed: false, attempts: 0, best: {} };
      if (!e.best || typeof e.best !== 'object') e.best = {};
      e.attempts = (e.attempts | 0) + 1;
      let newBest = false, firstClear = false;
      if (result?.outcome === 'success') {
        firstClear = !e.completed;
        e.completed = true;
        const s = result.stats || {};
        const cur = e.best[d];
        const score = Number.isFinite(s.score) ? s.score : 0;
        const rating = typeof s.rating === 'string' ? s.rating : null;
        if (!cur || score > (cur.score || 0) || ratingRank(rating) > ratingRank(cur.rating)) {
          e.best[d] = {
            score: Math.max(score, cur?.score || 0),
            rating: ratingRank(rating) >= ratingRank(cur?.rating) ? rating : cur.rating,
            time: Number.isFinite(result.time) ? Math.round(result.time) : null,
          };
          newBest = !!cur || score > 0;
        }
      }
      data.missions[id] = e;
      save();
      return { newBest, firstClear };
    },
    getSetting(k, d) { const v = data.settings[k]; return v === undefined ? d : v; },
    setSetting(k, v) { data.settings[k] = v; return save(); },
    counts(ids) { let done = 0; for (const id of ids) if (entry(id)?.completed) done++; return { done, total: ids.length }; },
  };
}
