import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyAction, padAction, padStep, triggerHeld, PAD_MAP, PAD_FREE, PAD_OWNED, COMBAT_BINDINGS, COMBAT_PAD_BINDINGS, PAD_FALLBACK_BINDINGS, TOUCH_BUTTONS,
  missileShot, nextMissileMode, aimFromPointer, accumulateAim, HUD_HINTS, KEY_MAP, FLARE_PROGRAM, NOLOCK_TEXT } from './map.js';
import { COMBAT_BINDINGS as FROM_INDEX } from './index.js';

test('keys map to COMBAT.md §9 commands', () => {
  assert.equal(keyAction({ code: 'Space' }), 'gun');
  assert.equal(keyAction({ code: 'Enter' }), 'missile');
  assert.equal(keyAction({ code: 'KeyX' }), 'missile');
  assert.equal(keyAction({ code: 'KeyV' }), 'flare');
  assert.equal(keyAction({ code: 'Tab' }), 'targetNext');
  assert.equal(keyAction({ code: 'Tab', shiftKey: true }), 'targetPrev');
  assert.equal(keyAction({ code: 'KeyY' }), 'targetNearest');
  assert.equal(keyAction({ code: 'KeyZ' }), 'weaponNext');
  assert.equal(keyAction({ code: 'KeyG' }), null);
  assert.equal(keyAction(null), null);
});

test('never Ctrl / Alt / Meta combinations', () => {
  for (const m of ['ctrlKey', 'altKey', 'metaKey']) for (const code of ['Space', 'Enter', 'KeyX', 'KeyV', 'Tab', 'KeyY', 'KeyZ']) assert.equal(keyAction({ code, [m]: true }), null);
});

test('combat keys do not collide with the simulator key table', async () => {
  const { CODE_MAP } = await import('../../input/bindings.js');
  for (const r of KEY_MAP) if (r.code !== 'Space') assert.equal(CODE_MAP.has(r.code), false, r.code);
  assert.ok(CODE_MAP.has('Space'));   // shared on purpose: wheel brake on the ground, gun in the air
});

test('gamepad: default buttons are ones the simulator input does not map (no double fire)', () => {
  const src = readFileSync(new URL('../../input/index.js', import.meta.url), 'utf8');
  const std = src.slice(src.indexOf('if (std) {'), src.indexOf('} else {', src.indexOf('if (press(0)')));
  const used = new Set([...std.matchAll(/(?:press|b)\((\d+)\)|bt\[(\d+)\]/g)].map(m => +(m[1] ?? m[2])));
  for (const r of PAD_FREE) assert.equal(used.has(r.button), false, `button ${r.button} is mapped by src/input`);
  assert.ok(used.has(0) && used.has(7));   // sanity: the scan sees the simulator's map
});

test('gamepad: full map and trigger dead zone', () => {
  assert.equal(padAction(7), 'gun'); assert.equal(padAction(5), 'missile'); assert.equal(padAction(1), 'flare');
  assert.equal(padAction(2), 'targetNext'); assert.equal(padAction(3), 'targetNearest'); assert.equal(padAction(4), 'weaponNext');
  assert.equal(padAction(11), 'padlock'); assert.equal(padAction(9), null);
  assert.ok(!PAD_OWNED.has(9) && !PAD_OWNED.has(6));          // Start (menu) and LT stay with the simulator
  assert.equal(triggerHeld(0.3, false), false); assert.equal(triggerHeld(0.4, false), true);
  assert.equal(triggerHeld(0.25, true), true); assert.equal(triggerHeld(0.1, true), false);
});

test('gamepad: padStep edges, holds, triggers and stand-down', () => {
  const B = (o) => { const a = []; for (let i = 0; i < 17; i++) a.push({ pressed: false, value: 0 }); for (const k in o) a[k] = o[k]; return a; };
  const prev = [];
  let r = padStep(B({ 5: { pressed: true, value: 1 }, 7: { pressed: true, value: 0.8 } }), prev, PAD_MAP, true);
  assert.deepEqual(r, { gun: true, cmds: ['missile'] });
  r = padStep(B({ 5: { pressed: true, value: 1 } }), prev, PAD_MAP, true);
  assert.deepEqual(r, { gun: false, cmds: [] });               // held RB: no repeat
  r = padStep(B({ 2: { pressed: true, value: 1 } }), prev, PAD_MAP, false);
  assert.deepEqual(r, { gun: false, cmds: [] });               // not live: nothing, but the edge is consumed
  r = padStep(B({ 2: { pressed: true, value: 1 } }), prev, PAD_MAP, true);
  assert.deepEqual(r.cmds, []);
  const p2 = [];
  r = padStep(B({ 11: { pressed: true, value: 1 }, 16: { pressed: true, value: 1 } }), p2, PAD_FREE, true);
  assert.deepEqual(r, { gun: true, cmds: ['padlock'] });
  assert.equal(PAD_FALLBACK_BINDINGS.length, PAD_FREE.length);
  assert.equal(COMBAT_PAD_BINDINGS.length, PAD_MAP.length);
});

test('bindings list every action for the help screen', () => {
  assert.equal(FROM_INDEX, COMBAT_BINDINGS);
  const ids = COMBAT_BINDINGS.map(b => b.id);
  for (const id of ['gun', 'missile', 'flare', 'targetNext', 'targetPrev', 'targetNearest', 'weaponNext', 'padlock']) assert.ok(ids.includes(id), id);
  for (const b of [...COMBAT_BINDINGS, ...COMBAT_PAD_BINDINGS]) { assert.ok(b.group && b.action); assert.ok(Array.isArray(b.keys) && b.keys.length); }
  assert.deepEqual(TOUCH_BUTTONS.map(t => t.label).sort(), ['FLR', 'GUN', 'MSL', 'TGT', 'VIEW']);
});

test('two-hand layout: Shift boost, Tab, X / Enter missile, V flares, O view', () => {
  assert.equal(keyAction({ code: 'ShiftLeft', shiftKey: true }), 'boost');
  assert.equal(keyAction({ code: 'ShiftRight', shiftKey: true }), 'boost');
  assert.equal(keyAction({ code: 'KeyO' }), 'padlock');
  assert.equal(keyAction({ code: 'KeyF' }), null);              // F is the simulator's throttle down
  for (const h of HUD_HINTS) assert.ok(h.keys.length && h.text && h.cmd);
  assert.ok(FLARE_PROGRAM.releases === 3 && FLARE_PROGRAM.interval * (FLARE_PROGRAM.releases - 1) <= 1.0);
});

const T = (o) => ({ rounds: 2, locked: false, see: false, off: 0.05, fov: 0.5, range: 3000, rMin: 400, rMax: 8000, ...o });
test('missile: best type for the shot', () => {
  // IR locked inside its envelope
  assert.deepEqual(missileShot({ mode: 'auto', selected: 'ir', hasTarget: true, ir: T({ locked: true, see: true }), radar: T({ see: true, rMax: 30000 }) }), { type: 'ir', reason: '' });
  // beyond IR range: radar (not selected, but its seeker sees the target)
  const far = { range: 20000 };
  assert.equal(missileShot({ mode: 'auto', selected: 'ir', hasTarget: true, ir: T({ ...far }), radar: T({ ...far, see: true, rMax: 30000 }) }).type, 'radar');
  // forced IR (Z) at long range: held, out of range
  assert.deepEqual(missileShot({ mode: 'ir', selected: 'ir', hasTarget: true, ir: T({ ...far }), radar: T({ ...far, see: true, rMax: 30000 }) }), { type: null, reason: 'out of range' });
});
test('missile: specific reasons when it holds fire', () => {
  const base = { mode: 'auto', selected: 'ir' };
  assert.equal(missileShot({ ...base, hasTarget: false, ir: T(), radar: T() }).reason, 'no target');
  assert.equal(missileShot({ ...base, hasTarget: true, ir: T({ rounds: 0 }), radar: T({ rounds: 0 }) }).reason, 'no missiles');
  assert.equal(missileShot({ ...base, hasTarget: true, ir: T({ off: 1.2 }), radar: T({ rounds: 0 }) }).reason, 'off boresight');
  assert.equal(missileShot({ ...base, hasTarget: true, ir: T({ range: 200, see: true, locked: true }), radar: T({ rounds: 0 }) }).reason, 'too close');
  assert.equal(missileShot({ ...base, hasTarget: true, ir: T({ see: true }), radar: T({ rounds: 0 }) }).reason, 'locking');
  assert.equal(missileShot({ ...base, hasTarget: true, ir: T({ range: 9000 }), radar: T({ rounds: 0 }) }).reason, 'out of range');
  for (const r of ['no target', 'no missiles', 'off boresight', 'out of range', 'too close', 'locking', 'no lock']) assert.ok(NOLOCK_TEXT[r]);
});
test('missile type cycle: Auto, IR, radar, skipping empty rails', () => {
  assert.equal(nextMissileMode('auto', { ir: 2, radar: 2 }), 'ir');
  assert.equal(nextMissileMode('ir', { ir: 2, radar: 2 }), 'radar');
  assert.equal(nextMissileMode('radar', { ir: 2, radar: 2 }), 'auto');
  assert.equal(nextMissileMode('auto', { ir: 0, radar: 2 }), 'radar');
  assert.equal(nextMissileMode('auto', { ir: 0, radar: 0 }), 'auto');
});
test('pointer aim: centre offset, +y up, clamped; locked accumulation', () => {
  const rect = { left: 0, top: 0, width: 1000, height: 500 };   // R = 0.4 * 500 = 200
  let a = aimFromPointer(600, 150, rect);
  assert.ok(Math.abs(a.x - 0.5) < 1e-9 && Math.abs(a.y - 0.5) < 1e-9);
  a = aimFromPointer(1000, 250, rect); assert.ok(Math.abs(a.x - 1) < 1e-9 && a.y === 0);
  a = aimFromPointer(503, 251, rect); assert.deepEqual([a.x, a.y], [0, 0]);   // dead zone
  const m = { x: 0, y: 0 };
  accumulateAim(m, 100, -100, rect); assert.ok(Math.abs(m.x - 0.5) < 1e-9 && Math.abs(m.y - 0.5) < 1e-9);
  accumulateAim(m, 5000, 0, rect); assert.ok(Math.abs(Math.hypot(m.x, m.y) - 1) < 1e-9);
});
