// Combat camera mode bookkeeping — pure (no ctx), unit-tested.
// A persistent *base* view the player chose (padlock or none) plus at most one temporary *overlay* (missile cam,
// kill cam, victory). Overlays end by themselves and hand back to the base, so "return to the previous view" is
// simply "the overlay ends". One overlay may be queued behind the running one (victory waits for a kill cam).

export const OVERLAYS = ['missile', 'kill', 'victory'];
export const PRIORITY = { missile: 1, kill: 2, victory: 3 };

export function createModeState() { return { base: null, overlay: null, queued: null }; }
export function currentMode(s) { return s.overlay || s.base; }

export function setBase(s, m) { s.base = m === 'padlock' ? 'padlock' : null; return currentMode(s); }

/** Start an overlay. A lower-priority request never replaces a higher one. opts.queue: wait for the running one. */
export function pushOverlay(s, m, opts) {
  if (!PRIORITY[m]) return false;
  if (s.overlay && s.overlay !== m) {
    if (opts?.queue) { s.queued = m; return true; }
    if (PRIORITY[s.overlay] > PRIORITY[m]) return false;
  }
  s.overlay = m;
  if (s.queued === m) s.queued = null;
  return true;
}

/** End overlay m (if it is the running one): the queued overlay, else the base view, takes over. */
export function endOverlay(s, m) {
  if (m && s.overlay !== m) { if (s.queued === m) s.queued = null; return currentMode(s); }
  s.overlay = s.queued; s.queued = null;
  return currentMode(s);
}

export function clearOverlays(s) { s.overlay = null; s.queued = null; return currentMode(s); }
export function clearAll(s) { s.base = null; s.overlay = null; s.queued = null; return null; }
