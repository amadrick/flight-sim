// Live fallback: while a section's stem is still rendering, its bars are played live by a small fixed graph — drums,
// picked bass, one (mono) rhythm guitar and the synth-bass pulse, no reverbs — so the score is never silent and the
// band can come in on the next bar on any device. The engine hands over to the stem at the next section boundary and
// disposes this graph once it has been idle for a few bars. About 90 nodes / 20 oscillators, all built once.
import { G, BQ, noise, makeDrums, makeRhythmGuitar, makeBass, makeSynthBass } from './synth.js';

const LIVE = new Set(['gtr', 'bass', 'sbass']);
export const LIVE_LEVEL = 0.8;                        // roughly matches the stems' level through the same trim

export function createLiveBand(ac, dest) {
  const out = G(ac, LIVE_LEVEL), comp = ac.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.18;
  const hp = BQ(ac, 'highpass', 30, 0.7); hp.connect(comp); comp.connect(out); out.connect(dest);
  const white = noise(ac, 'white'); white.start();
  const sink = G(ac, 0);                                // drums' room / gate sends go nowhere (no reverb live)
  const drumBus = G(ac, 0.75); drumBus.connect(hp);
  const gtrBus = G(ac, 1.6); gtrBus.connect(hp);
  const inst = {
    drums: makeDrums(ac, drumBus, sink, { in: sink, open() {} }, white),
    gtr: makeRhythmGuitar(ac, gtrBus, white, { os: 'none', mono: true }),
    bass: makeBass(ac, hp, white),
    sbass: makeSynthBass(ac, hp),
  };
  const sources = [white];
  for (const k in inst) sources.push(...inst[k].sources);
  let alive = true;
  return {
    /** schedule steps [from, to) of a bar from bar time t; with `fill`, drum steps >= fillFrom come from the fill */
    playBar(bar, t, sd, from = 0, to = 16, fill = null, fillFrom = 16) {
      if (!alive) return;
      for (let k = from; k < to; k++) {
        const tk = t + k * sd, evs = bar.steps[k];
        for (let i = 0; i < evs.length; i++) {
          const e = evs[i];
          if (e.dr) { if (!fill || k < fillFrom) inst.drums.trigger(e, tk); }
          else if (LIVE.has(e.i)) inst[e.i].trigger(e, tk, sd);
        }
        if (fill && k >= fillFrom) for (const e of fill[k]) inst.drums.trigger(e, tk);
      }
    },
    release(t) { for (const k in inst) inst[k].release(t); },
    nodes: 90,
    dispose(t = ac.currentTime) {
      if (!alive) return; alive = false;
      out.gain.setTargetAtTime(0, t, 0.05);
      for (const s of sources) { try { s.stop(t + 0.4); } catch {} }
      setTimeout(() => { try { out.disconnect(); } catch {} for (const s of sources) { try { s.disconnect(); } catch {} } }, 800);
    },
  };
}
