// Combat HUD — DOM panels: objectives + timer + score, radio subtitles, kill feed, score pops, mission-end banner and the
// first-minute control hints. DOM is touched on events and on value changes only (never per frame without a change).
import { F } from '../../ui/hud/common.js';
import { createSubtitleQueue } from './math.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const HINTS = [
  { keys: ['Space'], text: 'Guns (hold)', cmd: 'gun' },
  { keys: ['Enter', 'X'], text: 'Missile', cmd: 'missile' },
  { keys: ['V'], text: 'Flares', cmd: 'flare' },
  { keys: ['Tab'], text: 'Next target', cmd: 'targetNext' },
  { keys: ['Y'], text: 'Target nearest the nose', cmd: 'targetNearest' },
  { keys: ['Z'], text: 'Switch missile', cmd: 'weaponNext' },
  { keys: ['O'], text: 'Target view (padlock)', cmd: 'padlock' },
];
const HINT_LIFE = 20;          // s of (unblocked) mission time the hint card stays

export function createPanels(root, opts) {
  const doc = document;
  const el = (tag, cls, parent, html) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; };
  const reduced = opts.reduced;

  // ---- objectives -------------------------------------------------------------------------------------
  const left = el('div', 'cbt-hud-left', root);
  const lrow = el('div', 'cbt-hud-lrow', left);
  const obj = el('div', 'cbt-hud-obj glass', lrow);
  const objH = el('div', 'cbt-hud-obj-h', obj, '<span class="cbt-hud-cap">Objectives</span>');
  const timer = el('span', 'cbt-hud-timer', objH); timer.hidden = true;
  const objList = el('ul', '', obj);
  const objF = el('div', 'cbt-hud-obj-f', obj, '<span class="cbt-hud-cap">Score</span>');
  const scoreEl = el('b', '', objF, '0');
  const prevState = new Map(); const flashes = [];
  let timerKey = '', objKey = '';

  function renderObjectives(list) {
    list = Array.isArray(list) ? list : [];
    let key = '';
    for (const o of list) key += (o.id ?? '') + '|' + o.state + '|' + (o.text ?? '') + '|' + (o.progress ?? '') + '|' + (o.optional ? 1 : 0) + ';';
    if (key === objKey) return;
    objKey = key;
    objList.textContent = '';
    for (const o of list) {
      const li = el('li', o.optional ? 'cbt-hud-opt' : '', objList);
      li.dataset.state = o.state || 'active';
      li.innerHTML = `<span>${esc(o.text)}${o.optional ? ' <span class="cbt-hud-cap" style="letter-spacing:.1em">optional</span>' : ''}</span>${o.progress != null && o.progress !== '' ? `<em>${esc(o.progress)}</em>` : '<span></span>'}`;
      const id = o.id ?? o.text, was = prevState.get(id);
      if (was !== undefined && was !== o.state) { li.classList.add('cbt-hud-new'); flashes.push({ li, t: 1.6 }); }
      else if (was === undefined && prevState.size) { li.classList.add('cbt-hud-new'); flashes.push({ li, t: 1.6 }); }
      prevState.set(id, o.state);
    }
    obj.hidden = list.length === 0 && timer.hidden;
  }
  function setTimer(tm) {
    if (!tm || !(tm.seconds >= 0)) { if (!timer.hidden) { timer.hidden = true; timerKey = ''; } return; }
    const s = Math.ceil(tm.seconds), k = (tm.label || '') + s;
    if (k === timerKey) return;
    timerKey = k; timer.hidden = false;
    timer.innerHTML = (tm.label ? `<small>${esc(tm.label)}</small>` : '') + F.mmss(s);
    timer.classList.toggle('cbt-hud-low', s <= 30);
    if (obj.hidden) obj.hidden = false;
  }
  let scoreVal = -1;
  function setScore(v) { v = Math.round(v || 0); if (v !== scoreVal) { scoreVal = v; scoreEl.textContent = F.comma(v); } }

  // ---- right column -----------------------------------------------------------------------------------
  const side = el('div', 'cbt-hud-side', root);
  const radarBox = el('div', 'cbt-hud-radar glass', side);
  radarBox.setAttribute('role', 'button'); radarBox.setAttribute('aria-label', 'Radar: tap to change range or hide');
  const radarCv = el('canvas', '', radarBox);
  const statBox = el('div', 'cbt-hud-stat glass', side);
  const statCv = el('canvas', '', statBox);
  const feed = el('div', 'cbt-hud-feed', side);
  const kills = [];
  let killCap = 4;
  function addKill(html, mine) {
    const k = el('div', 'cbt-hud-kill cbt-hud-in' + (mine ? ' cbt-hud-mine' : ''), null, html);
    feed.insertBefore(k, feed.firstChild);
    requestAnimationFrame?.(() => k.classList.remove('cbt-hud-in'));
    kills.push({ k, t: 7 });
    while (kills.length > killCap) { const o = kills.shift(); o.k.remove(); }
  }

  // ---- subtitles --------------------------------------------------------------------------------------
  const subs = el('div', 'cbt-hud-subs', root);
  subs.setAttribute('aria-live', 'polite');
  const subQ = createSubtitleQueue({ max: 2 });
  const subEls = [el('div', 'cbt-hud-sub', subs), el('div', 'cbt-hud-sub', subs)];
  const subAlpha = [-1, -1];
  for (const s of subEls) s.hidden = true;
  let subBottom = -1;
  function setSubsBottom(px) { px = Math.round(px); if (px !== subBottom) { subBottom = px; subs.style.bottom = px + 'px'; } }

  // ---- score pops -------------------------------------------------------------------------------------
  const pops = el('div', 'cbt-hud-pops', root);
  const popList = [];
  function addPop(points, reason) {
    const p = el('div', 'cbt-hud-pop' + (points < 0 ? ' cbt-hud-neg' : ''), null, `${points > 0 ? '+' : ''}${esc(F.comma(points))}<span>${esc(reason || '')}</span>`);
    pops.appendChild(p); popList.push({ p, t: 2.2 });
    while (popList.length > 3) popList.shift().p.remove();
  }

  // ---- banner -----------------------------------------------------------------------------------------
  const banner = el('div', 'cbt-hud-banner glass', root); banner.hidden = true; banner.setAttribute('role', 'alert');
  function showBanner(res, stats) {
    const ok = res?.outcome === 'success';
    banner.dataset.outcome = ok ? 'success' : 'failure';
    const st = stats || res?.stats || null;
    const bits = [];
    if (st) {
      if (st.kills != null) bits.push(`Kills ${st.kills}`);
      if (st.score != null) bits.push(`Score ${F.comma(st.score)}`);
      if (st.shots > 0 && st.hits != null) bits.push(`Gun hits ${Math.round(100 * st.hits / st.shots)}%`);
    }
    if (res?.time > 0) bits.push(F.mmss(res.time));
    banner.innerHTML = `<h2>${ok ? 'Mission complete' : 'Mission failed'}</h2>${res?.reason ? `<p>${esc(res.reason)}</p>` : ''}${bits.length ? `<div class="cbt-hud-stats">${esc(bits.join('  ·  '))}</div>` : ''}`;
    banner.hidden = false;
    if (!reduced()) { banner.classList.add('cbt-hud-in'); requestAnimationFrame?.(() => requestAnimationFrame?.(() => banner.classList.remove('cbt-hud-in'))); }
  }

  // ---- hints ------------------------------------------------------------------------------------------
  const hints = el('div', 'cbt-hud-hints', root); hints.hidden = true;
  const hintEls = new Map();
  for (const h of HINTS) {
    const r = el('div', 'cbt-hud-hint', hints, `${h.keys.map((k) => `<span class="cbt-hud-kbd">${esc(k)}</span>`).join('')}<span>${esc(h.text)}</span>`);
    hintEls.set(h.cmd, r);
  }
  let hintT = -1, hintsLeft = 0, hintsBlocked = false, hintsAllowed = true;
  /** the simulator's own controls card is up (same corner): hold ours back until it goes */
  function setHintsBlocked(b) {
    if (b === hintsBlocked) return;
    hintsBlocked = b; hints.style.visibility = b ? 'hidden' : '';
  }
  function setHintsAllowed(a) { hintsAllowed = !!a; hints.classList.toggle('cbt-hud-off', !hintsAllowed); }
  function startHints(on) {
    hintT = on ? 0 : -1; hints.hidden = !on; hints.classList.remove('cbt-hud-out');
    hintsLeft = HINTS.length;
    for (const r of hintEls.values()) { r.classList.remove('cbt-hud-used'); r.hidden = false; }
  }
  function usedHint(cmd) {
    const r = hintEls.get(cmd); if (!r || r.classList.contains('cbt-hud-used')) return;
    r.classList.add('cbt-hud-used'); hintsLeft--;
    setTimeout(() => { r.hidden = true; }, 650);
    if (hintsLeft <= 0) hintT = Math.max(hintT, HINT_LIFE - 1);
  }

  function reset() {
    prevState.clear(); objKey = ''; timerKey = ''; objList.textContent = ''; timer.hidden = true; setScore(0);
    for (const k of kills) k.k.remove(); kills.length = 0;
    for (const p of popList) p.p.remove(); popList.length = 0;
    subQ.clear(); for (let i = 0; i < 2; i++) { subEls[i].hidden = true; subAlpha[i] = -1; }
    banner.hidden = true; flashes.length = 0;
  }

  /** Per-frame bookkeeping (real dt; `live` = simulation running, not paused). */
  function tick(rdt, live) {
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; if ((f.t -= rdt) <= 0) { f.li.classList.remove('cbt-hud-new'); flashes.splice(i, 1); } }
    for (let i = kills.length - 1; i >= 0; i--) {
      const o = kills[i]; o.t -= rdt;
      if (o.t < 0.6 && !o.out) { o.out = true; o.k.classList.add('cbt-hud-out'); }
      if (o.t <= 0) { o.k.remove(); kills.splice(i, 1); }
    }
    for (let i = popList.length - 1; i >= 0; i--) {
      const o = popList[i]; o.t -= rdt;
      if (o.t < 0.7 && !o.out) { o.out = true; o.p.classList.add('cbt-hud-out'); }
      if (o.t <= 0) { o.p.remove(); popList.splice(i, 1); }
    }
    // subtitles
    if (live) subQ.update(rdt);
    if (subQ.changed) {
      subQ.changed = false;
      for (let i = 0; i < 2; i++) {
        const v = subQ.visible[i], s = subEls[i];
        if (!v) { s.hidden = true; s.dataset.id = ''; continue; }
        if (s.dataset.id !== String(v.id)) {
          s.dataset.id = String(v.id); s.dataset.team = v.team === 'red' ? 'red' : v.team === 'blue' ? 'blue' : 'neutral';
          s.classList.toggle('cbt-hud-urgent', v.priority >= 2);
          s.innerHTML = (v.from ? `<b>${esc(v.from)}</b>` : '') + esc(v.text);
          subAlpha[i] = -1;
        }
        s.hidden = false;
      }
    }
    for (let i = 0; i < 2; i++) {
      const v = subQ.visible[i]; if (!v) continue;
      const a = reduced() ? (v.alpha > 0.05 ? 1 : 0) : Math.round(v.alpha * 20) / 20;
      if (a !== subAlpha[i]) { subAlpha[i] = a; subEls[i].style.opacity = String(a); }
    }
    // hints
    if (hintT >= 0 && live && !hintsBlocked && hintsAllowed) {
      hintT += rdt;
      if (hintT > HINT_LIFE) hints.classList.add('cbt-hud-out');
      if (hintT > HINT_LIFE + 1) { hintT = -1; hints.hidden = true; }
    }
  }

  return {
    left, lrow, obj, side, feed, radarBox, radarCv, statBox, statCv, subs,
    renderObjectives, setTimer, setScore, addKill, addPop, showBanner, hideBanner() { banner.hidden = true; },
    startHints, usedHint, setHintsBlocked, setHintsAllowed, setKillCap(n) { killCap = n; while (kills.length > killCap) kills.shift().k.remove(); }, setSubsBottom, reset, tick, subQ,
    get hintsVisible() { return hintT >= 0; },
  };
}
