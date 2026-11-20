# Changes requested outside `src/combat/weapons/`

1. **Fuel leak hook (physics).** Weapons writes `sim.damage.fuelLeak` (kg/s) when that field exists on `sim.damage`, and lets the
   flight model starve the engines. `reset()` and `rearm({ heal: 1 })` set it back to 0. Until the field exists, the old emulation
   stays in place: every engine is shut down when `damage.fuelLost` reaches `state.fuel`. Please initialise
   `fuelLeak: 0` in `sim.js`'s `dmg` object, because detection uses `'fuelLeak' in sim.damage`.
2. **COMBAT.md §6/§5.** Document the additions listed in `README.md`: `gunTrajectory`, `threatsTo`, `canLock`, `launchZone`, the lock fields `rNe / tti / closure / aspect / offBoresight`, the missile fields (`motor`, `seeker`, `active`, …) and the new events.
3. **`node --test src/combat/weapons`.** Node runs a directory argument as a CommonJS entry, so `src/combat/weapons/package.json` (`"type": "module"`, `"main": "tests.mjs"`) makes that command actually run the tests. If you would rather avoid a nested `package.json`, use `node --test src/combat/weapons/*.test.js` and delete both files.
4. **AI placeholder.** It drops flares on every inbound missile within 3 km, with no timing. That decoys a lot but works poorly against the anti-spam rule. Brief the AI agent on `threatsTo`, `missile.tgo` and `launchZone`.
