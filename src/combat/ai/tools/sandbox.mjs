// Scenario sandbox for AI tools/tests: a headless combat bench with no mission director (the scenario script spawns
// and judges everything itself). opts: createBench options ({ seed, groundFn, difficulty }).
import { createBench } from '../../../../tools/combat-bench.mjs';

export async function createSandbox(opts = {}) {
  const b = await createBench(opts);
  const c = b.combat;
  c.director.update = () => {};
  c.director.start = () => {};
  c.mission = { id: 'ai-sandbox', enemies: [] };
  c.active = true;
  return b;
}
