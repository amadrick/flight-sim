// Combat control map — single source of truth for keys, gamepad buttons and touch buttons (no DOM; unit-tested).
// Commands are combat.events 'cmd' names (COMBAT.md §5); 'gun' is the held trigger (combat.input.trigger).

/** KeyboardEvent.code → action. shift: only with / without Shift (undefined = either). */
export const KEY_MAP = [
  { code: 'Space', act: 'gun' },                       // airborne only: on the ground Space stays the wheel brake
  { code: 'Enter', act: 'missile' }, { code: 'NumpadEnter', act: 'missile' }, { code: 'KeyX', act: 'missile' },
  { code: 'KeyV', act: 'flare' },
  { code: 'Tab', shift: false, act: 'targetNext' }, { code: 'Tab', shift: true, act: 'targetPrev' },
  { code: 'KeyY', act: 'targetNearest' },
  { code: 'KeyZ', act: 'weaponNext' },
];

/**
 * Pure key lookup. Returns 'gun' | a 'cmd' name | null. Never maps Ctrl / Alt / Meta combinations.
 * e: { code, shiftKey, ctrlKey, altKey, metaKey }
 */
export function keyAction(e) {
  if (!e || e.ctrlKey || e.altKey || e.metaKey) return null;
  for (const r of KEY_MAP) {
    if (r.code !== e.code) continue;
    if (r.shift !== undefined && r.shift !== !!e.shiftKey) continue;
    return r.act;
  }
  return null;
}

/**
 * Standard-mapping gamepad buttons combat takes over while a mission is live and the aircraft is airborne.
 * The simulator's own uses of these buttons (gear A, speedbrake B, flaps X / Y, trim D-pad up / down) stand down then
 * (src/input asks combat.input.padOwns(i)). On the ground the simulator keeps every button.
 * act 'speedbrake' re-implements the simulator's B toggle on D-pad down so it is not lost in a fight.
 */
export const PAD_MAP = [
  { button: 0, act: 'gun', label: 'A' },
  { button: 1, act: 'flare', label: 'B' },
  { button: 2, act: 'missile', label: 'X' },
  { button: 3, act: 'targetNext', label: 'Y' },
  { button: 11, act: 'targetNearest', label: 'Right stick click' },
  { button: 12, act: 'weaponNext', label: 'D-pad up' },
  { button: 13, act: 'speedbrake', label: 'D-pad down' },
];
export const PAD_OWNED = new Set(PAD_MAP.map(r => r.button));
export function padAction(i) { const r = PAD_MAP.find(x => x.button === i); return r ? r.act : null; }

/** Touch buttons (hold = held while pressed). */
export const TOUCH_BUTTONS = [
  { id: 'missile', label: 'MSL', aria: 'Launch missile' },
  { id: 'flare', label: 'FLR', aria: 'Drop flares' },
  { id: 'targetNext', label: 'TGT', aria: 'Next target' },
  { id: 'gun', label: 'GUN', aria: 'Fire gun (hold)', hold: true },
];

const padLabel = (act) => PAD_MAP.filter(r => r.act === act).map(r => r.label);
const touchLabel = (act) => TOUCH_BUTTONS.find(t => t.id === act)?.label || null;

/** Help-screen rows ({ group, action, keys }) plus the ids / pad / touch names the HUD's first-minute hints use. */
export const COMBAT_BINDINGS = [
  { id: 'gun', group: 'Combat', action: 'Fire gun (hold, airborne)', keys: ['Space', 'Left mouse'], pad: padLabel('gun'), touch: touchLabel('gun') },
  { id: 'missile', group: 'Combat', action: 'Launch missile', keys: ['Enter', 'X'], pad: padLabel('missile'), touch: touchLabel('missile') },
  { id: 'flare', group: 'Combat', action: 'Flares', keys: ['V'], pad: padLabel('flare'), touch: touchLabel('flare') },
  { id: 'targetNext', group: 'Combat', action: 'Next target', keys: ['Tab'], pad: padLabel('targetNext'), touch: touchLabel('targetNext') },
  { id: 'targetPrev', group: 'Combat', action: 'Previous target', keys: ['Shift+Tab'], pad: [], touch: null },
  { id: 'targetNearest', group: 'Combat', action: 'Target nearest the nose', keys: ['Y'], pad: padLabel('targetNearest'), touch: null },
  { id: 'weaponNext', group: 'Combat', action: 'Switch missile type', keys: ['Z'], pad: padLabel('weaponNext'), touch: null },
  { id: 'restart', group: 'Combat', action: 'Restart mission', keys: ['Backspace'], pad: [], touch: null },
];

/** Gamepad rows for the help screen (in combat, airborne). */
export const COMBAT_PAD_BINDINGS = [
  { group: 'Combat gamepad', action: 'Fire gun (hold)', keys: ['A'] },
  { group: 'Combat gamepad', action: 'Launch missile', keys: ['X'] },
  { group: 'Combat gamepad', action: 'Flares', keys: ['B'] },
  { group: 'Combat gamepad', action: 'Next target', keys: ['Y'] },
  { group: 'Combat gamepad', action: 'Target nearest the nose', keys: ['R3'] },
  { group: 'Combat gamepad', action: 'Switch missile type', keys: ['D-pad up'] },
  { group: 'Combat gamepad', action: 'Speedbrake', keys: ['D-pad down'] },
];

/** Without the src/input hook (ctx.input.combatPadHook) combat only takes the free right-stick click. */
export const PAD_FALLBACK_BINDINGS = [
  { group: 'Combat gamepad', action: 'Fire gun (hold)', keys: ['Right stick click'] },
];
