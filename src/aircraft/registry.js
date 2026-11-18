// Aircraft roster. Owned by the integrator — module branches must NOT edit this file.
import f16 from './f16/index.js';
import b738 from './b738/index.js';

export const AIRCRAFT = [f16, b738];
export function getAircraft(id) { return AIRCRAFT.find(a => a.id === id) || AIRCRAFT[0]; }
