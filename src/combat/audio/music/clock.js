// Look-ahead step clock for the sequencer (pure maths, node-tested).
// The music engine calls pump(now) once per frame; it hands back each 16th step that falls inside the look-ahead window
// so it can be scheduled sample-accurately on the AudioContext clock. If the main thread stalled and the clock fell
// behind, late steps are skipped (counted in `skipped`) instead of being played in a burst.
export function createClock({ bpm = 120, lookahead = 0.3, maxLate = 0.03 } = {}) {
  const c = {
    bpm, stepDur: 60 / bpm / 4, lookahead, running: false, next: 0, step: 0, bar: 0, skipped: 0,
    setTempo(b) { c.bpm = b; c.stepDur = 60 / b / 4; },
    /** start so that step 0 of bar 0 lands at time t */
    start(t) { c.running = true; c.next = t; c.step = 0; c.bar = 0; c.skipped = 0; },
    stop() { c.running = false; },
    /**
     * Visit due steps: fn(time, step, bar) for every step with time < now + lookahead. Returns how many were visited.
     * Allocation-free.
     */
    pump(now, fn) {
      if (!c.running) return 0;
      let n = 0;
      while (c.next < now - maxLate) { advance(); c.skipped++; }        // fell behind: drop, keep the grid
      while (c.next < now + c.lookahead && n < 64) { fn(c.next, c.step, c.bar); advance(); n++; }
      return n;
    },
    /** time at which the next bar starts (step 0) */
    nextBarTime() { return c.next + (16 - c.step) % 16 * c.stepDur; },
  };
  function advance() { c.next += c.stepDur; c.step++; if (c.step >= 16) { c.step = 0; c.bar++; } }
  return c;
}
