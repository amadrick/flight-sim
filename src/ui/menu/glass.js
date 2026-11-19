// Skyward glass: runtime side of the glass material defined in index.template.html.
//  - data-scene on <html> (day / dusk / night) from ctx.env.nightFactor, so the tint and rim adapt to the scene
//  - --rim-angle: the on-screen direction of the sun (or moon), so specular rims are lit from where the light is
//  - .ui-lite: no backdrop blur (quality 'low', a sustained low frame rate, or the user's "Reduced" choice)
//  - .ui-lens: SVG refraction for small controls (Chromium only: backdrop-filter:url() is ignored elsewhere)
// Everything is cheap: one quaternion transform per frame and a style write only when the angle moved > 1.5°.

const RAD = 180 / Math.PI;

/** Pure: CSS gradient angle (deg) for light coming from camera-space direction (x right, y up). Exported for tests. */
export function rimAngle(x, y) {
  // the gradient runs from the lit edge toward the far edge: direction = away from the light, in CSS angle
  // convention (0deg = up, clockwise). Screen-down vector of the light is (x, -y); away is (-x, y).
  if (Math.abs(x) + Math.abs(y) < 1e-4) return 180;
  return ((Math.atan2(-x, -y) * RAD) % 360 + 360) % 360;
}

/** Pure: scene class from night factor (0 day .. 1 night). */
export function sceneOf(night) { return night > 0.62 ? 'night' : night > 0.24 ? 'dusk' : 'day'; }

/** Displacement map for a rounded rectangle: R/G = 128 ± inward normal × falloff near the rim. */
function lensMap(w, h, r, edge) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); const img = g.createImageData(w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // signed distance to the rounded rect (negative inside) and its gradient
    const px = x + 0.5 - w / 2, py = y + 0.5 - h / 2;
    const qx = Math.abs(px) - (w / 2 - r), qy = Math.abs(py) - (h / 2 - r);
    let nx, ny, dist;
    if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; dist = l - r; nx = qx / l; ny = qy / l; }
    else if (qx > qy) { dist = qx - r; nx = 1; ny = 0; } else { dist = qy - r; nx = 0; ny = 1; }
    nx *= Math.sign(px) || 1; ny *= Math.sign(py) || 1;
    const t = Math.min(1, Math.max(0, -dist / edge));     // 0 at the rim, 1 deep inside
    const m = (1 - t) * (1 - t);
    const i = (y * w + x) * 4;
    d[i] = 128 - nx * m * 127; d[i + 1] = 128 - ny * m * 127; d[i + 2] = 128; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL();
}

export function createGlass(ctx) {
  const html = document.documentElement;
  const raw = ctx.params?.raw || {};
  let userLite = false, fpsLite = false, scene = '', angle = -1, lastAngle = -1;
  let ema = 1 / 60, slowT = 0, fastT = 0, trips = 0;

  // ---- refraction filter (Chromium) -----------------------------------------------------------
  const brands = navigator.userAgentData?.brands?.map(b => b.brand).join(' ') || '';
  const chromium = /Chromium|Google Chrome|Microsoft Edge|Opera/.test(brands) || (/Chrome\//.test(navigator.userAgent) && !/Firefox|FxiOS/.test(navigator.userAgent));
  let lensOk = chromium && raw.glass !== 'plain' && CSS.supports?.('backdrop-filter', 'url(#a)');
  let svg = null;
  if (lensOk) {
    try {
      const NS = 'http://www.w3.org/2000/svg';
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
      // one generic pill-shaped map (128×64, radius 32), stretched to each control: controls using it are pills
      const href = lensMap(128, 64, 32, 14);
      svg.innerHTML = `<filter id="sky-lens" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
        <feImage href="${href}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map"/>
        <feDisplacementMap in="SourceGraphic" in2="map" scale="0.18" xChannelSelector="R" yChannelSelector="G"/></filter>`;
      document.body.appendChild(svg);
    } catch { lensOk = false; }
  }

  function applyLite() {
    const q = ctx.quality?.level;
    const lite = userLite || fpsLite || q === 'low' || raw.glass === 'lite';
    html.classList.toggle('ui-lite', lite);
    html.classList.toggle('ui-lens', !!lensOk && !lite && (q === 'high' || q === 'ultra' || q === 'medium'));
  }
  ctx.events?.on?.('quality:change', applyLite);
  applyLite();

  const v = { x: 0, y: 0, z: 0 };
  function update(rdt, menuOpen) {
    // scene tint
    const night = Number(ctx.env?.nightFactor) || 0;
    const sc = sceneOf(night);
    if (sc !== scene) { scene = sc; html.dataset.scene = sc; }
    // light direction in camera space (sun by day, moon by night)
    const cam = ctx.camera, env = ctx.env;
    const src = env && (env.sunDir?.y > -0.08 || !env.moonDir) ? env.sunDir : env?.moonDir;
    if (cam?.quaternion && src) {
      const q = cam.quaternion;
      // rotate src by the inverse camera rotation (conjugate quaternion)
      const qx = -q.x, qy = -q.y, qz = -q.z, qw = q.w;
      const ix = qw * src.x + qy * src.z - qz * src.y, iy = qw * src.y + qz * src.x - qx * src.z;
      const iz = qw * src.z + qx * src.y - qy * src.x, iw = -qx * src.x - qy * src.y - qz * src.z;
      v.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
      v.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
      const a = rimAngle(v.x, v.y);
      // damp (shortest arc) so camera cuts do not flash the rims
      if (angle < 0) angle = a;
      else { let d = ((a - angle + 540) % 360) - 180; angle = (angle + d * Math.min(1, rdt * 4) + 360) % 360; }
      if (Math.abs(((angle - lastAngle + 540) % 360) - 180) > 1.5) { lastAngle = angle; html.style.setProperty('--rim-angle', angle.toFixed(1) + 'deg'); }
    }
    // frame-rate guard: blur over the WebGL canvas costs real GPU time; drop it when frames are slow
    if (!ctx.params?.test && rdt > 0) {
      ema += (Math.min(rdt, 0.2) - ema) * 0.05;
      // hysteresis: trip below 24 fps for 4 s; retry glass only above 50 fps for 10 s, and give up after two trips
      if (!fpsLite) { slowT = ema > 1 / 24 ? slowT + rdt : 0; if (slowT > 4) { fpsLite = true; trips++; fastT = 0; applyLite(); } }
      else if (trips < 2) { fastT = ema < 1 / 50 ? fastT + rdt : 0; if (fastT > 10) { fpsLite = false; slowT = 0; applyLite(); } }
    }
  }

  return {
    update,
    get lens() { return !!lensOk; },
    get lite() { return html.classList.contains('ui-lite'); },
    setReduced(on) { userLite = !!on; applyLite(); },
    get reduced() { return userLite; },
  };
}
