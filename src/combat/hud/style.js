// Combat HUD stylesheet (injected once by createCombatHud). Panels use the simulator's .glass material; line work over the
// world is drawn on the overlay canvas. Class names are prefixed cbt-hud-.
export const CSS = `
.cbt-hud-cv{position:absolute;inset:0;width:100%;height:100%;pointer-events:none!important;z-index:3;display:block}
.cbt-hud-cv.cbt-hud-shadow{filter:drop-shadow(0 0 1px rgba(0,0,0,.95)) drop-shadow(0 1px 1.5px rgba(0,0,0,.5))}
.cbt-hud-root{position:absolute;inset:0;pointer-events:none!important;z-index:4;overflow:hidden;
  --cbt-gl:max(16px,env(safe-area-inset-left,0px));--cbt-gr:max(16px,env(safe-area-inset-right,0px));--cbt-gt:max(16px,env(safe-area-inset-top,0px));
  --cbt-side:212px;--cbt-blue:var(--ok,#4cc9f0);--cbt-red:var(--warn,#ff5a3c);
  font-family:var(--font-body,'Saira','Segoe UI',system-ui,-apple-system,Arial,sans-serif);color:var(--fg,#f2f6fa)}
.cbt-hud-root[hidden],.cbt-hud-root [hidden]{display:none!important}
.cbt-hud-cap{font-family:var(--font-display,'Saira Condensed','Arial Narrow',Arial,sans-serif);font-weight:600;font-size:11.5px;letter-spacing:.18em;text-transform:uppercase;color:var(--fg-dim,#a9b8c7)}

/* objectives (top left) */
.cbt-hud-obj{--r:20px;position:absolute;left:var(--cbt-gl);top:var(--cbt-gt);width:min(310px,calc(100vw - var(--cbt-side) - 64px));box-sizing:border-box;padding:11px 14px 12px;
  transition:transform .5s var(--spring,cubic-bezier(.34,1.32,.5,1)),opacity .3s}
.cbt-hud-obj-h{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:7px}
.cbt-hud-timer{font:600 15px/1 var(--font-mono,'B612 Mono',ui-monospace,monospace);color:var(--fg,#f2f6fa);letter-spacing:.02em}
.cbt-hud-timer.cbt-hud-low{color:var(--accent,#ffb000)}
.cbt-hud-timer small{font:600 10.5px/1 var(--font-display,'Arial Narrow',Arial,sans-serif);letter-spacing:.14em;color:var(--fg-dim,#a9b8c7);margin-right:6px;text-transform:uppercase}
.cbt-hud-obj ul{list-style:none;margin:0;padding:0;display:grid;gap:5px}
.cbt-hud-obj li{display:grid;grid-template-columns:14px 1fr auto;gap:8px;align-items:start;font-size:13.5px;line-height:1.3;color:var(--fg,#f2f6fa);border-radius:6px;transition:background-color .6s,color .4s}
.cbt-hud-obj li::before{content:"";width:9px;height:9px;margin-top:4px;border:1.5px solid var(--hud,#5dff9b);border-radius:2px;box-sizing:border-box}
.cbt-hud-obj li[data-state=done]{color:var(--fg-dim,#a9b8c7)}
.cbt-hud-obj li[data-state=done]::before{background:var(--hud,#5dff9b);border-color:var(--hud,#5dff9b);border-radius:50%}
.cbt-hud-obj li[data-state=failed]{color:#ffb0a2;text-decoration:line-through;text-decoration-color:rgba(255,90,60,.7)}
.cbt-hud-obj li[data-state=failed]::before{border-color:var(--warn,#ff5a3c);background:linear-gradient(45deg,transparent 42%,var(--warn,#ff5a3c) 42% 58%,transparent 58%)}
.cbt-hud-obj li.cbt-hud-opt{color:var(--fg-dim,#a9b8c7)}
.cbt-hud-obj li.cbt-hud-opt::before{border-style:dashed}
.cbt-hud-obj li em{font:500 12px/1.4 var(--font-mono,monospace);font-style:normal;color:var(--hud,#5dff9b);white-space:nowrap}
.cbt-hud-obj li.cbt-hud-new{background:rgba(93,255,155,.16)}
.cbt-hud-obj li.cbt-hud-new[data-state=failed]{background:rgba(255,90,60,.2)}
.cbt-hud-obj-f{display:flex;justify-content:space-between;margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.1)}
.cbt-hud-obj-f b{font:600 13px/1 var(--font-mono,monospace);color:var(--fg,#f2f6fa)}

/* right column: radar, own-ship status, kill feed */
.cbt-hud-side{position:absolute;right:var(--cbt-gr);top:var(--cbt-gt);width:var(--cbt-side);display:flex;flex-direction:column;gap:10px;align-items:stretch}
.cbt-hud-radar{--r:24px;aspect-ratio:1;overflow:hidden;pointer-events:auto;cursor:pointer;touch-action:manipulation}
.cbt-hud-radar canvas,.cbt-hud-stat canvas{position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1}
.cbt-hud-radar.cbt-hud-mini{aspect-ratio:auto;height:34px;width:84px;align-self:flex-end;--r:17px}
.cbt-hud-radar.cbt-hud-mini canvas{display:none}
.cbt-hud-radar.cbt-hud-mini::after{content:"RADAR";position:absolute;inset:0;display:grid;place-items:center;font:600 11px/1 var(--font-display,'Arial Narrow',Arial,sans-serif);letter-spacing:.18em;color:var(--fg-dim,#a9b8c7);z-index:1}
.cbt-hud-stat{--r:18px;position:relative}
.cbt-hud-feed{display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.cbt-hud-kill{max-width:100%;box-sizing:border-box;padding:4px 10px;border-radius:9px;background:rgba(8,12,18,.58);font-size:12.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  transition:opacity .5s,transform .35s var(--spring,cubic-bezier(.34,1.32,.5,1))}
.cbt-hud-kill.cbt-hud-in{opacity:0;transform:translateX(14px)}
.cbt-hud-kill.cbt-hud-out{opacity:0}
.cbt-hud-kill b{font-weight:600}.cbt-hud-kill .cbt-hud-b{color:var(--cbt-blue)}.cbt-hud-kill .cbt-hud-r{color:#ff8a74}
.cbt-hud-kill i{font-style:normal;color:var(--fg-dim,#a9b8c7)}
.cbt-hud-kill.cbt-hud-mine{background:rgba(40,70,40,.62);box-shadow:inset 0 0 0 1px rgba(93,255,155,.35)}

/* radio subtitles (bottom centre, above the flight-data strip) */
.cbt-hud-subs{position:absolute;left:50%;transform:translateX(-50%);bottom:120px;width:min(660px,calc(100% - 32px));display:flex;flex-direction:column;align-items:center;gap:6px}
.cbt-hud-sub{max-width:100%;box-sizing:border-box;padding:6px 14px 7px;border-radius:12px;background:rgba(6,10,15,.62);font-size:15px;line-height:1.35;text-align:center;color:var(--fg,#f2f6fa);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.cbt-hud-sub b{font-family:var(--font-display,'Saira Condensed','Arial Narrow',Arial,sans-serif);font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-right:8px;font-size:13px}
.cbt-hud-sub[data-team=blue] b{color:var(--cbt-blue)}.cbt-hud-sub[data-team=red] b{color:#ff8a74}.cbt-hud-sub[data-team=neutral] b{color:var(--fg-dim,#a9b8c7)}
.cbt-hud-sub.cbt-hud-urgent{background:rgba(40,14,8,.72);box-shadow:inset 0 0 0 1.5px rgba(255,176,0,.75);font-weight:600}
.cbt-hud-sub.cbt-hud-urgent b{color:var(--accent,#ffb000)}

/* score pops */
.cbt-hud-pops{position:absolute;left:50%;top:calc(var(--cbt-gt) + 52px);transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:2px}
.cbt-hud-pop{font:600 15px/1.2 var(--font-mono,monospace);color:var(--hud,#5dff9b);white-space:nowrap;text-shadow:0 1px 2px #000,0 0 1px #000;transition:opacity .6s,transform .6s}
.cbt-hud-pop span{font:600 11.5px/1 var(--font-display,'Arial Narrow',Arial,sans-serif);letter-spacing:.16em;color:var(--fg,#f2f6fa);margin-left:8px;text-transform:uppercase}
.cbt-hud-pop.cbt-hud-neg{color:var(--warn,#ff5a3c)}
.cbt-hud-pop.cbt-hud-out{opacity:0;transform:translateY(-10px)}

/* mission end banner */
.cbt-hud-banner{--r:28px;position:absolute;left:50%;top:21%;transform:translate(-50%,-50%);width:min(520px,calc(100% - 32px));box-sizing:border-box;padding:18px 22px 16px;text-align:center;
  transition:opacity .4s,transform .5s var(--spring,cubic-bezier(.34,1.32,.5,1))}
.cbt-hud-banner.cbt-hud-in{opacity:0;transform:translate(-50%,-50%) scale(.92)}
.cbt-hud-banner h2{margin:0;font-family:var(--font-display,'Saira Condensed','Arial Narrow',Arial,sans-serif);font-weight:600;font-size:clamp(24px,4.2vw,38px);letter-spacing:.22em;padding-left:.22em;text-transform:uppercase}
.cbt-hud-banner[data-outcome=success] h2{color:var(--hud,#5dff9b)}
.cbt-hud-banner[data-outcome=failure] h2{color:var(--warn,#ff5a3c)}
.cbt-hud-banner p{margin:6px 0 0;font-size:14px;color:var(--fg,#f2f6fa)}
.cbt-hud-banner .cbt-hud-stats{margin-top:10px;font:500 12.5px/1.4 var(--font-mono,monospace);color:var(--fg-dim,#a9b8c7)}

/* first-minute control hints (keyboard only) */
.cbt-hud-hints{position:absolute;left:var(--cbt-gl);top:52%;display:grid;gap:6px;transition:opacity .8s}
.cbt-hud-hint{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--fg,#f2f6fa);text-shadow:0 1px 2px #000;transition:opacity .6s,transform .4s}
.cbt-hud-hint.cbt-hud-used{opacity:0;transform:translateX(-8px)}
.cbt-hud-kbd{display:inline-grid;place-items:center;min-width:24px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:7px;color:var(--fg,#f2f6fa);
  font:700 11px/1 var(--font-mono,'B612 Mono',ui-monospace,monospace);background:rgba(10,14,20,.6);box-shadow:inset 0 0 0 1px rgba(255,255,255,.22),inset 0 -2px 0 rgba(0,0,0,.3)}
.cbt-hud-hints.cbt-hud-out{opacity:0}

@media (max-width:640px),(max-height:520px){
  .cbt-hud-root{--cbt-side:132px}
  .cbt-hud-obj{padding:8px 11px 9px;--r:16px}
  .cbt-hud-obj li{font-size:12px;gap:6px;grid-template-columns:11px 1fr auto}
  .cbt-hud-obj li::before{width:8px;height:8px;margin-top:3px}
  .cbt-hud-obj-f{display:none}
  .cbt-hud-cap{font-size:10.5px}
  .cbt-hud-side{gap:7px}
  .cbt-hud-radar{--r:18px}
  .cbt-hud-kill{font-size:11px;padding:3px 8px}
  .cbt-hud-sub{font-size:13px;padding:5px 11px}
  .cbt-hud-sub b{font-size:11.5px}
  .cbt-hud-pops{top:calc(var(--cbt-gt) + 44px)}
}
@media (max-width:520px),(pointer:coarse){.cbt-hud-hints{display:none}}
@media (prefers-reduced-motion:reduce){
  .cbt-hud-obj,.cbt-hud-obj li,.cbt-hud-kill,.cbt-hud-pop,.cbt-hud-banner,.cbt-hud-hint,.cbt-hud-hints{transition:none!important}
  .cbt-hud-banner.cbt-hud-in{transform:translate(-50%,-50%)}
}
`;
