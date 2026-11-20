// COMBAT HUD — placeholder implementation written by the integrator so the rest of combat runs: target boxes and a few
// lines of text on its own overlay canvas. The HUD agent replaces it; API (COMBAT.md §9): createCombatHud(combat) -> { update(dt) }.
import * as THREE from 'three';

export async function createCombatHud(combat) {
  const ctx = combat.ctx;
  const cv = document.createElement('canvas');
  cv.className = 'cbt-hud'; cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3';
  (ctx.hudCanvas?.parentNode || ctx.uiRoot).appendChild(cv);
  const g = cv.getContext('2d'), v = new THREE.Vector3();
  let W = 2, H = 2, radio = '', radioT = 0;
  combat.events.on('radio', ({ from, text }) => { radio = `${from}: ${text}`; radioT = 5; });
  function project(p) {
    ctx.world.toRender(p, v).applyMatrix4(ctx.camera.matrixWorldInverse);
    if (v.z > -1) return false;
    v.applyMatrix4(ctx.camera.projectionMatrix);
    v.x = (v.x + 1) * 0.5 * W; v.y = (1 - v.y) * 0.5 * H;
    return true;
  }
  return {
    update(dt) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth || window.innerWidth; H = cv.clientHeight || window.innerHeight;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      if (!combat.active || ctx.menu?.isOpen || ctx.params.hud === false) return;
      const p = combat.world.player; if (!p) return;
      g.font = '600 12px monospace'; g.lineWidth = 1.5;
      for (const e of combat.world.aircraft) {
        if (e === p || !project(e.state.position)) continue;
        const red = e.team !== p.team, sel = p.target === e;
        g.strokeStyle = g.fillStyle = red ? (sel ? '#ff5a4a' : '#ff9a8a') : '#7fd0ff';
        const s = sel ? 16 : 10; g.strokeRect(v.x - s, v.y - s, 2 * s, 2 * s);
        g.fillText(`${e.callsign} ${(e.state.position.distanceTo(p.state.position) / 1852).toFixed(1)} nm`, v.x + s + 4, v.y + 4);
      }
      const L = p.lock, lo = p.loadout;
      g.fillStyle = '#5dff9b';
      if (lo) g.fillText(`GUN ${lo.gun.rounds}   ${lo.selected.toUpperCase()} ${lo.missiles[lo.selected]}   FLR ${lo.flares}   HP ${Math.max(0, Math.round(p.hp))}   ${L?.state === 'locked' ? 'LOCK' : L?.state === 'acquiring' ? 'ACQ' : ''}`, 20, H - 60);
      let y = 80;
      for (const o of combat.director.objectives) { g.fillText(`${o.state === 'done' ? '[x]' : '[ ]'} ${o.text} ${o.progress || ''}`, 20, y); y += 16; }
      if ((radioT -= ctx.time.realDt || 0) > 0) { g.textAlign = 'center'; g.fillText(radio, W / 2, H * 0.78); g.textAlign = 'left'; }
      if (combat.result) { g.textAlign = 'center'; g.font = '700 28px sans-serif'; g.fillText(combat.result.outcome === 'success' ? 'MISSION COMPLETE' : 'MISSION FAILED', W / 2, H * 0.3); g.textAlign = 'left'; }
    },
  };
}
