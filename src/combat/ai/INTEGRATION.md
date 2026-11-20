# AI: notes for the integrator and the other modules

Nothing outside `src/combat/ai/` was changed. These are requests and observations.

## Requests

1. **Flight model, F-14 at high speed** (`src/physics`): at about 300 m/s and low altitude, full aft stick gives only about 3–4 g at 3–4° AoA, which looks elevator-limited.
   - The AI copes: it learns the stick-to-G gain online and plans terrain recovery with it.
   - A human in the F-14 will still find it hard to pull out of a fast dive. This is worth a look.
2. **Flight model, b738 in `tools/fc-test.mjs`**: commanded to the profile "corner" speed, it exceeds its overspeed limit. This only happens in the controller sweep, which has no speed guard; with the pilot guard it is fine. The b738 `targets.instantTurnSpeed` may simply be unrealistic for an airliner.
3. **Weapons (optional)**:
   - `gunSolution` includes the target's instantaneous acceleration. Against an out-of-plane jink this makes the aim point jump at each jink, and a human cannot see acceleration that fast.
   - A smoothed acceleration (τ ≈ 0.3 s) would make AI tracking and the player's lead-computing pipper steadier.
4. **Bench (optional)**: a `--bot-skill` flag on `tools/combat-bench.mjs` would allow bot-skill sweeps. The bot uses `botSkill ?? 0.7`.
5. **Missions**: the AI reads these fields:
   - `director.markers` (kind `'target'`) and `director.waypoint`, for player-bot navigation when nothing is left to fight;
   - `entity.tags.role`, `def.category`, `pilot.passive` and `order.passive`.
   - Please keep these field names.

## Notes

- `pilot.debug.gun` holds the last fire-control numbers (`err, tol, r, good, losRate`) for tools. It is overwritten in place every frame.
- The AI uses `entity.state.fuel / fuelCapacity`: no afterburner below 30 % fuel except to survive, and it bugs out below 8 %.
- Collisions are lethal. Team-mates keep at least about 70 m plus both radii on converging paths. Wingmen on station in a formation are allowed closer (about 20 m plus radii).
