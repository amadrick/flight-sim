// The menu's single injected stylesheet. Flight-deck identity: hairline bezels, corner brackets, condensed display
// type for labels and big numerals, mono for data, amber only for the current selection and the primary action,
// cyan (--ok) for keyboard focus. Everything scoped under .menu-*.
export const CSS = /* css */`
.menu-root, .menu-corner, .menu-crash {
  --m-glass: rgba(7, 11, 16, 0.74);
  --m-glass-2: rgba(10, 15, 21, 0.88);
  --m-hair: rgba(143, 161, 179, 0.17);
  --m-hair-2: rgba(143, 161, 179, 0.30);
  --m-sel: rgba(255, 176, 0, 0.085);
  --m-hover: rgba(230, 237, 243, 0.045);
  --m-gl: max(16px, env(safe-area-inset-left, 0px));
  --m-gr: max(16px, env(safe-area-inset-right, 0px));
  --m-gb: max(16px, env(safe-area-inset-bottom, 0px));
  --m-gt: max(10px, env(safe-area-inset-top, 0px));
  font-family: var(--font-body, 'Saira', 'Segoe UI', system-ui, -apple-system, Arial, sans-serif);
  color: var(--fg, #e6edf3);
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.menu-root[hidden], .menu-corner[hidden], .menu-crash[hidden], .menu-view[hidden], .menu-root [hidden] { display: none !important; }
.menu-root {
  position: absolute; inset: 0; z-index: 20; overflow: hidden; overflow: clip;
  display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr);
}
:where(.menu-root, .menu-corner, .menu-crash) button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; text-align: inherit; }
.menu-root :focus { outline: none; }
.menu-root :focus-visible, .menu-corner :focus-visible, .menu-crash :focus-visible { outline: 2px solid var(--ok, #4cc9f0); outline-offset: 2px; }
.menu-mono { font-family: var(--font-mono, 'B612 Mono', ui-monospace, Menlo, Consolas, monospace); font-variant-numeric: tabular-nums; }
.menu-disp { font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); }

/* ---------- top status bar --------------------------------------------------------------- */
.menu-top {
  pointer-events: auto; display: flex; overflow: hidden; min-width: 0; align-items: stretch; gap: 22px; min-height: 50px;
  padding: var(--m-gt) var(--m-gr) 0 var(--m-gl);
  background: linear-gradient(to bottom, rgba(5, 8, 12, 0.82), rgba(5, 8, 12, 0.5));
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--m-hair);
}
.menu-brand { display: flex; align-items: center; gap: 12px; flex: none; }
.menu-brand-mark { width: 18px; height: 18px; position: relative; flex: none; }
.menu-brand-mark::before { content: ""; position: absolute; left: 0; right: 0; top: 8px; height: 2px; background: var(--fg, #e6edf3); }
.menu-brand-mark::after { content: ""; position: absolute; left: 6px; top: 2px; width: 6px; height: 14px; border: 2px solid var(--accent, #ffb000); border-top: 0; border-bottom: 0; }
.menu-brand-name { font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 700; font-size: 19px; letter-spacing: 0.34em; text-transform: uppercase; line-height: 1; }
.menu-brand-sub { font-family: var(--font-mono, ui-monospace, Menlo, monospace); font-size: 9.5px; letter-spacing: 0.18em; color: var(--fg-dim, #8fa1b3); text-transform: uppercase; padding-left: 12px; border-left: 1px solid var(--m-hair-2); line-height: 1.25; }
.menu-tabs { display: flex; align-items: stretch; gap: 6px; margin-left: 4px; }
.menu-tab {
  position: relative; display: flex; align-items: center; gap: 7px; padding: 0 14px;
  font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 600; font-size: 13.5px;
  letter-spacing: 0.2em; text-transform: uppercase; color: var(--fg-dim, #8fa1b3);
}
.menu-tab-n { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0; opacity: 0.6; }
.menu-tab:hover { color: var(--fg, #e6edf3); }
.menu-tab[aria-current="page"] { color: var(--fg, #e6edf3); }
.menu-tab[aria-current="page"]::after { content: ""; position: absolute; left: 14px; right: 14px; bottom: -1px; height: 2px; background: var(--accent, #ffb000); }
.menu-tab:focus-visible { outline-offset: -4px; }
.menu-status { margin-left: auto; display: flex; align-items: center; gap: 16px; min-width: 0; }
.menu-status-item { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; }
.menu-status-k { font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-size: 10px; letter-spacing: 0.22em; color: var(--fg-dim, #8fa1b3); text-transform: uppercase; }
.menu-status-v { font-family: var(--font-mono, ui-monospace, monospace); font-size: 13px; letter-spacing: 0.04em; }
.menu-iconbtn {
  width: 34px; height: 34px; flex: none; display: grid; place-items: center; align-self: center;
  border: 1px solid var(--m-hair-2); background: rgba(5, 8, 12, 0.35); color: var(--fg, #e6edf3);
}
.menu-iconbtn:hover { border-color: var(--fg-dim, #8fa1b3); background: rgba(230, 237, 243, 0.06); }
.menu-ico-fs { width: 14px; height: 14px; position: relative; }
.menu-ico-fs::before, .menu-ico-fs::after { content: ""; position: absolute; width: 5px; height: 5px; border: 1.5px solid currentColor; }
.menu-ico-fs::before { left: 0; top: 0; border-right: 0; border-bottom: 0; box-shadow: 9px 9px 0 -0px transparent; }
.menu-ico-fs::after { right: 0; bottom: 0; border-left: 0; border-top: 0; }
.menu-ico-fs > i::before, .menu-ico-fs > i::after { content: ""; position: absolute; width: 5px; height: 5px; border: 1.5px solid currentColor; }
.menu-ico-fs > i::before { right: 0; top: 0; border-left: 0; border-bottom: 0; }
.menu-ico-fs > i::after { left: 0; bottom: 0; border-right: 0; border-top: 0; }
.menu-ico-menu { width: 14px; height: 10px; border-top: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; position: relative; box-sizing: border-box; }
.menu-ico-menu::after { content: ""; position: absolute; left: 0; right: 0; top: 3px; height: 1.5px; background: currentColor; }

/* ---------- views + panels --------------------------------------------------------------- */
.menu-body { position: relative; min-height: 0; }
.menu-view { position: absolute; inset: 0; box-sizing: border-box; padding: 16px var(--m-gr) var(--m-gb) var(--m-gl); pointer-events: none; }
.menu-view > *, .menu-sheet > * { pointer-events: auto; }
.menu-panel {
  position: relative; display: flex; flex-direction: column; min-height: 0; max-height: 100%; box-sizing: border-box;
  background: var(--m-glass); border: 1px solid var(--m-hair);
  -webkit-backdrop-filter: blur(16px) saturate(1.15); backdrop-filter: blur(16px) saturate(1.15);
}
.menu-panel::before, .menu-panel::after { content: ""; position: absolute; width: 9px; height: 9px; pointer-events: none; border-color: var(--fg-dim, #8fa1b3); border-style: solid; opacity: 0.8; }
.menu-panel::before { left: -1px; top: -1px; border-width: 1px 0 0 1px; }
.menu-panel::after { right: -1px; bottom: -1px; border-width: 0 1px 1px 0; }
.menu-scroll { overflow-y: auto; overflow-x: hidden; min-height: 0; flex: 1 1 auto; overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: thin; scrollbar-color: var(--m-hair-2) transparent; }
.menu-scroll::-webkit-scrollbar { width: 6px; }
.menu-panel-plan > .menu-scroll { padding-bottom: 20px; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 26px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 26px), transparent); }
.menu-todchips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.menu-todchips .menu-chip { padding: 0 6px; min-height: 30px; font-size: 13px; }
.menu-scroll::-webkit-scrollbar-thumb { background: var(--m-hair-2); }
.menu-sec { padding: 13px 16px 14px; }
.menu-sec + .menu-sec { border-top: 1px solid var(--m-hair); }
.menu-h {
  display: flex; align-items: center; gap: 10px; margin: 0 0 10px;
  font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 600; font-size: 11.5px;
  letter-spacing: 0.24em; text-transform: uppercase; color: var(--fg-dim, #8fa1b3);
}
.menu-h::after { content: ""; flex: 1; height: 1px; background: var(--m-hair); }
.menu-h-n { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.05em; color: var(--fg-dim, #8fa1b3); opacity: 0.7; }
.menu-h-aside { order: 3; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.06em; text-transform: none; }
.menu-grouplabel { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.2em; color: var(--fg-dim, #8fa1b3); text-transform: uppercase; padding: 8px 0 5px; display: flex; gap: 8px; }
.menu-grouplabel span { opacity: 0.55; }

/* list rows (aircraft, airports) */
.menu-list { display: flex; flex-direction: column; }
.menu-row {
  display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; align-items: center; column-gap: 10px;
  min-height: 44px; padding: 5px 10px 5px 12px; position: relative; border-top: 1px solid var(--m-hair);
}
.menu-list > .menu-row:last-child { border-bottom: 1px solid var(--m-hair); }
.menu-row:hover { background: var(--m-hover); }
.menu-row[aria-selected="true"] { background: var(--m-sel); box-shadow: inset 2px 0 0 var(--accent, #ffb000); }
.menu-row:focus-visible { outline-offset: -2px; }
.menu-row-code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 14px; font-weight: 700; letter-spacing: 0.04em; color: var(--fg, #e6edf3); }
.menu-row[aria-selected="true"] .menu-row-code { color: var(--accent, #ffb000); }
.menu-row-main { min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
.menu-row-name { font-size: 14.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-row-sub { font-size: 11.5px; color: var(--fg-dim, #8fa1b3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-row-tag { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; color: var(--fg-dim, #8fa1b3); text-align: right; line-height: 1.3; }

/* aircraft panel */
.menu-panel-ac .menu-aclist { flex: 0 0 auto; max-height: 38vh; }
.menu-acinfo { flex: 0 1 auto; border-top: 1px solid var(--m-hair); margin-top: 10px; }
.menu-acname { font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 600; font-size: 26px; line-height: 1.05; letter-spacing: 0.02em; text-transform: uppercase; margin: 2px 0 4px; }
.menu-acmeta { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--fg-dim, #8fa1b3); letter-spacing: 0.04em; line-height: 1.55; }
.menu-acmeta b { color: var(--fg, #e6edf3); font-weight: 400; }
.menu-lore { font-size: 13px; line-height: 1.45; color: var(--fg-dim, #8fa1b3); margin: 10px 0 0; }
.menu-lore-tag { color: var(--fg, #e6edf3); font-weight: 500; }
.menu-specs { display: grid; grid-template-columns: 1fr 1fr; margin: 12px 0 0; border-top: 1px solid var(--m-hair); }
.menu-spec { padding: 7px 0 6px; border-bottom: 1px solid var(--m-hair); min-width: 0; }
.menu-spec:nth-child(odd) { padding-right: 10px; border-right: 1px solid var(--m-hair); }
.menu-spec:nth-child(even) { padding-left: 10px; }
.menu-spec-k { font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-size: 10.5px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--fg-dim, #8fa1b3); }
.menu-spec-v { font-family: var(--font-mono, ui-monospace, monospace); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-spec-u { font-size: 10.5px; color: var(--fg-dim, #8fa1b3); margin-left: 4px; }

/* chips / segmented options */
.menu-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.menu-chip {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 0 11px;
  border: 1px solid var(--m-hair-2); color: var(--fg-dim, #8fa1b3); background: rgba(5, 8, 12, 0.25);
  font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 500; font-size: 13.5px; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap;
}
.menu-chip:hover { color: var(--fg, #e6edf3); border-color: var(--fg-dim, #8fa1b3); }
.menu-chip[aria-checked="true"] { color: var(--accent, #ffb000); border-color: var(--accent, #ffb000); background: var(--m-sel); }
.menu-seg { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; border: 1px solid var(--m-hair-2); }
.menu-seg .menu-chip { border: 0; border-left: 1px solid var(--m-hair-2); min-height: 40px; flex-direction: column; gap: 0; line-height: 1.1; padding: 4px 6px; background: none; }
.menu-seg .menu-chip:first-child { border-left: 0; }
.menu-seg .menu-chip[aria-checked="true"] { box-shadow: inset 0 0 0 1px var(--accent, #ffb000); background: var(--m-sel); }
.menu-seg .menu-chip:focus-visible { outline-offset: -3px; }
.menu-note { font-size: 12px; color: var(--fg-dim, #8fa1b3); margin: 8px 0 0; line-height: 1.4; min-height: 1.4em; }

/* runway designators — styled like taxiway location signs: yellow on black, yellow border */
.menu-rwys { display: flex; flex-wrap: wrap; gap: 6px; }
.menu-livsec { margin-bottom: 18px; }
.menu-liveries .menu-chip { min-height: 32px; padding: 0 12px; }
.menu-rwy {
  min-width: 52px; height: 34px; padding: 0 9px; display: inline-grid; place-items: center;
  font-family: var(--font-mono, ui-monospace, monospace); font-weight: 700; font-size: 16px; letter-spacing: 0.06em;
  color: var(--fg-dim, #8fa1b3); border: 1px solid var(--m-hair-2); background: rgba(0, 0, 0, 0.35);
}
.menu-rwy:hover { color: var(--fg, #e6edf3); border-color: var(--fg-dim, #8fa1b3); }
.menu-rwy[aria-checked="true"] { background: #000; color: var(--accent, #ffb000); border: 2px solid var(--accent, #ffb000); }
.menu-rwyinfo { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--fg-dim, #8fa1b3); margin-top: 8px; letter-spacing: 0.03em; }
.menu-aptdesc { font-size: 12.5px; color: var(--fg-dim, #8fa1b3); line-height: 1.4; margin: 8px 0 0; }

/* time of day */
.menu-tod-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.menu-tod-read { font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 600; font-size: 34px; line-height: 1; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; }
.menu-tod-read small { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--fg-dim, #8fa1b3); font-weight: 400; margin-left: 6px; letter-spacing: 0.1em; }
.menu-tod-phase { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--fg-dim, #8fa1b3); letter-spacing: 0.08em; text-transform: uppercase; }
.menu-slider { position: relative; padding: 6px 0 2px; }
.menu-range { -webkit-appearance: none; appearance: none; width: 100%; height: 28px; margin: 0; background: transparent; cursor: pointer; display: block; touch-action: none; }
.menu-range::-webkit-slider-runnable-track { height: 28px; background:
  linear-gradient(to right, #142040 0%, #142040 17%, #6a4a7a 19.5%, #e8955a 21.5%, #8fb8dc 27%, #b8d8ef 50%, #8fb8dc 72%, #f0a050 78.5%, #7a4060 80.5%, #142040 84%, #142040 100%) 0 100% / 100% 3px no-repeat,
  linear-gradient(var(--m-hair-2), var(--m-hair-2)) 0 50% / 100% 1px no-repeat,
  repeating-linear-gradient(to right, var(--m-hair-2) 0 1px, transparent 1px calc(100% / 24)) 0 50% / calc(100% - 1px) 9px no-repeat,
  repeating-linear-gradient(to right, var(--fg-dim, #8fa1b3) 0 1px, transparent 1px calc(100% / 4)) 0 50% / calc(100% - 1px) 15px no-repeat; }
.menu-range::-moz-range-track { height: 28px; background:
  linear-gradient(to right, #142040 0%, #142040 17%, #6a4a7a 19.5%, #e8955a 21.5%, #8fb8dc 27%, #b8d8ef 50%, #8fb8dc 72%, #f0a050 78.5%, #7a4060 80.5%, #142040 84%, #142040 100%) 0 100% / 100% 3px no-repeat,
  linear-gradient(var(--m-hair-2), var(--m-hair-2)) 0 50% / 100% 1px no-repeat,
  repeating-linear-gradient(to right, var(--m-hair-2) 0 1px, transparent 1px calc(100% / 24)) 0 50% / calc(100% - 1px) 9px no-repeat,
  repeating-linear-gradient(to right, var(--fg-dim, #8fa1b3) 0 1px, transparent 1px calc(100% / 4)) 0 50% / calc(100% - 1px) 15px no-repeat; }
.menu-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 8px; height: 26px; margin-top: 1px; background: var(--accent, #ffb000); border: 0; border-radius: 0; box-shadow: 0 0 0 3px rgba(5, 8, 12, 0.85); }
.menu-range::-moz-range-thumb { width: 8px; height: 26px; background: var(--accent, #ffb000); border: 0; border-radius: 0; box-shadow: 0 0 0 3px rgba(5, 8, 12, 0.85); }
.menu-range:focus-visible { outline-offset: 3px; }
.menu-range.menu-range-plain::-webkit-slider-runnable-track { background: linear-gradient(var(--m-hair-2), var(--m-hair-2)) 0 50% / 100% 2px no-repeat; }
.menu-range.menu-range-plain::-moz-range-track { background: linear-gradient(var(--m-hair-2), var(--m-hair-2)) 0 50% / 100% 2px no-repeat; }
.menu-scale { display: flex; justify-content: space-between; font-family: var(--font-mono, ui-monospace, monospace); font-size: 9.5px; color: var(--fg-dim, #8fa1b3); opacity: 0.8; margin: 0 -2px 10px; }

/* weather */
.menu-wx { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.menu-wx .menu-chip { flex-direction: column; align-items: flex-start; gap: 1px; min-height: 46px; padding: 5px 9px; white-space: normal; text-align: left; line-height: 1.1; }
.menu-wx-code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; opacity: 0.85; }
.menu-wx-label { font-size: 12.5px; letter-spacing: 0.05em; }
.menu-metar { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; color: var(--fg-dim, #8fa1b3); margin-top: 10px; line-height: 1.5; letter-spacing: 0.02em; word-break: break-word; }
.menu-metar b { color: var(--fg, #e6edf3); font-weight: 400; }

/* fly bar */
.menu-flybar { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 9px; }
.menu-clear { display: flex; justify-content: space-between; gap: 10px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; letter-spacing: 0.04em; color: var(--fg-dim, #8fa1b3); }
.menu-clear b { color: var(--fg, #e6edf3); font-weight: 400; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-fly {
  position: relative; display: flex !important; align-items: center; justify-content: center; gap: 14px; width: 100%; min-height: 54px;
  background: var(--accent, #ffb000) !important; color: #120c00 !important; text-align: center !important;
  font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif) !important; font-weight: 700 !important; font-size: 25px !important;
  letter-spacing: 0.42em !important; text-transform: uppercase; padding-left: 0.42em !important;
  transition: filter 0.15s, transform 0.08s;
}
.menu-fly:hover { filter: brightness(1.08); }
.menu-fly:active { transform: translateY(1px); }
.menu-fly-arrow { width: 22px; height: 12px; position: relative; flex: none; margin-left: -0.2em; }
.menu-fly-arrow::before { content: ""; position: absolute; left: 0; right: 3px; top: 5px; height: 2px; background: currentColor; }
.menu-fly-arrow::after { content: ""; position: absolute; right: 1px; top: 1px; width: 8px; height: 8px; border: solid currentColor; border-width: 2px 2px 0 0; transform: rotate(45deg); }
.menu-fly-key { position: absolute; right: 12px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.08em; font-weight: 700; opacity: 0.55; border: 1px solid currentColor; padding: 1px 5px; }

/* hero placard (wide screens only) */
.menu-hero { pointer-events: none !important; align-self: end; justify-self: center; text-align: center; min-width: 0; max-width: min(760px, 100%); padding-bottom: 2px; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.75), 0 0 24px rgba(0, 0, 0, 0.45); }
.menu-hero-kicker { text-wrap: balance; font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: rgba(230, 237, 243, 0.82); }
.menu-hero-name { font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 600; font-size: clamp(38px, 3.9vw, 68px); line-height: 0.98; letter-spacing: 0.03em; text-transform: uppercase; margin: 6px 0 6px; }
.menu-hero-tag { font-size: 15px; color: rgba(230, 237, 243, 0.85); margin: 0 0 12px; }
.menu-hero-metar { display: inline-flex; align-items: stretch; border: 1px solid var(--m-hair-2); background: rgba(5, 8, 12, 0.6); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); text-shadow: none; }
.menu-hero-metar { max-width: 100%; text-align: left; }
.menu-hero-metar > span { padding: 5px 9px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px; letter-spacing: 0.04em; line-height: 1.45; }
.menu-hero-metar > span:first-child { display: flex; align-items: center; }
.menu-hero-metar > span:first-child { color: #000; background: var(--fg-dim, #8fa1b3); font-weight: 700; letter-spacing: 0.12em; }

/* ---------- main (hangar) layout ------------------------------------------------------------ */
.menu-main { display: grid; grid-template-columns: minmax(290px, 360px) minmax(0, 1fr) minmax(320px, 392px); grid-template-rows: minmax(0, 1fr) auto; column-gap: 20px; row-gap: 10px; }
.menu-sheet { display: contents; }
.menu-main .menu-panel-ac { grid-column: 1; grid-row: 1 / 3; align-self: start; max-height: 100%; }
.menu-main .menu-panel-plan { grid-column: 3; grid-row: 1; align-self: stretch; }
.menu-main .menu-flybar { grid-column: 3; grid-row: 2; }
.menu-main .menu-hero { grid-column: 2; grid-row: 1 / 3; }
.menu-grab { display: none; }

/* single-panel views */
.menu-dock { display: flex; }
.menu-dock-l { justify-content: flex-start; }
.menu-dock-r { justify-content: flex-end; }
.menu-dock > .menu-panel { width: min(400px, 100%); align-self: stretch; }
.menu-dock-wide > .menu-panel { width: min(880px, 100%); }
.menu-subhead { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--m-hair); flex: none; }
.menu-back { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px 0 8px; border: 1px solid var(--m-hair-2); font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-weight: 600; font-size: 12.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--fg-dim, #8fa1b3); }
.menu-back:hover { color: var(--fg, #e6edf3); border-color: var(--fg-dim, #8fa1b3); }
.menu-back::before { content: ""; width: 6px; height: 6px; border: solid currentColor; border-width: 0 0 1.5px 1.5px; transform: rotate(45deg); margin-left: 3px; }
.menu-subtitle { font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 600; font-size: 20px; letter-spacing: 0.16em; text-transform: uppercase; }

/* settings */
.menu-opt { display: grid; grid-template-columns: 18px minmax(0, 1fr); column-gap: 12px; padding: 10px 10px 10px 8px; border-top: 1px solid var(--m-hair); width: 100%; box-sizing: border-box; }
.menu-opts > .menu-opt:last-child { border-bottom: 1px solid var(--m-hair); }
.menu-opt:hover { background: var(--m-hover); }
.menu-opt[aria-checked="true"] { background: var(--m-sel); }
.menu-opt:focus-visible { outline-offset: -2px; }
.menu-radio { width: 12px; height: 12px; border: 1px solid var(--fg-dim, #8fa1b3); border-radius: 50%; margin-top: 4px; display: grid; place-items: center; }
.menu-opt[aria-checked="true"] .menu-radio { border-color: var(--accent, #ffb000); }
.menu-opt[aria-checked="true"] .menu-radio::after { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--accent, #ffb000); }
.menu-opt-t { font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-weight: 600; font-size: 16px; letter-spacing: 0.12em; text-transform: uppercase; display: flex; justify-content: space-between; gap: 8px; }
.menu-opt[aria-checked="true"] .menu-opt-t { color: var(--accent, #ffb000); }
.menu-opt-t small { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10px; letter-spacing: 0.04em; color: var(--fg-dim, #8fa1b3); font-weight: 400; text-transform: none; }
.menu-opt-d { font-size: 12.5px; color: var(--fg-dim, #8fa1b3); line-height: 1.35; margin-top: 2px; }
.menu-field { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.menu-field-l { display: flex; flex-direction: column; line-height: 1.25; }
.menu-field-t { font-size: 14px; font-weight: 500; }
.menu-field-d { font-size: 12px; color: var(--fg-dim, #8fa1b3); }
.menu-vol { display: grid; grid-template-columns: minmax(0, 1fr) 54px; align-items: center; gap: 12px; }
.menu-vol-read { font-family: var(--font-mono, ui-monospace, monospace); font-size: 15px; text-align: right; }
.menu-annun {
  min-width: 74px; height: 34px; display: inline-grid; grid-template-columns: auto auto; align-items: center; justify-content: center; gap: 8px;
  border: 1px solid var(--m-hair-2); background: rgba(0, 0, 0, 0.45);
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; font-weight: 700; letter-spacing: 0.14em; color: var(--fg-dim, #8fa1b3);
}
.menu-annun::before { content: ""; width: 7px; height: 7px; background: #33404c; }
.menu-annun[aria-pressed="true"] { color: var(--hud, #5dff9b); border-color: rgba(93, 255, 155, 0.45); }
.menu-annun[aria-pressed="true"]::before { background: var(--hud, #5dff9b); box-shadow: 0 0 8px rgba(93, 255, 155, 0.7); }
.menu-fine { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; color: var(--fg-dim, #8fa1b3); line-height: 1.6; letter-spacing: 0.03em; }

/* controls reference */
.menu-keys { columns: 2 340px; column-gap: 28px; padding: 14px 16px 6px; }
.menu-keygroup { break-inside: avoid; margin: 0 0 14px; }
.menu-keyrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 32px; border-top: 1px solid var(--m-hair); padding: 3px 0; }
.menu-keygroup .menu-keyrow:last-child { border-bottom: 1px solid var(--m-hair); }
.menu-keyrow-a { font-size: 13px; color: var(--fg, #e6edf3); line-height: 1.25; }
.menu-keyrow-k { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 4px; flex: none; max-width: 60%; }
.menu-keyrow-k.menu-keytext { font-family: var(--font-mono, ui-monospace, monospace); font-size: 10.5px; color: var(--fg-dim, #8fa1b3); text-align: right; flex: 0 1 auto; display: block; }
.menu-kbd {
  display: inline-grid; place-items: center; min-width: 24px; height: 23px; padding: 0 6px; box-sizing: border-box;
  font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px; font-weight: 700; line-height: 1; color: var(--fg, #e6edf3);
  background: linear-gradient(#1a242e, #121a22); border: 1px solid #3a4a5a; border-bottom-width: 2px; border-radius: 3px;
}
.menu-kor { font-size: 10px; color: var(--fg-dim, #8fa1b3); font-style: italic; padding: 0 1px; }
.menu-kslash { font-family: var(--font-mono, ui-monospace, monospace); font-size: 12px; color: var(--fg-dim, #8fa1b3); padding: 0 3px; }
.menu-devices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid var(--m-hair); }
.menu-device { padding: 12px 16px 14px; font-size: 12.5px; color: var(--fg-dim, #8fa1b3); line-height: 1.45; }
.menu-device + .menu-device { border-left: 1px solid var(--m-hair); }
.menu-device b { display: block; font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-weight: 600; font-size: 11.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--fg, #e6edf3); margin-bottom: 3px; }

/* pause */
.menu-pause-head { padding: 18px 16px 14px; border-bottom: 1px solid var(--m-hair); flex: none; }
.menu-pause-title { font-family: var(--font-display, 'Saira Condensed', 'Arial Narrow', Arial, sans-serif); font-weight: 700; font-size: 38px; line-height: 1; letter-spacing: 0.22em; text-transform: uppercase; display: flex; align-items: center; gap: 12px; }
.menu-pause-title::before { content: ""; width: 12px; height: 26px; border: solid var(--fg, #e6edf3); border-width: 0 4px; box-sizing: border-box; flex: none; }
.menu-pause-sub { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--fg-dim, #8fa1b3); margin-top: 10px; letter-spacing: 0.04em; line-height: 1.6; }
.menu-pause-sub b { color: var(--fg, #e6edf3); font-weight: 400; }
.menu-actions { display: flex; flex-direction: column; padding: 12px 16px 14px; gap: 0; }
.menu-act {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 0 12px;
  border-top: 1px solid var(--m-hair); font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-weight: 600; font-size: 16px; letter-spacing: 0.14em; text-transform: uppercase;
}
.menu-act:last-child { border-bottom: 1px solid var(--m-hair); }
.menu-act:hover { background: var(--m-hover); }
.menu-act:focus-visible { outline-offset: -2px; }
.menu-act-primary { background: var(--accent, #ffb000) !important; color: #120c00; border: 0; margin-bottom: 8px; min-height: 50px; font-size: 19px; font-weight: 700; letter-spacing: 0.3em; }
.menu-act-primary + .menu-act { border-top: 1px solid var(--m-hair); }
.menu-act-primary .menu-kbd { color: #120c00; background: none; border-color: rgba(18, 12, 0, 0.45); }
.menu-act-dim { color: var(--fg-dim, #8fa1b3); }
.menu-act .menu-kbd { font-size: 10px; height: 20px; min-width: 20px; }
.menu-act-chev { width: 7px; height: 7px; border: solid currentColor; border-width: 1.5px 1.5px 0 0; transform: rotate(45deg); opacity: 0.6; margin-right: 4px; }

/* ---------- in-flight corner buttons + crash dialog -------------------------------------------- */
.menu-corner { position: absolute; z-index: 15; top: var(--m-gt); right: var(--m-gr); display: flex; gap: 6px; pointer-events: auto; margin-top: 6px; }
.menu-corner .menu-iconbtn { background: rgba(5, 8, 12, 0.5); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.menu-fab { width: auto !important; padding: 0 11px; display: inline-flex !important; gap: 8px; font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-weight: 600; font-size: 12px; letter-spacing: 0.2em; text-transform: uppercase; }
.menu-crash {
  position: absolute; z-index: 21; left: 50%; bottom: calc(var(--m-gb) + 56px); transform: translateX(-50%);
  width: min(420px, calc(100% - 32px)); box-sizing: border-box; pointer-events: auto;
  background: var(--m-glass-2); border: 1px solid var(--m-hair-2); border-top: 2px solid var(--warn, #ff5a3c);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); padding: 14px 16px 16px;
  animation: menu-rise 0.28s ease-out;
}
.menu-crash-t { font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-weight: 700; font-size: 18px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--warn, #ff5a3c); }
.menu-crash-r { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11.5px; color: var(--fg-dim, #8fa1b3); margin: 4px 0 12px; letter-spacing: 0.03em; }
.menu-crash-b { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.menu-btn { min-height: 42px; display: inline-flex; align-items: center; justify-content: center; border: 1px solid var(--m-hair-2); font-family: var(--font-display, 'Saira Condensed', Arial, sans-serif); font-weight: 600; font-size: 14px; letter-spacing: 0.16em; text-transform: uppercase; text-align: center !important; }
.menu-btn:hover { border-color: var(--fg-dim, #8fa1b3); background: var(--m-hover); }
.menu-btn-primary { background: var(--accent, #ffb000) !important; color: #120c00 !important; border-color: var(--accent, #ffb000); font-weight: 700; }

@keyframes menu-rise { from { opacity: 0; transform: translate(-50%, 10px); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes menu-in-l { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
@keyframes menu-in-r { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
@keyframes menu-in-u { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes menu-fade { from { opacity: 0; } to { opacity: 1; } }
.menu-anim .menu-main .menu-panel-ac, .menu-anim .menu-dock-l > .menu-panel { animation: menu-in-l 0.32s cubic-bezier(.2,.7,.2,1) both; }
.menu-anim .menu-main .menu-panel-plan, .menu-anim .menu-main .menu-flybar, .menu-anim .menu-dock-r > .menu-panel { animation: menu-in-r 0.32s cubic-bezier(.2,.7,.2,1) both; }
.menu-anim .menu-hero { animation: menu-fade 0.6s ease-out both; }

/* ---------- responsive ---------------------------------------------------------------------- */
@media (min-width: 1600px) {
  .menu-main { grid-template-columns: minmax(300px, 400px) minmax(0, 1fr) minmax(340px, 430px); column-gap: 28px; }
}
@media (max-width: 1180px) {
  .menu-main { grid-template-columns: minmax(270px, 330px) minmax(0, 1fr) minmax(290px, 350px); column-gap: 14px; }
  .menu-brand-sub { display: none; }
}
@media (max-width: 1060px), (max-height: 600px) {
  .menu-hero { display: none; }
}
@media (max-height: 640px) and (min-width: 721px) {
  .menu-top { min-height: 42px; }
  .menu-view { padding-top: 10px; padding-bottom: max(10px, env(safe-area-inset-bottom, 0px)); }
  .menu-main .menu-panel-ac { overflow-y: auto; overscroll-behavior: contain; touch-action: pan-y; scrollbar-width: thin; align-self: stretch; }
  .menu-panel-ac .menu-aclist { max-height: none; overflow: visible; flex: none; }
  .menu-sec { padding: 10px 14px 12px; }
  .menu-flybar { padding: 9px 12px 10px; gap: 6px; }
  .menu-fly { min-height: 44px; font-size: 21px !important; }
  .menu-acname { font-size: 22px; }
  .menu-status-item:not(.menu-status-keep) { display: none; }
  .menu-pause-head { padding: 12px 14px 10px; }
  .menu-pause-title { font-size: 28px; }
  .menu-pause-title::before { height: 20px; }
}
@media (max-width: 860px) and (min-width: 721px) {
  .menu-main { grid-template-columns: minmax(250px, 1fr) 0 minmax(270px, 1fr); column-gap: 12px; }
  .menu-tab-n { display: none; }
}
@media (max-width: 720px) {
  .menu-top { gap: 8px; min-height: 46px; }
  .menu-brand-name { font-size: 15px; letter-spacing: 0.22em; }
  .menu-brand-mark { display: none; }
  .menu-tabs { margin-left: auto; gap: 0; }
  .menu-tab { padding: 0 7px; font-size: 12px; letter-spacing: 0.1em; }
  .menu-top .menu-fsbtn { display: none; }
  .menu-tab-n { display: none; }
  .menu-tab[aria-current="page"]::after { left: 8px; right: 8px; }
  .menu-status { margin-left: 0; }
  .menu-status-item { display: none; }
  .menu-view { padding: 0; }
  .menu-main { display: block; }
  .menu-sheet, .menu-dock > .menu-panel {
    position: absolute; left: 0; right: 0; bottom: 0; width: auto !important; max-height: 56%;
    background: var(--m-glass-2); border: 0; border-top: 1px solid var(--m-hair-2);
    -webkit-backdrop-filter: blur(18px) saturate(1.15); backdrop-filter: blur(18px) saturate(1.15);
    box-sizing: border-box;
  }
  .menu-dock > .menu-panel { max-height: 76%; padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }
  .menu-dock > .menu-panel::before, .menu-dock > .menu-panel::after { display: none; }
  .menu-sheet { display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; padding: 0 var(--m-gr) 0 var(--m-gl); scrollbar-width: none; }
  .menu-sheet > .menu-panel { background: none; border: 0; -webkit-backdrop-filter: none; backdrop-filter: none; max-height: none; flex: none; }
  .menu-sheet > .menu-panel::before, .menu-sheet > .menu-panel::after { display: none; }
  .menu-sheet .menu-sec { padding-left: 0; padding-right: 0; }
  .menu-sheet .menu-scroll, .menu-panel-ac .menu-aclist { overflow: visible; max-height: none; flex: none; }
  .menu-sheet .menu-aclist { padding: 0 !important; }
  .menu-sheet .menu-scroll.menu-aclist { max-height: 228px; overflow-y: auto; overscroll-behavior: auto; border-bottom: 1px solid var(--m-hair); }
  .menu-sheet .menu-panel-plan { border-top: 1px solid var(--m-hair); }
  .menu-grab { display: block; flex: none; width: 40px; height: 4px; border-radius: 2px; background: var(--m-hair-2); margin: 8px auto 2px; }
  .menu-sheet > .menu-flybar { position: sticky; bottom: 0; z-index: 2; margin: 0 calc(-1 * var(--m-gr)) 0 calc(-1 * var(--m-gl)); padding: 10px var(--m-gr) var(--m-gb) var(--m-gl); background: rgba(8, 12, 17, 0.96); border-top: 1px solid var(--m-hair-2); flex: none; }
  .menu-fly { min-height: 50px; }
  .menu-devices { grid-template-columns: 1fr; }
  .menu-device + .menu-device { border-left: 0; border-top: 1px solid var(--m-hair); }
  .menu-keys { columns: 1; }
  .menu-crash { bottom: calc(var(--m-gb) + 24px); }
  .menu-anim .menu-sheet, .menu-anim .menu-dock > .menu-panel { animation: menu-in-u 0.32s cubic-bezier(.2,.7,.2,1) both; }
  .menu-anim .menu-main .menu-panel-ac, .menu-anim .menu-main .menu-panel-plan, .menu-anim .menu-main .menu-flybar { animation: none; }
}
@media (max-width: 380px) {
  .menu-brand-name { letter-spacing: 0.18em; }
  .menu-tab { padding: 0 6px; letter-spacing: 0.08em; }
  .menu-wx { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .menu-root *, .menu-crash, .menu-corner * { animation: none !important; transition: none !important; }
}
`;
