// URL parameters (query string for local testing, plain "#a=b&c=d" style is NOT available in artifacts,
// so in production everything is chosen in the menu). Known params:
//   test=1        no rAF loop; drive with window.__sim.step(n, dt)
//   autostart=1   skip the menu and start flying immediately
//   aircraft=f16  aircraft id (see src/aircraft/registry.js)
//   airport=KHVN  airport id (see src/data/airports.js)
//   start=runway|air|approach   spawn mode (default runway)
//   alt=3000 spd=200 hdg=90     overrides for start=air (m MSL, m/s TAS, degrees true)
//   tod=14.5      local solar time of day in hours
//   weather=clear|fair|scattered|broken|overcast|storm
//   cam=chase|cockpit|flyby|orbit|tower|free
//   quality=low|medium|high|ultra
//   seed=1234     deterministic RNG seed
//   hud=0         hide HUD/UI (clean screenshots)
export function parseParams() {
  const p = {};
  const add = (s) => { for (const [k, v] of new URLSearchParams(s)) p[k] = v; };
  try { add(location.search); } catch {}
  const num = (k, d) => (p[k] !== undefined && isFinite(+p[k]) ? +p[k] : d);
  return {
    raw: p,
    test: p.test === '1',
    autostart: p.autostart === '1',
    aircraft: p.aircraft || null,
    airport: p.airport || null,
    start: p.start || 'runway',
    alt: num('alt', null), spd: num('spd', null), hdg: num('hdg', null),
    tod: num('tod', null),
    weather: p.weather || null,
    cam: p.cam || null,
    quality: p.quality || null,
    seed: num('seed', 1337),
    hud: p.hud !== '0',
  };
}
