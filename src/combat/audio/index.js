// COMBAT AUDIO (weapons, lock tones, warnings, explosions, radio voice, music) — placeholder: silent.
// The audio agent implements it; API (COMBAT.md §11): createCombatAudio(combat) -> { update(dt) }.
export async function createCombatAudio(combat) {
  return { update() {} };
}
