// Player target selection (which enemy is designated). CORE. Seeker lock / tone logic lives in weapons/.
// Commands (combat.events 'cmd' { name }): targetNext, targetPrev, targetNearest (closest to the nose), targetClear.
import * as THREE from 'three';
import { toBody } from './util.js';

export function createTargeting(combat) {
  const list = [], v = new THREE.Vector3();
  let auto = 0;
  function candidates(p) {
    combat.world.enemiesOf(p, list, null);
    // missiles and flares are not designatable
    for (let i = list.length - 1; i >= 0; i--) if (list[i].kind === 'missile' || list[i].kind === 'flare') list.splice(i, 1);
    list.sort((a, b) => a.state.position.distanceToSquared(p.state.position) - b.state.position.distanceToSquared(p.state.position));
    return list;
  }
  function boresight(p) {
    let best = null, ba = Infinity;
    for (const e of candidates(p)) {
      toBody(p.state, e.state.position, v);
      const a = Math.atan2(Math.hypot(v.x, v.y), -v.z);
      if (a < ba) { ba = a; best = e; }
    }
    return best;
  }
  function set(p, t) {
    if (p.target === t) return;
    p.target = t;
    combat.events.emit('target:change', { entity: p, target: t });
  }
  function cycle(dir) {
    const p = combat.world.player; if (!p || !p.alive) return;
    const c = candidates(p); if (!c.length) { set(p, null); return; }
    const i = c.indexOf(p.target);
    set(p, c[(i + dir + c.length) % c.length] || c[0]);
  }
  combat.events.on('cmd', ({ name } = {}) => {
    const p = combat.world.player; if (!p || !p.alive) return;
    if (name === 'targetNext') cycle(1);
    else if (name === 'targetPrev') cycle(-1);
    else if (name === 'targetNearest') set(p, boresight(p));
    else if (name === 'targetClear') set(p, null);
  });
  return {
    set(t) { const p = combat.world.player; if (p) set(p, t); },
    /** keep a target designated: when it dies or none is set, pick the enemy closest to the nose (every 0.5 s) */
    update(dt) {
      const p = combat.world.player; if (!p || !p.alive) return;
      if (p.target && !p.target.alive) set(p, null);
      if (!p.target && (auto -= dt) <= 0) { auto = 0.5; const t = boresight(p); if (t) set(p, t); }
    },
  };
}
