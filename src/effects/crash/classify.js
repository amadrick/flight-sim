// Crash classification from the physics state at impact (pure logic, no three.js scene access; tested in node).
//
//   classifyCrash(input) -> outcome
//   input = { reason, speed (m/s, |v|), vel {x,y,z} (world, m/s), pitch, roll (rad), gear (0 up .. 1 down),
//             fuel (kg), mass (kg), surface ('runway'|'taxiway'|'apron'|'deck'|'terrain'|'water'), slope (rad, terrain),
//             agl (m above the surface at the event), length, span (m) }
//   outcome = { kind, surface, energy (MJ), vn, vt, pathAngle, burnFuel (kg in the fireball), poolFuel (kg left to
//               burn on the ground), D (fireball diameter, m), tStar (s), breakup (0..1), slide (m), crater (m),
//               sparks (bool), dust (bool), water (bool), fire (bool), label }
//
// kinds (mildest → worst):
//   'belly'        gear-up landing, low sink: long scrape, sparks on pavement / dust on grass, no breakup, no fireball
//   'gearCollapse' hard landing on the gear: gear folds, shorter slide, sparks, a small fuel fire if it was hard
//   'breakup'      moderate energy (wingtip / nacelle / nose dig-in, steep-ish arrival): airframe breaks into a few
//                  pieces, cartwheel debris, medium fireball + ground fire
//   'impact'       high energy (dive, CFIT at speed): disintegration, crater, full fuel fireball, debris spray,
//                  shockwave dust ring
//   'ditch'        water, low energy: spray sheet + wake, the airframe stays (mostly) whole
//   'waterImpact'  water, high energy: spray column, debris, no fireball (a short-lived burning slick at most)
//   'airburst'     structural failure in the air: fireball where it broke up; the wreck falls (crash:impact later)
//
// Fireball size: Roberts / HSE correlation for a hydrocarbon fireball D = 5.8 m^(1/3) m (m = burning fuel, kg),
// duration ~0.45 m^(1/3) s; the runtime works in Froude-scaled units (length D, time t* = sqrt(D/g)).

const DEG = Math.PI / 180;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const PAVED = new Set(['runway', 'taxiway', 'apron', 'deck']);

export const CRASH_KINDS = ['belly', 'gearCollapse', 'breakup', 'impact', 'ditch', 'waterImpact', 'airburst'];

export function fireballScale(burnKg) {
  const m = Math.max(1, burnKg);
  const D = clamp(5.8 * Math.cbrt(m), 8, 220);
  return { D, tStar: Math.sqrt(D / 9.81), duration: 0.45 * Math.cbrt(m) };
}

export function classifyCrash(i) {
  const reason = String(i.reason || '');
  const v = i.vel || { x: 0, y: -(i.speed || 0), z: 0 };
  const speed = i.speed ?? Math.hypot(v.x, v.y, v.z);
  const vh = Math.hypot(v.x, v.z);
  // speed into the surface: on a slope, the normal component of the velocity
  const slope = i.slope || 0;
  let vn = Math.max(0, -v.y);
  if (slope > 0.05 && i.normal) vn = Math.max(0, -(v.x * i.normal.x + v.y * i.normal.y + v.z * i.normal.z));
  const vt = Math.sqrt(Math.max(0, speed * speed - vn * vn));
  const pathAngle = Math.atan2(vn, Math.max(vt, 1e-3));
  const mass = Math.max(500, i.mass || 10000);
  const fuel = Math.max(0, i.fuel ?? mass * 0.2);
  const energy = 0.5 * mass * speed * speed / 1e6;
  const gearDown = (i.gear ?? 1) > 0.5;
  let surface = i.surface || 'terrain';
  if (surface === 'terrain' && slope > 18 * DEG) surface = 'mountain';
  else if (surface === 'terrain') surface = 'grass';
  else if (PAVED.has(surface)) surface = surface === 'deck' ? 'deck' : 'runway';
  const water = surface === 'water' || /ditch/i.test(reason);
  if (water) surface = 'water';
  const L = i.length || 15;
  const agl = i.agl ?? 0;
  const bank = Math.abs(i.roll || 0);

  let kind;
  if (/structural/i.test(reason) && agl > 25) kind = 'airburst';
  else if (water) kind = vn > 11 || speed > 105 || pathAngle > 14 * DEG ? 'waterImpact' : 'ditch';
  else if (vn > 15 || (speed > 95 && pathAngle > 10 * DEG) || (surface === 'mountain' && speed > 60) || (vn > 9 && speed > 120)) kind = 'impact';
  else if (vn > 6.5 || (speed > 50 && /wingtip|pod|nose|terrain/i.test(reason) && (bank > 25 * DEG || pathAngle > 4 * DEG || vn > 3)) || (speed > 110 && /terrain/i.test(reason))) kind = 'breakup';
  else if (!gearDown || /gear-up/i.test(reason)) kind = 'belly';
  else kind = 'gearCollapse';

  // fuel that takes part in the fireball / burns on the ground afterwards
  const frac = { belly: 0, gearCollapse: vn > 4.5 || speed > 75 ? 0.04 : 0, breakup: 0.22, impact: 0.55, ditch: 0, waterImpact: 0, airburst: 0.45 }[kind];
  const burnFuel = fuel * frac;
  const poolFuel = kind === 'impact' || kind === 'breakup' ? fuel * 0.3 : kind === 'gearCollapse' && frac > 0 ? fuel * 0.15 : 0;
  const fire = burnFuel > 5 || poolFuel > 20;
  const { D, tStar, duration } = fireballScale(burnFuel > 0 ? burnFuel : 50);
  const breakup = { belly: 0, gearCollapse: 0.1, breakup: 0.6, impact: 1, ditch: 0.05, waterImpact: 0.9, airburst: 1 }[kind];
  // slide distance on the belly / wreck (friction ~0.35 pavement, ~0.6 grass with ploughing), capped
  const mu = surface === 'runway' || surface === 'deck' ? 0.33 : surface === 'water' ? 0.9 : 0.6;
  const slide = kind === 'impact' || kind === 'airburst' || kind === 'waterImpact' ? clamp(vt * 0.15, 0, 60) : clamp(vt * vt / (2 * 9.81 * mu), 5, 1500);
  const crater = kind === 'impact' ? clamp(0.12 * Math.cbrt(energy * 1e6 / 4e6) * 10, 3, 30) * (surface === 'runway' ? 0.4 : 1) : kind === 'breakup' ? clamp(L * 0.25, 2, 8) : 0;
  const label = { belly: 'Gear-up slide', gearCollapse: 'Gear collapse', breakup: 'Breakup on impact', impact: 'High-energy impact', ditch: 'Ditching', waterImpact: 'Water impact', airburst: 'In-flight breakup' }[kind];
  return {
    kind, surface, energy, speed, vh, vn, vt, pathAngle, burnFuel, poolFuel, fire, D, tStar, duration, breakup, slide, crater,
    sparks: (surface === 'runway' || surface === 'deck') && (kind === 'belly' || kind === 'gearCollapse' || kind === 'breakup'),
    dust: surface === 'grass' || surface === 'mountain' || kind === 'impact',
    water, label,
  };
}

/** Synthetic impact states for deterministic tests / screenshots (?crashtest=<type>). */
export const CRASH_TESTS = {
  belly:    { reason: 'Gear-up landing', vel: { x: 0, y: -1.5, z: -70 }, gear: 0, surface: 'runway', fuel: 2500 },
  collapse: { reason: 'Hard landing', vel: { x: 0, y: -5.5, z: -72 }, gear: 1, surface: 'runway', fuel: 2500 },
  breakup:  { reason: 'Wingtip strike', vel: { x: 0, y: -8, z: -85 }, gear: 1, roll: 0.7, surface: 'grass', fuel: 3000 },
  impact:   { reason: 'Collision with terrain', vel: { x: 0, y: -60, z: -140 }, gear: 0, surface: 'grass', fuel: 3200 },
  fireball: { reason: 'Collision with terrain', vel: { x: 0, y: -45, z: -120 }, gear: 0, surface: 'runway', fuel: 3200 },
  mountain: { reason: 'Collision with terrain', vel: { x: 0, y: -20, z: -160 }, gear: 0, surface: 'terrain', slope: 0.5, fuel: 3200 },
  ditch:    { reason: 'Ditched in water', vel: { x: 0, y: -2, z: -65 }, gear: 0, surface: 'water', fuel: 2500 },
  water:    { reason: 'Ditched in water', vel: { x: 0, y: -50, z: -130 }, gear: 0, surface: 'water', fuel: 3200 },
  airburst: { reason: 'Structural failure (over-G)', vel: { x: 0, y: -10, z: -220 }, gear: 0, surface: 'terrain', fuel: 3000, agl: 400 },
};
