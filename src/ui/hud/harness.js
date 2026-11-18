// HUD test harness: the full sim, plus URL params that freeze physics and pose the aircraft for screenshots.
//   node tools/shot.mjs --entry src/ui/hud/harness.js --html dist/hud.html --params "aircraft=f16&start=air&cam=cockpit&pose=90,10,30&fpa=4&drift=3&spd=150"
// pose = heading,pitch,roll (deg); fpa = flight-path angle (deg, default = pitch - 3); drift = track - heading (deg);
// spd = TAS m/s; gear=1 (down); stall=1; pullup=1 (fake a dive toward the ground); ap=1; night=1 (env.nightFactor = 1)
import * as THREE from 'three';
import '../../main.js';

const sim = window.__sim;
const raw = Object.fromEntries(new URLSearchParams(location.search));
let inner = null;
Object.defineProperty(sim, 'step', {
  configurable: true,
  get() { return inner && ((n, dt) => { apply(); return inner(n, dt); }); },
  set(fn) { inner = fn; },
});
const DEG = Math.PI / 180;
const e = new THREE.Euler();
function apply() {
  const ctx = sim.ctx, p = ctx?.player; if (!p || !raw.pose) return;
  const [hdg, pitch, roll] = raw.pose.split(',').map(Number);
  const s = p.state;
  if (!p.__frozen) { p.__frozen = true; p.sim.step = () => {}; }
  const fpa = raw.fpa !== undefined ? +raw.fpa : pitch - 3;
  const drift = +(raw.drift || 0);
  const spd = +(raw.spd || s.tas || 150);
  e.set(pitch * DEG, -hdg * DEG, -roll * DEG, 'YXZ');
  s.quaternion.setFromEuler(e);
  const trk = (hdg + drift) * DEG, g = fpa * DEG;
  s.velocity.set(Math.cos(g) * Math.sin(trk), Math.sin(g), -Math.cos(g) * Math.cos(trk)).multiplyScalar(spd);
  s.heading = ((hdg % 360) + 360) % 360 * DEG; s.pitch = pitch * DEG; s.roll = roll * DEG; s.track = ((hdg + drift + 360) % 360) * DEG;
  s.tas = spd; s.ias = spd * 0.95; s.groundSpeed = spd * Math.cos(g); s.verticalSpeed = spd * Math.sin(g);
  s.aoa = (pitch - fpa) * DEG; s.mach = spd / 330;
  s.gLoad = raw.g ? +raw.g : 1 / Math.cos(roll * DEG);
  if (raw.gear) s.surfaces.gear = +raw.gear;
  if (raw.flaps) s.surfaces.flaps = +raw.flaps;
  if (raw.sb) s.surfaces.speedbrake = +raw.sb;
  if (raw.stall) s.stallWarning = true;
  if (raw.ap) { s.ap.engaged = true; s.ap.autothrottle = true; s.ap.mode = raw.apmode || 'alt hdg'; s.ap.altitude = s.position.y; s.ap.heading = s.heading; s.ap.speed = s.ias; }
  if (raw.alt) s.position.y = +raw.alt;
  if (raw.pullup) { s.position.y = ctx.world.groundHeightAt(s.position.x, s.position.z) + 300; }
  s.altitude = s.position.y;
  s.agl = s.position.y - ctx.world.groundHeightAt(s.position.x, s.position.z) - p.def.geometry.cgHeight;
  if (raw.night) ctx.env.nightFactor = 1;
  if (raw.fuel) s.fuel = +raw.fuel;
}
