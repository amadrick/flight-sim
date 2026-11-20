import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { keyAction, padAction, padStep, triggerHeld, PAD_MAP, PAD_FREE, PAD_OWNED, COMBAT_BINDINGS, COMBAT_PAD_BINDINGS, PAD_FALLBACK_BINDINGS, TOUCH_BUTTONS } from './map.js';
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
  for (const code of ['Enter', 'KeyX', 'KeyV', 'Tab', 'KeyY', 'KeyZ']) assert.equal(CODE_MAP.has(code), false, code);
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
