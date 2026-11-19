// Inline SVG glyphs for the menu (Skyward's own drawings, no icon fonts). Plan-view aircraft silhouettes by category,
// nose up, 24×24; and a few line icons for the tab bar and the in-flight buttons.
const PLAN = {
  fighter: 'M12 1.6l1.3 6.1 6.9 5.3v1.6l-6.9-1.5-.3 5 3.2 2.5v1.2L12 20.7l-4.2 1.1v-1.2l3.2-2.5-.3-5-6.9 1.5V13l6.9-5.3z',
  attack: 'M12 2l.9 3.6v3.4l9.1 1v2l-9.1.6v5.4l4.1 1.1V21l-5-.5-5 .5v-1.9l4.1-1.1v-5.4L2 12V10l9.1-1V5.6z',
  bomber: 'M12 4.5l11 10.6-3 1.9-2.5-1.5-2.5 1.6L12 15.6l-3 1.5-2.5-1.6L4 17l-3-1.9z',
  recon: 'M12 1l1 6 1 4.2 5 6v1.8l-5-.6-.5 3.6-1.5-1.1-1.5 1.1-.5-3.6-5 .6V17.2l5-6L11 7z',
  transport: 'M12 1.8c.8 0 1.3.9 1.3 2.2V9l8.7 3.4V14l-8.7-1.4-.3 5.4 4 1.9v1.5L12 20.8l-5 .6v-1.5l4-1.9-.3-5.4L2 14v-1.6L10.7 9V4c0-1.3.5-2.2 1.3-2.2z',
  airliner: 'M12 1.4c.9 0 1.3 1.5 1.3 3v5.2l8.7 4.4v1.6l-8.7-2-.2 5 3 2.1v1.3L12 21.1 7.9 22v-1.3l3-2.1-.2-5-8.7 2V14l8.7-4.4V4.4c0-1.5.4-3 1.3-3z',
};
export function planGlyph(category) {
  const d = PLAN[category] || PLAN.fighter;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`;
}
const stroke = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
export const ICON = {
  brand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l1.6 7.2 8.4 5.1v2l-8.4-1.8-.4 4.4 3.3 2.2V23L12 22l-4.5 1v-1.4l3.3-2.2-.4-4.4L2 16.8v-2l8.4-5.1z" fill="currentColor"/></svg>',
  hangar: stroke('<path d="M3 20V10.5L12 5l9 5.5V20"/><path d="M7 20v-6h10v6"/>'),
  settings: stroke('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>'),
  controls: stroke('<rect x="2.8" y="6.5" width="18.4" height="11" rx="2.6"/><path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7.5 14h9"/>'),
  fullscreen: stroke('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  menu: stroke('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  help: stroke('<rect x="2.8" y="6.5" width="18.4" height="11" rx="2.6"/><path d="M6.5 10h1M10 10h1M13.5 10h1M17 10h.5M7.5 14h9"/>'),
};
