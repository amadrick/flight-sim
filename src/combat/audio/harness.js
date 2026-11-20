// Offline verification harness for combat audio. Renders the real graph builders (music engine, weapon sfx, warnings,
// radio framing) through an OfflineAudioContext into the simulator's master bus and measures the result.
// Run: node src/combat/audio/run-harness.mjs [filter]      (builds dist/cbt-audio.html and drives headless Chromium)
import { createMaster } from '../../audio/master.js';
import { createMusic } from './music/engine.js';
import * as A from './analyze.js';
import { SCENARIOS } from './harness-scenarios.js';

const SR = A.SR, FPS = 30;

/**
 * Render `seconds` of audio. setup(ac, M) builds things and returns an object; tick(t, obj, ac) runs every 1/30 s
 * of audio time (at suspend points, like a game frame).
 */
async function render({ seconds, setup, tick, channels = 2 }) {
  const ac = new OfflineAudioContext(channels, Math.ceil(SR * seconds), SR);
  const M = createMaster(ac);
  const obj = setup(ac, M) || {};
  if (tick) {
    const quant = 128 / SR; let lastQ = -1;
    for (let i = 0; i < Math.floor(seconds * FPS); i++) {
      const t = Math.ceil((i / FPS) / quant) * quant, q = Math.round(t / quant);
      if (q === lastQ) continue; lastQ = q;
      ac.suspend(t).then(() => { try { tick(ac.currentTime, obj, ac); } catch (e) { obj.err = String(e?.stack || e); } ac.resume(); });
    }
  }
  const buf = await ac.startRendering();
  if (obj.err) throw new Error(obj.err);
  return { buf, obj };
}

const results = { rows: [], checks: [], music: {}, sfx: {} };
const check = (name, ok, detail) => results.checks.push({ name, ok: !!ok, detail: String(detail) });
function row(name, buf, extra = {}) {
  let pk = 0, dc = 0, sq = 0, n = 0, nan = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const v = d[i]; if (!isFinite(v)) { nan++; continue; } pk = Math.max(pk, Math.abs(v)); dc += v; sq += v * v; n++; } }
  const r = { name, peak: +pk.toFixed(3), rms_db: +A.db(Math.sqrt(sq / n)).toFixed(1), dc: +(dc / n).toExponential(1), nan, ...extra };
  results.rows.push(r); return r;
}

const H = { render, results, check, row, A, createMusic, SR };
window.__sim = { ready: false, error: null, results, ctx: {}, step() {}, H };
const filter = new URLSearchParams(location.search).get('only') || '';
(async () => {
  for (const [name, fn] of Object.entries(SCENARIOS)) {
    if (filter && !name.includes(filter)) continue;
    const t0 = performance.now();
    try { await fn(H); } catch (e) { check(`scenario ${name} ran`, false, String(e?.stack || e).slice(0, 400)); }
    results.rows.push({ name: `(${name} render ${Math.round(performance.now() - t0)} ms)` });
  }
})().then(() => { window.__sim.ready = true; }).catch((e) => { window.__sim.error = String(e?.stack || e); window.__sim.ready = true; });
