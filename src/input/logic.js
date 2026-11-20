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

// ---- touch stick / throttle shaping (touch.js) -----------------------------------------------------------------
// The floating stick's raw deflection is the thumb offset from where it landed divided by the throw radius
// (layout stickR / sensitivity), clamped to the unit circle. Shaping: radial dead zone 6 %, then expo 0.35
// (out = 0.65·x + 0.35·x³ of the post-dead-zone magnitude), same curve on both axes. Auto-coordination (rudder slider
// hidden, not disabled by the combat assist): yaw = 0.28 × shaped roll.
export const TOUCH_STICK = Object.freeze({ dead: 0.06, expo: 0.35, coord: 0.28 });

/** Raw unit-circle deflection {x, y} (+x right, +y down = nose down) from a thumb offset in px. */
export function touchRaw(dx, dy, rad, sens, out) {
  const k = (sens > 0 ? sens : 1) / Math.max(1, rad);
  let x = dx * k, y = dy * k; const m = Math.hypot(x, y);
  if (m > 1) { x /= m; y /= m; }
  out.x = x; out.y = y; return out;
}
/** Shaped stick from a raw deflection (dead zone + expo, TOUCH_STICK). */
export const touchShape = (raw, out, k = TOUCH_STICK) => shapeStick(raw.x, raw.y, out, k.dead, k.expo);
/** Auto-coordinated rudder for a shaped roll input. */
export const autoCoordYaw = (roll, k = TOUCH_STICK.coord) => clamp(roll * k, -1, 1);

/**
 * Throttle detents for a relative drag: idle (0), MIL (AB_DETENT when the aircraft has an afterburner; its zone is
 * above it) and full. Returns the lever and which detent was crossed or reached since `prev` ('idle' | 'mil' | 'ab' |
 * 'full' | null) — the caller vibrates on it.
 */
export function throttleDetent(prev, v, ab, width = 0.03) {
  v = clamp(v, 0, 1);
  if (v < 0.015) v = 0; else if (v > 0.99) v = 1;
  v = snapDetent(v, ab, width);
  let hit = null;
  if (v === 0 && prev > 0) hit = 'idle';
  else if (ab && prev <= AB_DETENT && v > AB_DETENT) hit = 'ab';
  else if (ab && (v === AB_DETENT && prev !== AB_DETENT || prev > AB_DETENT && v < AB_DETENT)) hit = 'mil';
  else if (!ab && v === 1 && prev < 1) hit = 'full';
  return { v, hit };
}
