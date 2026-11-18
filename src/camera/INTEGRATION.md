# Camera rig — integration notes

- API: `createCameraRig(ctx)` -> `{ mode, modes, allModes, setMode(m), next(dir), snap(), update(realDt), worldPosition, velocity, isInterior }`.
- Input conventions assumed (input agent should match): `controls.lookX/lookY` are **deflections** in -1..1
  (+X = look right, +Y = look up; the view eases back when released); `controls.zoom` > 0 zooms IN (rate, per second).
  Optional `ctx.input.lookDelta` ({x,y} or [x,y], pixel-ish per frame, +x right / +y up; used by orbit mode only, must be
  reset by input each frame) and `ctx.input.zoomDelta` (wheel notches per frame, >0 = in).
- Optional scenery hook: `ctx.scenery.airports[i].towerPosition` ({x,y,z} world), index = index in `AIRPORTS`.
- `session:start` keeps the current mode (showcase glides, others snap). The menu must call `setMode('chase')` (or `camera:chase`) to leave showcase.
- `isInterior` is true in `cockpit` and in `wing` for airliners (passenger window).
- Events used: `cmd`, `touchdown`, `crash`, `session:start`, `session:end`; emits `camera:mode`.
