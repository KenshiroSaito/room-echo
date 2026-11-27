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

/** The display clap (spec 5.6). */
export const CLAP_CENTER_HZ = 800;
export const TONE_MIN_HZ = 50;
export const TONE_MAX_HZ = 2000;
/** Fade-in and fade-out of the tone [s]. */
export const TONE_RAMP_SECONDS = 0.02;
/**
 * Amplitude of the tone's source value: TONE_SOURCE_GAIN·√(ω·Δt). A 2D source of amplitude
 * ω·Δt radiates a field that grows as √f, so this keeps the tone at about the level of a clap
 * at 1 m (0.10) at every frequency from 50 Hz to 2 kHz (scripts/display-levels.ts).
 */
export const TONE_SOURCE_GAIN = 3.0;

/**
 * Source values for the display, one per step: claps (Ricker wavelets, which may overlap) and
 * the tone. The tone keeps its phase when its frequency changes, and fades in and out over
 * 20 ms, so neither makes a click in the field.
 */
export class DisplaySource {
  private readonly clapShape = ricker(CLAP_CENTER_HZ);
  /** Steps into each clap still sounding. */
  private claps: number[] = [];
  private toneOn = false;
  private toneHz = 440;
  private phase = 0;
  /** 0 (silent) to 1 (full), moved linearly over the ramp. */
  private envelope = 0;
  private readonly rampSteps: number;

  constructor(private readonly sampleRate = SAMPLE_RATE) {
    this.rampSteps = Math.max(1, Math.round(TONE_RAMP_SECONDS * sampleRate));
  }

  clap(): void {
    this.claps.push(0);
  }

  setTone(on: boolean, hz: number): void {
    this.toneOn = on;
    this.toneHz = Math.min(TONE_MAX_HZ, Math.max(TONE_MIN_HZ, hz));
  }

  /** Stop everything at once (the field is being cleared). */
  silence(): void {
    this.claps = [];
    this.envelope = 0;
    this.phase = 0;
  }

  /** True while a clap or the tone is still adding to the field. */
  get sounding(): boolean {
    return this.claps.length > 0 || this.toneOn || this.envelope > 0;
  }

  /** Write the next `steps` source values into `out`. */
  fill(out: Float32Array, steps: number): void {
    const shape = this.clapShape;
    const w = (2 * Math.PI * this.toneHz) / this.sampleRate;
    const amplitude = TONE_SOURCE_GAIN * Math.sqrt(w);
    const rampStep = 1 / this.rampSteps;
    for (let i = 0; i < steps; i++) {
      let value = 0;
      for (let k = 0; k < this.claps.length; k++) {
        const at = this.claps[k];
        if (at < shape.length) value += shape[at];
        this.claps[k] = at + 1;
      }
      if (this.toneOn) this.envelope = Math.min(1, this.envelope + rampStep);
      else this.envelope = Math.max(0, this.envelope - rampStep);
      if (this.envelope > 0) {
        const gain = 0.5 - 0.5 * Math.cos(Math.PI * this.envelope);
        value += amplitude * gain * Math.sin(this.phase);
        this.phase += w;
        if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      } else {
        this.phase = 0;
      }
      out[i] = value;
    }
    this.claps = this.claps.filter((at) => at < shape.length);
  }
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
