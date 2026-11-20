// Combat screens stylesheet. The screens reuse the menu's design system — the root also carries `.menu-root` (tokens,
// button reset, focus ring, vignette) and the panels/rows/chips/segments/switches/keys are the menu's own classes
// (`.menu-panel .menu-scroll .menu-sec .menu-h .menu-row .menu-chip .menu-seg .menu-switch .menu-range .menu-act
// .menu-btn .menu-fly .menu-back`) on the shared glass material. Only layout and the few combat-specific pieces
// (threat pips, rating badge, objective list, tactical map, debrief figures) are defined here, all under .cbt-ui-*.
export const CSS = /* css */`
.cbt-ui-root.menu-root { z-index: 22; }
.cbt-ui-root .cbt-ui-top {
  display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; pointer-events: none;
  padding: var(--gt) var(--gr) 0 var(--gl);
}
.cbt-ui-top > * { pointer-events: auto; }
.cbt-ui-root.cbt-ui-nohead .cbt-ui-top { display: none; }
.cbt-ui-cap { --r: var(--r-pill); height: 44px; display: flex; align-items: center; gap: 10px; box-sizing: border-box; padding: 0 16px 0 4px; min-width: 0; }
.cbt-ui-cap .menu-back { width: 36px; height: 36px; background: none; box-shadow: none; }
.cbt-ui-cap .menu-back:hover { background: var(--fill-2); }
.cbt-ui-captitle { font-family: var(--font-display); font-weight: 600; font-size: 19px; letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap; }
.cbt-ui-capsub { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cbt-ui-iconcap { --r: var(--r-pill); height: 44px; display: inline-flex; align-items: center; gap: 8px; padding: 0 16px 0 13px; box-sizing: border-box; font-size: 13.5px; font-weight: 500; color: var(--fg); }
.cbt-ui-iconcap svg { width: 18px; height: 18px; flex: none; }
.cbt-ui-iconcap[aria-pressed="true"] { color: var(--amber-soft); }

.cbt-ui-body { position: relative; min-height: 0; }
.cbt-ui-view { position: absolute; inset: 0; box-sizing: border-box; padding: 14px var(--gr) var(--gb) var(--gl); pointer-events: none; }
.cbt-ui-view > * { pointer-events: auto; }
.cbt-ui-view[hidden] { display: none !important; }

/* ---------- mission select: list + briefing side by side -------------------------------------------- */
.cbt-ui-missions { display: grid; grid-template-columns: minmax(280px, 360px) minmax(0, 620px); justify-content: center; align-items: start; column-gap: 18px; }
.cbt-ui-missions > .menu-panel { max-height: 100%; min-height: 0; }
.cbt-ui-list .menu-scroll { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent); }
.cbt-ui-list .menu-list { padding-bottom: 14px; }
.cbt-ui-groupnote { position: relative; z-index: 1; font-size: 12px; color: var(--fg-dim); padding: 0 10px 6px; line-height: 1.35; }
.cbt-ui-mrow.menu-row { grid-template-columns: 38px minmax(0, 1fr) auto; min-height: 56px; }
.cbt-ui-mno { width: 38px; height: 38px; border-radius: var(--r-s); display: grid; place-items: center; background: rgb(255 255 255 / 0.07); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1);
  font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--fg-dim); transition: color 0.2s, background 0.2s; }
.cbt-ui-mno svg { width: 18px; height: 18px; }
.cbt-ui-mrow.done .cbt-ui-mno { color: var(--hud); background: rgb(93 255 155 / 0.12); }
.cbt-ui-mrow[aria-selected="true"] .cbt-ui-mno { color: var(--accent); background: rgb(255 176 0 / 0.14); }
.cbt-ui-mtag { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.cbt-ui-rate { display: inline-grid; place-items: center; min-width: 24px; height: 22px; padding: 0 5px; box-sizing: border-box; border-radius: 7px; font-family: var(--font-display); font-weight: 700; font-size: 15px; line-height: 1;
  color: var(--fg); background: var(--fill-2); box-shadow: inset 0 0 0 1px var(--hair-2); }
.cbt-ui-rate[data-r="S"] { color: var(--accent-ink); background: var(--tint-bg); box-shadow: none; }
.cbt-ui-rate[data-r="A"] { color: var(--hud); box-shadow: inset 0 0 0 1px rgb(93 255 155 / 0.5); }
.cbt-ui-rate[data-r="B"] { color: var(--ok); box-shadow: inset 0 0 0 1px rgb(76 201 240 / 0.45); }
.cbt-ui-rate[data-r="D"] { color: var(--fg-dim); }
.cbt-ui-pips { display: inline-flex; gap: 3px; align-items: center; }
.cbt-ui-pips i { width: 6px; height: 10px; border-radius: 2px; background: rgb(255 255 255 / 0.16); }
.cbt-ui-pips i.on { background: #ff8a70; box-shadow: 0 0 6px rgb(255 90 60 / 0.45); }
.cbt-ui-empty { padding: 26px 16px 30px; text-align: center; color: var(--fg-dim); font-size: 13.5px; line-height: 1.5; }
.cbt-ui-empty b { display: block; color: var(--fg); font-size: 16px; font-weight: 600; margin-bottom: 4px; }

/* briefing */
.cbt-ui-brief { padding: 8px; }
.cbt-ui-brief > .menu-scroll { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent); }
.cbt-ui-bhead { padding: 10px 10px 4px; position: relative; }
.cbt-ui-kicker { font-size: 11.5px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--fg-faint); display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.cbt-ui-kicker .cbt-ui-done { color: var(--hud); }
.cbt-ui-btitle { font-family: var(--font-display); font-weight: 600; font-size: clamp(28px, 3.2vw, 40px); line-height: 1; letter-spacing: 0.03em; text-transform: uppercase; margin: 6px 0 6px; text-wrap: balance; }
.cbt-ui-tagline { font-size: 14.5px; color: var(--fg); margin: 0 0 10px; line-height: 1.4; }
.cbt-ui-facts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-radius: var(--r-l); background: rgb(0 0 0 / 0.14); box-shadow: inset 0 0 0 1px var(--hair); margin: 4px 0 2px; }
.cbt-ui-fact { padding: 8px 12px 9px; min-width: 0; position: relative; }
.cbt-ui-fact + .cbt-ui-fact::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 1px; background: var(--hair); }
.cbt-ui-fact-k { font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-faint); white-space: nowrap; }
.cbt-ui-fact-v { font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 3px; display: flex; align-items: center; gap: 6px; min-height: 22px; }
.cbt-ui-fact-v small { font-size: 11px; color: var(--fg-dim); }
.cbt-ui-cond { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-dim); margin: 10px 2px 0; line-height: 1.5; }
.cbt-ui-map { display: block; width: 100%; height: 150px; border-radius: var(--r-m); background: rgb(0 0 0 / 0.22); box-shadow: inset 0 0 0 1px var(--hair); margin-top: 10px; }
.cbt-ui-p { font-size: 14px; line-height: 1.55; color: rgb(242 246 250 / 0.92); margin: 0 2px 10px; }
.cbt-ui-p:last-child { margin-bottom: 0; }
.cbt-ui-obj { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.cbt-ui-obj li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 10px; align-items: start; font-size: 13.5px; line-height: 1.4; }
.cbt-ui-obj li::before { content: ""; width: 8px; height: 8px; margin: 5px 0 0 3px; transform: rotate(45deg); border: 1.5px solid var(--accent); box-sizing: border-box; }
.cbt-ui-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cbt-ui-chips .menu-chip { max-width: 100%; }
.cbt-ui-chips .menu-chip small { font-family: var(--font-mono); font-size: 10.5px; opacity: 0.75; }
.cbt-ui-fixed { font-size: 14px; color: var(--fg); padding: 2px 2px 0; }
.cbt-ui-fixed small { color: var(--fg-dim); font-size: 12px; margin-left: 6px; }
.cbt-ui-bfoot { flex: none; padding: 8px 2px 2px; display: flex; flex-direction: column; gap: 6px; }
.cbt-ui-bfoot .menu-fly { font-size: 22px !important; letter-spacing: 0.26em !important; padding-left: 0.26em !important; }
.cbt-ui-flyline { display: flex; justify-content: space-between; gap: 10px; padding: 0 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--fg-faint); text-transform: uppercase; }
.cbt-ui-flyline b { font-family: var(--font-mono); font-weight: 400; letter-spacing: 0.02em; color: var(--fg); text-transform: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* custom setup */
.cbt-ui-form { display: flex; flex-direction: column; gap: 0; }
.cbt-ui-step { display: inline-flex; align-items: center; gap: 4px; flex: none; }
.cbt-ui-step button { width: 36px; height: 36px; border-radius: 50%; display: grid; place-items: center; background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); font-size: 18px; font-weight: 500; line-height: 1; transition: background 0.2s; }
.cbt-ui-step button:hover { background: var(--fill-2); }
.cbt-ui-step button:disabled { opacity: 0.35; cursor: default; }
.cbt-ui-step output { min-width: 74px; text-align: center; font-family: var(--font-mono); font-size: 13.5px; font-variant-numeric: tabular-nums; }

/* settings */
.cbt-ui-dock { display: flex; justify-content: center; align-items: flex-start; }
.cbt-ui-dock > .menu-panel { width: min(460px, 100%); max-height: 100%; }

/* ---------- debrief ------------------------------------------------------------------------------- */
.cbt-ui-deb { display: flex; justify-content: center; align-items: center; padding-top: var(--gt); }
.cbt-ui-debp { width: min(780px, 100%); max-height: 100%; padding: 8px; }
.cbt-ui-dhead { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; padding: 14px 14px 10px; flex: none; }
.cbt-ui-outcome { font-family: var(--font-display); font-weight: 700; font-size: clamp(26px, 3.4vw, 40px); line-height: 1; letter-spacing: 0.12em; text-transform: uppercase; display: flex; align-items: center; gap: 12px; }
.cbt-ui-outcome::before { content: ""; width: 12px; height: 12px; border-radius: 50%; flex: none; background: var(--hud); box-shadow: 0 0 12px var(--hud); }
.cbt-ui-debp.fail .cbt-ui-outcome { color: #ff8a70; }
.cbt-ui-debp.fail .cbt-ui-outcome::before { background: var(--warn); box-shadow: 0 0 12px var(--warn); }
.cbt-ui-reason { font-family: var(--font-mono); font-size: 12.5px; color: var(--fg-dim); margin-top: 8px; }
.cbt-ui-dmission { font-size: 12px; font-weight: 600; letter-spacing: 0.13em; text-transform: uppercase; color: var(--fg-faint); margin-bottom: 8px; }
.cbt-ui-badge { width: 76px; height: 76px; border-radius: 22px; display: grid; place-items: center; font-family: var(--font-display); font-weight: 700; font-size: 50px; line-height: 1;
  color: var(--fg); background: rgb(0 0 0 / 0.2); box-shadow: inset 0 0 0 1.5px var(--hair-2); position: relative; }
.cbt-ui-badge small { position: absolute; top: -18px; left: 0; right: 0; text-align: center; font-family: var(--font-body); font-size: 10.5px; font-weight: 600; letter-spacing: 0.14em; color: var(--fg-faint); }
.cbt-ui-badge[data-r="S"] { color: var(--accent-ink); background: var(--tint-bg); box-shadow: var(--tint-shadow); }
.cbt-ui-badge[data-r="A"] { color: var(--hud); box-shadow: inset 0 0 0 1.5px rgb(93 255 155 / 0.55), 0 0 24px rgb(93 255 155 / 0.12); }
.cbt-ui-badge[data-r="B"] { color: var(--ok); box-shadow: inset 0 0 0 1.5px rgb(76 201 240 / 0.5); }
.cbt-ui-badge[data-r="D"] { color: var(--fg-dim); }
.cbt-ui-score { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; padding: 0 14px 12px; }
.cbt-ui-score-v { font-family: var(--font-display); font-weight: 600; font-size: 46px; line-height: 1; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.cbt-ui-score-k { font-size: 11.5px; font-weight: 600; letter-spacing: 0.13em; text-transform: uppercase; color: var(--fg-faint); }
.cbt-ui-new { font-size: 11px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-ink); background: var(--tint-bg); border-radius: var(--r-pill); padding: 3px 10px; }
.cbt-ui-dgrid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 18px; }
.cbt-ui-brk { display: flex; flex-direction: column; }
.cbt-ui-brk-row { display: flex; justify-content: space-between; gap: 12px; min-height: 32px; align-items: center; font-size: 13.5px; position: relative; }
.cbt-ui-brk-row + .cbt-ui-brk-row::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: var(--hair); }
.cbt-ui-brk-row b { font-family: var(--font-mono); font-weight: 400; font-variant-numeric: tabular-nums; }
.cbt-ui-brk-row b.neg { color: #ff8a70; }
.cbt-ui-brk-row.total { font-weight: 600; }
.cbt-ui-brk-row.total b { color: var(--fg); font-weight: 700; }
.cbt-ui-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.cbt-ui-stat { padding: 8px 12px 9px; border-radius: var(--r-m); background: rgb(0 0 0 / 0.14); box-shadow: inset 0 0 0 1px var(--hair); min-width: 0; }
.cbt-ui-stat-k { font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cbt-ui-stat-v { font-size: 20px; font-weight: 500; font-variant-numeric: tabular-nums; margin-top: 2px; white-space: nowrap; }
.cbt-ui-stat-v small { font-size: 11px; color: var(--fg-dim); margin-left: 6px; font-weight: 400; }
.cbt-ui-medals { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 6px; }
.cbt-ui-medal { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; padding: 8px 12px 8px 8px; border-radius: var(--r-m); background: rgb(255 176 0 / 0.08); box-shadow: inset 0 0 0 1px rgb(255 176 0 / 0.3); }
.cbt-ui-medal i { width: 34px; height: 34px; display: grid; place-items: center; color: var(--accent); }
.cbt-ui-medal i svg { width: 26px; height: 26px; }
.cbt-ui-medal b { display: block; font-size: 13.5px; font-weight: 600; }
.cbt-ui-medal span { display: block; font-size: 12px; color: var(--fg-dim); line-height: 1.3; }
.cbt-ui-dacts { flex: none; display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 8px; padding: 10px 2px 2px; }
.cbt-ui-dacts .menu-btn { --r: calc(var(--r-xl) - 8px); flex-direction: column; gap: 1px; line-height: 1.15; padding: 4px 10px; }
.cbt-ui-dacts .menu-btn small { font-size: 11px; font-weight: 500; opacity: 0.75; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cbt-ui-dacts .menu-btn.glass-tint { font-family: var(--font-display); font-size: 17px; letter-spacing: 0.14em; text-transform: uppercase; }
.cbt-ui-dacts .menu-btn.glass-tint small { font-family: var(--font-body); letter-spacing: 0.02em; text-transform: none; }

/* ---------- motion -------------------------------------------------------------------------------- */
@keyframes cbt-ui-in-l { from { opacity: 0; transform: translateX(-16px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes cbt-ui-in-r { from { opacity: 0; transform: translateX(16px) scale(0.985); } to { opacity: 1; transform: none; } }
@keyframes cbt-ui-in-u { from { opacity: 0; transform: translateY(18px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes cbt-ui-pop { 0% { opacity: 0; transform: scale(1.6); } 60% { opacity: 1; transform: scale(0.94); } 100% { transform: none; } }
.cbt-ui-anim .cbt-ui-list { animation: cbt-ui-in-l 0.44s var(--spring) both; }
.cbt-ui-anim .cbt-ui-brief { animation: cbt-ui-in-r 0.44s var(--spring) both; }
.cbt-ui-anim .cbt-ui-dock > .menu-panel, .cbt-ui-anim .cbt-ui-debp { animation: cbt-ui-in-u 0.5s var(--spring) both; }
.cbt-ui-anim .cbt-ui-badge { animation: cbt-ui-pop 0.6s var(--spring) 0.25s both; }

/* ---------- narrow: one panel at a time ----------------------------------------------------------- */
@media (max-width: 720px) {
  .cbt-ui-captitle { font-size: 17px; letter-spacing: 0.12em; }
  .cbt-ui-iconcap span { display: none; }
  .cbt-ui-iconcap { padding: 0; width: 44px; justify-content: center; }
  .cbt-ui-view { padding: 10px var(--gr) var(--gb) var(--gl); }
  .cbt-ui-missions { grid-template-columns: minmax(0, 1fr); }
  .cbt-ui-missions > .menu-panel { grid-row: 1; grid-column: 1; }
  .cbt-ui-root:not(.cbt-ui-detail) .cbt-ui-brief, .cbt-ui-root.cbt-ui-detail .cbt-ui-list { display: none; }
  .cbt-ui-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cbt-ui-fact { padding: 7px 9px 8px; }
  .cbt-ui-fact-v { font-size: 14.5px; }
  .cbt-ui-dgrid { grid-template-columns: minmax(0, 1fr); }
  .cbt-ui-dacts { grid-template-columns: 1fr 1fr; }
  .cbt-ui-dacts > :first-child { grid-column: 1 / 3; }
  .cbt-ui-dhead { padding: 10px 8px 8px; }
  .cbt-ui-badge { width: 62px; height: 62px; font-size: 40px; border-radius: 18px; }
  .cbt-ui-score { padding: 0 8px 10px; }
  .cbt-ui-score-v { font-size: 38px; }
  .cbt-ui-deb { align-items: stretch; }
  .cbt-ui-anim .cbt-ui-list, .cbt-ui-anim .cbt-ui-brief { animation-name: cbt-ui-in-u; }
}
@media (max-height: 600px) {
  .cbt-ui-cap, .cbt-ui-iconcap { height: 40px; }
  .cbt-ui-view { padding-top: 10px; }
  .cbt-ui-map { height: 120px; }
  .cbt-ui-dhead { padding: 10px 12px 6px; }
  .cbt-ui-score-v { font-size: 36px; }
  .cbt-ui-bfoot .menu-fly { min-height: 48px; }
}
@media (prefers-reduced-motion: reduce) {
  .cbt-ui-root *, .cbt-ui-root { animation: none !important; transition: none !important; }
}
`;
