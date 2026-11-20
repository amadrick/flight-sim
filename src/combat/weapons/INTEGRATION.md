# Changes requested outside `src/combat/weapons/`

1. **Fuel leak hook (physics).** `sim.damage` has no way to drain fuel. Today a leak is emulated: `damage.fuelLost` builds up, and every engine is shut down when it reaches `state.fuel`. A `sim.damage.fuelLeak` (kg/s) that the sim subtracts from its internal `fuel` would make the fuel gauge honest.
2. **COMBAT.md §6/§5.** Document the additions listed in `README.md`: `gunTrajectory`, `threatsTo`, `canLock`, `launchZone`, the lock fields `rNe / tti / closure / aspect / offBoresight`, the missile fields (`motor`, `seeker`, `active`, …) and the new events.
3. **`node --test src/combat/weapons`.** Node runs a directory argument as a CommonJS entry, so `src/combat/weapons/package.json` (`"type": "module"`, `"main": "tests.mjs"`) makes that command actually run the tests. If you would rather avoid a nested `package.json`, use `node --test src/combat/weapons/*.test.js` and delete both files.
4. **AI placeholder.** It drops flares on every inbound missile within 3 km, with no timing. That decoys a lot but works poorly against the anti-spam rule. Brief the AI agent on `threatsTo`, `missile.tgo` and `launchZone`.
