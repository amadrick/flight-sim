// STUB input — replaced by the input agent. API: createInput(ctx) -> { update(dt) }; writes ctx.controls, emits 'cmd' events.
export async function createInput(ctx) {
  const keys = new Set(); const c = ctx.controls;
  const cmds = { KeyG: 'gearToggle', KeyF: 'flapsDown', KeyV: 'flapsUp', KeyB: 'speedbrakeToggle', KeyC: 'cameraNext', KeyP: 'pause', KeyR: 'reset', KeyZ: 'apToggle' };
  window.addEventListener('keydown', (e) => { if (!e.repeat && cmds[e.code]) ctx.events.emit('cmd', { name: cmds[e.code] }); keys.add(e.code); });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  const axis = (cur, target, dt) => cur + (target - cur) * Math.min(1, dt * 6);
  return {
    update(dt) {
      c.pitch = axis(c.pitch, (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0), dt);
      c.roll = axis(c.roll, (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0), dt);
      c.yaw = axis(c.yaw, (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0), dt);
      if (keys.has('KeyW') || keys.has('ShiftLeft')) c.throttle = Math.min(1, c.throttle + dt * 0.5);
      if (keys.has('KeyS') || keys.has('ControlLeft')) c.throttle = Math.max(0, c.throttle - dt * 0.5);
      c.brakes = keys.has('Space') ? 1 : 0;
    },
  };
}
