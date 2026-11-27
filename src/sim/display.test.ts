import { describe, expect, it } from 'vitest';
import {
  GAIN_MAX,
  GAIN_REFERENCE,
  StepClock,
  formatGain,
  formatLength,
  formatSimTime,
  nextGain,
  targetGain,
} from './display';
import { maxAbs } from './analysis';
import { DisplaySource, ricker, TONE_RAMP_SECONDS, TONE_SOURCE_GAIN } from './sources';
import { SAMPLE_RATE } from './grid';

describe('automatic gain', () => {
  it('aims at the reference over the loudest cell', () => {
    expect(targetGain(GAIN_REFERENCE / 8)).toBeCloseTo(8, 9);
    expect(targetGain(0)).toBe(GAIN_MAX);
  });

  it('rises quickly and falls slowly', () => {
    const frame = 1 / 60;
    let up = 1;
    let down = 64;
    for (let i = 0; i < 18; i++) {
      up = nextGain(up, GAIN_REFERENCE / 64, frame);
      down = nextGain(down, GAIN_REFERENCE, frame);
    }
    // After 0.3 s the rising gain is most of the way up (in the logarithm) …
    expect(Math.log(up) / Math.log(64)).toBeGreaterThan(0.8);
    // … and the falling one is still well above where it is heading.
    expect(Math.log(down) / Math.log(64)).toBeGreaterThan(0.6);
  });

  it('says "Gain ×N" only while the picture is amplified', () => {
    expect(formatGain(1)).toBeNull();
    expect(formatGain(1.5)).toBe('Gain ×1.5');
    expect(formatGain(8.04)).toBe('Gain ×8');
    expect(formatGain(123.4)).toBe('Gain ×123');
  });
});

describe('display clock', () => {
  it('runs 400 steps per second at 120× slower than real time', () => {
    const clock = new StepClock();
    let steps = 0;
    for (let i = 0; i < 600; i++) steps += clock.advance(1 / 60, 120);
    expect(steps).toBeGreaterThanOrEqual(3999);
    expect(steps).toBeLessThanOrEqual(4000);
  });

  it('does not make up for a stalled tab', () => {
    const clock = new StepClock();
    expect(clock.advance(5, 15)).toBe(Math.floor((0.1 * SAMPLE_RATE) / 15));
  });

  it('formats time and lengths', () => {
    expect(formatSimTime(595)).toBe('t = 12.4 ms');
    expect(formatSimTime(96_000)).toBe('t = 2.00 s');
    expect(formatLength(345)).toBe('3.45 m');
  });
});

describe('display source', () => {
  it('plays one clap as the Ricker wavelet', () => {
    const source = new DisplaySource();
    source.clap();
    const shape = ricker(800);
    const out = new Float32Array(shape.length + 10);
    source.fill(out, out.length);
    expect(Array.from(out.subarray(0, shape.length))).toEqual(Array.from(shape));
    expect(maxAbs(out, shape.length)).toBe(0);
    expect(source.sounding).toBe(false);
  });

  it('fades the tone in, holds it, and fades it out without a jump', () => {
    const source = new DisplaySource();
    const hz = 200;
    source.setTone(true, hz);
    const ramp = Math.round(TONE_RAMP_SECONDS * SAMPLE_RATE);
    const steps = 4 * ramp;
    const out = new Float32Array(steps);
    source.fill(out, steps);
    const amplitude = TONE_SOURCE_GAIN * Math.sqrt((2 * Math.PI * hz) / SAMPLE_RATE);
    expect(maxAbs(out, 0, ramp / 4)).toBeLessThan(0.2 * amplitude);
    expect(maxAbs(out, 2 * ramp)).toBeCloseTo(amplitude, 2);

    source.setTone(false, hz);
    const tail = new Float32Array(2 * ramp);
    source.fill(tail, tail.length);
    let largestStep = 0;
    const joined = [...out, ...tail];
    for (let i = 1; i < joined.length; i++) {
      largestStep = Math.max(largestStep, Math.abs(joined[i] - joined[i - 1]));
    }
    // A sine of this frequency never moves more than ω·Δt·amplitude per step.
    expect(largestStep).toBeLessThanOrEqual(((2 * Math.PI * hz) / SAMPLE_RATE) * amplitude * 1.01);
    expect(maxAbs(tail, ramp + 1)).toBe(0);
    expect(source.sounding).toBe(false);
  });

  it('keeps the phase when the frequency changes', () => {
    const source = new DisplaySource();
    source.setTone(true, 300);
    const a = new Float32Array(3000);
    source.fill(a, a.length);
    source.setTone(true, 310);
    const b = new Float32Array(10);
    source.fill(b, b.length);
    const amplitude = TONE_SOURCE_GAIN * Math.sqrt((2 * Math.PI * 310) / SAMPLE_RATE);
    expect(Math.abs(b[0] - a[a.length - 1])).toBeLessThan(0.05 * amplitude);
  });
});
