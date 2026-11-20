// Weapon data, per-aircraft loadouts, toughness and the difficulty table. Pure data + small helpers (safe in node).
// Generic weapon classes with descriptive names; public real-world designations appear only as `designation` data.

/**
 * Guns. rof rounds/s at full spin, muzzleVelocity m/s, dispersion = 1-sigma cone (rad, per axis), damage per hit (hp, before
 * part multipliers), mass kg / caliber m / cd (supersonic drag coefficient) give the drag constant k = rho·cd·A/(2m),
 * spinUp s to full rate (rotary guns), life s (self-destruct), range m (effective range for gunSolution.inRange / AI).
 */
export const GUNS = {
  m61: { id: 'm61', name: '20 mm rotary cannon', short: 'GUN', designation: 'M61A1', caliber: 0.020, mass: 0.102, cd: 0.30,
    rof: 100, muzzleVelocity: 1050, dispersion: 0.0026, damage: 6.5, spinUp: 0.35, tracerEvery: 5, life: 2.6, range: 1300 },
  gau22: { id: 'gau22', name: '25 mm rotary cannon', short: 'GUN', designation: 'GAU-22/A', caliber: 0.025, mass: 0.185, cd: 0.30,
    rof: 55, muzzleVelocity: 1040, dispersion: 0.0022, damage: 10, spinUp: 0.25, tracerEvery: 4, life: 2.8, range: 1400 },
  gau8: { id: 'gau8', name: '30 mm rotary cannon', short: 'GUN', designation: 'GAU-8/A', caliber: 0.030, mass: 0.395, cd: 0.28,
    rof: 65, muzzleVelocity: 1010, dispersion: 0.0035, damage: 17, spinUp: 0.5, tracerEvery: 4, life: 3.2, range: 1600 },
};

/**
 * Missiles. Kinematics: launch mass kg, motor { boost: [thrust N, time s], sustain: [thrust N, time s] }, propellant kg
 * (burnt linearly over the whole motor time), diameter m, cd0 (drag coefficient on the body cross-section, coasting;
 * the motor plume fills the base while burning: × 0.75), cnMax (max normal-force coefficient on the cross-section →
 * aerodynamic g limit), maxG structural, navGain (proportional navigation N), tau s (autopilot lag), gimbal deg (seeker
 * look-angle limit vs the missile axis), trackRate deg/s (seeker slew limit: a faster line-of-sight rate breaks the track), fov deg (lock cone off the launcher's nose), lockTime s, gate deg (seeker
 * tracking gate), quality 0..1 (counter-countermeasures), fuze m (proximity radius), blast m (damage radius),
 * damage hp at zero distance, armDist m / armTime s, life s (self-destruct), detectRange m (IR: vs a rear-aspect
 * MIL-power fighter; radar: seeker range once active), activeRange m (radar: goes autonomous at this range-to-go).
 * rMin / rMax / speed are nominal numbers for menus and HUD labels; the live launch zone is entity.lock.rMin/rMax/rNe.
 */
export const MISSILES = {
  ir: { id: 'ir', type: 'ir', seeker: 'ir', name: 'Short-range IR missile', short: 'SRM', designation: 'AIM-9M',
    mass: 86, propellant: 27, diameter: 0.127, cd0: 0.95, cnMax: 13, maxG: 32, navGain: 4, tau: 0.35,
    motor: { boost: [17500, 2.5], sustain: [0, 0] },
    gimbal: 60, trackRate: 30, fov: 30, lockTime: 0.9, gate: 3.2, quality: 0.62, detectRange: 10500,
    fuze: 7, blast: 11, damage: 240, armDist: 300, armTime: 0.45, life: 20,
    rMin: 400, rMax: 9000, speed: 820 },
  radar: { id: 'radar', type: 'radar', seeker: 'radar', name: 'Medium-range radar missile', short: 'MRM', designation: 'AIM-120C',
    mass: 152, propellant: 50, diameter: 0.178, cd0: 0.5, cnMax: 14, maxG: 35, navGain: 4, tau: 0.2,
    motor: { boost: [21000, 3.2], sustain: [4800, 5.0] },
    gimbal: 55, trackRate: 24, fov: 60, lockTime: 1.8, gate: 6, quality: 0.7, detectRange: 16000, activeRange: 11000,
    fuze: 11, blast: 17, damage: 300, armDist: 900, armTime: 1.1, life: 70,
    rMin: 1200, rMax: 32000, speed: 1250 },
};

/** Flares: count per salvo, cooldown s between salvos, life s, peak (relative IR intensity: a fighter at MIL power seen
 *  from astern ≈ 1.1), rise s to peak, fade s at the end, drag k (1/m, quadratic), ejection speed m/s. */
export const FLARE = { salvo: 2, cooldown: 0.4, life: 4.2, peak: 1.6, rise: 0.25, fade: 1.6, drag: 0.009, eject: 28 };

/** Launcher radar: lock cone half-angle deg, search range m vs a fighter of rcs 1, lock time scale. */
export const RADAR = { cone: 60, range: 75000 };

/** Radar cross-section factor (detection range ∝ rcs^¼): stealth aircraft are seen late. */
export const RCS = { f22: 0.04, f35: 0.06, b2: 0.03, sr71: 0.5, default: 1, transport: 8, airliner: 10 };

/**
 * Loadouts per aircraft id: gun type + rounds, IR / radar missile counts, flares, hit points (toughness), gun port in body
 * axes as a function of the geometry (≈ the real gun's side). Mission overrides merge on top (equip(entity, overrides)).
 */
export const LOADOUTS = {
  f16:  { gun: 'm61', rounds: 511, ir: 4, radar: 2, flares: 30, hp: 100, port: (g) => [-0.75, 0.45, g.pilotEye[2] + 1.6] },
  f15:  { gun: 'm61', rounds: 940, ir: 4, radar: 4, flares: 30, hp: 135, port: (g) => [1.7, 0.35, g.pilotEye[2] + 5.0] },
  fa18: { gun: 'm61', rounds: 412, ir: 2, radar: 4, flares: 60, hp: 125, port: (g) => [0, 0.55, g.noseZ + 1.0] },
  f22:  { gun: 'm61', rounds: 480, ir: 2, radar: 6, flares: 30, hp: 120, port: (g) => [1.35, 0.3, g.pilotEye[2] + 3.2] },
  f35:  { gun: 'gau22', rounds: 180, ir: 2, radar: 4, flares: 30, hp: 115, port: (g) => [-0.9, 0.6, g.pilotEye[2] + 2.2] },
  f14:  { gun: 'm61', rounds: 675, ir: 2, radar: 4, flares: 30, hp: 135, port: (g) => [-0.7, -0.45, g.pilotEye[2] - 0.6] },
  a10:  { gun: 'gau8', rounds: 1150, ir: 2, radar: 0, flares: 120, hp: 240, port: (g) => [0, -0.35, g.noseZ + 0.15] },
  sr71: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 140 },
  b2:   { gun: null, rounds: 0, ir: 0, radar: 0, flares: 60, hp: 320 },
  c17:  { gun: null, rounds: 0, ir: 0, radar: 0, flares: 120, hp: 420 },
  b738: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 190 },
  a320: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 190 },
  b789: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 260 },
  b77w: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 300 },
  b748: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 340 },
  a388: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 380 },
};
const BY_CATEGORY = {
  fighter: { gun: 'm61', rounds: 500, ir: 2, radar: 2, flares: 30, hp: 110 },
  attack: { gun: 'm61', rounds: 600, ir: 2, radar: 0, flares: 60, hp: 180 },
  bomber: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 60, hp: 300 },
  recon: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 30, hp: 140 },
  transport: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 90, hp: 380 },
  airliner: { gun: null, rounds: 0, ir: 0, radar: 0, flares: 0, hp: 220 },
};

/**
 * Damage TAKEN multipliers — the one place difficulty touches the damage model. Per weapon class:
 * gun, missile (blast), fire (burning over time), other (collision is not scaled: it always kills).
 * Player numbers vs one missile hit on a 100 hp fighter (warhead 240–300 hp × fall-off 0.5–1):
 *   rookie: at most ≈ 86 hp → always survives one hit, crippled; veteran: 65–200 → crippled or dead; ace: dead.
 */
export const DAMAGE_TAKEN = {
  player: {
    rookie: { gun: 0.45, missile: 0.25, fire: 0.3 },
    veteran: { gun: 0.8, missile: 0.65, fire: 0.8 },
    ace: { gun: 1.1, missile: 1.1, fire: 1.1 },
  },
  playerWingman: { rookie: 0.7, veteran: 0.9, ace: 1.0 },   // blue AI
  enemy: { rookie: 1.15, veteran: 1.0, ace: 0.9 },           // red AI
};

/**
 * Warning time guaranteed to the human player: an aircraft hostile to the player cannot launch a radar missile at
 * them until its radar lock ('rwr:lock' on the player) has been held this long (s). IR launches are passive (no lock
 * warning) but still raise 'rwr:launch'; they require the lock to be held `irHold` s.
 */
export const PLAYER_WARNING = {
  rookie: { radarHold: 4, irHold: 2 },
  veteran: { radarHold: 2.5, irHold: 1 },
  ace: { radarHold: 1, irHold: 0 },
};

/** Resolve the base loadout of an aircraft definition (id table → category → fighter default). */
export function baseLoadout(def) {
  return LOADOUTS[def?.id] || BY_CATEGORY[def?.category] || BY_CATEGORY.fighter;
}

/** Gun port in body axes for a def (falls back to a point left of the nose, ahead of the cockpit). */
export function gunPort(def, out = [0, 0, 0]) {
  const g = def?.geometry;
  const L = baseLoadout(def);
  if (g && L.port) { const p = L.port(g); out[0] = p[0]; out[1] = p[1]; out[2] = p[2]; return out; }
  const len = g?.length || 15;
  out[0] = -0.6; out[1] = 0.3; out[2] = g?.pilotEye ? g.pilotEye[2] + 1.5 : -0.3 * len;
  return out;
}

export function rcsOf(def) {
  return RCS[def?.id] ?? (def?.category === 'transport' ? RCS.transport : def?.category === 'airliner' ? RCS.airliner : RCS.default);
}
