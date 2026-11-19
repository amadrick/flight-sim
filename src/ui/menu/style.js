// The menu's single injected stylesheet. Skyward glass (material tokens live in index.template.html): floating
// translucent panels over the live hangar scene, specular rims lit from the sun's screen direction, concentric radii,
// morphing selection highlights (.menu-ind), springy but quick motion. Aviation identity stays in the details:
// condensed display type for names and big numerals, B612 Mono for data, amber for the selection and the one
// primary action, taxiway-sign runway chips. Everything is scoped under .menu-*.
// Sheet layout (phones, portrait tablets) is the block at the end: panels become one bottom sheet.
export const CSS = /* css */`
.menu-root, .menu-corner, .menu-crash {
  --hair: rgb(255 255 255 / 0.09);
  --hair-2: rgb(255 255 255 / 0.16);
  --fill: rgb(255 255 255 / 0.06);
  --fill-2: rgb(255 255 255 / 0.1);
  --fill-hover: rgb(255 255 255 / 0.08);
  --sel: rgb(255 255 255 / 0.15);
  --amber-soft: #ffd27a;
  font-family: var(--font-body, 'Saira', 'Segoe UI', system-ui, Arial, sans-serif);
  color: var(--fg, #f2f6fa);
  -webkit-user-select: none; user-select: none;
  -webkit-tap-highlight-color: transparent;
  font-size: 14px; line-height: 1.35;
}
.menu-root[hidden], .menu-corner[hidden], .menu-crash[hidden], .menu-view[hidden], .menu-root [hidden], .menu-corner [hidden] { display: none !important; }
.menu-root {
  position: absolute; inset: 0; z-index: 20; overflow: hidden; overflow: clip;
  display: grid; grid-template-rows: auto minmax(0, 1fr); grid-template-columns: minmax(0, 1fr);
}
/* a soft vignette at the edges keeps glass text legible over bright sky without darkening the hero */
.menu-root::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: -1;
  background: radial-gradient(130% 100% at 50% 40%, transparent 55%, rgb(0 0 0 / 0.28) 100%); }
:where(.menu-root, .menu-corner, .menu-crash) button { font: inherit; color: inherit; background: none; border: 0; margin: 0; padding: 0; cursor: pointer; text-align: inherit; }
.menu-root :focus, .menu-corner :focus, .menu-crash :focus { outline: none; }
.menu-root :focus-visible, .menu-corner :focus-visible, .menu-crash :focus-visible { outline: 2px solid var(--focus, #7fd8ff); outline-offset: 2px; }
.menu-mono { font-family: var(--font-mono, 'B612 Mono', ui-monospace, Menlo, Consolas, monospace); font-variant-numeric: tabular-nums; }
.menu-ind { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 0; border-radius: inherit;
  background: var(--sel); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14), inset 0 1px 0 rgb(255 255 255 / 0.18), 0 2px 10px rgb(0 0 0 / 0.12);
  transition: transform 0.38s var(--spring), width 0.38s var(--spring), height 0.38s var(--spring), opacity 0.2s; opacity: 0; }
.menu-ind.on { opacity: 1; }
.menu-ind.snap { transition: none; }

/* ---------- top bar: three floating capsules ---------------------------------------------------- */
.menu-top {
  display: flex; align-items: center; gap: 10px; min-width: 0; pointer-events: none;
  padding: var(--gt) var(--gr) 0 var(--gl);
}
.menu-top > * { pointer-events: auto; }
.menu-cap { --r: var(--r-pill); height: 44px; display: flex; align-items: center; box-sizing: border-box; }
.menu-brand { gap: 10px; padding: 0 18px 0 14px; flex: none; }
.menu-brand-mark { width: 22px; height: 22px; flex: none; color: var(--accent, #ffb000); }
.menu-brand-name { font-family: var(--font-display); font-weight: 700; font-size: 17px; letter-spacing: 0.3em; text-transform: uppercase; line-height: 1; padding-left: 0.1em; }
.menu-tabs { position: relative; padding: 4px; gap: 2px; margin: 0 auto; }
.menu-tabs > .menu-ind { border-radius: var(--r-pill); }
.menu-tab {
  position: relative; z-index: 1; height: 36px; display: flex; align-items: center; gap: 8px; padding: 0 18px; border-radius: var(--r-pill);
  font-weight: 500; font-size: 14px; letter-spacing: 0.02em; color: var(--fg-dim); transition: color 0.2s;
}
.menu-tab svg { width: 16px; height: 16px; flex: none; opacity: 0.9; }
.menu-tab:hover { color: var(--fg); }
.menu-tab[aria-current="page"] { color: var(--fg); }
.menu-status { gap: 0; padding: 0 4px 0 16px; flex: none; }
.menu-status-item { display: flex; align-items: baseline; gap: 7px; padding-right: 14px; }
.menu-status-item + .menu-status-item { padding-left: 14px; border-left: 1px solid var(--hair-2); }
.menu-status-k { font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--fg-faint); text-transform: uppercase; }
.menu-status-v { font-size: 14px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; white-space: nowrap; }
.menu-iconbtn { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: 50%; color: var(--fg); transition: background 0.2s; }
.menu-iconbtn:hover { background: var(--fill-2); }
.menu-iconbtn svg { width: 18px; height: 18px; }

/* ---------- views + panels ------------------------------------------------------------------------ */
.menu-body { position: relative; min-height: 0; }
.menu-view { position: absolute; inset: 0; box-sizing: border-box; padding: 14px var(--gr) var(--gb) var(--gl); pointer-events: none; }
.menu-view > *, .menu-sheet > * { pointer-events: auto; }
.menu-panel { --r: var(--r-xl); display: flex; flex-direction: column; min-height: 0; max-height: 100%; box-sizing: border-box; padding: 8px; }
.menu-scroll { overflow-y: auto; overflow-x: hidden; min-height: 0; flex: 1 1 auto; overscroll-behavior: contain; touch-action: pan-y;
  scrollbar-width: thin; scrollbar-color: rgb(255 255 255 / 0.22) transparent; border-radius: var(--r-l); }
.menu-scroll::-webkit-scrollbar { width: 6px; }
.menu-scroll::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.22); border-radius: 3px; }
.menu-sec { padding: 12px 10px 14px; position: relative; }
.menu-sec + .menu-sec::before { content: ""; position: absolute; left: 10px; right: 10px; top: 0; height: 1px; background: var(--hair); }
.menu-h { display: flex; align-items: center; gap: 8px; margin: 0 0 9px; font-size: 11.5px; font-weight: 600; letter-spacing: 0.13em; text-transform: uppercase; color: var(--fg-faint); }
.menu-h-aside { margin-left: auto; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.02em; text-transform: none; color: var(--fg-dim); font-weight: 400; }
.menu-note { font-size: 12.5px; color: var(--fg-dim); margin: 8px 2px 0; line-height: 1.4; min-height: 1.4em; }
.menu-count { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 6px; box-sizing: border-box; border-radius: 10px; background: var(--fill-2);
  font-family: var(--font-mono); font-size: 11px; color: var(--fg); letter-spacing: 0; }

/* panel header (aircraft) */
.menu-phead { display: flex; align-items: center; gap: 10px; padding: 8px 10px 10px; flex: none; }
.menu-ptitle { font-size: 17px; font-weight: 600; letter-spacing: 0.01em; }

/* segmented control with a sliding glass lozenge */
.menu-seg { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); padding: 3px; border-radius: var(--r-pill); background: rgb(0 0 0 / 0.18); box-shadow: inset 0 0 0 1px var(--hair); }
.menu-seg > .menu-ind { border-radius: var(--r-pill); }
.menu-seg > .menu-segbtn { position: relative; z-index: 1; min-height: 34px; padding: 0 10px; border-radius: var(--r-pill); display: flex; align-items: center; justify-content: center; gap: 6px;
  font-size: 13px; font-weight: 500; color: var(--fg-dim); white-space: nowrap; transition: color 0.2s; }
.menu-seg > .menu-segbtn:hover { color: var(--fg); }
.menu-seg > .menu-segbtn[aria-checked="true"] { color: var(--fg); }
.menu-seg > .menu-segbtn small { font-family: var(--font-mono); font-size: 10.5px; opacity: 0.7; }
.menu-filter { margin: 0 4px 8px; flex: none; }

/* list rows (aircraft, airports) */
.menu-list { position: relative; display: flex; flex-direction: column; gap: 2px; padding: 2px; }
.menu-list > .menu-ind { border-radius: var(--r-m); }
.menu-row {
  position: relative; z-index: 1; display: grid; grid-template-columns: 38px minmax(0, 1fr) auto; align-items: center; column-gap: 10px;
  min-height: 50px; padding: 5px 12px 5px 8px; border-radius: var(--r-m); transition: background 0.2s;
}
.menu-row:hover { background: var(--fill-hover); }
.menu-row[aria-selected="true"]:hover { background: none; }
.menu-glyph { width: 38px; height: 38px; border-radius: var(--r-s); display: grid; place-items: center; background: rgb(255 255 255 / 0.07); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1); color: var(--fg-dim); transition: color 0.2s, background 0.2s; }
.menu-glyph svg { width: 26px; height: 26px; }
.menu-row[aria-selected="true"] .menu-glyph { color: var(--accent); background: rgb(255 176 0 / 0.14); }
.menu-row-main { min-width: 0; display: flex; flex-direction: column; line-height: 1.22; }
.menu-row-name { font-size: 14.5px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-row-sub { font-size: 12px; color: var(--fg-dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-row-tag { font-size: 11.5px; font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: 0.04em; color: var(--fg-faint); text-align: right; line-height: 1.3; }
.menu-row[aria-selected="true"] .menu-row-tag { color: var(--amber-soft); }
.menu-grouplabel { position: relative; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 10px 10px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.13em; text-transform: uppercase; color: var(--fg-faint); }
.menu-grouplabel:first-child { padding-top: 2px; }
.menu-grouplabel .menu-count { font-size: 10px; height: 18px; min-width: 20px; }
.menu-aclist { padding: 0 2px; -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 18px), transparent); }
.menu-aclist > .menu-list { padding-bottom: 14px; }
.menu-livsec { flex: none; padding: 10px 10px 6px; position: relative; }
.menu-livsec::before { content: ""; position: absolute; left: 10px; right: 10px; top: 0; height: 1px; background: var(--hair); }

/* chips */
.menu-chips, .menu-rwys { display: flex; flex-wrap: wrap; gap: 6px; }
.menu-chip {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 34px; padding: 0 13px; border-radius: var(--r-pill);
  background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); color: var(--fg-dim);
  font-size: 13px; font-weight: 500; white-space: nowrap; transition: background 0.2s, color 0.2s, box-shadow 0.2s;
}
.menu-chip:hover { color: var(--fg); background: var(--fill-2); }
.menu-chip[aria-checked="true"] { color: var(--amber-soft); background: rgb(255 176 0 / 0.16); box-shadow: inset 0 0 0 1px rgb(255 176 0 / 0.7); }

/* runway designators: taxiway location signs (amber on black) when selected */
.menu-rwy {
  min-width: 54px; height: 36px; padding: 0 10px; display: inline-grid; place-items: center; border-radius: var(--r-xs);
  font-family: var(--font-mono); font-weight: 700; font-size: 15px; letter-spacing: 0.06em;
  color: var(--fg-dim); background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair-2); transition: background 0.2s, color 0.2s;
}
.menu-rwy:hover { color: var(--fg); background: var(--fill-2); }
.menu-rwy[aria-checked="true"] { background: #0a0a0a; color: var(--accent); box-shadow: inset 0 0 0 2px var(--accent), 0 2px 10px rgb(0 0 0 / 0.3); }
.menu-rwyinfo { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--fg-dim); margin: 9px 2px 0; letter-spacing: 0.02em; }

/* airport picker: a row that expands in place into the list */
.menu-picker { position: relative; width: 100%; display: grid; grid-template-columns: 54px minmax(0, 1fr) auto 18px; align-items: center; column-gap: 10px; min-height: 54px; padding: 6px 12px 6px 12px; box-sizing: border-box;
  border-radius: var(--r-m); background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); transition: background 0.2s; }
.menu-picker:hover { background: var(--fill-2); }
.menu-picker-code { font-family: var(--font-mono); font-weight: 700; font-size: 15px; color: var(--accent); letter-spacing: 0.04em; }
.menu-picker-chev { width: 8px; height: 8px; border: solid currentColor; border-width: 0 1.6px 1.6px 0; transform: translateY(-2px) rotate(45deg); justify-self: center; color: var(--fg-dim); transition: transform 0.3s var(--spring); }
.menu-picker[aria-expanded="true"] .menu-picker-chev { transform: translateY(2px) rotate(225deg); }
.menu-aptwrap { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.34s var(--ease), opacity 0.25s; opacity: 0; }
.menu-aptwrap.open { grid-template-rows: 1fr; opacity: 1; }
.menu-aptwrap > div { min-height: 0; overflow: hidden; }
.menu-aptwrap .menu-list { margin-top: 6px; }
.menu-aptwrap .menu-row { grid-template-columns: 54px minmax(0, 1fr) auto; padding-left: 12px; min-height: 48px; }
.menu-row-code { font-family: var(--font-mono); font-size: 14px; font-weight: 700; letter-spacing: 0.04em; }
.menu-row[aria-selected="true"] .menu-row-code { color: var(--accent); }
.menu-aptdesc { font-size: 12.5px; color: var(--fg-dim); line-height: 1.4; margin: 8px 2px 0; }

/* time of day */
.menu-tod-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 2px 2px; }
.menu-tod-read { font-family: var(--font-display); font-weight: 600; font-size: 32px; line-height: 1; letter-spacing: 0.01em; font-variant-numeric: tabular-nums; }
.menu-tod-read small { font-family: var(--font-body); font-size: 11px; color: var(--fg-faint); font-weight: 600; margin-left: 6px; letter-spacing: 0.12em; }
.menu-tod-phase { font-size: 13px; color: var(--fg-dim); font-weight: 500; }
.menu-slider { position: relative; padding: 6px 0 2px; }
.menu-range { -webkit-appearance: none; appearance: none; width: 100%; height: 30px; margin: 0; background: transparent; cursor: pointer; display: block; touch-action: none; }
.menu-range::-webkit-slider-runnable-track { height: 8px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.12);
  background: linear-gradient(to right, #1a2850 0%, #1a2850 17%, #6a4a7a 19.5%, #e8955a 21.5%, #8fb8dc 27%, #c4def2 50%, #8fb8dc 72%, #f0a050 78.5%, #7a4060 80.5%, #1a2850 84%, #1a2850 100%); }
.menu-range::-moz-range-track { height: 8px; border-radius: 4px;
  background: linear-gradient(to right, #1a2850 0%, #1a2850 17%, #6a4a7a 19.5%, #e8955a 21.5%, #8fb8dc 27%, #c4def2 50%, #8fb8dc 72%, #f0a050 78.5%, #7a4060 80.5%, #1a2850 84%, #1a2850 100%); }
.menu-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 26px; height: 26px; margin-top: -9px; border-radius: 50%; border: 0;
  background: radial-gradient(circle at 50% 35%, #fff, #e4ebf2); box-shadow: 0 2px 8px rgb(0 0 0 / 0.35), inset 0 0 0 1px rgb(0 0 0 / 0.08); transition: transform 0.2s var(--spring); }
.menu-range:active::-webkit-slider-thumb { transform: scale(1.12); }
.menu-range::-moz-range-thumb { width: 26px; height: 26px; border-radius: 50%; border: 0; background: #f4f7fa; box-shadow: 0 2px 8px rgb(0 0 0 / 0.35); }
.menu-range:focus-visible { outline-offset: 2px; border-radius: 8px; }
.menu-range.menu-range-plain::-webkit-slider-runnable-track { background: linear-gradient(to right, var(--accent) 0 var(--v, 50%), rgb(255 255 255 / 0.16) var(--v, 50%)); }
.menu-range.menu-range-plain::-moz-range-track { background: linear-gradient(to right, var(--accent) 0 var(--v, 50%), rgb(255 255 255 / 0.16) var(--v, 50%)); }
.menu-scale { display: flex; justify-content: space-between; font-family: var(--font-mono); font-size: 10px; color: var(--fg-faint); margin: 0 4px 10px; }
.menu-todchips { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.menu-todchips .menu-chip { padding: 0 6px; min-height: 32px; font-size: 12.5px; }

/* weather */
.menu-wx { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.menu-wx .menu-chip { flex-direction: column; align-items: flex-start; justify-content: center; gap: 1px; min-height: 48px; padding: 5px 11px; white-space: normal; text-align: left; line-height: 1.15; border-radius: var(--r-s); }
.menu-wx-code { font-family: var(--font-mono); font-size: 10px; letter-spacing: 0.06em; opacity: 0.8; }
.menu-wx-label { font-size: 12.5px; }
.menu-metar { font-family: var(--font-mono); font-size: 11px; color: var(--fg-dim); margin: 10px 2px 0; line-height: 1.5; word-break: break-word; }
.menu-metar b { color: var(--fg); font-weight: 400; }

/* fly */
.menu-flybar { --r: var(--r-xl); padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.menu-clear { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 4px 10px 2px; font-size: 11px; font-weight: 600; letter-spacing: 0.12em; color: var(--fg-faint); }
.menu-clear b { font-family: var(--font-mono); font-size: 11.5px; font-weight: 400; letter-spacing: 0.02em; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.menu-fly {
  --r: calc(var(--r-xl) - 8px);
  display: flex !important; align-items: center; justify-content: center; gap: 14px; width: 100%; min-height: 56px;
  text-align: center !important; color: var(--accent-ink) !important;
  font-family: var(--font-display) !important; font-weight: 700 !important; font-size: 24px !important;
  letter-spacing: 0.34em !important; text-transform: uppercase; padding-left: 0.34em !important;
  transition: transform 0.25s var(--spring), filter 0.2s;
}
.menu-fly:hover { filter: brightness(1.06) saturate(1.05); transform: scale(1.012); }
.menu-fly:active { transform: scale(0.985); }
.menu-fly-arrow { width: 22px; height: 12px; position: relative; flex: none; margin-left: -0.2em; }
.menu-fly-arrow::before { content: ""; position: absolute; left: 0; right: 3px; top: 5px; height: 2px; border-radius: 1px; background: currentColor; }
.menu-fly-arrow::after { content: ""; position: absolute; right: 1px; top: 1px; width: 8px; height: 8px; border: solid currentColor; border-width: 2px 2px 0 0; transform: rotate(45deg); }
.menu-fly-key { position: absolute; right: 14px; font-family: var(--font-mono); font-size: 11px; letter-spacing: 0; font-weight: 700; opacity: 0.55; border: 1.5px solid currentColor; border-radius: 6px; padding: 1px 6px; }
.menu-fly:focus-visible { outline-offset: 3px; }

/* hero: name + spec card over the aircraft (wide screens) */
.menu-hero { align-self: end; justify-self: center; width: min(740px, 100%); min-width: 0; display: flex; flex-direction: column; align-items: center; text-align: center; pointer-events: none !important; }
.menu-hero > * { pointer-events: auto; }
.menu-hero-kicker { font-size: 12px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: rgb(242 246 250 / 0.86); text-shadow: 0 1px 3px rgb(0 0 0 / 0.6); text-wrap: balance; pointer-events: none; }
.menu-hero-name { font-family: var(--font-display); font-weight: 600; font-size: clamp(38px, 4.2vw, 70px); line-height: 0.96; letter-spacing: 0.02em; text-transform: uppercase; margin: 6px 0 4px;
  text-shadow: 0 2px 4px rgb(0 0 0 / 0.45), 0 0 30px rgb(0 0 0 / 0.3); pointer-events: none; }
.menu-hero-tag { font-size: 15px; color: rgb(242 246 250 / 0.9); margin: 0 0 14px; text-shadow: 0 1px 3px rgb(0 0 0 / 0.6); pointer-events: none; }
.menu-spec { --r: var(--r-l); width: 100%; box-sizing: border-box; padding: 6px; text-align: left; }
.menu-spec-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; }
.menu-spec-key { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.menu-kv { padding: 8px 12px 8px; min-width: 0; position: relative; }
.menu-spec-key > .menu-kv + .menu-kv::before { content: ""; position: absolute; left: 0; top: 10px; bottom: 10px; width: 1px; background: var(--hair); }
.menu-kv-k { font-size: 10.5px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--fg-faint); white-space: nowrap; }
.menu-kv-v { font-size: 17px; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.menu-kv-u { font-size: 10.5px; color: var(--fg-dim); margin-left: 4px; }
.menu-more { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; margin-right: 2px; background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); transition: background 0.2s; }
.menu-more:hover { background: var(--fill-2); }
.menu-more i { width: 8px; height: 8px; border: solid var(--fg); border-width: 1.6px 1.6px 0 0; transform: translateY(2px) rotate(-45deg); transition: transform 0.32s var(--spring); }
.menu-more[aria-expanded="true"] i { transform: translateY(-2px) rotate(135deg); }
.menu-spec-more { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.36s var(--ease); }
.menu-spec.open .menu-spec-more { grid-template-rows: 1fr; }
.menu-spec-more > div { min-height: 0; overflow: hidden; }
.menu-spec-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 2px 0 0; border-top: 1px solid var(--hair); }
.menu-spec-detail { padding: 8px 12px 10px; border-top: 1px solid var(--hair); }
.menu-acmeta { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-dim); line-height: 1.6; }
.menu-acmeta b { color: var(--fg); font-weight: 400; }
.menu-lore { font-size: 13px; line-height: 1.5; color: var(--fg-dim); margin: 8px 0 0; }
.menu-lore-tag { color: var(--fg); font-weight: 500; }

/* ---------- main (hangar) layout -------------------------------------------------------------------- */
.menu-main { display: grid; grid-template-columns: minmax(272px, 318px) minmax(0, 1fr) minmax(306px, 356px); grid-template-rows: minmax(0, 1fr) auto; column-gap: 18px; row-gap: 10px; }
.menu-sheet { display: contents; }
.menu-main > .menu-sheet::before, .menu-main > .menu-sheet::after { content: none; }
.menu-main .menu-panel-ac { grid-column: 1; grid-row: 1 / 3; align-self: start; max-height: 100%; }
.menu-main .menu-panel-plan { grid-column: 3; grid-row: 1; align-self: start; max-height: 100%; }
.menu-main .menu-flybar { grid-column: 3; grid-row: 2; }
.menu-main .menu-hero { grid-column: 2; grid-row: 1 / 3; }
.menu-grab { display: none; }
.menu-panel-plan > .menu-scroll { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 16px), transparent); }

/* single-panel views */
.menu-dock { display: flex; align-items: flex-start; }
.menu-dock-l { justify-content: flex-start; }
.menu-dock-r { justify-content: flex-end; }
.menu-dock-c { justify-content: center; }
.menu-dock > .menu-panel { width: min(420px, 100%); }
.menu-dock-wide > .menu-panel { width: min(900px, 100%); }
.menu-subhead { display: flex; align-items: center; gap: 12px; padding: 6px 8px 10px; flex: none; }
.menu-back { width: 38px; height: 38px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); transition: background 0.2s; }
.menu-back:hover { background: var(--fill-2); }
.menu-back::before { content: ""; width: 8px; height: 8px; border: solid currentColor; border-width: 0 0 1.8px 1.8px; transform: translateX(2px) rotate(45deg); }
.menu-subtitle { font-size: 20px; font-weight: 600; letter-spacing: 0.01em; }

/* grouped cells (settings) */
.menu-group { border-radius: var(--r-l); background: rgb(0 0 0 / 0.14); box-shadow: inset 0 0 0 1px var(--hair); padding: 4px 14px; }
.menu-field { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 52px; position: relative; }
.menu-field + .menu-field::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: var(--hair); }
.menu-field-l { display: flex; flex-direction: column; line-height: 1.3; min-width: 0; }
.menu-field-t { font-size: 14.5px; font-weight: 500; }
.menu-field-d { font-size: 12px; color: var(--fg-dim); }
.menu-switch { position: relative; width: 52px; height: 32px; flex: none; border-radius: 16px; background: rgb(255 255 255 / 0.16); box-shadow: inset 0 0 0 1px var(--hair); transition: background 0.25s; }
.menu-switch::after { content: ""; position: absolute; left: 3px; top: 3px; width: 26px; height: 26px; border-radius: 50%; background: #f4f7fa; box-shadow: 0 2px 6px rgb(0 0 0 / 0.3); transition: transform 0.32s var(--spring); }
.menu-switch[aria-pressed="true"] { background: var(--hud, #5dff9b); background: #34c77b; }
.menu-switch[aria-pressed="true"]::after { transform: translateX(20px); }
.menu-opts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.menu-opt { display: flex; flex-direction: column; gap: 3px; padding: 11px 12px 12px; border-radius: var(--r-m); background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); transition: background 0.2s, box-shadow 0.2s; min-width: 0; }
.menu-opt:hover { background: var(--fill-2); }
.menu-opt[aria-checked="true"] { background: rgb(255 176 0 / 0.13); box-shadow: inset 0 0 0 1.5px rgb(255 176 0 / 0.75); }
.menu-opt-t { font-size: 15px; font-weight: 600; text-transform: capitalize; display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.menu-opt[aria-checked="true"] .menu-opt-t { color: var(--amber-soft); }
.menu-opt-t small { font-family: var(--font-mono); font-size: 10.5px; color: var(--fg-dim); font-weight: 400; text-transform: none; }
.menu-opt-d { font-size: 12px; color: var(--fg-dim); line-height: 1.35; }
.menu-vol { display: grid; grid-template-columns: minmax(0, 1fr) 48px; align-items: center; gap: 12px; padding: 10px 0 12px; }
.menu-vol-read { font-family: var(--font-mono); font-size: 14px; text-align: right; }
.menu-fine { font-family: var(--font-mono); font-size: 11px; color: var(--fg-dim); line-height: 1.7; }

/* controls reference */
.menu-keys { columns: 2 340px; column-gap: 24px; padding: 4px 10px 6px; }
.menu-keygroup { break-inside: avoid; margin: 0 0 16px; }
.menu-keygroup .menu-group { padding: 2px 12px; }
.menu-keyrow { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 38px; padding: 3px 0; position: relative; }
.menu-keyrow + .menu-keyrow::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 1px; background: var(--hair); }
.menu-keyrow-a { font-size: 13px; line-height: 1.25; }
.menu-keyrow-k { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: 4px; flex: none; max-width: 60%; }
.menu-keyrow-k.menu-keytext { font-size: 11.5px; color: var(--fg-dim); text-align: right; flex: 0 1 auto; display: block; }
.menu-kbd {
  display: inline-grid; place-items: center; min-width: 26px; height: 24px; padding: 0 7px; box-sizing: border-box; border-radius: 7px;
  font-family: var(--font-mono); font-size: 11.5px; font-weight: 700; line-height: 1; color: var(--fg);
  background: linear-gradient(rgb(255 255 255 / 0.16), rgb(255 255 255 / 0.08)); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.16), inset 0 -2px 0 rgb(0 0 0 / 0.25);
}
.menu-kor { font-size: 10.5px; color: var(--fg-faint); padding: 0 1px; }
.menu-kslash { font-family: var(--font-mono); font-size: 12px; color: var(--fg-faint); padding: 0 3px; }
.menu-devices { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; padding: 2px 10px 10px; }
.menu-device { padding: 12px 14px 14px; font-size: 12.5px; color: var(--fg-dim); line-height: 1.45; border-radius: var(--r-m); background: rgb(0 0 0 / 0.14); box-shadow: inset 0 0 0 1px var(--hair); }
.menu-device b { display: block; font-size: 13.5px; font-weight: 600; color: var(--fg); margin-bottom: 3px; }

/* pause */
.menu-pause-head { padding: 12px 12px 14px; flex: none; }
.menu-pause-title { font-family: var(--font-display); font-weight: 600; font-size: 34px; line-height: 1; letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 12px; }
.menu-pause-title::before { content: ""; width: 12px; height: 24px; border: solid var(--fg); border-width: 0 4px; border-radius: 1px; box-sizing: border-box; flex: none; }
.menu-pause-sub { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--fg-dim); margin-top: 10px; line-height: 1.65; }
.menu-pause-sub b { color: var(--fg); font-weight: 400; font-family: var(--font-body); font-size: 14px; font-weight: 500; }
.menu-actions { display: flex; flex-direction: column; padding: 0 2px 10px; gap: 6px; }
.menu-act {
  display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 48px; padding: 0 16px; border-radius: var(--r-m);
  background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); font-size: 15px; font-weight: 500; transition: background 0.2s, transform 0.25s var(--spring);
}
.menu-act:hover { background: var(--fill-2); }
.menu-act:active { transform: scale(0.985); }
.menu-act.menu-act-primary { --r: calc(var(--r-xl) - 10px); min-height: 54px; font-family: var(--font-display); font-size: 21px; font-weight: 700; letter-spacing: 0.26em; text-transform: uppercase; box-shadow: none; margin-bottom: 4px; }
.menu-act-primary .menu-kbd { color: var(--accent-ink); background: none; box-shadow: inset 0 0 0 1.5px rgb(28 19 0 / 0.45); letter-spacing: 0; font-family: var(--font-mono); }
.menu-act-dim { color: var(--fg-dim); }
.menu-act .menu-kbd { font-size: 10.5px; height: 22px; }
.menu-act-chev { width: 7px; height: 7px; border: solid currentColor; border-width: 1.6px 1.6px 0 0; transform: rotate(45deg); opacity: 0.6; margin-right: 4px; }

/* ---------- in-flight corner buttons + crash dialog ---------------------------------------------- */
.menu-corner { position: absolute; z-index: 15; top: var(--gt); right: var(--gr); display: flex; gap: 8px; pointer-events: auto; margin-top: 4px; transition: opacity 0.6s; }
.menu-corner.dim { opacity: 0.55; }
.menu-corner.dim:hover, .menu-corner:focus-within { opacity: 1; }
.menu-cbtn { --r: var(--r-pill); height: 40px; min-width: 40px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 12px; box-sizing: border-box; color: var(--fg);
  font-size: 13px; font-weight: 600; letter-spacing: 0.04em; transition: transform 0.25s var(--spring); }
.menu-cbtn:active { transform: scale(0.94); }
.menu-cbtn.menu-cbtn-icon { padding: 0; width: 40px; }
.menu-cbtn svg { width: 18px; height: 18px; flex: none; }
.menu-crash.menu-crash {
  --r: var(--r-xl); position: absolute; z-index: 21; left: 50%; bottom: calc(var(--gb) + 56px); transform: translateX(-50%);
  width: min(440px, calc(100% - 32px)); box-sizing: border-box; pointer-events: auto; padding: 18px 18px 10px;
  animation: menu-rise 0.42s var(--spring);
}
.menu-crash-t { font-family: var(--font-display); font-weight: 700; font-size: 20px; letter-spacing: 0.16em; text-transform: uppercase; color: #ff8a70; display: flex; align-items: center; gap: 10px; padding: 0 4px; }
.menu-crash-t::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--warn); box-shadow: 0 0 10px var(--warn); }
.menu-crash-r { font-family: var(--font-mono); font-size: 12px; color: var(--fg-dim); margin: 6px 4px 14px; }
.menu-crash-b { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 0 -8px; padding: 0; }
.menu-btn { --r: calc(var(--r-xl) - 10px); min-height: 48px; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--r); background: var(--fill-2); box-shadow: inset 0 0 0 1px var(--hair);
  font-size: 14.5px; font-weight: 600; text-align: center !important; transition: transform 0.25s var(--spring); }
.menu-btn:hover { background: rgb(255 255 255 / 0.14); }
.menu-btn.glass-tint { box-shadow: none; font-weight: 700; }
.menu-btn:active { transform: scale(0.97); }

/* touch flight controls (input module) restyled as clear glass */
.inp-pnl, .inp-btn, .inp-base { background: rgb(var(--glass-rgb) / var(--glass-a-clear)) !important; -webkit-backdrop-filter: blur(12px) saturate(1.6); backdrop-filter: blur(12px) saturate(1.6);
  border: 0 !important; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.22), inset 0 1px 0 rgb(255 255 255 / 0.3), 0 6px 18px rgb(0 0 0 / 0.2) !important; }
.inp-pnl, .inp-btn { border-radius: 18px !important; }
.inp-btn.on, .inp-btn.down { background: rgb(255 176 0 / 0.55) !important; color: var(--accent-ink) !important; }
.inp-knob, .inp-rud-knob { background: radial-gradient(circle at 50% 35%, #fff, #dfe6ee) !important; border: 0 !important; box-shadow: 0 3px 10px rgb(0 0 0 / 0.35) !important; }
.inp-thr-knob { box-shadow: 0 1px 6px rgb(0 0 0 / 0.4) !important; }
.inp-hint { border: 1.5px dashed rgb(255 255 255 / 0.3) !important; }
:root.ui-lite .inp-pnl, :root.ui-lite .inp-btn, :root.ui-lite .inp-base { -webkit-backdrop-filter: none; backdrop-filter: none; background: rgb(var(--glass-rgb) / 0.7) !important; }

/* ---------- motion: panels grow out of the control that opened them -------------------------------- */
@keyframes menu-rise { from { opacity: 0; transform: translate(-50%, 14px) scale(0.96); } to { opacity: 1; transform: translate(-50%, 0); } }
@keyframes menu-in { from { opacity: 0; transform: translateY(-8px) scale(0.965); } to { opacity: 1; transform: none; } }
@keyframes menu-in-l { from { opacity: 0; transform: translateX(-16px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes menu-in-r { from { opacity: 0; transform: translateX(16px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes menu-in-u { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
@keyframes menu-fade { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.menu-anim .menu-main .menu-panel-ac { animation: menu-in-l 0.46s var(--spring) both; transform-origin: top left; }
.menu-anim .menu-main .menu-panel-plan, .menu-anim .menu-main .menu-flybar { animation: menu-in-r 0.46s var(--spring) both; transform-origin: top right; }
.menu-anim .menu-main .menu-flybar { animation-delay: 0.04s; }
.menu-anim .menu-dock > .menu-panel { animation: menu-in 0.42s var(--spring) both; transform-origin: var(--origin, top center); }
.menu-anim .menu-hero { animation: menu-fade 0.6s var(--ease) both; }

/* ---------- responsive ---------------------------------------------------------------------------- */
@media (min-width: 1700px) {
  .menu-main { grid-template-columns: minmax(300px, 340px) minmax(0, 1fr) minmax(330px, 380px); column-gap: 24px; }
}
@media (max-width: 1180px) {
  .menu-main { grid-template-columns: minmax(256px, 290px) minmax(0, 1fr) minmax(290px, 330px); column-gap: 14px; }
  .menu-status-item.menu-status-opt { display: none; }
  .menu-tab { padding: 0 14px; }
}
@media (max-width: 1020px) {
  .menu-spec-key, .menu-spec-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .menu-spec-key > .menu-kv:nth-child(3)::before { display: none; }
  .menu-hero-tag { display: none; }
}
@media (max-width: 900px) and (min-width: 721px) {
  .menu-main { grid-template-columns: minmax(240px, 1fr) 0 minmax(270px, 1fr); }
  .menu-hero { display: none; }
  .menu-brand-name { display: none; }
  .menu-brand { padding: 0 11px; }
}
@media (max-height: 640px) {
  .menu-hero { display: none; }
  .menu-cap { height: 40px; }
  .menu-tab { height: 32px; }
  .menu-view { padding-top: 10px; padding-bottom: max(10px, env(safe-area-inset-bottom, 0px)); }
  .menu-sec { padding: 9px 8px 11px; }
  .menu-fly { min-height: 46px; font-size: 21px !important; }
  .menu-flybar { gap: 2px; }
  .menu-row { min-height: 44px; }
  .menu-glyph { width: 34px; height: 34px; }
  .menu-phead { padding: 4px 8px 8px; }
  .menu-pause-title { font-size: 26px; }
  .menu-pause-title::before { height: 19px; }
}
@media (max-height: 640px) and (min-width: 721px) {
  .menu-main .menu-panel-ac, .menu-main .menu-panel-plan { align-self: stretch; }
}
@media (max-height: 460px) and (min-width: 721px) {
  .menu-clear { display: none; }
  .menu-livsec { display: none; }
  .menu-tab svg { display: none; }
}

/* sheet layout: phones and portrait tablets — panels collapse into one bottom sheet */
@media (max-width: 720px), (max-aspect-ratio: 1/1) and (max-width: 1100px) {
  .menu-top { gap: 8px; }
  .menu-status { display: none; }
  .menu-brand { padding: 0 12px; }
  .menu-tabs { margin: 0 0 0 auto; }
  .menu-tab { padding: 0 13px; font-size: 13.5px; }
  .menu-view { padding: 0; }
  .menu-main { display: block; }
  .menu-root .menu-sheet, .menu-dock > .menu-panel {
    --r: var(--r-xl); position: absolute; left: 0; right: 0; bottom: 0; width: auto !important; max-height: 58%;
    border-radius: var(--r-xl) var(--r-xl) 0 0; box-sizing: border-box;
  }
  .menu-dock > .menu-panel { max-height: 80%; padding: 8px max(8px, env(safe-area-inset-right, 0px)) env(safe-area-inset-bottom, 0px) max(8px, env(safe-area-inset-left, 0px)); }
  .menu-sheet { display: flex; flex-direction: column; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; touch-action: pan-y; padding: 0 var(--gr) 0 var(--gl); scrollbar-width: none; }
  .menu-sheet::-webkit-scrollbar { display: none; }
  .menu-main > .menu-sheet::before, .menu-main > .menu-sheet::after { content: ""; }
  .menu-sheet > .menu-panel, .menu-sheet > .menu-flybar { background: none !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; box-shadow: none !important; max-height: none; flex: none; padding: 0; }
  .menu-sheet > .menu-panel::before, .menu-sheet > .menu-panel::after, .menu-sheet > .menu-flybar::before, .menu-sheet > .menu-flybar::after { display: none; }
  .menu-sheet .menu-scroll { overflow: visible; max-height: none; flex: none; -webkit-mask-image: none; mask-image: none; }
  .menu-grab { display: block; flex: none; width: 38px; height: 5px; border-radius: 3px; background: rgb(255 255 255 / 0.3); margin: 8px auto 4px; }
  .menu-sec { padding-left: 2px; padding-right: 2px; }
  .menu-sec + .menu-sec::before, .menu-livsec::before { left: 2px; right: 2px; }
  .menu-phead { padding: 6px 2px 8px; }
  .menu-filter { margin: 0 0 10px; }
  /* aircraft: horizontal carousel of cards */
  .menu-aclist { overflow-x: auto !important; overflow-y: hidden !important; margin: 0 calc(-1 * var(--gr)) 0 calc(-1 * var(--gl)); padding: 0 var(--gr) 0 var(--gl); scroll-snap-type: x proximity; scrollbar-width: none; touch-action: pan-x pan-y; -webkit-mask-image: none; mask-image: none; border-radius: 0; }
  .menu-aclist::-webkit-scrollbar { display: none; }
  .menu-aclist > .menu-list { flex-direction: row; padding: 2px 2px 4px; width: max-content; gap: 6px; }
  .menu-aclist .menu-row { grid-template-columns: 1fr; grid-template-rows: auto auto; width: 128px; height: 98px; align-content: start; row-gap: 6px; padding: 10px 11px; scroll-snap-align: start; background: var(--fill); box-shadow: inset 0 0 0 1px var(--hair); }
  .menu-aclist .menu-row[aria-selected="true"] { background: none; box-shadow: none; }
  .menu-aclist .menu-row-tag { position: absolute; right: 10px; top: 12px; }
  .menu-aclist .menu-row-name { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; font-size: 13.5px; line-height: 1.2; }
  .menu-aclist .menu-row-sub { display: none; }
  .menu-aclist .menu-grouplabel { writing-mode: vertical-rl; transform: rotate(180deg); padding: 6px 2px; justify-content: center; }
  .menu-aclist .menu-grouplabel .menu-count { display: none; }
  .menu-livsec { padding: 10px 2px 4px; }
  /* hero becomes the selected aircraft's card inside the sheet */
  .menu-main .menu-hero { width: auto; align-items: stretch; text-align: left; padding: 10px 2px 2px; }
  .menu-hero-kicker { display: none; }
  .menu-hero-name { font-size: 26px; margin: 0 0 2px; text-shadow: none; }
  .menu-hero-tag { display: block; font-size: 13px; margin: 0 0 10px; text-shadow: none; color: var(--fg-dim); }
  .menu-spec { background: rgb(0 0 0 / 0.14) !important; -webkit-backdrop-filter: none !important; backdrop-filter: none !important; box-shadow: inset 0 0 0 1px var(--hair) !important; }
  .menu-spec::before, .menu-spec::after { display: none; }
  .menu-spec-key, .menu-spec-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .menu-spec-key > .menu-kv:nth-child(3)::before { display: none; }
  .menu-sheet > .menu-flybar { position: sticky; bottom: 0; z-index: 3; margin: 6px calc(-1 * var(--gr)) 0 calc(-1 * var(--gl)); padding: 8px var(--gr) var(--gb) var(--gl) !important;
    background: linear-gradient(to bottom, rgb(var(--glass-rgb) / 0), rgb(var(--glass-rgb) / 0.75) 30%) !important; }
  .menu-fly { min-height: 54px; }
  .menu-devices { grid-template-columns: 1fr; }
  .menu-keys { columns: 1; }
  .menu-crash { bottom: calc(var(--gb) + 24px); }
  .menu-anim .menu-sheet, .menu-anim .menu-dock > .menu-panel { animation: menu-in-u 0.46s var(--spring) both; }
  .menu-anim .menu-main .menu-panel-ac, .menu-anim .menu-main .menu-panel-plan, .menu-anim .menu-main .menu-flybar, .menu-anim .menu-hero { animation: none; }
}
@media (max-width: 720px) and (max-height: 500px) {
  .menu-sheet, .menu-dock > .menu-panel { max-height: 72%; }
}
@media (max-width: 420px) {
  .menu-brand-name { display: none; }
  .menu-tab { padding: 0 11px; }
  .menu-tab svg { display: none; }
  .menu-wx { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .menu-opts { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) {
  .menu-root *, .menu-crash, .menu-corner, .menu-corner * { animation: none !important; transition: none !important; }
}
`;
