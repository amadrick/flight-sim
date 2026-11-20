// Dual-screen / foldable devices spanned across a hinge: the gap between the two viewport segments, in viewport CSS px.
// Viewport Segments API (window.viewport.segments) first, else the CSS env(viewport-segment-*) variables read through a
// probe element; on ordinary screens (or browsers without either) → null. Zero-width folds are returned as-is (w or h 0):
// the touch layout ignores them, since the panel is continuous.
let probe = null;
export function viewportHinge(W, H) {
  try {
    const segs = window.viewport && window.viewport.segments;
    if (segs && segs.length === 2) {
      const a = segs[0], b = segs[1];
      if (Math.abs(a.y - b.y) < 1) return { x: Math.round(a.x + a.width), y: 0, w: Math.round(b.x - a.x - a.width), h: H };
      return { x: 0, y: Math.round(a.y + a.height), w: W, h: Math.round(b.y - a.y - a.height) };
    }
    if (segs) return null;
  } catch {}
  try {
    if (!probe) {
      probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding:env(viewport-segment-right 0 0,0px) env(viewport-segment-left 1 0,0px) env(viewport-segment-bottom 0 0,0px) env(viewport-segment-top 0 1,0px)';
      document.body.appendChild(probe);
    }
    const st = getComputedStyle(probe);
    const r0 = parseFloat(st.paddingTop) || 0, l1 = parseFloat(st.paddingRight) || 0, b0 = parseFloat(st.paddingBottom) || 0, t1 = parseFloat(st.paddingLeft) || 0;
    if (l1 > 0) return { x: r0, y: 0, w: l1 - r0, h: H };
    if (t1 > 0) return { x: 0, y: b0, w: W, h: t1 - b0 };
  } catch {}
  return null;
}
