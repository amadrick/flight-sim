// Combat HUD — where every panel sits. ONE table so the integrator can re-seat panels after the simulator's layout
// changes (mobile pass, corner buttons, data strip) without touching the drawing code. Pure data + one DOM helper.
//
//   wide   (desktop):  objectives top-left · radar / stores / kill feed top-right under the menu's corner buttons ·
//                      subtitles bottom-centre above the flight-data strip · key hints left-middle · pops + banner top-centre
//   narrow (small window, mouse/keyboard): as wide, smaller panels, subtitles stacked under the objectives
//   touch  (any touch-enabled screen): the right edge belongs to the touch controls (top-right buttons, combat fire
//                      buttons on the right edge from ~64 px down), the bottom corners to stick and throttle — so the
//                      whole combat HUD stacks on the upper LEFT: [objectives | radar], stores line, kill feed, subtitles
//   compact (flag, short screens e.g. phone landscape 844×390): smaller scope, stores collapsed to one line
export const SEATS = {
  narrowMaxW: 640,          // px: at or below → narrow
  narrowMaxH: 520,
  compactMaxH: 440,         // px: at or below → compact flag
  sideTop: 54,              // px below the top gutter: clears the menu's in-flight corner buttons (top right)
  radar: { wide: 212, narrow: 132, touch: 116, compact: 92 },   // scope edge length, px
  touchLeftMax: 420,        // px: width of the left stack in touch mode (and never more than 100vw − 180 px)
  kills: { wide: 3, narrow: 2, touch: 2 },
  subs: { wide: 'bottom', narrow: 'left', touch: 'left' },     // 'bottom' (above the strip estimate) | 'left' (stacked)
  subsStripGap: 12,         // px between the subtitles and the top of the flight-data strip (wide)
  hints: { wide: true, narrow: true, touch: false },
  bannerTop: { wide: '21%', narrow: '57%', touch: '57%' },     // mission-end banner centre (sim crash card ≈ 40 %)
};

export function seatMode(W, H, touch) { return touch ? 'touch' : W <= SEATS.narrowMaxW || H <= SEATS.narrowMaxH ? 'narrow' : 'wide'; }
export function isCompact(W, H) { return H <= SEATS.compactMaxH; }

/** Re-parent / flag panels for a mode. Called on mode change only. Returns { subsLeft, radar (px) }. */
export function applySeats(panels, root, mode, compact) {
  root.classList.toggle('cbt-hud-narrow', mode !== 'wide');
  root.classList.toggle('cbt-hud-touch', mode === 'touch');
  root.classList.toggle('cbt-hud-compact', !!compact);
  const radar = compact ? SEATS.radar.compact : SEATS.radar[mode];
  root.style.setProperty('--cbt-side-top', SEATS.sideTop + 'px');
  root.style.setProperty('--cbt-radar', radar + 'px');
  root.style.setProperty('--cbt-side', (mode === 'wide' ? SEATS.radar.wide : SEATS.radar.narrow) + 'px');
  root.style.setProperty('--cbt-left-max', SEATS.touchLeftMax + 'px');
  root.style.setProperty('--cbt-banner-top', SEATS.bannerTop[mode]);
  const P = panels;
  if (mode === 'touch') {
    // left stack: [objectives | radar] row, then stores, kills, subtitles
    P.lrow.appendChild(P.radarBox);
    P.left.appendChild(P.statBox); P.left.appendChild(P.feed);
  } else {
    P.side.appendChild(P.radarBox); P.side.appendChild(P.statBox); P.side.appendChild(P.feed);
  }
  const subsLeft = SEATS.subs[mode] === 'left';
  const want = subsLeft ? P.left : root;
  if (P.subs.parentNode !== want || subsLeft) want.appendChild(P.subs);
  P.subs.classList.toggle('cbt-hud-subs-left', subsLeft);
  P.setKillCap(SEATS.kills[mode]);
  P.setHintsAllowed(SEATS.hints[mode]);
  P.radarBox.style.pointerEvents = mode === 'touch' ? 'auto' : '';
  return { subsLeft, radar };
}
