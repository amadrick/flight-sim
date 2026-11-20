// Combat HUD — where every panel sits. ONE table so the integrator can re-seat panels after the simulator's layout
// changes (mobile pass, corner buttons, data strip) without touching the drawing code. Pure data + one DOM helper.
//
//   wide   (desktop):        objectives top-left · radar/stores/kills top-right · subtitles bottom-centre above the
//                            flight-data strip · key hints left-middle · score pops + banner top-centre
//   narrow (phone / touch):  nothing in the bottom corners or on the bottom edge — objectives top-left with the radio
//                            subtitles stacked under them (upper left edge), radar/stores/kills top-right (upper right
//                            edge; the combat fire buttons sit on the right edge around mid-height, below them)
export const SEATS = {
  narrowMaxW: 640,          // px: at or below → narrow
  narrowMaxH: 520,
  sideTop: 54,              // px below the top gutter: clears the menu's in-flight corner buttons (top right)
  killsWide: 4, killsNarrow: 2,
  subsWide: 'bottom',       // 'bottom' (above the strip estimate) | 'left' (under the objectives)
  subsNarrow: 'left',
  subsStripGap: 12,         // px between the subtitles and the top of the flight-data strip (wide)
  hintsWide: true, hintsNarrow: false,
};

export function seatMode(W, H, touch) { return touch || W <= SEATS.narrowMaxW || H <= SEATS.narrowMaxH ? 'narrow' : 'wide'; }

/** Re-parent / flag panels for a mode. Called on mode change only. */
export function applySeats(panels, root, mode) {
  const narrow = mode === 'narrow';
  root.classList.toggle('cbt-hud-narrow', narrow);
  root.style.setProperty('--cbt-side-top', SEATS.sideTop + 'px');
  const subsLeft = (narrow ? SEATS.subsNarrow : SEATS.subsWide) === 'left';
  const want = subsLeft ? panels.left : root;
  if (panels.subs.parentNode !== want) want.appendChild(panels.subs);
  panels.subs.classList.toggle('cbt-hud-subs-left', subsLeft);
  panels.setKillCap(narrow ? SEATS.killsNarrow : SEATS.killsWide);
  panels.setHintsAllowed(narrow ? SEATS.hintsNarrow : SEATS.hintsWide);
  return subsLeft;
}
