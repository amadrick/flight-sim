// Listener geometry (distance, directivity, Doppler, pan) and the interior/exterior dual-path mixer stage.
import * as THREE from 'three';
import { gain, biquad, set, clamp, sat, smooth } from './dsp.js';

const C = 340;
const _a = new THREE.Vector3(), _fwd = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _l = new THREE.Vector3(), _q = new THREE.Quaternion();
const INTERIOR_MODES = ['cockpit', 'interior', 'pilot', 'vc', 'virtual-cockpit', 'cabin', 'hud'];

export function isInterior(ctx) {
  const rig = ctx.cameraRig; if (!rig) return false;
  if (typeof rig.isInterior === 'boolean') return rig.isInterior;
  return INTERIOR_MODES.includes(rig.mode);
}

/**
 * Pure geometry. All inputs world space (m, m/s). camQuat: camera orientation (right = +X, forward = -Z).
 * out: { dist, front (+1 camera in front of the aircraft nose), pan, dop }
 */
export function listenerGeometry(acPos, acVel, acQuat, camPos, camVel, camQuat, out = {}) {
  _r.subVectors(camPos, acPos); const d = _r.length(); out.dist = d;
  if (d < 1e-3) { out.front = 0; out.pan = 0; out.dop = 1; return out; }
  _r.multiplyScalar(1 / d);
  _fwd.set(0, 0, -1).applyQuaternion(acQuat); out.front = clamp(_fwd.dot(_r), -1, 1);
  // pan: source direction expressed in the camera frame
  _q.copy(camQuat).invert(); _l.copy(_r).multiplyScalar(-1).applyQuaternion(_q);
  out.pan = clamp(_l.x, -1, 1) * 0.9 * smooth(0, 12, d);
  // Doppler: u = listener -> source
  _u.copy(_r).multiplyScalar(-1);
  const vl = camVel ? camVel.dot(_u) : 0, vs = acVel ? acVel.dot(_u) : 0;
  const f = (C + clamp(vl, -0.8 * C, 0.8 * C)) / (C + clamp(vs, -0.8 * C, 3 * C));
  out.dop = 1 + (clamp(f, 0.55, 1.8) - 1) * smooth(8, 60, d);
  return out;
}
/** Distance rolloff and air absorption for sources attached to the aircraft. */
export const distGain = (d) => 1 / (1 + Math.pow(d / 70, 1.15));
export const distCutoff = (d) => clamp(15000 * Math.exp(-d / 3200), 450, 15000);

/** A source that can be heard through either an interior or an exterior path. */
export class Dual {
  constructor(ac, dest, { intLP = 2000, extLP = 15000, int2 = true } = {}) {
    this.in = gain(ac, 1);
    this.intF = biquad(ac, 'lowpass', intLP, 0.5); this.intF2 = biquad(ac, 'lowpass', intLP, 0.5); this.intG = gain(ac, 0);
    this.extF = biquad(ac, 'lowpass', extLP, 0.5); this.extG = gain(ac, 0);
    this.extP = ac.createStereoPanner(); this.extP.pan._ac = ac;
    this.in.connect(this.intF); this.intF.connect(this.intF2); this.intF2.connect(this.intG); this.intG.connect(dest);
    this.in.connect(this.extF); this.extF.connect(this.extG); this.extG.connect(this.extP); this.extP.connect(dest);
  }
  setInt(g, fc, tc = 0.08) { set(this.intG.gain, g, tc); if (fc) { set(this.intF.frequency, fc, tc); set(this.intF2.frequency, fc, tc); } }
  setExt(g, fc, pan = 0, tc = 0.06) { set(this.extG.gain, g, tc); if (fc) set(this.extF.frequency, fc, tc); set(this.extP.pan, pan, 0.05); }
  dispose() { for (const n of [this.in, this.intF, this.intF2, this.intG, this.extF, this.extG, this.extP]) { try { n.disconnect(); } catch {} } }
}
