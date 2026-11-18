// Pure input-shaping logic (no DOM) — unit-tested in logic.test.js.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const approach = (cur, target, maxStep) =>
  cur < target ? Math.min(target, cur + maxStep) : Math.max(target, cur - maxStep);

/** Dead zone (rescaled so output still reaches ±1) then expo blend: out = (1-e)·x + e·x³. */
export function shapeAxis(v, deadZone = 0.08, expo = 0.35) {
  const a = Math.abs(v);
  if (a <= deadZone) return 0;
  const x = Math.min(1, (a - deadZone) / (1 - deadZone));
  return Math.sign(v) * ((1 - expo) * x + expo * x * x * x);
}

/** Radial dead zone for a 2-stick. Writes {x,y} into out. */
export function shapeStick(x, y, out, deadZone = 0.08, expo = 0.35) {
  const m = Math.hypot(x, y);
  if (m <= deadZone) { out.x = 0; out.y = 0; return out; }
  const s = shapeAxis(m, deadZone, expo) / m;
  out.x = clamp(x * s, -1, 1); out.y = clamp(y * s, -1, 1);
  return out;
}

export const KEY_AXIS = {
  rampBase: 2.4,      // units/s the instant a key goes down  (taps stay fine)
  rampGain: 7.5,      // extra units/s gained as the key is held
  rampTime: 0.45,     // seconds to reach full ramp rate
  reverse: 2.0,       // multiplier when flipping direction through zero
  centre: 4.2,        // units/s auto-centre after release (slightly slower than full ramp-in)
};

/** Digital key → smooth analog axis. st = { v, t }; dir ∈ {-1,0,1}. Returns st.v. */
export function stepKeyAxis(st, dir, dt, k = KEY_AXIS) {
  if (dir === 0) {
    st.t = 0;
    st.v = approach(st.v, 0, k.centre * dt);
    return st.v;
  }
  if (st.dir !== dir) { st.t = 0; st.dir = dir; }
  st.t += dt;
  let rate = k.rampBase + k.rampGain * Math.min(1, st.t / k.rampTime);
  if (st.v * dir < 0) rate *= k.reverse;
  st.v = approach(st.v, dir, rate * dt);
  return st.v;
}

export const AB_DETENT = 0.9;
export const THROTTLE = { base: 0.28, gain: 0.5, rampTime: 1.5, detentHold: 0.4 };

/**
 * Throttle lever with an afterburner detent. st = { t, latched, extra, dir }.
 * lever: current 0..1; dir: -1/0/+1 from keys (or analog rate −1..1); returns the new lever.
 */
export function stepThrottle(st, lever, dir, dt, ab, k = THROTTLE) {
  if (dir === 0) { st.t = 0; st.latched = false; st.extra = 0; st.dir = 0; return lever; }
  const sgn = Math.sign(dir);
  if (st.dir !== sgn) { st.t = 0; st.latched = false; st.extra = 0; st.dir = sgn; }
  st.t += dt;
  const rate = (k.base + k.gain * Math.min(1, st.t / k.rampTime)) * Math.abs(dir);
  let next = clamp(lever + sgn * rate * dt, 0, 1);
  if (ab && sgn > 0) {
    if (st.latched) {
      st.extra += dt;
      if (st.extra >= k.detentHold) st.latched = false;
      else next = Math.min(next, AB_DETENT);
    } else if (lever < AB_DETENT && next >= AB_DETENT) {
      next = AB_DETENT; st.latched = true; st.extra = 0;
    }
  }
  return next;
}

/** Snap a slider value near the MIL detent (touch). */
export function snapDetent(v, ab, width = 0.035) {
  return ab && Math.abs(v - AB_DETENT) < width ? AB_DETENT : v;
}

export const milLever = (ab) => (ab ? AB_DETENT : 1);
