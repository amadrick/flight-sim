import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyAction, padAction, PAD_OWNED, COMBAT_BINDINGS, COMBAT_PAD_BINDINGS, TOUCH_BUTTONS } from './map.js';
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

test('gamepad map', () => {
  assert.equal(padAction(0), 'gun'); assert.equal(padAction(2), 'missile'); assert.equal(padAction(1), 'flare');
  assert.equal(padAction(3), 'targetNext'); assert.equal(padAction(11), 'targetNearest'); assert.equal(padAction(12), 'weaponNext');
  assert.equal(padAction(9), null); assert.equal(padAction(6), null); assert.equal(padAction(7), null);   // menu + throttle stay
  assert.ok(!PAD_OWNED.has(4) && !PAD_OWNED.has(5) && !PAD_OWNED.has(10) && !PAD_OWNED.has(14) && !PAD_OWNED.has(15));
});

test('bindings list every action for the help screen', () => {
  assert.equal(FROM_INDEX, COMBAT_BINDINGS);
  const ids = COMBAT_BINDINGS.map(b => b.id);
  for (const id of ['gun', 'missile', 'flare', 'targetNext', 'targetPrev', 'targetNearest', 'weaponNext']) assert.ok(ids.includes(id), id);
  for (const b of [...COMBAT_BINDINGS, ...COMBAT_PAD_BINDINGS]) { assert.ok(b.group && b.action); assert.ok(Array.isArray(b.keys) && b.keys.length); }
  assert.deepEqual(TOUCH_BUTTONS.map(t => t.label).sort(), ['FLR', 'GUN', 'MSL', 'TGT']);
});
