// Single source of truth for the keyboard map (ARCHITECTURE.md §10). `codes` are KeyboardEvent.code values.
// kind: 'axis' (held, analog-ramped), 'throttle', 'hold', 'cmd' (emits {name}), 'local' (handled inside input).

const R = (group, action, keys, codes, kind, id, extra) => ({ group, action, keys, codes, kind, id, ...extra });

export const KEY_TABLE = [
  R('Flight', 'Pitch nose down', ['W', '↑'], ['KeyW', 'ArrowUp'], 'axis', 'pitchDown'),
  R('Flight', 'Pitch nose up', ['S', '↓'], ['KeyS', 'ArrowDown'], 'axis', 'pitchUp'),
  R('Flight', 'Roll left', ['A', '←'], ['KeyA', 'ArrowLeft'], 'axis', 'rollLeft'),
  R('Flight', 'Roll right', ['D', '→'], ['KeyD', 'ArrowRight'], 'axis', 'rollRight'),
  R('Flight', 'Rudder left', ['Q'], ['KeyQ'], 'axis', 'yawLeft'),
  R('Flight', 'Rudder right', ['E'], ['KeyE'], 'axis', 'yawRight'),
  R('Flight', 'Pitch trim nose down', [','], ['Comma'], 'cmd', 'trimDown', { name: 'trimDown' }),
  R('Flight', 'Pitch trim nose up', ['.'], ['Period'], 'cmd', 'trimUp', { name: 'trimUp' }),
  R('Flight', 'Reset trim', ['/'], ['Slash'], 'cmd', 'trimReset', { name: 'trimReset' }),
  R('Flight', 'Autopilot (hold altitude + heading)', ['T'], ['KeyT'], 'cmd', 'apToggle', { name: 'apToggle' }),

  R('Engine', 'Throttle up', ['R', '=', 'Page Up'], ['KeyR', 'Equal', 'NumpadAdd', 'PageUp'], 'throttle', 'throttleUp'),
  R('Engine', 'Throttle down', ['F', '-', 'Page Down'], ['KeyF', 'Minus', 'NumpadSubtract', 'PageDown'], 'throttle', 'throttleDown'),
  R('Engine', 'Throttle idle', ['1'], ['Digit1', 'Numpad1'], 'throttle', 'throttleIdle'),
  R('Engine', 'Throttle MIL (full dry power)', ['9'], ['Digit9', 'Numpad9'], 'throttle', 'throttleMil'),
  R('Engine', 'Throttle max (afterburner)', ['0'], ['Digit0', 'Numpad0'], 'throttle', 'throttleMax'),
  R('Engine', 'Engines start / stop', ['I'], ['KeyI'], 'cmd', 'engineToggle', { name: 'engineToggle' }),

  R('Systems', 'Landing gear', ['G'], ['KeyG'], 'cmd', 'gearToggle', { name: 'gearToggle' }),
  R('Systems', 'Flaps retract one notch', ['['], ['BracketLeft'], 'cmd', 'flapsUp', { name: 'flapsUp' }),
  R('Systems', 'Flaps extend one notch', [']'], ['BracketRight'], 'cmd', 'flapsDown', { name: 'flapsDown' }),
  R('Systems', 'Speedbrake / spoilers', ['B'], ['KeyB'], 'local', 'speedbrake'),
  R('Systems', 'Wheel brakes (hold)', ['Space'], ['Space'], 'hold', 'brakes'),
  R('Systems', 'Parking brake', ['K'], ['KeyK'], 'cmd', 'parkingBrakeToggle', { name: 'parkingBrakeToggle' }),
  R('Systems', 'Arrestor hook', ['H'], ['KeyH'], 'cmd', 'hookToggle', { name: 'hookToggle' }),
  R('Systems', 'Landing lights', ['L'], ['KeyL'], 'cmd', 'lightsToggle', { name: 'lightsToggle' }),
  R('Systems', 'Canopy', ['N'], ['KeyN'], 'cmd', 'canopyToggle', { name: 'canopyToggle' }),
  R('Systems', 'Wing sweep', ['J'], ['KeyJ'], 'cmd', 'wingSweepToggle', { name: 'wingSweepToggle' }),

  R('Camera', 'Camera next', ['C'], ['KeyC'], 'cmd', 'cameraNext', { name: 'cameraNext' }),
  R('Camera', 'Camera previous', ['Shift+C'], ['KeyC'], 'cmd', 'cameraPrev', { name: 'cameraPrev', shift: true }),
  R('Camera', 'Look around', ['Right-drag', 'Gamepad right stick'], [], 'none', 'look'),
  R('Camera', 'Zoom', ['Mouse wheel'], [], 'none', 'zoom'),

  R('Sim', 'Mouse yoke on / off', ['M'], ['KeyM'], 'local', 'mouseYoke'),
  R('Sim', 'HUD on / off', ['U'], ['KeyU'], 'cmd', 'hudToggle', { name: 'hudToggle' }),
  R('Sim', 'Pause', ['P'], ['KeyP'], 'cmd', 'pause', { name: 'pause', always: true }),
  R('Sim', 'Restart flight', ['Backspace'], ['Backspace'], 'cmd', 'reset', { name: 'reset' }),
  R('Sim', 'Menu', ['Esc'], ['Escape'], 'cmd', 'menu', { name: 'menu', always: true }),
];

/** Public array for the menu's help screen. */
export const BINDINGS = KEY_TABLE.map(({ group, action, keys }) => ({ group, action, keys: keys.slice() }));

/** code → rows (C maps to two rows: next and Shift+C previous). */
export const CODE_MAP = new Map();
for (const row of KEY_TABLE) for (const code of row.codes) {
  if (!CODE_MAP.has(code)) CODE_MAP.set(code, []);
  CODE_MAP.get(code).push(row);
}

export const GAMEPAD_BINDINGS = [
  { group: 'Gamepad', action: 'Roll / pitch', keys: ['Left stick'] },
  { group: 'Gamepad', action: 'Camera look', keys: ['Right stick'] },
  { group: 'Gamepad', action: 'Throttle up / down', keys: ['RT / LT'] },
  { group: 'Gamepad', action: 'Rudder left / right', keys: ['LB / RB'] },
  { group: 'Gamepad', action: 'Landing gear', keys: ['A'] },
  { group: 'Gamepad', action: 'Speedbrake', keys: ['B'] },
  { group: 'Gamepad', action: 'Flaps extend / retract', keys: ['X / Y'] },
  { group: 'Gamepad', action: 'Trim up / down', keys: ['D-pad up / down'] },
  { group: 'Gamepad', action: 'Camera previous / next', keys: ['D-pad left / right', 'Back'] },
  { group: 'Gamepad', action: 'Wheel brakes (hold)', keys: ['Left stick click'] },
  { group: 'Gamepad', action: 'Menu', keys: ['Start'] },
];
