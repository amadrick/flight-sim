// Tiny PNG writer for debug dumps: node png.mjs in.json out.png  (in.json = { w, h, b64 } RGBA; alpha shown over grey)
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const [, , inp, outp] = process.argv;
let j = JSON.parse(readFileSync(inp, 'utf8')); if (typeof j === 'string') j = JSON.parse(j);
const { w, h } = j, px = Buffer.from(j.b64, 'base64');
const raw = Buffer.alloc((w * 3 + 1) * h);
for (let y = 0; y < h; y++) {
  const sy = h - 1 - y;                       // GL rows are bottom-up
  raw[y * (w * 3 + 1)] = 0;
  for (let x = 0; x < w; x++) {
    const k = (sy * w + x) * 4, a = px[k + 3] / 255;
    for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.round(px[k + c] * a + 128 * (1 - a));
  }
}
const crc = (b) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
writeFileSync(outp, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
