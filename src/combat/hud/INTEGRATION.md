# Combat HUD — requests outside `src/combat/hud/`

None are required for the HUD to work; these make it better.

1. **Simulator HUD (`src/ui/hud/`)**: expose the exterior flight-data strip rectangle (`ctx.hud.stripRect` = the
   `ext.rect` it already computes) and whether the controls card is up (`ctx.hud.hintVisible`, notices already has
   the getter). The combat HUD currently re-derives the strip height from the same formula (`math.js stripTop`) and finds
   the card with `document.querySelector('.hud-hint')`.
2. **Missions**: `director.home = { position: {x, z}, label }` for the radar's home-base symbol (falls back to
   `ctx.player.airport.position`). `director.markers[]` entries may carry `{ position | entity, label, color }`.
3. **Weapons**: please document whether `gunTrajectory(shooter, tof, out)` includes the shooter's own velocity. The HUD
   detects it (|offset at 1 s| > muzzle velocity + ½ airspeed) but a flag (`weapons.gunTrajectoryRelative = true`) would be
   cleaner. `rwr:lock` for IR locks too (today only radar locks emit it — the HUD also scans enemy `lock` states).
4. **Menu (`src/ui/menu/`)**: the in-flight corner buttons sit top right; the combat right column starts 54 px below the
   top gutter to clear them. If they move, adjust `.cbt-hud-side` top in `style.js`.
