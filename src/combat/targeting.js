// Player target selection (which enemy is designated). CORE (on loan to the controls round). Seeker lock / tone logic
// lives in weapons/.
// Commands (combat.events 'cmd' { name }):
//   targetNext / targetPrev  cycle by angle from the nose: the hostile nearest the nose first, then the next nearest, ...
//                            (a sequence remembers who it visited for CYCLE_RESET s, so a turning fight still steps
//                            through everyone); targetPrev walks that sequence back
//   targetNearest            the hostile closest to the nose
//   targetThreat             the most threatening hostile (mission priority, who is attacking you, range, aspect)
//   targetClear              drop the target (no automatic pick until the next target command or mission start)
// Automatic: picks the most threatening hostile shortly after mission start and RETARGET_DELAY s after the target
// dies (so the kill reads). Never designates friendlies or neutrals unless the mission sets entity.targetable = true;
// entity.targetable = false hides an enemy from selection. Mission-priority targets (director markers of kind 'target'
// with an entity, or entity.priority) are preferred by the automatic pick and by targetThreat.
// Emits 'target:change' { entity, target, how } (how: 'auto' | 'next' | 'prev' | 'nose' | 'threat' | 'clear' | 'killed' | 'set').
import * as THREE from 'three';
import { toBody } from './util.js';

export const RETARGET_DELAY = 1.2;     // s after a kill before the next automatic pick
export const START_DELAY = 0.4;        // s after mission start (spawns settle)
export const CYCLE_RESET = 3;          // s without a Tab press before the cycle starts over from the nose

const _v = new THREE.Vector3();

/** May the player designate e? */
export function isTargetable(p, e) {
  if (!e || e === p || !e.alive || !e.state) return false;
  if (e.kind === 'missile' || e.kind === 'flare' || e.kind === 'bullet') return false;
  if (e.targetable === true) return true;
  if (e.targetable === false) return false;
  return e.team !== p.team && e.team !== 'neutral';
}
/** Angle (rad) between p's nose and the line of sight to e. */
export function noseAngle(p, e) {
  toBody(p.state, e.state.position, _v);
  return Math.atan2(Math.hypot(_v.x, _v.y), -_v.z);
}
/** Mission-priority entities (director markers of kind 'target' with an entity, or entity.priority). */
export function priorityOf(combat) {
  const s = new Set();
  for (const m of combat.director?.markers || []) if (m && m.kind === 'target' && m.entity) s.add(m.entity);
  return s;
}
/** Higher = more urgent. Pure (reads positions, targets and locks). */
export function threatScore(p, e, prio) {
  const d = e.state.position.distanceTo(p.state.position);
  let s = 1 / (1 + d / 4000);                                  // closer first
  if (e.target === p) s += 0.6;                                // it is after you
  const L = e.lock;
  if (L && L.target === p) s += L.state === 'locked' ? 1 : L.state === 'acquiring' ? 0.5 : 0;
  s += 0.4 * (1 - noseAngle(p, e) / Math.PI);                  // in front of you: easier to engage
  if (e.kind === 'aircraft') s += 0.3;
  if ((prio && prio.has(e)) || e.priority) s += 2;
  return s;
}

export function createTargeting(combat) {
  const list = [];
  let autoT = -1, retry = 0, last = null, manualClear = false;
  let seq = [], seqT = -Infinity;

  function candidates(p) {
    list.length = 0;
    for (const e of combat.world.entities) if (isTargetable(p, e)) list.push(e);
    return list;
  }
  function byNose(p) {
    const c = candidates(p).map(e => ({ e, a: noseAngle(p, e) }));
    c.sort((x, y) => x.a - y.a);
    return c.map(x => x.e);
  }
  function threat(p) {
    const prio = priorityOf(combat);
    let best = null, bs = -Infinity;
    for (const e of candidates(p)) { const s = threatScore(p, e, prio); if (s > bs) { bs = s; best = e; } }
    return best;
  }
  function set(p, t, how = 'set') {
    if (t && !isTargetable(p, t)) t = null;
    last = t;
    if (p.target === t) return;
    p.target = t;
    combat.events.emit('target:change', { entity: p, target: t, how });
  }
  const now = () => combat.clock || 0;
  function next(p) {
    const order = byNose(p); if (!order.length) { set(p, null, 'next'); return; }
    if (now() - seqT > CYCLE_RESET) seq = p.target ? [p.target] : [];
    seqT = now();
    let t = order.find(e => !seq.includes(e));
    if (!t) { seq = p.target ? [p.target] : []; t = order.find(e => e !== p.target) || order[0]; }
    seq.push(t);
    set(p, t, 'next');
  }
  function prev(p) {
    const recent = now() - seqT <= CYCLE_RESET;
    seqT = now();
    if (recent && seq.length >= 2) {
      seq.pop();
      while (seq.length && !isTargetable(p, seq[seq.length - 1])) seq.pop();
      if (seq.length) { set(p, seq[seq.length - 1], 'prev'); return; }
    }
    const order = byNose(p); if (!order.length) { set(p, null, 'prev'); return; }
    const i = order.indexOf(p.target);
    const t = order[i < 0 ? order.length - 1 : (i - 1 + order.length) % order.length];
    seq = [t];
    set(p, t, 'prev');
  }

  combat.events.on('cmd', ({ name } = {}) => {
    const p = combat.world.player; if (!p || !p.alive) return;
    if (name === 'targetNext') { manualClear = false; next(p); }
    else if (name === 'targetPrev') { manualClear = false; prev(p); }
    else if (name === 'targetNearest') { manualClear = false; seq = []; set(p, byNose(p)[0] || null, 'nose'); }
    else if (name === 'targetThreat') { manualClear = false; seq = []; set(p, threat(p), 'threat'); }
    else if (name === 'targetClear') { manualClear = true; set(p, null, 'clear'); }
  });
  combat.events.on('mission:start', () => { autoT = START_DELAY; retry = 0; last = null; manualClear = false; seq = []; seqT = -Infinity; });

  return {
    set(t) { const p = combat.world.player; if (p) set(p, t); },
    /** the target order Tab walks right now (nearest the nose first) — HUD / tests */
    order() { const p = combat.world.player; return p ? byNose(p) : []; },
    threat() { const p = combat.world.player; return p ? threat(p) : null; },
    update(dt) {
      const p = combat.world.player; if (!p || !p.alive) return;
      // the target died (core's kill() clears entity.target first, so watch the last one we set)
      if ((p.target && !isTargetable(p, p.target)) || (!p.target && last && !last.alive)) {
        set(p, null, 'killed'); last = null; autoT = RETARGET_DELAY;
      }
      if (p.target || manualClear) return;
      if (autoT > 0) { autoT -= dt; if (autoT > 0) return; }
      if ((retry -= dt) > 0) return;
      const t = threat(p);
      if (t) { set(p, t, 'auto'); autoT = -1; } else retry = 0.5;
    },
  };
}
