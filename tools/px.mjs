import { createRequire } from 'module'; const require = createRequire(import.meta.url); const { chromium } = require('playwright');
import fs from 'fs';
const files = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage();
for (const f of files) {
  const d = 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  const r = await p.evaluate(async (d) => { const i = new Image(); i.src = d; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0);
    const at = (u, v) => Array.from(x.getImageData(Math.round(u * i.width), Math.round(v * i.height), 1, 1).data.slice(0, 3));
    return { sky: at(0.6, 0.1), horizon: at(0.3, 0.36), grass: at(0.9, 0.45), asphalt: at(0.75, 0.75), paint: at(0.42, 0.9) }; }, d);
  console.log(f, JSON.stringify(r));
}
await b.close();
