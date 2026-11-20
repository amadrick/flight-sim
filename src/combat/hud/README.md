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

## Flight assist
While `combat.assist.info.active`: the commanded nose (`assist.command`) is drawn as a steering reticle — open circle +
centre dot, HUD green, projected at the gun cross's distance so the two register in every camera; on the screen edge
with an arrow when off screen. The gun cross is the actual nose; a thin lead line joins them beyond ~3°. `gunAssist`
turns the reticle white with four ticks and `AIM`. `info.limiting` → `MAX TURN` / `G LIMIT` / `TOO SLOW` (`OVERSPEED`
when the speed limit is an overspeed) under the reticle, debounced 0.3 s; `pullUp` / 'ground' → a flashing `PULL UP`
box with an up arrow in the SHOOT-cue slot (SHOOT suppressed), on at once, held 0.3 s. `autoThrottle` → `A/THR` chip
in the stores panel. With mouse aim (`assist.aim.active`) the input module's DOM ring at the pointer is the reticle;
the HUD then draws only the nose cross and the lead line. The overlay canvas sits above the glass panels (z 5) so
no steering cue can hide under them.

Energy cue: a short vertical tape just left of the gun cross. The centre tick is the fight speed
(`info.fightSpeed`, the corner speed the auto-throttle holds; without it, the corner speed from `ai/fly.js profileOf`).
The green band runs from 12 m/s below it to 22 m/s above it, and the caret marks the IAS (up = faster, outlined when
pinned at an end). The caret is green inside the band, white when fast and amber when slow; `info.slow` (or IAS below
0.8 × fight speed) adds an amber `SLOW` under the tape. It is hidden while PULL UP shows.

## Combat cameras
Reads `combat.camera.mode` (`fight`, the default mission chase view, is treated as plain chase; a peek reports `padlock`). In `missile` / `kill` / `victory` (not seen from the nose) the boresight-referenced layer is
hidden (gun cross, funnel, pipper, seeker / lock rings, launch-zone scale, SHOOT cue, damage arcs) and so are the
"turn this way" edge cues; world-projected markers, the target box and the warning box stay, plus a camera label at the
top (`MISSILE CAM` with the missile's time to go, `KILL CAM`, `VICTORY`). In `padlock` everything stays and a nose /
lift-vector cue is added (wings + lift line where the nose points, or a `NOSE` arrow on the screen edge).

## Touch layout (regions from `src/input`)
While the touch layout runs a mission (`html.inp-mission`, and `ctx.input.touch.layout.mission`), every panel sits in
the region that layout publishes as `--inp-<name>-{x,y,w,h}` on `<html>`. The CSS for this is in `style.js`, scoped
`html.inp-mission .cbt-hud-root.cbt-hud-touch`, and every seat is `position: fixed`:
- `.cbt-hud-left` (objectives chip, hull line, kill feed) goes in `cbt`, clipped to it (`max-height`, `overflow:hidden`).
- `.cbt-hud-radar` goes in `radar` when `html.inp-radar` is set; otherwise it stays in the left stack.
- `.cbt-hud-subs` goes in `subs` when `html.inp-subs` is set, bottom-aligned with at most two lines; otherwise it stays
  in the left stack.
- `.cbt-hud-pops` sit at the top centre of `clear` and `.cbt-hud-banner` (mission end) at its centre.
- `.cbt-hud-hints` are hidden.
- Objectives become a one-line chip: the current objective (`li.cbt-hud-cur`), its progress, the timer and `+N` more.
  Tapping it toggles `.cbt-hud-open` (the full list); the list folds again after 8 s.
- Stores become a single `HULL` bar with the warning chips (`A/THR`, `FIRE`, `BINGO`, `NO MSL`…), because the dock
  shows rounds, missiles and flares.
- The canvas reads the same rectangles (re-read on `touch:layout`). Edge cues ride an ellipse between the strip and
  the bottom of `clear`, and between the screen edge and the control clusters (dock, scope, fire, extras).
- Warnings (`MISSILE` box, `ENEMY LOCK · callsign`, `BANDIT SIX`) and the camera label go in the top band between
  the strip and the top-right buttons. When that band is too narrow, they go at the bottom of `cbt`.
- The launch-zone scale becomes the horizontal bar under the target box, without a lock word: the ring colour and
  SHOOT say it. The SHOOT / PULL UP slot stays above the `subs` region.
- In `clear` the HUD draws only world-projected markers, the reticle and gun cross, the energy cue, the target box,
  SHOOT / PULL UP and short pops.

## Layout
All panel anchors live in `seats.js` (`SEATS` table + `seatMode` + `isCompact` + `applySeats`): *wide* (desktop),
*narrow* (small mouse/keyboard window) and *touch* (any touch-enabled screen: the right edge and bottom corners belong
to the touch controls, so everything stacks on the upper left — [objectives | radar], a one-line stores strip, kill
feed, subtitles). *compact* (height ≤ 440 px, e.g. phone landscape) shrinks the scope and collapses the stores panel
to one line. In the cockpit the launch-zone scale becomes a short horizontal bar under the target box (the fighter
HUD's altitude tape owns the right of centre). Edge cues ride an ellipse that stays above the data strip
(`ctx.hud.stripRect`). Key hints (incl. `O` padlock) last 20 s of unblocked time or until each key is used;
never on touch.

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
