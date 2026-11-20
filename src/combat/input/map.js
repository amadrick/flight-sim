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
  { code: 'KeyO', act: 'padlock' },                    // combat cameras (src/combat/camera): padlock view on / off
  { code: 'Semicolon', act: 'missileCam' },            // missile camera on / off
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
 * Gamepad (standard mapping), read by combat itself during a mission.
 * The simulator's input (src/input, not ours) already maps every standard button except the right stick click (11):
 * A gear, B speedbrake, X / Y flaps, LB / RB rudder (analog), LT / RT throttle (analog rate), Back camera, Start menu,
 * L3 wheel brakes, D-pad trim / camera. So by default combat takes only buttons nothing else uses:
 *   PAD_FREE: R3 = gun (hold), Home / guide (16, where the browser exposes it) = padlock view.
 * PAD_MAP is the full combat layout. It is used only when the simulator's input advertises that it stands down for
 * combat (ctx.input.combatPadHook, patch described in src/combat/ui/INTEGRATION.md): RT gun, RB missile, B flares,
 * X next target, Y nearest target, LB switch missile, R3 padlock — airborne in a live mission only.
 * kind 'trigger' = analog button read with a dead zone and hysteresis; 'hold' = held; otherwise an edge-triggered command.
 */
export const PAD_FREE = [
  { button: 11, act: 'gun', kind: 'hold', label: 'Right stick click' },
  { button: 16, act: 'padlock', label: 'Home' },
];
export const PAD_MAP = [
  { button: 7, act: 'gun', kind: 'trigger', label: 'RT' },
  { button: 5, act: 'missile', label: 'RB' },
  { button: 1, act: 'flare', label: 'B' },
  { button: 2, act: 'targetNext', label: 'X' },
  { button: 3, act: 'targetNearest', label: 'Y' },
  { button: 4, act: 'weaponNext', label: 'LB' },
  { button: 11, act: 'padlock', label: 'Right stick click' },
];
export const PAD_OWNED = new Set(PAD_MAP.map(r => r.button));
export const TRIGGER_ON = 0.35, TRIGGER_OFF = 0.2;
/** Trigger with hysteresis: was held → stays held until below OFF; idle → held above ON. */
export function triggerHeld(value, wasHeld) { const v = Number(value) || 0; return wasHeld ? v > TRIGGER_OFF : v > TRIGGER_ON; }
/**
 * One poll step, pure: buttons [{ pressed, value }], prev [] (edge memory, mutated), map rows, ok (live + airborne).
 * Returns { gun: bool, cmds: [names] }.
 */
export function padStep(buttons, prev, map, ok, gunWas = false) {
  const out = { gun: false, cmds: [] };
  for (const r of map) {
    const b = buttons[r.button];
    if (r.kind === 'trigger') { const held = ok && triggerHeld(b ? (b.value ?? (b.pressed ? 1 : 0)) : 0, gunWas); if (held) out.gun = true; continue; }
    const p = !!b?.pressed;
    if (r.kind === 'hold') { if (ok && p) out.gun = true; continue; }
    const was = !!prev[r.button]; prev[r.button] = p;
    if (ok && p && !was) out.cmds.push(r.act);
  }
  return out;
}
export function padAction(i, map = PAD_MAP) { const r = map.find(x => x.button === i); return r ? r.act : null; }

/** Touch buttons (hold = held while pressed). Layout areas in input/index.js. */
export const TOUCH_BUTTONS = [
  { id: 'padlock', label: 'VIEW', aria: 'Padlock view: keep the target in sight', area: 'view' },
  { id: 'targetNext', label: 'TGT', aria: 'Next target', area: 'tgt' },
  { id: 'flare', label: 'FLR', aria: 'Drop flares', area: 'flr' },
  { id: 'missile', label: 'MSL', aria: 'Launch missile', area: 'msl' },
  { id: 'gun', label: 'GUN', aria: 'Fire gun (hold)', hold: true, area: 'gun' },
];

const ACT_LABEL = { gun: 'Fire gun (hold)', missile: 'Launch missile', flare: 'Flares', targetNext: 'Next target', targetNearest: 'Target nearest the nose', weaponNext: 'Switch missile type', padlock: 'Padlock view on / off' };
const padLabel = (act) => PAD_FREE.filter(r => r.act === act).map(r => r.label);
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
  { id: 'padlock', group: 'Combat', action: 'Padlock view (keep the target in sight) on / off', keys: ['O'], pad: padLabel('padlock'), touch: touchLabel('padlock') },
  { id: 'missileCam', group: 'Combat', action: 'Missile camera on / off', keys: [';'], pad: [], touch: null },
  { id: 'restart', group: 'Combat', action: 'Restart mission', keys: ['Backspace'], pad: [], touch: null },
];

/** Gamepad rows for the help screen: full layout (with the src/input hook) and the default free-button layout. */
export const COMBAT_PAD_BINDINGS = PAD_MAP.map(r => ({ group: 'Combat gamepad', action: ACT_LABEL[r.act], keys: [r.label] }));
export const PAD_FALLBACK_BINDINGS = PAD_FREE.map(r => ({ group: 'Combat gamepad', action: ACT_LABEL[r.act], keys: [r.label] }));
