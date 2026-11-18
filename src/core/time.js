// Simulation clock + astronomy. Owned by the integrator.
import * as THREE from 'three';
import { DEG } from './constants.js';

// Direction TO the sun in world axes (+X east, +Y up, +Z south) for local solar time `hours`.
export function sunDirection(hours, dayOfYear, latitudeDeg, out = new THREE.Vector3()) {
  const phi = latitudeDeg * DEG;
  const decl = -23.44 * DEG * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
  const H = (hours - 12) * 15 * DEG;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const cosEl = Math.max(1e-6, Math.cos(el));
  const sinAz = (-Math.sin(H) * Math.cos(decl)) / cosEl;
  const cosAz = (Math.sin(decl) - sinEl * Math.sin(phi)) / (cosEl * Math.max(1e-6, Math.cos(phi)));
  const az = Math.atan2(sinAz, cosAz); // from north, clockwise
  return out.set(Math.sin(az) * cosEl, sinEl, -Math.cos(az) * cosEl).normalize();
}

export function createTime(ctx, params) {
  const time = {
    now: 0,            // seconds of simulated time since boot (stops while paused)
    real: 0,           // seconds of wall time since boot
    dt: 0,             // simulated seconds this frame (0 while paused)
    realDt: 0,
    frame: 0,
    paused: false,
    timeScale: 1,      // sim speed multiplier
    timeOfDay: params.tod ?? 10.5,   // local solar hours 0..24
    dayOfYear: 172,    // June 21
    latitude: 34,      // degrees north
    dayRate: 1,        // how fast timeOfDay advances relative to sim time (1 = real time, 60 = 1 min per second)
    setTimeOfDay(h) { time.timeOfDay = ((h % 24) + 24) % 24; ctx.events.emit('time:change', time.timeOfDay); },
    advance(realDt) {
      time.realDt = realDt; time.real += realDt; time.frame++;
      time.dt = time.paused ? 0 : realDt * time.timeScale;
      time.now += time.dt;
      time.timeOfDay = (time.timeOfDay + (time.dt * time.dayRate) / 3600) % 24;
      sunDirection(time.timeOfDay, time.dayOfYear, time.latitude, ctx.env.sunDir);
      // Moon: simple model — roughly opposite the sun (full-ish moon), slightly offset.
      sunDirection((time.timeOfDay + 11.2) % 24, (time.dayOfYear + 182) % 365, time.latitude, ctx.env.moonDir);
    },
  };
  return time;
}
