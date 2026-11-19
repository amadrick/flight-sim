// Dumps the tuned (resolved) flight-model numbers of every aircraft to JSON for the offline aerodynamic pipeline
// (tools/neural/aero/*.py). The Python side never parses the JS configs itself.
//
//   node tools/neural/aero/dump_models.mjs [out.json]      (default: tools/neural/aero/results/models.json)
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
globalThis.window ??= globalThis;
globalThis.document ??= { createElement: () => ({ getContext: () => null, style: {} }), body: {}, addEventListener() {} };
const imp = (p) => import(pathToFileURL(resolve(root, p)).href);
const { resolveConfig } = await imp('src/physics/config.js');

const out = {};
for (const id of readdirSync(resolve(root, 'src/aircraft')).sort()) {
  if (!existsSync(resolve(root, `src/aircraft/${id}/physics.js`)) || !existsSync(resolve(root, `src/aircraft/${id}/index.js`))) continue;
  const def = (await imp(`src/aircraft/${id}/index.js`)).default;
  const m = resolveConfig(def), A = m.aero, F = A.flaps, g = def.geometry;
  const at = (tab, M) => tab[Math.round(M / 0.02)];
  out[id] = {
    id, name: def.name, category: def.category, fcs: m.fcs.type,
    S: A.S, b: A.b, c: A.c, length: g.length, span: g.span, cgHeight: g.cgHeight, noseZ: g.noseZ, tailZ: g.tailZ,
    cla: A.cla, cl0: A.cl0, sharp: A.sharp, clPost: A.clPost, cd90: A.cd90, a0n: A.a0n, peakOff: A.peakOff,
    slatDAlpha: A.slatDAlpha, slatAuto: m.slatAuto,
    flaps: { n: F.n, pos: Array.from(F.pos), slat: Array.from(F.slat), dcl0: Array.from(F.dcl0), a0: Array.from(F.a0), clMax: Array.from(F.clMax), dcm0: Array.from(F.dcm0), landing: F.landing, takeoff: F.takeoff },
    machGrid: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], machClmax: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((M) => at(A.tClmax, M)),
    machCla: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((M) => at(A.tCla, M)), machCtrl: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map((M) => at(A.tCtrl, M)),
    sm: A.sm, cm0: A.cm0, cmq: A.cmq, cmde: A.cmde, clde: A.clde, cmPost: A.cmPost,
    cyb: A.cyb, cydr: A.cydr, clb: A.clb, clbCl: A.clbCl, clp: A.clp, clr: A.clr, clrCl: A.clrCl, clda: A.clda, cldt: A.cldt, cldr: A.cldr,
    cnb: A.cnb, cnp: A.cnp, cnpCl: A.cnpCl, cnr: A.cnr, cnda: A.cnda, cndaCl: A.cndaCl, cndr: A.cndr, cnbPost: A.cnbPost,
    aDir: [A.aDir0, A.aDir0 + 1 / A.aDirInv], rudLoss: A.rudLoss, ailLoss: A.ailLoss, clpPost: A.clpPost,
    deMax: A.deMax, daMax: A.daMax, drMax: A.drMax, dtMax: A.dtMax, groundEffect: A.groundEffect,
    sweep: !!A.sweep, splitRudder: m.ctl.splitRudder, alphaMax: m.fcs.alphaMax,
  };
}
const file = resolve(process.argv[2] || resolve(root, 'tools/neural/aero/results/models.json'));
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`wrote ${file}: ${Object.keys(out).join(' ')}`);
