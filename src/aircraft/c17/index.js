// c17 definition glue. Owned by the integrator: specs.js + geometry.js (reference data), physics.js (flight model), visual.js (3D model).
import base from './specs.js';
import geometry from './geometry.js';
import physics from './physics.js';
import { createVisual } from './visual.js';

export default { ...base, geometry, physics, createVisual };
