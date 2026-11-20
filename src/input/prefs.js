// Touch-control preferences (Settings → Touch controls). Pure data + localStorage; read by touch.js, written by the menu.
//   sensitivity  0.5 … 2   stick throw scale (2 = full deflection with half the thumb travel); also scales look drags
//   lefty        bool      mirror the layout: stick under the LEFT thumb, throttle under the right
//   rudder       bool      show the rudder slider (off: auto-coordinated rudder from the stick, see touch.js)
//   autoCentre   bool      stick returns to centre on release (off: the last deflection is held until the next touch)
//   haptics      bool      short vibrations on buttons and throttle detents (navigator.vibrate, where available)
//   drawer       'auto' | 'open' | 'closed'   systems buttons (gear, flaps, brake, speedbrake, AP): context-sensitive / always / on demand
export const PREFS_KEY = 'skyward.touch';
export const PREF_DEFAULTS = Object.freeze({ sensitivity: 1, lefty: false, rudder: false, autoCentre: true, haptics: true, drawer: 'auto' });

export function sanitizePrefs(p) {
  const d = PREF_DEFAULTS, o = { ...d };
  if (!p || typeof p !== 'object') return o;
  const s = Number(p.sensitivity);
  if (Number.isFinite(s)) o.sensitivity = Math.round(Math.min(2, Math.max(0.5, s)) * 20) / 20;
  for (const k of ['lefty', 'rudder', 'autoCentre', 'haptics']) if (typeof p[k] === 'boolean') o[k] = p[k];
  if (p.drawer === 'auto' || p.drawer === 'open' || p.drawer === 'closed') o.drawer = p.drawer;
  return o;
}

/** A small store: get(), set(patch) → new prefs, on(fn) → unsubscribe. Survives a missing / throwing localStorage. */
export function createPrefs(storage) {
  let st = null;
  try { st = storage === undefined ? window.localStorage : storage; } catch { st = null; }
  let cur = PREF_DEFAULTS;
  try { cur = sanitizePrefs(JSON.parse((st && st.getItem(PREFS_KEY)) || 'null')); } catch { cur = sanitizePrefs(null); }
  const subs = new Set();
  return {
    get() { return cur; },
    set(patch) {
      cur = sanitizePrefs({ ...cur, ...(patch || {}) });
      try { st && st.setItem(PREFS_KEY, JSON.stringify(cur)); } catch {}
      for (const f of subs) { try { f(cur); } catch (e) { console.error(e); } }
      return cur;
    },
    reset() { return this.set(PREF_DEFAULTS); },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
