// Master bus: flight bus + ambience bus -> volume -> DC-block -> compressor/limiter -> tanh safety clip -> destination.
import { gain, biquad, tanhCurve } from './dsp.js';

export function createMaster(ac, dest = ac.destination, volume = 0.8) {
  const flightIn = gain(ac, 1), ambIn = gain(ac, 1), master = gain(ac, volume);
  const hp = biquad(ac, 'highpass', 14, 0.6);
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.22;
  const post = gain(ac, 1.1);
  const clip = ac.createWaveShaper(); clip.curve = tanhCurve(4096, 1.0).map((v) => v * 0.94); try { clip.oversample = '2x'; } catch {}
  flightIn.connect(master); ambIn.connect(master); master.connect(hp); hp.connect(comp); comp.connect(post); post.connect(clip); clip.connect(dest);
  return { flightIn, ambIn, master, comp, clip };
}
