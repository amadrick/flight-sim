// COMBAT INPUT — placeholder implementation written by the integrator so the rest of combat runs.
// The UI/controls agent replaces the internals; the API below (documented in COMBAT.md §9) must be kept.
// Emits combat.events 'cmd' { name }: missile, flare, targetNext, targetPrev, targetNearest, weaponNext.  `trigger` = gun held.
export const COMBAT_BINDINGS = [
  { group: 'Combat', action: 'Fire gun (hold)', keys: ['Space', 'Left mouse'] },
  { group: 'Combat', action: 'Launch missile', keys: ['Enter', 'X'] },
  { group: 'Combat', action: 'Flares', keys: ['V'] },
  { group: 'Combat', action: 'Next / previous target', keys: ['Tab', 'Shift+Tab'] },
  { group: 'Combat', action: 'Target nearest the nose', keys: ['Y'] },
  { group: 'Combat', action: 'Switch missile type', keys: ['Z'] },
];

export async function createCombatInput(combat) {
  const ctx = combat.ctx;
  const input = { trigger: false, bindings: COMBAT_BINDINGS, update() { if (ctx.menu?.isOpen || ctx.time?.paused) input.trigger = false; } };
  const live = () => combat.active && !ctx.menu?.isOpen;
  const emit = (name) => combat.events.emit('cmd', { name });
  window.addEventListener('keydown', (e) => {
    if (!live() || e.ctrlKey || e.altKey || e.metaKey) return;
    const airborne = !ctx.player?.state?.onGround;
    switch (e.code) {
      case 'Space': if (airborne) input.trigger = true; break;
      case 'Enter': case 'KeyX': if (!e.repeat) emit('missile'); break;
      case 'KeyV': if (!e.repeat) emit('flare'); break;
      case 'Tab': e.preventDefault(); if (!e.repeat) emit(e.shiftKey ? 'targetPrev' : 'targetNext'); break;
      case 'KeyY': if (!e.repeat) emit('targetNearest'); break;
      case 'KeyZ': if (!e.repeat) emit('weaponNext'); break;
      default: return;
    }
  });
  window.addEventListener('keyup', (e) => { if (e.code === 'Space') input.trigger = false; });
  window.addEventListener('blur', () => { input.trigger = false; });
  return input;
}
