# Combat effects — integration notes / requests outside `src/combat/fx/`

Everything below is optional: the module works without any of it (fallbacks in brackets).

## Requests

1. **`weapons.muzzleOf(entity, outVec3) → outVec3`** (weapons, optional) — world gun-port position. Used when present;
   otherwise we compute it from `weapons/specs.js gunPort(def)` (same data), so this is a nicety only.
2. Real weapons fields now consumed (merged `claude/project-thread-p4olds`): bullets `gun`/`life`, `loadout.gun.type`,
   `missile.motor` + `spec.motor`/`spec.diameter`, `flare.heat`, `damage.{smoke, fire, engineOut, leak, parts}`,
   `bullet:hit.gun`, `bullet:ground`, `missile:miss.detonated`, `kill.info.disintegrated`. Not used yet (ideas):
   `fire:start` / `engine:out` (a puff + flash on the event), `collision` (sparks + debris at `position`).
3. **`'kill'` with `info.disintegrated`**: we throw more and bigger debris; set `victim.hidden = true` at the same time
   if the airframe should vanish (we never touch `hidden`).
4. **Wreck lifetime** (core, `world.js` `WRECK_TIME = 30`): a wreck shot down at 5 km is removed before it reaches the
   ground, so `wreck:impact` (ground fireball + smoke column) rarely happens in the instant missions. Suggest keeping
   wrecks until impact (or ~60 s) — our trail follows them all the way down for free.
5. **`ctx.effects.shared = { uniforms, header, anchor }`** (simulator effects, `src/effects/index.js`): expose the
   shared uniform block, GLSL header and anchor so combat fx stops building a duplicate (two small noise textures
   ≈ 20 ms at boot + one more anchor). [we build our own with the same helpers from `src/effects/*`; detected
   automatically when present]
6. **Simulator crash fx for a player shot down at altitude** (`src/effects/crash/`): `combat.kill` → `sim.destroy('Shot
   down…')` → `'crash'` with the aircraft still kilometres up. `classifyCrash` only produces `airburst` for
   `/structural/` reasons, so an in-air shoot-down may be classified as a ground crash and place its fireball on the
   ground under the jet. Suggest treating `/shot down/i` with `agl > 25` as `airburst`. Combat fx deliberately
   does not explode the player's jet (no double fireball); it does trail fire and black smoke behind the falling
   player wreck until it reaches the ground.

## Public additions on `combat.fx` (documented in README.md)
`explode(worldPos, scale, { velocity, debris })`, `explodeAircraft(victim, weapon, info)`, `groundImpact(entity,
position)`, `clear()`, `stats()`, `dispose()`.

## Debug params (screenshots only)
`cfxfb=0` disables the neural fireball (particles only); `cfxdmg=<0..1>` forces battle damage on every aircraft;
`cfxcontrail=1` forces AI contrails; `cfxvapor=1` forces AI wingtip vapour.
