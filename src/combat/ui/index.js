// COMBAT SCREENS (mission select, briefing, debrief) — placeholder: none; start missions with ?mission=<id>&autostart=1.
// The UI agent implements it; API (COMBAT.md §12): createCombatUi(combat) -> { update(dt), openMissions(), isOpen }.
export async function createCombatUi(combat) {
  return { isOpen: false, openMissions() {}, update() {} };
}
