// Shared GPU state for the combat effects: the simulator effects' uniform block / GLSL header / anchored storage /
// noise textures. Uses ctx.effects' own instances when it exposes them (requested in INTEGRATION.md:
// `ctx.effects.shared = { uniforms, header, anchor, textures }`), otherwise builds a private copy with the same helpers
// (two 32³ / 128² textures, ~20 ms at boot). Our copy is refreshed every frame by refresh().
import { createNoise3D, createPuffTexture } from '../../effects/noise.js';
import { createSharedUniforms, sharedHeader } from '../../effects/fxglsl.js';
import { createAnchor } from '../../effects/anchor.js';

export function createFxShared(ctx) {
  const ext = ctx.effects?.shared;
  if (ext?.uniforms && ext?.header && ext?.anchor) {
    // shared with the simulator effects: they refresh the frame-dependent values (and the anchor) themselves, but they
    // update AFTER combat.step — so we still run anchor.update() (idempotent) before writing anything each frame
    return { uniforms: ext.uniforms, header: ext.header, anchor: ext.anchor, owned: false, refresh(f) { ext.anchor.update(); }, dispose() {} };
  }
  const tex = { noise3D: createNoise3D(), puff: createPuffTexture() };
  const uniforms = createSharedUniforms(ctx, tex);
  const header = sharedHeader(ctx);
  const anchor = createAnchor(ctx, uniforms);
  const raw = ctx.params?.raw || {};
  if (raw.fxtm === '1') { uniforms.uFxPreviewTM.value = 1; uniforms.uFxPreviewExposure.value = +raw.fxexp || 1; }
  return {
    uniforms, header, anchor, owned: true, tex,
    /** per-frame values (same as src/effects/index.js) */
    refresh() {
      anchor.update();
      const u = uniforms;
      u.uFxNight.value = ctx.env?.nightFactor || 0;
      const kd = ctx.pipeline?.lighting?.keyDir;
      if (kd) u.uFxKeyDir.value.copy(kd); else if (ctx.env?.sunDir) u.uFxKeyDir.value.copy(ctx.env.sunDir);
      u.uFxExposure.value = Math.max(1e-3, ctx.env?.exposure || 1);
      const s = ctx.player?.state;
      if (s && ctx.weather?.windAt) ctx.weather.windAt(s.position, u.uFxWind.value);
      else if (ctx.weather?.wind) u.uFxWind.value.copy(ctx.weather.wind);
    },
    dispose() { tex.noise3D.dispose(); tex.puff.dispose(); },
  };
}
