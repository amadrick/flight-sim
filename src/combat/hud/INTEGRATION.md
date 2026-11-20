# Combat HUD — requests outside `src/combat/hud/`

None are required for the HUD to work; these make it better.

1. **Simulator HUD (`src/ui/hud/`)**: expose the exterior flight-data strip rectangle (`ctx.hud.stripRect` = the
   `ext.rect` it already computes) and whether the controls card is up (`ctx.hud.hintVisible`, notices already has
   the getter). The combat HUD currently re-derives the strip height from the same formula (`math.js stripTop`) and finds
   the card with `document.querySelector('.hud-hint')`.
2. **Missions**: `director.home = { position: {x, z}, label }` for the radar's home-base symbol (falls back to
   `ctx.player.airport.position`). `director.markers[]` entries may carry `{ position | entity, label, color }`.
3. **Weapons** (merged): `threatsTo(e, out)` sets `out.length = n`, dropping the pooled objects when the count shrinks, so
   they are re-allocated later; keeping the array length and returning `n` (or a separate count) would make it
   allocation-free for the HUD.
4. **Menu (`src/ui/menu/`)**: the in-flight corner buttons sit top right; the combat right column starts 54 px below the
   top gutter to clear them (`SEATS.sideTop` in `seats.js`).
5. **Mobile pass**: every panel anchor is in `seats.js`; after the simulator's mobile layout lands, adjust that table
   (narrow mode already keeps the bottom corners and bottom edge free). On wide screens the subtitles sit above the
   flight-data strip using an estimate of its height (`math.js stripTop`) — item 1 would replace it.
