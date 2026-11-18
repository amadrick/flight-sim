// Dev tool: shaded-relief map of the world from the CPU height function.
//   node src/terrain/tools/map.mjs --out shots/map.png [--cx 0 --cz 0 --span 640 --size 900]   (km)
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { heightAt, sampleTerrain } from '../height.gen.js';
import { AIRPORTS, CARRIER } from '../../data/airports.js';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const out = resolve(flag('out', 'shots/map.png'));
const cx = +flag('cx', 0) * 1000, cz = +flag('cz', 0) * 1000, span = +flag('span', 640) * 1000, S = +flag('size', 900);

function crc32(buf) { let c, crc = ~0; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const px = span / S, H = new Float32Array((S + 2) * (S + 2)), o = {}, AR = new Float32Array(S * S), SP = new Float32Array(S * S);
const t0 = performance.now();
for (let j = 0; j < S + 2; j++) for (let i = 0; i < S + 2; i++) {
  const x = cx - span / 2 + (i - 0.5) * px, z = cz - span / 2 + (j - 0.5) * px;
  sampleTerrain(x, z, o); H[j * (S + 2) + i] = o.height;
  if (i > 0 && j > 0 && i <= S && j <= S) { AR[(j - 1) * S + i - 1] = o.arid; SP[(j - 1) * S + i - 1] = o.special; }
}
const dtms = performance.now() - t0;
const rgb = Buffer.alloc(S * S * 3);
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
let hmin = 1e9, hmax = -1e9;
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
  const k = (j + 1) * (S + 2) + i + 1, h = H[k];
  hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
  const dx = (H[k + 1] - H[k - 1]) / (2 * px), dz = (H[k + S + 2] - H[k - S - 2]) / (2 * px);
  const ex = +flag("ex", 2);
  const nl = 1 / Math.hypot(dx * ex, 1, dz * ex);
  const sh = Math.max(0, (-dx * ex * -0.6 + 0.6 + -dz * ex * -0.5) * nl / 0.985);   // light from NW
  let c; const ar = AR[j * S + i], sp = SP[j * S + i];
  if (h < 0) c = lerp3([150, 215, 225], [8, 30, 70], Math.min(1, Math.pow(-h / 400, 0.5)));
  else {
    const green = lerp3([70, 120, 50], [200, 175, 120], ar);
    c = h < 2 ? [225, 210, 160] : h < 2300 ? lerp3(green, lerp3([120, 110, 95], [170, 120, 90], ar), Math.min(1, h / 2300)) : h < 2900 ? [130, 125, 120] : [245, 245, 250];
    if (sp > 0.3) c = [30, 80, 200]; else if (sp < -0.3) c = lerp3(c, [240, 235, 215], -sp);
    const s = 0.35 + 0.75 * sh; c = [c[0] * s, c[1] * s, c[2] * s];
  }
  rgb[(j * S + i) * 3] = Math.min(255, c[0]); rgb[(j * S + i) * 3 + 1] = Math.min(255, c[1]); rgb[(j * S + i) * 3 + 2] = Math.min(255, c[2]);
}
const mark = (x, z, col) => { const i = Math.round((x - cx + span / 2) / px), j = Math.round((z - cz + span / 2) / px); for (let a = -3; a <= 3; a++) for (const [u, v] of [[i + a, j], [i, j + a]]) if (u >= 0 && v >= 0 && u < S && v < S) { rgb[(v * S + u) * 3] = col[0]; rgb[(v * S + u) * 3 + 1] = col[1]; rgb[(v * S + u) * 3 + 2] = col[2]; } };
for (const a of AIRPORTS) mark(a.position.x, a.position.z, [255, 0, 0]);
mark(CARRIER.position.x, CARRIER.position.z, [255, 0, 255]);
writePng(out, S, S, rgb);
console.log(`wrote ${out}  ${S}x${S}  ${(px).toFixed(0)} m/px  h=[${hmin.toFixed(0)}, ${hmax.toFixed(0)}]  ${(dtms * 1000 / ((S + 2) * (S + 2))).toFixed(2)} us/sample`);
