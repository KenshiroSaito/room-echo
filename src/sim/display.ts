// Numbers behind the picture (spec 10-room-echo 4.1): the automatic gain, the display speed and
// the labels that state them. No DOM here, so the rules are unit-tested.

import { SAMPLE_RATE } from './grid';

/**
 * Peak pressure of a clap 1 m from the source in free field (scripts/display-levels.ts).
 * "Gain ×1" means the loudest part of the field is this loud.
 */
export const GAIN_REFERENCE = 0.1027;

/**
 * Compression k of the tone mapping v = sign(p)·(1 − exp(−k·|p|·g)). With g = reference / max,
 * the loudest cell maps to v = 1 − e^−1.5 ≈ 0.78 and a reflection ten times weaker to 0.14.
 * Chosen by eye in M1 between 1.0 (dull; the walls' hit flashes hard to see) and 3.0 (a
 * reverberant room floods with the brightest colours).
 */
export const COMPRESSION = 1.5 / GAIN_REFERENCE;

export const GAIN_MIN = 1 / 256;
/**
 * The gain stops at ×100: 40 dB below the reference, the same range as the Energy view. Beyond
 * that a room that has gone quiet should look quiet. At ×1000 (tried in M1) the picture showed
 * whatever was left 60 dB down, such as the slow 2D tail of a room whose walls were cleared.
 */
export const GAIN_MAX = 100;
/** Time constants of the gain in display time [s]: it rises quickly and falls slowly. */
export const GAIN_RISE_SECONDS = 0.15;
export const GAIN_FALL_SECONDS = 0.8;

/** The gain the field asks for: the reference over the loudest cell, within the limits. */
export function targetGain(fieldMax: number): number {
  if (!(fieldMax > 0)) return GAIN_MAX;
  return Math.min(GAIN_MAX, Math.max(GAIN_MIN, GAIN_REFERENCE / fieldMax));
}

/** One display frame of the automatic gain, smoothed in the logarithm. */
export function nextGain(current: number, fieldMax: number, dtSeconds: number): number {
  const target = targetGain(fieldMax);
  const tau = target > current ? GAIN_RISE_SECONDS : GAIN_FALL_SECONDS;
  const k = 1 - Math.exp(-Math.max(0, dtSeconds) / tau);
  return Math.exp(Math.log(current) + (Math.log(target) - Math.log(current)) * k);
}

/** "Gain ×8", shown only while the picture is amplified. */
export function formatGain(gain: number): string | null {
  if (gain < 1.05) return null;
  const shown = gain >= 10 ? Math.round(gain).toString() : (Math.round(gain * 10) / 10).toString();
  return `Gain ×${shown}`;
}

/** Display speeds, as how many times slower than real time. 120× is the default. */
export const SLOWDOWNS = [960, 480, 240, 120, 60, 30, 15] as const;
export const DEFAULT_SLOWDOWN = 120;
/** Under prefers-reduced-motion the picture starts slower. */
export const REDUCED_MOTION_SLOWDOWN = 480;

/** Simulation steps for a frame that took `dtSeconds` of real time, with the carried remainder. */
export class StepClock {
  private carry = 0;

  /** At most this many steps per frame; a stalled tab does not make the next frame huge. */
  constructor(private readonly maxSteps = 512) {}

  advance(dtSeconds: number, slowdown: number): number {
    const dt = Math.min(Math.max(dtSeconds, 0), 0.1);
    this.carry += (dt * SAMPLE_RATE) / slowdown;
    const steps = Math.min(this.maxSteps, Math.floor(this.carry));
    this.carry = Math.min(this.carry - steps, 1);
    return steps;
  }

  reset(): void {
    this.carry = 0;
  }
}

/** "t = 12.4 ms" from a number of steps. */
export function formatSimTime(steps: number): string {
  const seconds = steps / SAMPLE_RATE;
  if (seconds < 1) return `t = ${(seconds * 1000).toFixed(1)} ms`;
  return `t = ${seconds.toFixed(2)} s`;
}

export function formatSlowdown(slowdown: number): string {
  return `Slowed ${slowdown}×`;
}

/** "3.45 m" for a wall being drawn. */
export function formatLength(cm: number): string {
  return `${(cm / 100).toFixed(2)} m`;
}
