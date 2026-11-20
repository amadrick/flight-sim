// Scoring, rating and medals. The stats object is shared with the weapons module (it increments shots, hits, missiles,
// missileHits, damageDealt, damageTaken on world.player.stats). The director keeps its own counts of the event-derived
// numbers too and takes the larger one at the end, so the debrief is right with or without that support.

const KILL_POINTS = { fighter: 100, attack: 100, recon: 150, bomber: 160, transport: 120, airliner: 100 };
const DIFF_MULT = { rookie: 0.75, veteran: 1, ace: 1.5 };

export function newStats() {
  return {
    kills: 0, assists: 0, losses: 0, shots: 0, hits: 0, missiles: 0, missileHits: 0, damageDealt: 0, damageTaken: 0,
    gunKills: 0, missileKills: 0, friendlyFire: 0, objectives: 0, objectivesFailed: 0, time: 0,
    score: 0, rating: null, breakdown: [], medals: [], outcome: null,
  };
}

export function createScoring(combat) {
  const ev = combat.events;
  const buckets = new Map();          // label -> { label, points, count }
  const own = { missileHits: 0, damageDealt: 0, damageTaken: 0 };
  const sc = {
    stats: newStats(),
    medals: [],
    par: 1000,
    reset() {
      sc.stats = newStats(); buckets.clear(); sc.medals = [];
      own.missileHits = 0; own.damageDealt = 0; own.damageTaken = 0;
      return sc.stats;
    },
    /** Add points now (shown in the HUD feed) under a breakdown label. */
    add(points, label, reason = label) {
      points = Math.round(points);
      if (!points || !Number.isFinite(points)) return;
      const s = sc.stats;
      s.score += points;
      let b = buckets.get(label); if (!b) buckets.set(label, b = { label, points: 0, count: 0 });
      b.points += points; b.count++;
      ev.emit('score', { points, reason, total: s.score });
    },
    medal(id, title, text) { if (!sc.medals.some((m) => m.id === id)) sc.medals.push({ id, title, text }); },
    killValue(victim, weapon) {
      const base = victim.tags?.points ?? KILL_POINTS[victim.def?.category] ?? 100;
      return weapon === 'gun' ? Math.round(base * 1.5) : base;
    },
    onDamage(target, amount, source) {
      const p = combat.world.player; if (!p) return;
      if (target === p) own.damageTaken += amount;
      else if (source === p && target.team !== p.team) own.damageDealt += amount;
    },
    onMissileHit(missile, target) { if (missile?.owner && missile.owner === combat.world.player && target?.kind === 'aircraft') own.missileHits++; },
    /**
     * Close the books. info: { outcome, time, parTime, wingmenAlive, wingmenTotal, protectedOk, optionalDone, optionalTotal }
     */
    finalize(info) {
      const s = sc.stats;
      s.missileHits = Math.max(s.missileHits || 0, own.missileHits);
      s.damageDealt = Math.round(Math.max(s.damageDealt || 0, own.damageDealt));
      s.damageTaken = Math.round(Math.max(s.damageTaken || 0, own.damageTaken));
      s.time = Math.round(info.time);
      s.outcome = info.outcome;
      const win = info.outcome === 'success';
      if (win && !info.noTimeBonus) {
        const f = Math.max(0, Math.min(1, (info.parTime - info.time) / info.parTime));
        if (f > 0) sc.add(300 * f, 'Time bonus');
      }
      if (s.shots >= 60) sc.add(Math.min(250, 500 * s.hits / s.shots), 'Gun accuracy', `Gun accuracy ${Math.round(100 * s.hits / s.shots)}%`);
      if (s.missiles >= 1 && s.missileHits > 0) sc.add(150 * Math.min(1, s.missileHits / s.missiles), 'Missile accuracy');
      if (win && info.wingmenAlive > 0) sc.add(75 * info.wingmenAlive, 'Wingmen home', `${info.wingmenAlive} wingm${info.wingmenAlive > 1 ? 'en' : 'an'} home`);
      if (win && s.damageTaken === 0 && !info.noDamageBonus) sc.add(250, 'No damage taken');
      const mult = DIFF_MULT[combat.difficulty] ?? 1;
      if (mult !== 1 && s.score > 0) sc.add(s.score * (mult - 1), `Difficulty (${combat.difficulty} ×${mult})`);
      if (s.score < 0 && !win) s.score = Math.max(s.score, -2000);
      s.breakdown = [...buckets.values()].map((b) => ({ label: b.count > 1 && /kill|assist|objective/i.test(b.label) ? `${b.label} ×${b.count}` : b.label, points: b.points }));
      // rating against the mission's par score
      const ratio = s.score / Math.max(200, sc.par * mult);
      let r = ratio >= 1 ? 'S' : ratio >= 0.75 ? 'A' : ratio >= 0.5 ? 'B' : ratio >= 0.3 ? 'C' : 'D';
      if (!win && (r === 'S' || r === 'A' || r === 'B')) r = 'C';
      s.rating = r;
      // medals
      if (win && s.damageTaken === 0) sc.medal('untouchable', 'Untouchable', 'Mission complete without a scratch on the paint.');
      if (s.gunKills >= 2) sc.medal('gunfighter', 'Gunfighter', 'Two or more kills with the cannon in one sortie.');
      if (s.kills >= 5) sc.medal('ace-in-a-day', 'Ace in a Day', 'Five or more kills in a single mission.');
      if (s.shots >= 150 && s.hits / s.shots >= 0.3) sc.medal('sharpshooter', 'Sharpshooter', 'Gun accuracy of 30% or better over 150+ rounds.');
      if (s.missiles >= 2 && s.missileHits >= s.missiles) sc.medal('every-shot', 'Every Shot Counts', 'Every missile you fired found its target.');
      if (win && info.wingmenTotal > 0 && info.wingmenAlive === info.wingmenTotal && info.protectedOk !== false) sc.medal('shepherd', 'Shepherd', 'Everyone on your side came home.');
      if (win && info.time < info.parTime * 0.5) sc.medal('quick-draw', 'Quick Draw', 'Finished in under half the expected time.');
      if (win && info.optionalTotal > 0 && info.optionalDone === info.optionalTotal) sc.medal('thorough', 'Above and Beyond', 'Every optional objective completed.');
      if (win && combat.difficulty === 'ace') sc.medal('ace-difficulty', 'Hard Way', 'Completed on ace difficulty.');
      s.medals = sc.medals.slice();
      return s;
    },
    KILL_POINTS,
  };
  return sc;
}
