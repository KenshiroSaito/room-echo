// Source signals and the spatial footprint of a source (spec 10-room-echo 5.6).

import { SAMPLE_RATE } from './grid';

/**
 * Weight of a source by squared distance r² (in cells) from its centre. The source is added to
 * the centre cell and the cells within radius 2, with a Gaussian weight (standard deviation of
 * one cell), normalised so the 13 weights sum to 1. r² = 3 does not occur on a square grid.
 */
export const SOURCE_RADIUS = 2;
const RAW_WEIGHTS = [1, Math.exp(-0.5), Math.exp(-1), 0, Math.exp(-2)];
const WEIGHT_SUM = RAW_WEIGHTS[0] + 4 * RAW_WEIGHTS[1] + 4 * RAW_WEIGHTS[2] + 4 * RAW_WEIGHTS[4];
export const SOURCE_WEIGHTS: readonly number[] = RAW_WEIGHTS.map((w) =>
  Math.fround(w / WEIGHT_SUM),
);

/** The 13 cell offsets a source touches, with their weights. */
export const SOURCE_FOOTPRINT: readonly { dx: number; dy: number; weight: number }[] = (() => {
  const out: { dx: number; dy: number; weight: number }[] = [];
  for (let dy = -SOURCE_RADIUS; dy <= SOURCE_RADIUS; dy++) {
    for (let dx = -SOURCE_RADIUS; dx <= SOURCE_RADIUS; dx++) {
      const r2 = dx * dx + dy * dy;
      if (r2 <= SOURCE_RADIUS * SOURCE_RADIUS) out.push({ dx, dy, weight: SOURCE_WEIGHTS[r2] });
    }
  }
  return out;
})();

/**
 * Ricker wavelet (the "Clap" of the display): (1 − 2a)·exp(−a), a = (π·f·τ)².
 * It starts 1.5 periods before its peak, where it is below 1e-9, and lasts 3 periods.
 */
export function ricker(centerHz: number, sampleRate = SAMPLE_RATE): Float32Array {
  const delay = 1.5 / centerHz;
  const n = Math.ceil(2 * delay * sampleRate) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const tau = i / sampleRate - delay;
    const a = (Math.PI * centerHz * tau) ** 2;
    out[i] = (1 - 2 * a) * Math.exp(-a);
  }
  return out;
}

/**
 * Band-limited pulse for recording a response: a sinc low-pass with a Blackman window.
 * The gain is 1 at 0 Hz and −6 dB at the cut-off.
 */
export function windowedSinc(cutoffHz: number, taps = 129, sampleRate = SAMPLE_RATE): Float32Array {
  if (taps % 2 === 0) throw new Error('taps must be odd');
  const mid = (taps - 1) / 2;
  const fc = cutoffHz / sampleRate;
  const out = new Float32Array(taps);
  for (let i = 0; i < taps; i++) {
    const k = i - mid;
    const sinc = k === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * k) / (Math.PI * k);
    const phase = (2 * Math.PI * i) / (taps - 1);
    const window = 0.42 - 0.5 * Math.cos(phase) + 0.08 * Math.cos(2 * phase);
    out[i] = sinc * window;
  }
  return out;
}

/** First difference, one sample longer than the input. Its running sum is the input. */
export function differentiate(signal: Float32Array): Float32Array {
  const out = new Float32Array(signal.length + 1);
  for (let i = 0; i <= signal.length; i++) {
    out[i] = (i < signal.length ? signal[i] : 0) - (i > 0 ? signal[i - 1] : 0);
  }
  return out;
}

/** A sine that fades in over `rampSeconds` (the "Tone" source). */
export function tone(
  frequencyHz: number,
  steps: number,
  rampSeconds = 0.02,
  sampleRate = SAMPLE_RATE,
): Float32Array {
  const out = new Float32Array(steps);
  const rampSteps = Math.max(1, Math.round(rampSeconds * sampleRate));
  for (let i = 0; i < steps; i++) {
    const gain = i < rampSteps ? 0.5 - 0.5 * Math.cos((Math.PI * i) / rampSteps) : 1;
    out[i] = gain * Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate);
  }
  return out;
}
