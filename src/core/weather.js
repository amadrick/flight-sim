// Weather state shared by clouds, physics, effects, audio, UI. Owned by the integrator.
// Modules READ ctx.weather (fields below are the *current, smoothed* values). The UI calls setPreset().
import * as THREE from 'three';
import { DEG } from './constants.js';
import { damp } from './math.js';

export const WEATHER_PRESETS = {
  //            coverage  base(m) top(m)  cirrus precip  vis(m)   windFrom(deg) wind(m/s @10m) turb  lightning
  clear:     { cloudCoverage: 0.00, cloudBase: 1800, cloudTop: 3200, cirrus: 0.15, precipitation: 0.0, visibility: 120000, windFrom: 250, windSpeed: 3,  turbulence: 0.05, lightning: 0, label: 'Clear' },
  fair:      { cloudCoverage: 0.22, cloudBase: 1500, cloudTop: 3000, cirrus: 0.30, precipitation: 0.0, visibility: 80000,  windFrom: 240, windSpeed: 5,  turbulence: 0.12, lightning: 0, label: 'Fair-weather cumulus' },
  scattered: { cloudCoverage: 0.42, cloudBase: 1400, cloudTop: 3600, cirrus: 0.35, precipitation: 0.0, visibility: 60000,  windFrom: 230, windSpeed: 7,  turbulence: 0.2,  lightning: 0, label: 'Scattered' },
  broken:    { cloudCoverage: 0.65, cloudBase: 1100, cloudTop: 4200, cirrus: 0.45, precipitation: 0.0, visibility: 40000,  windFrom: 220, windSpeed: 9,  turbulence: 0.3,  lightning: 0, label: 'Broken' },
  overcast:  { cloudCoverage: 0.92, cloudBase: 700,  cloudTop: 3000, cirrus: 0.20, precipitation: 0.35, visibility: 15000, windFrom: 200, windSpeed: 10, turbulence: 0.35, lightning: 0, label: 'Overcast, light rain' },
  storm:     { cloudCoverage: 0.97, cloudBase: 500,  cloudTop: 9500, cirrus: 0.10, precipitation: 0.9, visibility: 7000,   windFrom: 190, windSpeed: 17, turbulence: 0.75, lightning: 1, label: 'Thunderstorm' },
};
const NUMERIC = ['cloudCoverage', 'cloudBase', 'cloudTop', 'cirrus', 'precipitation', 'visibility', 'windFrom', 'windSpeed', 'turbulence', 'lightning'];

export function createWeather(ctx, params) {
  const startName = WEATHER_PRESETS[params.weather] ? params.weather : 'fair';
  const w = {
    preset: startName,
    target: { ...WEATHER_PRESETS[startName] },
    ...WEATHER_PRESETS[startName],       // current smoothed numeric values live directly on ctx.weather
    wind: new THREE.Vector3(),           // world-space velocity of the air mass at 10 m AGL (m/s), i.e. where the air is GOING
    setPreset(name, instant = false) {
      if (!WEATHER_PRESETS[name]) return;
      w.preset = name; w.target = { ...WEATHER_PRESETS[name] };
      if (instant) for (const k of NUMERIC) w[k] = w.target[k];
      ctx.events.emit('weather:change', { preset: name, instant });
    },
    // Steady wind at a world position (no turbulence; physics adds gusts scaled by weather.turbulence).
    // Power-law boundary layer below 600 m AGL-ish, then jet-stream-like increase with altitude.
    windAt(worldPos, out = new THREE.Vector3()) {
      const alt = Math.max(0, worldPos.y);
      const k = alt < 600 ? Math.pow(Math.max(alt, 2) / 10, 0.16) : Math.pow(60, 0.16) * (1 + (alt - 600) / 9000);
      return out.copy(w.wind).multiplyScalar(Math.min(k, 6));
    },
    update(dt) {
      const rate = 0.25;
      for (const k of NUMERIC) w[k] = k === 'windFrom' ? w.target[k] : damp(w[k], w.target[k], rate, dt);
      const a = w.windFrom * DEG; // wind FROM this true bearing -> air moves toward the opposite bearing
      w.wind.set(-Math.sin(a) * w.windSpeed, 0, Math.cos(a) * w.windSpeed);
    },
  };
  w.update(0);
  return w;
}
