// Node has no Web Audio: these tests check that the module imports cleanly (no AudioContext / DOM at top level) and that
// createCombatAudio is a silent no-op without an AudioContext, survives every event, and exposes the settings API.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Events } from '../../core/events.js';
import { createCombatAudio, MIX } from './index.js';
import * as A from './analyze.js';

function fakeCombat(audio) {
  const ev = new Events();
  const player = { isPlayer: true, alive: true, team: 'blue', callsign: 'Viper 1', state: { position: new THREE.Vector3(), velocity: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, lock: { state: 'locked', seeker: 'ir', target: {} }, loadout: { gun: { rounds: 0, max: 500, spin: 1 } }, hp: 50, maxHp: 100, damage: { fire: 1 } };
  return { ev, combat: { ctx: { params: { raw: { music: '0' } }, time: { realDt: 1 / 60 }, audio, events: new Events() }, events: ev, active: true, mission: { id: 'instant-2v2' }, world: { player, aircraft: [player] }, weapons: { missiles: [], specs: { gun: { rof: 100 } } } } };
}

test('silent no-op without an AudioContext; every event and setting is safe', async () => {
  const { ev, combat } = fakeCombat(null);
  const a = await createCombatAudio(combat);
  assert.equal(typeof a.update, 'function');
  for (const n of ['gun:start', 'gun:stop', 'missile:launch', 'flare', 'damage', 'bullet:hit', 'bullet:near', 'missile:hit', 'missile:miss', 'kill', 'wreck:impact', 'collision', 'rwr:lock', 'rwr:launch', 'missile:active', 'weapon:nolock', 'target:change', 'radio', 'mission:start', 'mission:end', 'mission:abort', 'player:down'])
    ev.emit(n, { shooter: combat.world.player, target: combat.world.player, entity: combat.world.player, text: 'Splash one.' });
  for (let i = 0; i < 5; i++) a.update(1 / 60);
  assert.equal(a.musicEnabled, false, 'URL music=0 honoured');
  a.setMusicVolume(0.4); assert.equal(a.musicVolume, 0.4);
  a.musicEnabled = true; assert.equal(a.musicEnabled, true);
  a.setRadioVoice(false); assert.equal(a.radioVoice, false);
  a.setRadioVolume(2); assert.equal(a.radioVolume, 1);
  a.setSfxVolume(-1); assert.equal(a.sfxVolume, 0);
  assert.equal(a.info, null);
  assert.ok(MIX.music < 1 && MIX.duckRadio < 1);
});

test('analysis helpers measure what they claim', () => {
  const sr = A.SR, x = new Float32Array(sr * 2);
  for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / sr);
  assert.ok(Math.abs(A.peakFreq(x, 0, 2) - 1000) < 6);
  assert.ok(A.tonePurity(x, 0, 2).purity > 0.95);
  assert.ok(Math.abs(A.rms(x, 0, 2) - 0.3536) < 0.01);
  const c = new Float32Array(sr * 4); for (let k = 0; k < 4 / 0.5; k++) for (let j = 0; j < 400; j++) c[Math.floor(k * 0.5 * sr) + j] = Math.sin(j * 0.05) * Math.exp(-j / 100);
  assert.ok(Math.abs(A.beatPeriod(c, 0, 4, 0.3, 1.2) - 0.5) < 0.02);
});
