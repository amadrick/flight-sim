// Quality presets. Modules read ctx.quality.<flag> and listen to 'quality:change'.
// Add new flags here (integrator-owned); modules must fall back gracefully if a flag is missing.
export const QUALITY_LEVELS = {
  low:    { renderScale: 0.6,  cloudSteps: 32,  cloudScale: 0.25, shadows: false, shadowMapSize: 1024, terrainDetail: 0.6, waterDetail: 0.5, bloom: false, taa: false, particles: 0.4, anisotropy: 2 },
  medium: { renderScale: 0.8,  cloudSteps: 56,  cloudScale: 0.33, shadows: true,  shadowMapSize: 2048, terrainDetail: 0.8, waterDetail: 0.75, bloom: true, taa: true, particles: 0.7, anisotropy: 4 },
  high:   { renderScale: 1.0,  cloudSteps: 80,  cloudScale: 0.5,  shadows: true,  shadowMapSize: 2048, terrainDetail: 1.0, waterDetail: 1.0, bloom: true, taa: true, particles: 1.0, anisotropy: 8 },
  ultra:  { renderScale: 1.0,  cloudSteps: 128, cloudScale: 0.5,  shadows: true,  shadowMapSize: 4096, terrainDetail: 1.3, waterDetail: 1.0, bloom: true, taa: true, particles: 1.0, anisotropy: 16 },
};
export function createQuality(ctx, params) {
  const q = {
    level: 'high',
    ...QUALITY_LEVELS.high,
    dynamicResolution: true,   // pipeline may lower renderScale further to hold frame rate
    set(level) {
      if (!QUALITY_LEVELS[level]) return;
      Object.assign(q, QUALITY_LEVELS[level]); q.level = level;
      ctx.events.emit('quality:change', q);
    },
  };
  if (params.quality) q.set(params.quality);
  else if (params.test) Object.assign(q, QUALITY_LEVELS.medium, { level: 'medium' });
  return q;
}
