// Combat screens: pure data shaping and formatting (no DOM, no three). Unit-tested in logic.test.js.
// Mission definitions come from the missions agent; every field is optional, so everything here degrades gracefully.

export const CATEGORIES = [
  { id: 'training', label: 'Training', note: 'Learn the weapons and the basic fight, one skill at a time.' },
  { id: 'campaign', label: 'Campaign', note: 'A connected series of sorties. Each one unlocks the story of the next.' },
  { id: 'instant', label: 'Instant action', note: 'Straight into the fight. No story, no setup.' },
];
export const DIFFICULTY = [
  { id: 'rookie', label: 'Rookie', note: 'Slower, less accurate bandits. Generous damage.' },
  { id: 'veteran', label: 'Veteran', note: 'Competent opponents who use the vertical and fire missiles.' },
  { id: 'ace', label: 'Ace', note: 'Sharp pilots, full missile employment, little margin for error.' },
];
export const RATINGS = ['S', 'A', 'B', 'C', 'D'];
const RATING_RANK = { S: 5, A: 4, B: 3, C: 2, D: 1 };
export const ratingRank = (r) => RATING_RANK[r] || 0;

export const group3 = (n) => (Number.isFinite(+n) ? Math.round(+n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '0');

/** Seconds → "m:ss" (or "h:mm:ss"). */
export function fmtTime(s) {
  s = Math.max(0, Math.round(Number(s) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
/** "05:30" from hours. */
export function fmtClock(hr) {
  hr = ((Number(hr) % 24) + 24) % 24;
  let hh = Math.floor(hr), mm = Math.round((hr - hh) * 60);
  if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
/** hits / shots → "42%", or "–" when nothing was fired. */
export function fmtPct(hits, shots) {
  const s = Number(shots) || 0;
  if (s <= 0) return '–';
  return Math.round(100 * Math.min(1, (Number(hits) || 0) / s)) + '%';
}
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Brief: a string (paragraphs split on blank lines) or an array of paragraphs → array of non-empty strings. */
export function paragraphs(b) {
  if (Array.isArray(b)) return b.map(x => String(x ?? '').trim()).filter(Boolean);
  if (typeof b === 'string') return b.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
  return [];
}

/** A mission definition with every field the screens read filled in (originals untouched). */
export function normalise(m, index = 0) {
  const st = m.start || {};
  const aircraft = m.aircraft || st.aircraft || null;
  const choices = [];
  for (const a of [aircraft, ...(Array.isArray(m.aircraftChoices) ? m.aircraftChoices : [])]) if (a && !choices.includes(a)) choices.push(a);
  const threat = isNum(m.threat) ? Math.max(1, Math.min(5, Math.round(m.threat))) : null;
  return {
    id: String(m.id),
    def: m,
    index,
    category: m.category || 'instant',
    order: isNum(m.order) ? m.order : index,
    title: m.title || m.id,
    tagline: m.tagline || '',
    brief: paragraphs(m.brief),
    location: m.location ?? st.airport ?? null,
    tod: isNum(m.tod) ? m.tod : isNum(st.tod) ? st.tod : null,
    weather: m.weather ?? st.weather ?? null,
    aircraft,
    aircraftChoices: choices,
    objectives: Array.isArray(m.objectivesPreview) ? m.objectivesPreview.map(String).filter(Boolean) : [],
    threat,
    minutes: isNum(m.minutes) && m.minutes > 0 ? m.minutes : null,
    custom: m.id === 'instant-custom' || !!m.custom,
  };
}

/** Group missions by category in CATEGORIES order (unknown categories after), each sorted by order. */
export function groupMissions(list) {
  const all = (Array.isArray(list) ? list : []).filter(m => m && m.id != null).map((m, i) => normalise(m, i));
  const ids = [...CATEGORIES.map(c => c.id), ...new Set(all.map(m => m.category).filter(c => !CATEGORIES.some(k => k.id === c)))];
  const out = [];
  for (const id of ids) {
    const missions = all.filter(m => m.category === id).sort((a, b) => a.order - b.order || a.index - b.index);
    if (!missions.length) continue;
    const c = CATEGORIES.find(k => k.id === id);
    out.push({ id, label: c?.label || (id.charAt(0).toUpperCase() + id.slice(1)), note: c?.note || '', missions });
  }
  return out;
}

/**
 * The mission after `id`: the next one of the same category in order; after the last training mission, the first
 * campaign mission. Instant missions have no "next". Returns a normalised mission or null.
 */
export function nextMission(list, id) {
  const groups = groupMissions(list);
  for (const g of groups) {
    const i = g.missions.findIndex(m => m.id === id);
    if (i < 0) continue;
    if (g.id === 'instant') return null;
    if (i + 1 < g.missions.length) return g.missions[i + 1];
    if (g.id === 'training') return groups.find(x => x.id === 'campaign')?.missions[0] || null;
    return null;
  }
  return null;
}

/** "Haven International · 15:00 LCL · Scattered". airports: [{ id, name }], weatherLabels: { id: label }. */
export function conditionsLine(m, airports = [], weatherLabels = {}) {
  const parts = [];
  if (m.location) { const a = airports.find(x => x.id === m.location); parts.push(a ? a.name : String(m.location)); }
  if (isNum(m.tod)) parts.push(fmtClock(m.tod) + ' LCL');
  if (m.weather) parts.push(weatherLabels[m.weather] || String(m.weather));
  return parts.join('  ·  ');
}

export function outcomeCopy(result) {
  const ok = result?.outcome === 'success';
  return { ok, title: ok ? 'Mission complete' : 'Mission failed', reason: result?.reason ? String(result.reason) : (ok ? 'All objectives met.' : 'The mission was not accomplished.') };
}
/** Real seconds between 'mission:end' and the debrief: let the victory breathe, let the crash play out. */
export function debriefDelay(result) { return result?.outcome === 'success' ? 3.5 : 4.2; }

/** Stats grid rows for the debrief, only for fields the director reported. */
export function statRows(stats = {}, time) {
  const s = stats || {}, rows = [];
  if (isNum(s.kills)) rows.push({ k: 'Kills', v: String(s.kills) });
  if (isNum(s.assists)) rows.push({ k: 'Assists', v: String(s.assists) });
  if (isNum(s.losses)) rows.push({ k: 'Friendly losses', v: String(s.losses) });
  if (isNum(s.shots)) rows.push({ k: 'Gun accuracy', v: fmtPct(s.hits, s.shots), u: isNum(s.hits) ? `${group3(s.hits)} / ${group3(s.shots)} rds` : `${group3(s.shots)} rds` });
  if (isNum(s.missiles)) rows.push({ k: 'Missiles', v: isNum(s.missileHits) ? `${s.missileHits} / ${s.missiles}` : String(s.missiles), u: isNum(s.missileHits) ? 'hit / fired' : 'fired' });
  if (isNum(s.damageTaken)) rows.push({ k: 'Damage taken', v: String(Math.round(s.damageTaken)), u: '%' });
  if (isNum(time)) rows.push({ k: 'Time', v: fmtTime(time) });
  return rows;
}

/** Breakdown rows [{ label, points }] → cleaned list (zero rows kept: they explain the score). */
export function breakdownRows(stats = {}) {
  const b = Array.isArray(stats?.breakdown) ? stats.breakdown : [];
  return b.filter(r => r && r.label != null).map(r => ({ label: String(r.label), points: Math.round(Number(r.points) || 0) }));
}

export const CUSTOM_DEFAULT = { enemies: 2, wingmen: 1, enemyType: 'mixed', gunsOnly: false, startRange: 18520, altitude: 4572, advantage: 'neutral' };
export const ADVANTAGES = [
  { id: 'neutral', label: 'Neutral', note: 'Head-on, co-altitude.' },
  { id: 'offensive', label: 'Offensive', note: 'You start behind them.' },
  { id: 'defensive', label: 'Defensive', note: 'They start behind you.' },
];
export const RANGE_STEPS = [3, 5, 10, 20, 30].map(nm => nm * 1852);               // m (3, 5, 10, 20, 30 NM)
export const ALT_STEPS = [2000, 5000, 10000, 15000, 25000, 35000].map(ft => Math.round(ft * 0.3048));   // m
const clampInt = (v, a, b, d) => (isNum(+v) && v !== '' && v != null ? Math.max(a, Math.min(b, Math.round(+v))) : d);
/** Validate a custom-mission setup. */
export function cleanCustom(c = {}) {
  const d = CUSTOM_DEFAULT; c = c || {};
  return {
    enemies: clampInt(c.enemies, 1, 8, d.enemies),
    wingmen: clampInt(c.wingmen, 0, 3, d.wingmen),
    enemyType: typeof c.enemyType === 'string' && c.enemyType ? c.enemyType : d.enemyType,
    gunsOnly: !!c.gunsOnly,
    startRange: clampInt(c.startRange, 1000, 100000, d.startRange),
    altitude: clampInt(c.altitude, 300, 15000, d.altitude),
    advantage: ADVANTAGES.some(a => a.id === c.advantage) ? c.advantage : d.advantage,
  };
}
/** Nearest step index (for the range / altitude steppers). */
export function nearestStep(steps, v) {
  let best = 0;
  for (let i = 1; i < steps.length; i++) if (Math.abs(steps[i] - v) < Math.abs(steps[best] - v)) best = i;
  return best;
}
export const M_PER_FT = 0.3048, M_PER_NM = 1852;
export const fmtFt = (m) => group3(Math.round(m / M_PER_FT / 100) * 100) + ' ft';
export const fmtNm = (m) => { const n = m / M_PER_NM; return (n < 10 ? n.toFixed(1).replace(/\.0$/, '') : String(Math.round(n))) + ' NM'; };

/** First-run pick: the gunnery training mission if listed, else the first training mission, else the first mission. */
export function firstRunMission(list) {
  const g = groupMissions(list);
  const all = g.flatMap(x => x.missions);
  return all.find(m => m.id === 'train-gunnery') || g.find(x => x.id === 'training')?.missions[0] || all[0] || null;
}
