// Aircraft roster. Owned by the integrator — module branches must NOT edit this file.
import { AIRCRAFT_LORE } from '../data/aircraft-lore.js';
import f16 from './f16/index.js';
import f22 from './f22/index.js';
import f35 from './f35/index.js';
import fa18 from './fa18/index.js';
import f15 from './f15/index.js';
import f14 from './f14/index.js';
import a10 from './a10/index.js';
import sr71 from './sr71/index.js';
import b2 from './b2/index.js';
import c17 from './c17/index.js';
import b738 from './b738/index.js';
import a320 from './a320/index.js';
import b789 from './b789/index.js';
import b77w from './b77w/index.js';
import b748 from './b748/index.js';
import a388 from './a388/index.js';

// READY lists the aircraft whose model and flight model are finished; the menu shows only these.
export const ALL_AIRCRAFT = [f16, f22, f35, fa18, f15, f14, a10, sr71, b2, c17, b738, a320, b789, b77w, b748, a388];
const READY = new Set(['f16', 'b738', 'a320', 'f15']);
for (const def of ALL_AIRCRAFT) def.lore = AIRCRAFT_LORE[def.id] || null;
export const AIRCRAFT = ALL_AIRCRAFT.filter(a => READY.has(a.id));
export function getAircraft(id) { return ALL_AIRCRAFT.find(a => a.id === id) || AIRCRAFT[0]; }
