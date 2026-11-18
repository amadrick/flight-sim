# Audio module — integration notes

API (unchanged from the stub): `createAudio(ctx) -> { update(dt), resume(), setMasterVolume(v), masterVolume, audioContext }`.

* The `AudioContext` is created lazily on the first `pointerdown/keydown/touchstart/mousedown` (capture phase on `window`) or when
  `ctx.audio.resume()` is called. Until then every call is a silent no-op. The menu's Fly button should call `ctx.audio.resume()`.
* Reads (all defensive): `ctx.player.state/def`, `ctx.time.paused/realDt`, `ctx.menu?.isOpen`, `ctx.weather`, `ctx.camera`,
  `ctx.cameraRig.{isInterior (bool), mode, worldPosition, velocity}` (velocity falls back to a finite difference of worldPosition),
  `ctx.world.groundAt` (surface type for runway roughness).
* Listens to: `session:start/end`, `touchdown`, `gear:moved`, `flaps:moved`, `sonicBoom`, `crash`, `lightning`, `cmd` (switch clicks),
  optional `stallWarning` / `overspeed` (also derived from `state.stallWarning/stalled/overspeed/overG/ap.engaged` flags, so events are optional).
* Interior cameras: `rig.isInterior === true` or `rig.mode` in `cockpit|interior|pilot|vc|virtual-cockpit|cabin|hud`.
* Verification: `node src/audio/run-harness.mjs` (offline render of the real graphs + measurements), `node --test src/audio/`.
