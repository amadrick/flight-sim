// Game state -> music mood, with hysteresis so the score does not flap. Pure (node-tested).
//   off      no mission
//   calm     patrol, no enemy within 25 km
//   tension  enemies closing (inside 25 km) but no fight yet
//   fight    an enemy within 6 km, weapons fired in the last 8 s, or anybody locked up (held 20 s after it stops)
//   hero     fighting and winning: the player scored a kill in the last 25 s, or the friendly side outnumbers the
//            enemy 2:1 with the player healthy (held at least 16 s so the chorus can land)
//   danger   a missile guides on the player, or the player is below 35 % health (held 5 s after it clears)
//   victory / defeat   the mission was decided (or the player went down)
export const MOODS = ['off', 'calm', 'tension', 'fight', 'hero', 'danger', 'victory', 'defeat'];
export const MOOD_CFG = { tensionRange: 25000, fightRange: 6000, weaponsRecent: 8, fightHold: 20, dangerHp: 0.35, dangerHold: 5, heroKill: 25, heroHold: 16 };

export function createMood(cfg = MOOD_CFG) {
  const s = { t: 0, mood: 'off', since: 0, fightUntil: -1, dangerUntil: -1, heroUntil: -1 };
  function update(i) {
    s.t += Math.max(0, i.dt || 0);
    const t = s.t;
    let m;
    if (!i.active) { m = 'off'; s.fightUntil = s.dangerUntil = s.heroUntil = -1; }
    else if (i.result === 'success') m = 'victory';
    else if (i.result === 'failure' || i.alive === false) m = 'defeat';
    else {
      if (i.threat || (i.hp ?? 1) < cfg.dangerHp) s.dangerUntil = t + cfg.dangerHold;
      const fightNow = (i.enemyDist ?? Infinity) < cfg.fightRange || (i.weaponsAgo ?? Infinity) < cfg.weaponsRecent || !!i.lockAny;
      if (fightNow && (i.enemyCount ?? 1) > 0) s.fightUntil = t + cfg.fightHold;
      if (t < s.dangerUntil) m = 'danger';
      else if (t < s.fightUntil) {
        const ec = i.enemyCount ?? 1, fc = (i.friendCount ?? 0) + 1;
        const winning = (i.killAgo ?? Infinity) < cfg.heroKill || (ec > 0 && fc >= 2 * ec && (i.hp ?? 1) > 0.6);
        if (winning && s.mood !== 'hero') s.heroUntil = t + cfg.heroHold;
        m = winning || t < s.heroUntil ? 'hero' : 'fight';
      } else m = (i.enemyDist ?? Infinity) < cfg.tensionRange && (i.enemyCount ?? 1) > 0 ? 'tension' : 'calm';
    }
    if (m !== s.mood) { s.mood = m; s.since = t; }
    return m;
  }
  return { update, get mood() { return s.mood; }, get since() { return s.t - s.since; }, reset() { s.mood = 'off'; s.fightUntil = s.dangerUntil = s.heroUntil = -1; } };
}
