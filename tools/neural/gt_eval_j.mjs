// Evaluate the deployed scatter models (CPU twins of the GLSL, same LUTs) on a batch of march samples.
//   node tools/neural/gt_eval_j.mjs in.f32 out.f32 neural3|neural4|neural5     (in: N x 4 float32 tauSun, tauUp, cosT, tauDown)
import { readFileSync, writeFileSync } from 'node:fs';
import { createNeuralCloudScatter, createNeuralCloudScatter4 } from '../../src/neural/cloud-scatter.js';
const [inp, outp, model] = process.argv.slice(2);
const buf = readFileSync(inp);
const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength >> 2);
const n = x.length / 4, y = new Float32Array(n);
const opts = { phaseMax: 20 };
let f;
if (model === 'neural3') { const s = createNeuralCloudScatter(opts); f = (a, b, c) => s.sample(a, b, c); }
else if (model === 'neural4') { const s = createNeuralCloudScatter4(opts); f = (a, b, c, d) => s.sample(a, b, c, d); }
else if (model === 'neural3full') { const s = createNeuralCloudScatter({}); f = (a, b, c) => s.sample(a, b, c); }
else if (model === 'neural4full') { const s = createNeuralCloudScatter4({}); f = (a, b, c, d) => s.sample(a, b, c, d); }
else throw new Error('model ' + model);
for (let i = 0; i < n; i++) y[i] = f(x[4 * i], x[4 * i + 1], x[4 * i + 2], x[4 * i + 3]);
writeFileSync(outp, Buffer.from(y.buffer));
