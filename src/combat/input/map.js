// Combat control map — single source of truth for keys, gamepad buttons and touch buttons (no DOM; unit-tested).
// Commands are combat.events 'cmd' names (COMBAT.md §5); 'gun' is the held trigger (combat.input.trigger).

/**
 * KeyboardEvent.code → action. shift: only with / without Shift (undefined = either).
 * Two-hand layout, collision-free with the simulator's keys (src/input/bindings.js uses W A S D, arrows, Q E , . / T
 * R F = - PgUp PgDn 1 9 0 I G [ ] B Space K H L N J C (Shift+C) M U P Backspace Esc):
 *   right hand: arrows or the mouse fly (mouse aim in Assisted), Enter missile
 *   left hand:  Space gun (thumb), Shift boost (pinky, hold), Tab target (hold = most dangerous), X missile, V flares,
 *               Z missile type; O target view, Y target nearest the nose, ; missile camera.
 * Shift is free in the simulator except as the Shift+C modifier (camera previous): while boosting, C steps back.
 */
export const KEY_MAP = [
  { code: 'Space', act: 'gun' },                       // airborne only: on the ground Space stays the wheel brake
  { code: 'ShiftLeft', act: 'boost' }, { code: 'ShiftRight', act: 'boost' },   // hold: full throttle (afterburner), released = back to the lever
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

/** Seconds Tab must be held to pick the most dangerous hostile instead of cycling. Touch TGT: a double tap. */
export const TAB_HOLD = 0.4;
export const DOUBLE_TAP = 0.35;
/** Seconds O / VIEW must be held to peek at the target (while held) instead of toggling padlock. */
export const PEEK_HOLD = 0.3;
/** Flare programme: one press = this many releases (each a weapons salvo) spaced so the dispenser cooldown allows them. */
export const FLARE_PROGRAM = { releases: 3, interval: 0.45 };

/**
 * Pick the missile for the shot (pure). o = { mode: 'auto'|'ir'|'radar', selected, hasTarget,
 *   ir / radar: { rounds, locked (selected seeker holds a lock), see (seeker could see the target now), off (rad),
 *   fov (rad), range (m), rMin, rMax } }.
 * Auto: IR inside its envelope, else radar. A forced mode (Z) only tries that type.
 * Returns { type, reason }: type = what to fire (null = hold fire), reason when held:
 * 'no target' | 'no missiles' | 'off boresight' | 'out of range' | 'too close' | 'locking' | 'no lock'.
 */
export function missileShot(o) {
  const types = o.mode === 'ir' || o.mode === 'radar' ? [o.mode] : ['ir', 'radar'];
  const has = (t) => (o[t]?.rounds || 0) > 0;
  if (!types.some(has)) return { type: null, reason: 'no missiles' };
  if (!o.hasTarget) return { type: null, reason: 'no target' };
  const shootable = (t) => {
    const i = o[t]; if (!has(t)) return false;
    if (!(i.range >= i.rMin && i.range <= i.rMax)) return false;
    return t === o.selected ? !!i.locked : !!i.see;
  };
  for (const t of types) if (shootable(t)) return { type: t, reason: '' };
  // why not: judged on the type the shot would want
  const pref = types.length === 1 ? types[0] : (has('ir') && o.ir.range <= o.ir.rMax ? 'ir' : has('radar') ? 'radar' : 'ir');
  const i = o[pref];
  if (!has(pref)) return { type: null, reason: 'no missiles' };
  if (i.off > i.fov) return { type: null, reason: 'off boresight' };
  if (i.range > i.rMax) return { type: null, reason: 'out of range' };
  if (i.range < i.rMin) return { type: null, reason: 'too close' };
  return { type: null, reason: i.see ? 'locking' : 'no lock' };   // seeker sees it: the lock is building
}
/** HUD text for a held missile shot. */
export const NOLOCK_TEXT = { 'no target': 'NO TARGET', 'no missiles': 'NO MISSILES', 'off boresight': 'NOSE ON TARGET', 'out of range': 'OUT OF RANGE', 'too close': 'TOO CLOSE', locking: 'LOCKING', 'no lock': 'NO LOCK' };

/** Missile type selection cycled by Z / switchMissile(): Auto → IR → radar → Auto, skipping empty rails. */
export function nextMissileMode(mode, rounds) {
  const order = ['auto', 'ir', 'radar'].filter(m => m === 'auto' || (rounds?.[m] || 0) > 0);
  const i = order.indexOf(mode);
  return order[(i + 1) % order.length];
}

/**
 * Pointer aim (pure). Absolute: the pointer's offset from the centre of `rect` in units of AIM_RADIUS × the short side,
 * +x right, +y up, clamped to the unit circle. Locked: accumulate movement deltas into `aim`.
 */
export const AIM_RADIUS = 0.4;
export const AIM_DEAD = 0.03;
export function aimFromPointer(px, py, rect, out = { x: 0, y: 0 }) {
  const R = AIM_RADIUS * Math.max(1, Math.min(rect.width, rect.height));
  out.x = (px - (rect.left + rect.width / 2)) / R; out.y = -(py - (rect.top + rect.height / 2)) / R;
  return clampAim(out);
}
export function accumulateAim(aim, dx, dy, rect) {
  const R = AIM_RADIUS * Math.max(1, Math.min(rect.width, rect.height));
  aim.x += dx / R; aim.y -= dy / R;
  return clampAim(aim);
}
export function clampAim(a) { const m = Math.hypot(a.x, a.y); if (m > 1) { a.x /= m; a.y /= m; } if (Math.abs(a.x) < AIM_DEAD && Math.abs(a.y) < AIM_DEAD) { a.x = 0; a.y = 0; } return a; }

/** Haptics (ms for navigator.vibrate; gamepad dual-rumble magnitudes 0..1). */
export const HAPTICS = {
  gunPulse: 14, gunEvery: 0.11,                       // short buzz every gunEvery s while the gun fires
  hit: [70], hitHeavy: [110, 50, 80],                 // hit taken (heavy: >= 15 hp)
  padGun: { duration: 60, strongMagnitude: 0.15, weakMagnitude: 0.45 },
  padHit: { duration: 220, strongMagnitude: 0.9, weakMagnitude: 0.5 },
};

/** Touch buttons (hold = held while pressed). Layout areas in input/index.js. */
export const TOUCH_BUTTONS = [
  { id: 'padlock', label: 'VIEW', aria: 'Padlock view: keep the target in sight', area: 'view' },
  { id: 'targetNext', label: 'TGT', aria: 'Next target', area: 'tgt' },
  { id: 'flare', label: 'FLR', aria: 'Drop flares', area: 'flr' },
  { id: 'missile', label: 'MSL', aria: 'Launch missile', area: 'msl' },
  { id: 'gun', label: 'GUN', aria: 'Fire gun (hold)', hold: true, area: 'gun' },
];

const ACT_LABEL = { gun: 'Fire gun (hold)', missile: 'Launch missile (best for the shot)', flare: 'Flares', targetNext: 'Next target', targetNearest: 'Target nearest the nose', weaponNext: 'Switch missile type', padlock: 'Padlock view on / off' };
const padLabel = (act) => PAD_FREE.filter(r => r.act === act).map(r => r.label);
const touchLabel = (act) => TOUCH_BUTTONS.find(t => t.id === act)?.label || null;

/** Help-screen rows ({ group, action, keys }) plus the ids / pad / touch names the HUD's first-minute hints use. */
export const COMBAT_BINDINGS = [
  { id: 'gun', group: 'Combat', action: 'Fire gun (hold, airborne)', keys: ['Space', 'Left mouse'], pad: padLabel('gun'), touch: touchLabel('gun') },
  { id: 'missile', group: 'Combat', action: 'Missile: fires the best one for the shot', keys: ['X', 'Enter', 'Right mouse click'], pad: padLabel('missile'), touch: touchLabel('missile') },
  { id: 'flare', group: 'Combat', action: 'Flares (a short programme)', keys: ['V'], pad: padLabel('flare'), touch: touchLabel('flare') },
  { id: 'targetNext', group: 'Combat', action: 'Next target, nearest the nose first', keys: ['Tab', 'Mouse wheel (mouse aim)'], pad: padLabel('targetNext'), touch: touchLabel('targetNext') },
  { id: 'targetThreat', group: 'Combat', action: 'Most dangerous target', keys: ['Hold Tab'], pad: [], touch: touchLabel('targetNext') ? 'Double-tap ' + touchLabel('targetNext') : null },
  { id: 'targetPrev', group: 'Combat', action: 'Previous target', keys: ['Shift+Tab'], pad: [], touch: null },
  { id: 'targetNearest', group: 'Combat', action: 'Target nearest the nose', keys: ['Y', 'Middle mouse'], pad: padLabel('targetNearest'), touch: null },
  { id: 'weaponNext', group: 'Combat', action: 'Missile type: Auto / IR / radar', keys: ['Z'], pad: padLabel('weaponNext'), touch: null },
  { id: 'boost', group: 'Combat', action: 'Boost: full afterburner while held', keys: ['Shift'], pad: [], touch: null },
  { id: 'padlock', group: 'Combat', action: 'Target view: tap = padlock on / off, hold = peek', keys: ['O'], pad: padLabel('padlock'), touch: touchLabel('padlock') },
  { id: 'missileCam', group: 'Combat', action: 'Missile camera on / off', keys: [';'], pad: [], touch: null },
  { id: 'mouseAim', group: 'Combat', action: 'Mouse aim (Assisted): steer with the mouse; click to lock the pointer, Esc frees it', keys: ['Mouse'], pad: [], touch: null },
  { id: 'restart', group: 'Combat', action: 'Restart mission', keys: ['Backspace'], pad: [], touch: null },
];

/** First-minute hint card rows for the combat HUD ({ keys, text, cmd }, cmd = the 'cmd' name that ticks it off). */
export const HUD_HINTS = [
  { keys: ['Space'], text: 'Guns (hold)', cmd: 'gun' },
  { keys: ['X'], text: 'Missile (best for the shot)', cmd: 'missile' },
  { keys: ['V'], text: 'Flares', cmd: 'flare' },
  { keys: ['Tab'], text: 'Next target (hold: most dangerous)', cmd: 'targetNext' },
  { keys: ['Shift'], text: 'Boost (hold)', cmd: 'boost' },
  { keys: ['O'], text: 'Target view', cmd: 'padlock' },
];

/** Gamepad rows for the help screen: full layout (with the src/input hook) and the default free-button layout. */
export const COMBAT_PAD_BINDINGS = PAD_MAP.map(r => ({ group: 'Combat gamepad', action: ACT_LABEL[r.act], keys: [r.label] }));
export const PAD_FALLBACK_BINDINGS = PAD_FREE.map(r => ({ group: 'Combat gamepad', action: ACT_LABEL[r.act], keys: [r.label] }));
