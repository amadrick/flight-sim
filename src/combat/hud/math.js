// Combat HUD — pure maths (no DOM, safe in node): camera projection of world points, edge clamping for off-screen
// cues, radar-scope transform, auto range, launch-zone scale, aspect brevity and the radio subtitle queue.

export const NM = 1852, KT = 0.514444, FT = 0.3048, DEG = Math.PI / 180, RAD = 180 / Math.PI;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * Projector for world points through a three.js camera, in render space. Call set() once per frame after the camera's
 * matrices are current. point(rx, ry, rz) takes a RENDER-space position and writes:
 *   vx, vy, vz   view-space coordinates (camera looks down −Z)
 *   x, y         screen CSS px (valid when front)
 *   front        true when the point is in front of the near plane
 *   dx, dy       screen-space direction from the screen centre toward the point (valid for points behind as well:
 *                a point behind and to the right yields dx > 0, i.e. "turn right")
 */
export function createProjector() {
  const m = new Float64Array(16);
  const P = {
    w: 1, h: 1, cx: 0.5, cy: 0.5, p0: 1, p5: 1, p8: 0, p9: 0,
    vx: 0, vy: 0, vz: 0, x: 0, y: 0, dx: 0, dy: 1, front: false,
    /** pixels per radian near the optical centre (vertical) */
    ppr: 1,
    set(camera, w, h) {
      const e = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
      for (let i = 0; i < 16; i++) m[i] = e[i];
      P.p0 = p[0]; P.p5 = p[5]; P.p8 = p[8]; P.p9 = p[9];
      P.w = w; P.h = h; P.cx = w / 2; P.cy = h / 2; P.ppr = p[5] * h / 2;
    },
    /** Raw view matrix for tests (column-major 4x4) and projection terms. */
    setRaw(view, p0, p5, w, h) {
      for (let i = 0; i < 16; i++) m[i] = view[i];
      P.p0 = p0; P.p5 = p5; P.p8 = 0; P.p9 = 0; P.w = w; P.h = h; P.cx = w / 2; P.cy = h / 2; P.ppr = p5 * h / 2;
    },
    point(rx, ry, rz) {
      const vx = m[0] * rx + m[4] * ry + m[8] * rz + m[12];
      const vy = m[1] * rx + m[5] * ry + m[9] * rz + m[13];
      const vz = m[2] * rx + m[6] * ry + m[10] * rz + m[14];
      P.vx = vx; P.vy = vy; P.vz = vz;
      P.front = vz < -0.5;
      if (P.front) {
        const iw = -1 / vz;
        P.x = ((P.p0 * vx + P.p8 * vz) * iw + 1) * 0.5 * P.w;
        P.y = (1 - (P.p5 * vy + P.p9 * vz) * iw) * 0.5 * P.h;
        P.dx = P.x - P.cx; P.dy = P.y - P.cy;
      } else {
        // behind: lateral side from the view-space offset; mostly "down" (six o'clock) unless it is well above
        P.dx = P.p0 * vx * P.w; P.dy = P.p5 * P.h * (0.6 * vz - 0.4 * vy);
        if (Math.abs(P.dx) + Math.abs(P.dy) < 1e-6) { P.dx = 0; P.dy = 1; }   // dead astern: point down
        P.x = P.y = NaN;
      }
      return P.front;
    },
    /** Project a world-space DIRECTION (point at infinity) — rotation part only. */
    dir(dx, dy, dz) {
      const vx = m[0] * dx + m[4] * dy + m[8] * dz, vy = m[1] * dx + m[5] * dy + m[9] * dz, vz = m[2] * dx + m[6] * dy + m[10] * dz;
      P.vx = vx; P.vy = vy; P.vz = vz; P.front = vz < -1e-6;
      if (P.front) {
        const iw = -1 / vz;
        P.x = ((P.p0 * vx + P.p8 * vz) * iw + 1) * 0.5 * P.w; P.y = (1 - (P.p5 * vy + P.p9 * vz) * iw) * 0.5 * P.h;
        P.dx = P.x - P.cx; P.dy = P.y - P.cy;
      } else { P.dx = P.p0 * vx * P.w; P.dy = P.p5 * P.h * (0.6 * vz - 0.4 * vy); P.x = P.y = NaN; }
      return P.front;
    },
  };
  return P;
}

/** True when (x, y) lies inside the rectangle inset by `m` px. */
export function insideRect(x, y, w, h, m) { return x >= m && y >= m && x <= w - m && y <= h - m; }

/**
 * Clamp a screen direction (dx, dy) from centre (cx, cy) onto an ellipse with semi-axes (ax, ay).
 * Writes out.x, out.y (on the ellipse) and out.a (screen angle, rad, atan2(dy, dx)). Returns out.
 */
export function edgeClamp(dx, dy, cx, cy, ax, ay, out) {
  const l = Math.hypot(dx, dy);
  if (l < 1e-9) { dx = 0; dy = 1; } else { dx /= l; dy /= l; }
  const s = 1 / Math.sqrt((dx * dx) / (ax * ax) + (dy * dy) / (ay * ay));
  out.x = cx + dx * s; out.y = cy + dy * s; out.a = Math.atan2(dy, dx);
  return out;
}

/** True when a screen point is beyond the ellipse (cx, cy, ax, ay) — i.e. the cue should be drawn on the edge. */
export function outsideEllipse(x, y, cx, cy, ax, ay) {
  const u = (x - cx) / ax, v = (y - cy) / ay;
  return u * u + v * v > 1;
}

/**
 * Heading-up radar scope transform. (ex, ez): world offset east (+X) and south (+Z) of own ship, heading `hdg` (rad,
 * 0 = north). range (m) maps to radius R (px). Writes out.x (right), out.y (down, screen), out.r (0..), out.clipped.
 */
export function radarPoint(ex, ez, hdg, range, R, out) {
  const ch = Math.cos(hdg), sh = Math.sin(hdg);
  // own-ship frame: forward = (sin h, -cos h) in (x, z); right = (cos h, sin h)
  const fwd = ex * sh - ez * ch, right = ex * ch + ez * sh;
  let x = right / range * R, y = -fwd / range * R;
  const r = Math.hypot(x, y);
  out.clipped = r > R;
  if (out.clipped) { x *= R / r; y *= R / r; }
  out.x = x; out.y = y; out.r = r / R;
  return out;
}

/** Relative bearing (rad, −π..π, + = right) of a world offset (ex, ez) for own heading hdg (rad). */
export function relBearing(ex, ez, hdg) {
  let a = Math.atan2(ex, -ez) - hdg;
  a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI;
  return a - Math.PI;
}

export const RADAR_RANGES_NM = [5, 10, 20, 40, 80];
/** Smallest scope range (nm) that shows `distM` with a margin; hysteresis keeps the current one while it still fits. */
export function autoRange(distM, current = 0, steps = RADAR_RANGES_NM) {
  const dn = distM / NM;
  let want = steps[steps.length - 1];
  for (const s of steps) if (dn < s * 0.82) { want = s; break; }
  const i = steps.indexOf(current);
  // zoom out at once; zoom in only once the contact is well inside the smaller scale
  if (i > 0 && want < current && dn > steps[i - 1] * 0.6 && dn < current * 0.95) return current;
  return want;
}

/**
 * Launch-zone scale: maps ranges to 0..1 positions on a scale that runs from 0 to `top` (default 1.25 × rMax).
 * Returns { top, min, max, ne, cur, inRange, inNe } (ne = −1 when no no-escape range is known).
 */
export function launchZone(lock, out = {}) {
  const rMax = lock?.rMax > 0 ? lock.rMax : 1, rMin = Math.max(0, lock?.rMin || 0);
  const top = rMax * 1.25, range = Math.max(0, lock?.range || 0);
  out.top = top; out.min = rMin / top; out.max = rMax / top;
  out.ne = lock?.rNe > 0 ? clamp(lock.rNe / top, out.min, out.max) : -1;
  out.cur = clamp(range / top, 0, 1);
  out.inRange = lock?.rMax > 0 && range > 0 && range >= rMin && range <= rMax;
  out.inNe = out.ne >= 0 ? range >= rMin && range <= lock.rNe : false;
  return out;
}

/**
 * Brevity for the target's aspect. aspect (rad): 0 = we sit dead astern of it, π = head-on (it points at us).
 */
export function aspectWord(aspect) {
  const d = aspect * RAD;
  return d > 150 ? 'HOT' : d > 110 ? 'FLANK' : d > 70 ? 'BEAM' : d > 30 ? 'DRAG' : 'COLD';
}

/** Rough closing-geometry time to impact (s) of a missile at distance d (m) closing at c (m/s); Infinity if opening. */
export function timeToImpact(d, c) { return c > 1 ? d / c : Infinity; }

/** How long a radio line stays up (s): reading time scaled by its length. */
export function subtitleDuration(text) { return clamp(1.8 + (text ? text.length : 0) * 0.055, 2.6, 7.5); }

/**
 * Radio subtitle queue: at most `max` lines visible; extra lines wait. Urgent lines (priority ≥ 2) jump the queue and
 * shorten whatever is showing. update(dt) advances; `visible` holds { from, text, team, priority, t, life, alpha, id }.
 */
export function createSubtitleQueue({ max = 2, fade = 0.4, cap = 8 } = {}) {
  let id = 0;
  const Q = {
    visible: [], waiting: [], changed: false,
    push(line) {
      const it = { from: String(line?.from || ''), text: String(line?.text || ''), team: line?.team || 'blue', priority: +line?.priority || 0,
        t: 0, life: subtitleDuration(line?.text), alpha: 0, id: ++id };
      if (!it.text) return null;
      if (it.priority >= 2) {
        Q.waiting.unshift(it);
        // urgent: hurry the oldest visible line off screen
        for (const v of Q.visible) v.life = Math.min(v.life, v.t + 0.6);
      } else Q.waiting.push(it);
      while (Q.waiting.length > cap) {
        // drop the oldest non-urgent waiting line
        let k = Q.waiting.findIndex((w) => w.priority < 2); if (k < 0) k = Q.waiting.length - 1;
        Q.waiting.splice(k, 1);
      }
      Q.changed = true;
      return it;
    },
    update(dt) {
      for (let i = Q.visible.length - 1; i >= 0; i--) {
        const v = Q.visible[i]; v.t += dt;
        // a line waiting behind a full board shortens the showing ones a little
        const pressure = Q.waiting.length ? 0.6 : 1;
        const life = v.life * pressure;
        v.alpha = v.t < fade ? v.t / fade : v.t > life ? Math.max(0, 1 - (v.t - life) / fade) : 1;
        if (v.t > life + fade) { Q.visible.splice(i, 1); Q.changed = true; }
      }
      while (Q.visible.length < max && Q.waiting.length) { Q.visible.push(Q.waiting.shift()); Q.changed = true; }
      return Q.visible;
    },
    clear() { Q.visible.length = 0; Q.waiting.length = 0; Q.changed = true; },
  };
  return Q;
}

/** Strip-layout estimate of the simulator's exterior flight-data strip (src/ui/hud/external.js): its top edge in px. */
export function stripTop(W, H) {
  const fsV = Math.round(clamp(Math.min(W * 0.022, H * 0.034), 15, 30));
  const fsS = Math.round(fsV * 0.56), rowH = Math.round(fsV * 2.75), cw = fsV * 0.6;
  const widths = [rowH * 0.9, cw * 3 + fsS * 1.6 + fsV * 0.6, cw * 6 + fsS * 1.6 + fsV * 0.6, cw * 4 + fsV * 0.8, cw * 6 + fsS * 2.2 + fsV * 0.4,
    cw * 3 + fsS * 1.4 + fsV * 0.6, cw * 3 + fsV * 0.5, fsS * 0.6 * 17, rowH * 0.9];
  const pad = Math.round(fsV * 0.55), gap = Math.round(fsV * 0.7), maxW = W - 32;
  let rows = 1, rw = pad * 2, n = 0;
  for (const w of widths) {
    const need = w + (n ? gap : 0);
    if (rw + need > maxW && n) { rows++; rw = pad * 2 + w; n = 1; } else { rw += need; n++; }
  }
  const ph = rows * rowH + (rows - 1) * Math.round(fsV * 0.25) + pad * 0.5;
  return Math.round(H - 16 - Math.max(8, H * 0.012) - ph);
}
