// Small signal-analysis helpers used by the validation scenes (and by ir.ts from M2 on).

/** In-place radix-2 FFT. `re` and `im` must have the same power-of-two length. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error('FFT length must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = Math.cos(step * k);
        const wi = Math.sin(step * k);
        const a = start + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export interface Spectrum {
  /** |X(f)| for bins 0 … n/2. */
  magnitude: Float64Array;
  /** Width of one bin [Hz]. */
  binHz: number;
}

/** Magnitude spectrum of a real signal, zero-padded to `fftSize` (a power of two). */
export function magnitudeSpectrum(
  signal: ArrayLike<number>,
  sampleRate: number,
  fftSize = nextPowerOfTwo(signal.length),
  window: 'none' | 'hann' = 'none',
): Spectrum {
  const n = signal.length;
  if (fftSize < n) throw new Error('fftSize is smaller than the signal');
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let i = 0; i < n; i++) {
    const w = window === 'hann' ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1;
    re[i] = signal[i] * w;
  }
  fft(re, im);
  const magnitude = new Float64Array(fftSize / 2 + 1);
  for (let k = 0; k < magnitude.length; k++) magnitude[k] = Math.hypot(re[k], im[k]);
  return { magnitude, binHz: sampleRate / fftSize };
}

/**
 * Frequencies of the spectral peaks between `minHz` and `maxHz`, lowest first. A peak is a local
 * maximum of at least `threshold` × the largest value in the range; its position is refined by
 * fitting a parabola through the logarithm of the three bins around it.
 */
export function findPeaks(
  spectrum: Spectrum,
  minHz: number,
  maxHz: number,
  threshold = 0.1,
): number[] {
  const { magnitude, binHz } = spectrum;
  const lo = Math.max(1, Math.ceil(minHz / binHz));
  const hi = Math.min(magnitude.length - 2, Math.floor(maxHz / binHz));
  let max = 0;
  for (let k = lo; k <= hi; k++) max = Math.max(max, magnitude[k]);
  const peaks: number[] = [];
  for (let k = lo; k <= hi; k++) {
    const m = magnitude[k];
    if (m < threshold * max || m <= magnitude[k - 1] || m < magnitude[k + 1]) continue;
    const a = Math.log(magnitude[k - 1]);
    const b = Math.log(m);
    const c = Math.log(magnitude[k + 1]);
    const denominator = a - 2 * b + c;
    const shift = denominator === 0 ? 0 : (0.5 * (a - c)) / denominator;
    peaks.push((k + shift) * binHz);
  }
  return peaks;
}

export function maxAbs(values: ArrayLike<number>, from = 0, to = values.length): number {
  let max = 0;
  for (let i = from; i < to; i++) max = Math.max(max, Math.abs(values[i]));
  return max;
}

/** Index of the sample with the largest magnitude. */
export function argMaxAbs(values: ArrayLike<number>, from = 0, to = values.length): number {
  let best = from;
  for (let i = from; i < to; i++) if (Math.abs(values[i]) > Math.abs(values[best])) best = i;
  return best;
}

export function toDb(amplitudeRatio: number): number {
  return 20 * Math.log10(Math.max(amplitudeRatio, 1e-12));
}
