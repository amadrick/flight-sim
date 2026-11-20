// Player flight assist: turns the player's stick / pointer intent into control inputs that fly the nose where the player points.
// Contract: COMBAT.md §15. This file is a no-op placeholder until the assist module lands.
export function createAssist(combat) {
  const assist = {
    mode: 'off',                 // 'off' (direct stick) | 'assist' (stick steers the nose; the assist banks, pulls and coordinates)
    aim: { x: 0, y: 0, active: false },   // optional pointer aim, set by combat.input: offset from the screen centre, -1..1, +x right, +y up
    aimAssist: 0,                // 0..1 gun aim help strength (set from difficulty / settings)
    info: { mode: 'off', active: false, gunAssist: false, limiting: '' },   // read by the HUD
    setMode(m) { assist.mode = m === 'assist' ? 'assist' : 'off'; assist.info.mode = assist.mode; },
    setAimAssist(v) { assist.aimAssist = Math.max(0, Math.min(1, +v || 0)); },
    reset() {},                  // mission start / restart
    update(dt) {},               // core calls this in combat.pre(), after combat.input.update(dt) and before the player's physics
  };
  return assist;
}
