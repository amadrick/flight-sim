// STUB HUD — replaced by the HUD/instruments agent. API: createHud(ctx) -> { update(dt), setVisible(v) }
// Draws on ctx.hudCanvas (2D canvas overlaying the 3D view).
export async function createHud(ctx) {
  const cv = ctx.hudCanvas, g = cv.getContext('2d'); let visible = ctx.params.hud;
  const fit = () => { const d = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(cv.clientWidth * d); cv.height = Math.round(cv.clientHeight * d); g.setTransform(d, 0, 0, d, 0, 0); };
  ctx.events.on('resize', fit); fit();
  return {
    setVisible(v) { visible = v; },
    update() {
      g.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
      const s = ctx.player?.state; if (!s || !visible) return;
      g.font = '13px ui-monospace, monospace'; g.fillStyle = '#5dff9b';
      const lines = [`IAS ${(s.ias / 0.5144).toFixed(0)} kt   M ${s.mach.toFixed(2)}`, `ALT ${(s.altitude / 0.3048).toFixed(0)} ft   VS ${(s.verticalSpeed * 196.85).toFixed(0)} fpm`,
        `HDG ${(s.heading * 57.2958).toFixed(0)}   G ${s.gLoad.toFixed(1)}   AoA ${(s.aoa * 57.2958).toFixed(1)}`, `THR ${(s.throttle * 100).toFixed(0)}%  GEAR ${s.surfaces.gear > 0.5 ? 'DN' : 'UP'}  FLAPS ${(s.surfaces.flaps * 100).toFixed(0)}%${s.onGround ? '  GND' : ''}${s.crashed ? '  CRASHED' : ''}`];
      lines.forEach((l, i) => g.fillText(l, 16, 24 + i * 18));
    },
  };
}
