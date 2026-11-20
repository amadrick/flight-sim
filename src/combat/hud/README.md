# Combat HUD (`src/combat/hud/`)

`createCombatHud(combat) → { update(dt), setVisible(v), visible, radar, subtitles }` — called by core; `update` runs in
`combat.late` after the simulator HUD. Only `update` is part of the COMBAT.md contract; the rest is additive.

| additive member | what |
|---|---|
| `setVisible(v)` | force the combat overlay on/off (the simulator's `cmd hudToggle` flips the same switch) |
| `visible` | true while anything is shown |
| `radar.cycle()` | step the scope range (auto → 5 → 10 → 20 → 40 → 80 nm → hidden → auto); a tap/click on the scope does the same |
| `subtitles.push({ from, text, priority, team })` | queue a subtitle line directly (normally fed by `'radio'`) |

## What it draws

**Overlay canvas** (`overlay.js`, z-index 3 above the simulator HUD canvas, CSS drop-shadow outline; ≈150–350 draw ops):
- Aircraft markers through the real camera (`math.js createProjector`): hostile corner brackets (< 7 km) or a diamond,
  friendly rings, call sign + range for near ones. Inbound/locking/six threats get an amber ring and an edge cue.
- Designated target: box sized to the airframe, aspect line (where it will be in 2 s), data block (call sign, type,
  range nm, closure kt, altitude delta kft, aspect brevity HOT/FLANK/BEAM/DRAG/COLD), hit counter.
  Off-screen: double chevron on the screen-edge ellipse + target locator line from the centre with degrees off the nose.
- Gun: gun cross projected at the target's range (skipped in the cockpit — the fighter HUD draws its own), a bullet-stream
  funnel built from the last ~2 s of the aircraft's own attitude history (rounds fired then are where the funnel is now;
  width = a 11 m wingspan at that range), lead-computing pipper from `weapons.gunSolution` with a range arc and a steering
  line, `SHOOT` when the gun line is on the solution within the target's angular size and in range.
  The round's path comes from `weapons.gunTrajectory(shooter, t, out)` (offset from the shooter's straight-line path, body
  axes), rotated with each history sample's attitude and added to that sample's position + velocity·t; without it, the
  aircraft's own gun spec (`loadout.gun.spec.muzzleVelocity`) and gravity.
- Missiles: uncaged seeker circle while searching, closing amber circle + progress arc while acquiring, red ring + diamond
  + `LOCK` (box snaps in) when locked; launch-zone scale right of centre (`rMin`, `rMax`, thick `rNe` band, range caret,
  `tti`), selected type + count, lock state, fly-out list with time to impact (`missile.tgo`) for the player's missiles;
  `SHOOT` whenever locked (a launch needs a full lock) — green inside `rNe` (or in range when none is known), amber otherwise.
- Threats: `MISSILE` box (flashes unless reduced motion) with an arrow to the nearest inbound missile, time to impact and
  a prompt (`FLARES · BREAK LEFT/RIGHT`, radar missiles `BREAK … · NOTCH`), edge cues for every inbound missile,
  `LOCKED` + call sign, `BANDIT SIX` + chevrons, `GUNS` on `'bullet:near'`, directional red arcs + vignette on `'damage'`
  (and a steady vignette under 30 % hull).
- Hit markers (`'bullet:hit'` by the player), `SPLASH` stamp on the player's kills, short messages (`NO LOCK`,
  `MISSILE MISSED`, `DECOYED`, weapon selected).

**DOM** (`panels.js`, `.glass` panels, z-index 4):
- Objectives (top left; steps down while the simulator's controls card is up) with progress, optional, done/failed
  states and a highlight on change, mission timer (`director.timer`), score.
- Right column under the menu's corner buttons: radar / RWR scope (`radar.js`: heading-up, range rings, auto range,
  friends/enemies/missiles/target/steer point/home base; outer band = radar warning: amber chevrons for locks, red spokes
  for launches), stores panel (`status.js`: gun bar, missile pips per type with the selected one bracketed, flares,
  hull bar, a top-down part-damage diagram from `damage.parts` once anything is hit, chips FIRE / ENG OUT / SMOKE /
  FUEL LEAK / BINGO / FUEL LOW / GUN LOW / NO MSL / WINCHESTER), kill feed.
- Radio subtitles bottom centre above the flight-data strip (two lines, queued, urgent lines jump the queue),
  score pops, mission-end banner (stays until the debrief screen opens), first-minute key hints (keyboard only;
  each fades when used).

## Layout
All panel anchors live in `seats.js` (`SEATS` table + `seatMode` + `applySeats`). *wide* (desktop) and *narrow*
(phone width, short screens or any touch device). Narrow keeps every panel out of the bottom corners and off the bottom
edge: objectives with the radio subtitles stacked under them on the upper left, radar / stores / kills on the upper
right (the combat touch fire buttons go on the right edge around mid-height). Re-seat panels there after the
simulator's mobile pass.

Hidden when no mission is active, while `ctx.menu.isOpen`, `combat.ui.isOpen`, `ctx.params.hud === false`, in the
showcase camera, or after `hudToggle`.

## Events consumed
`mission:start/end/abort`, `objective:update`, `radio`, `score`, `kill`, `bullet:hit`, `bullet:near`, `damage`,
`lock:locked`, `weapon:nolock`, `weapon:select`, `missile:miss` (reason), `missile:decoyed`, `missile:active`, `fire:start`,
`engine:out`, `rwr:lock`, `cmd`, `gun:start`.
Per-frame state read: `world.aircraft`, `weapons.missiles`, `player.{target, lock, loadout, hp, maxHp, damage, state}`,
`weapons.threatsTo?` (fallback: scan missiles / enemy locks), `director.{objectives, waypoint, timer, markers, stats, home?}`.

## Tests
`node --test src/combat/hud` (the local `package.json` points node at `hud.test.js`): projection vs three.js, behind-camera
turn direction, edge clamp, radar transform, auto range, launch-zone scale, aspect brevity, subtitle queue, strip estimate,
node import without DOM.
