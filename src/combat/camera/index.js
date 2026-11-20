// COMBAT CAMERAS (padlock, missile cam, kill cam) — placeholder: none.
// The camera agent implements it; API (COMBAT.md §14): createCombatCamera(combat) -> { update(realDt), mode, setMode(m) }.
// update(realDt) runs right after the simulator's camera rig has posed ctx.camera, and may override the pose.
export async function createCombatCamera(combat) {
  return { mode: null, setMode() {}, update() {} };
}
