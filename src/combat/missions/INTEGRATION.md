# Missions: notes for the integrator and the other modules

## What missions rely on (already in place or agreed)

- **Weapons**:
  - `equip` overrides: `{ gun, ir, radar, flares, hp, invulnerable }`.
  - Missions also set `entity.invulnerable` directly: the player while the training shot comes in (train-missiles), and both jets in train-bfm.
  - Missions read and refill `entity.loadout.missiles.ir/radar`, `loadout.gun.rounds` and `loadout.flares`, and add to `entity.hp`. These are the survival rearm and the train-missiles rearm.
- **sim.damage**: `thrust` and `drag` are set once at spawn for target drones and laden strikers (spec `thrust`/`drag`). The damage model overwrites them when the aircraft is hit, which is fine.
- **Team flip**:
  - Groups can start on team `'neutral'` and are switched to `'red'` by setting `entity.team` (c1 unknowns, train-missiles Clay 4).
  - A team change mid-mission must therefore be tolerated, for example by HUD markers and by targeting, which re-reads `team`.
- **AI orders used**:
  - `engage` with a target.
  - `patrol` with `{ waypoints, loop, passive, speed? }`. Orbits are patrol rings that also carry `orbit: { center, radius, alt }`.
  - `escort`.
  - `cruise`, `flee` and `rtb`, each with `{ heading, alt, passive }`.
  - `intercept`, with a fallback heading.
  - `pilot.passive = true` is set as well as `order.passive`.
  - Speed hints: `order.speed` (m/s) on patrols.
- **AI calls**: the director turns `'ai:call' { entity, call, target }` from blue AI into wingman lines, and occasionally does the same for red. It also reacts to `kill`, `rwr:launch`, `fire:start` and `engine:out` itself.

## Requests

1. **HUD**:
   - Draw `director.waypoint`, `director.timer` and `director.markers` (kinds: target, protect, nav, zone, friendly).
   - Objectives may carry `optional` and `progress`, and `state` can be `'failed'`.
   - A marker with `kind: 'zone'` is a line or area label, for example the Lantern Line in c5.
2. **UI**:
   - Missions provide `map` (via `briefMap`), `location` (an airport id) plus `locationName`.
   - `instant-custom` has `custom: true` and reads `options.custom`, with fields clamped in `defs/instant.js customSettings()`. The optional `tod` and `weather` are also honoured.
3. **AI**: with the placeholder AI the bench bot often loses energy, collides with its own wingmen or flies into the sea. The success rates in the report reflect that, and should improve with the real AI. A bot that prefers designated priority targets (bombers and strikers over escorts) would help c4, c6 and c7.
4. **Core (optional)**: the bench `combat.start` cannot pass `botSkill` from the CLI. Not needed, but useful for tuning.
