// Quick look at the procedural trees without booting the sim (software GL, a few seconds):
//   node tools/neural/veg/tree-preview.mjs --out shots/tp.png [--species oak,beech] [--size 1200x500] [--sun 40,120]
//        [--view side|close|top] [--gen classic]
// Renders the species from treegen.js with the foliage atlas, simplified lighting (sun with the baked per-tree
// visibility, sky ambient, translucency) on a flat ground, so silhouettes, branch structure and gaps can be judged.
import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const out = resolve(root, flag('out', 'shots/tree-preview.png'));
const [W, H] = flag('size', '1200x500').split('x').map(Number);
const cfg = { species: flag('species', ''), sun: flag('sun', '40,140').split(',').map(Number), view: flag('view', 'side'), gen: flag('gen', '') };

const entry = `
import * as THREE from 'three';
import { buildTreeMeshes, VERTEX_PULL_GLSL, VMAX, treeGen } from '../src/terrain/veg/treegen.js';
import { createFoliageAtlas } from '../src/terrain/veg/foliage.js';
import { SPECIES } from '../src/terrain/veg/species.js';
const cfg = ${JSON.stringify(cfg)};
treeGen.classic = cfg.gen === 'classic';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(${W}, ${H}); document.body.appendChild(renderer.domElement);
const t0 = performance.now();
const meshes = buildTreeMeshes(); const fol = createFoliageAtlas();
const list = cfg.species ? cfg.species.split(',').map((id) => SPECIES.findIndex((s) => s.id === id)) : SPECIES.map((s, i) => i);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0.45, 0.62, 0.85);
const el = cfg.sun[0] * Math.PI / 180, az = cfg.sun[1] * Math.PI / 180;
const sun = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.10, 0.12, 0.06) }));
ground.rotation.x = -Math.PI / 2; scene.add(ground);
const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(VMAX * 3), 3));
let x = 0; const gap = 4;
list.forEach((si, k) => {
  const sp = SPECIES[si], Hm = (sp.h[0] + sp.h[1]) / 2;
  const w = Math.max(meshes.info[si].rmax * Hm * 2, 3);
  x += k ? w / 2 : 0;
  const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, glslVersion: THREE.GLSL3,
    uniforms: { tVegVerts: { value: meshes.texture }, tF: { value: fol }, uS: { value: si }, uH: { value: Hm }, uX: { value: x }, uSun: { value: sun },
      uLeaf: { value: new THREE.Vector3(...sp.leaf) }, uBark: { value: new THREE.Vector3(...sp.bark) } },
    vertexShader: VERTEX_PULL_GLSL + \`
      uniform int uS; uniform float uH, uX; out vec2 vUv; out vec3 vN; out vec4 vVis; out float vKind; out vec3 vP;
      void main() { vec4 t0, t1, t2; vegFetch(uS, gl_VertexID, t0, t1, t2); vVis = vegFetchVis(uS, gl_VertexID);
        vec3 p = t0.xyz * uH + vec3(uX, 0.0, 0.0); vP = p; vUv = vec2(t0.w, t1.w); vN = t1.xyz; vKind = t2.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }\`,
    fragmentShader: \`
      uniform sampler2D tF; uniform vec3 uSun, uLeaf, uBark; in vec2 vUv; in vec3 vN; in vec4 vVis; in float vKind; in vec3 vP; out vec4 o;
      void main() { vec4 fo; vec3 alb;
        if (vKind < 0.5) { fo = textureLod(tF, vec2(0.75, 0.5) + fract(vUv * vec2(1.0, 0.25)) * 0.25, 1.0); alb = uBark * (0.55 + 0.9 * fo.r); fo.a = 1.0; }
        else { fo = texture(tF, vUv); alb = uLeaf * (0.45 + 1.1 * fo.r) * mix(vec3(1.0), vec3(1.5, 1.1, 0.55), fo.g * 0.6) * (0.7 + 0.3 * fo.b); }
        if (fo.a < 0.5) discard;
        vec3 n = normalize(vN);
        float sv = clamp(vVis.x + dot(vVis.yzw, uSun), 0.0, 1.0); sv += (1.0 - sv) * 0.08;
        float sky = clamp(vVis.x + vVis.z * 0.5, 0.0, 1.0); sky += (1.0 - sky) * 0.2;
        float nl = max(dot(n, uSun), 0.0) * 0.8 + 0.2 * (vKind < 0.5 ? 0.0 : 1.0);
        vec3 E = vec3(1.0, 0.95, 0.88) * 3.0 * nl * sv + vec3(0.35, 0.45, 0.6) * 1.2 * sky;
        vec3 c = alb * E;
        c = c / (1.0 + c);
        o = vec4(pow(c * 1.8, vec3(1.0 / 2.2)), 1.0); }\` });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; scene.add(m);
  x += w / 2 + gap;
});
const cam = new THREE.PerspectiveCamera(cfg.view === 'close' ? 50 : 30, ${W} / ${H}, 0.5, 2000);
const cx = x / 2;
if (cfg.view === 'top') { cam.position.set(cx, x * 1.1, 1); cam.lookAt(cx, 0, 0); }
else if (cfg.view === 'close') { cam.position.set(cx, 1.7, 14); cam.lookAt(cx, 6, 0); }
else { const d = (x / 2) / (Math.tan(15 * Math.PI / 180) * ${W} / ${H}); cam.position.set(cx, 6, Math.max(d, 25)); cam.lookAt(cx, 9, 0); }
renderer.render(scene, cam);
window.__done = { ms: performance.now() - t0, info: meshes.info.map((s) => s.id + ':' + s.tris) };
`;
const tmp = resolve(root, 'dist/tree-preview');
mkdirSync(tmp, { recursive: true });
writeFileSync(resolve(root, 'dist/tree-preview-entry.js'), entry);
const r = await build({ entryPoints: [resolve(root, 'dist/tree-preview-entry.js')], bundle: true, write: false, format: 'iife', absWorkingDir: root, nodePaths: [resolve(root, 'node_modules')] });
writeFileSync(resolve(tmp, 'index.html'), `<!doctype html><body style="margin:0"><script>${r.outputFiles[0].text}</script>`);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('console', (m) => console.log('[page]', m.text())); page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto('file://' + resolve(tmp, 'index.html'));
await page.waitForFunction(() => window.__done, null, { timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => window.__done)));
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
await browser.close();
console.log('wrote', out);
