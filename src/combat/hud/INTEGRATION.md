# Combat HUD — requests outside `src/combat/hud/`

None are required for the HUD to work; these make it better.

1. **Simulator HUD** (done): the combat HUD now uses `ctx.hud.stripRect`. `math.js stripTop` is only a fallback for a
   simulator HUD that does not have that getter.
2. **Missions**: `director.home = { position: {x, z}, label }` for the radar's home-base symbol (falls back to
   `ctx.player.airport.position`). `director.markers[]` entries may carry `{ position | entity, label, color }`.
3. **Weapons** (merged): `threatsTo(e, out)` sets `out.length = n`, dropping the pooled objects when the count shrinks, so
   they are re-allocated later; keeping the array length and returning `n` (or a separate count) would make it
   allocation-free for the HUD.
4. **Menu (`src/ui/menu/`)**: the in-flight corner buttons sit top right; the combat right column starts 54 px below the
   top gutter to clear them (`SEATS.sideTop` in `seats.js`).
5. **Touch layout (`src/input/touch.js`)**: the combat HUD now seats itself from the `--inp-*` variables (see the
   README's "Touch layout" section), so the panel rules in `COMBAT_SEATS` can go: the `.cbt-hud-left`, `.cbt-hud-radar`,
   `.cbt-hud-subs`, `.cbt-hud-pops`, `.cbt-hud-banner` and `.cbt-hud-hints` lines. Keep the `.cbt-inp-*` lines
   (the combat fire buttons). The HUD's own rules carry no `!important`, so the old block still wins while it is there.
   Both place the panels in the same rectangles, but the old block's `max-height` / `overflow` / `transform`
   `!important` are harmless.
