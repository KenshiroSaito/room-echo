// Validation scenes for the M0 completion criteria (spec 10-room-echo 7, M0).
// They are written against the Sim interface, so the CPU reference (vitest) and the GPU solver
// (/bench) run exactly the same scenes.

import { argMaxAbs, findPeaks, magnitudeSpectrum, maxAbs, toDb } from './analysis';
import {
  AIR,
  CUSTOM_CODE_MIN,
  DEFAULT_ABSORBER,
  EDGE,
  NO_ABSORBER,
  RIGID,
  buildCoefficients,
  createGrid,
  fillRect,
  strokeRect,
  wallCode,
  type CellGrid,
} from './geometry';
import { DT, SAMPLE_RATE, SPEED_OF_SOUND, metersToCells } from './grid';
import { WALL_MATERIALS, betaFromAlpha, floorSigma, reflectionFromAlpha } from './materials';
import { createRng } from './rng';
import type { Absorber, SimFactory, SimSetup } from './sim';
import { differentiate, ricker, tone, windowedSinc } from './sources';

// ---------------------------------------------------------------------------------------------
// Head-on reflection, measured in a one-cell-wide channel between fully reflecting walls.
// A plane wave in such a channel is exactly a wave that hits the end wall head-on.
//
//   wall | ←—— lead ——→ source ←— gap —→ probe ←— run —→ | end wall under test
//
// The same channel is run a second time with the end moved far away. The difference between
// the two recordings at the probe is the reflected wave alone.
// ---------------------------------------------------------------------------------------------

const CHANNEL = { lead: 1500, gap: 200, run: 400, extension: 1000, steps: 2400 };

export interface Termination {
  /** Admittance β of the end wall. */
  beta: number;
  /** Absorbing layer in front of the end wall. Only its right edge is used. */
  absorber?: Absorber;
}

function channelSetup(termination: Termination | null): SimSetup {
  const airCells = CHANNEL.lead + CHANNEL.gap + CHANNEL.run + (termination ? 0 : CHANNEL.extension);
  const nx = airCells + 2;
  const ny = 3;
  const grid: CellGrid = { nx, ny, cells: new Uint8Array(nx * ny).fill(RIGID) };
  fillRect(grid, 1, 1, nx - 1, 2, AIR);
  grid.cells[nx] = EDGE;
  grid.cells[nx + nx - 1] = termination ? CUSTOM_CODE_MIN : EDGE;
  const absorber: Absorber = termination?.absorber
    ? { ...termination.absorber, left: false, top: false, bottom: false, right: true }
    : NO_ABSORBER;
  const probe = { x: CHANNEL.lead + CHANNEL.gap, y: 1 };
  return {
    nx,
    ny,
    coeff: buildCoefficients(grid, {
      absorber,
      customBeta: new Map([[CUSTOM_CODE_MIN, termination?.beta ?? 1]]),
    }),
    absorber,
    source: { x: CHANNEL.lead, y: 1 },
    probes: [probe, probe],
    recordCapacity: CHANNEL.steps,
  };
}

async function recordChannel(
  factory: SimFactory,
  termination: Termination | null,
  source: Float32Array,
): Promise<Float32Array> {
  const sim = await factory(channelSetup(termination));
  try {
    await sim.run(CHANNEL.steps, source);
    return (await sim.readRecording())[0];
  } finally {
    sim.destroy();
  }
}

export interface ReflectionMeasurement {
  /** Reflected peak / incident peak, with the sign of the reflected pulse. */
  peakRatio: number;
  /**
   * √(reflected energy / incident energy), with the sign of the reflected pulse. Unlike the
   * peak, the energy of a pulse does not change as the grid slowly smears it out on the way
   * to the wall and back, so this is the better estimate of the reflection factor.
   */
  energyRatio: number;
  incident: Float32Array;
  reflected: Float32Array;
}

/**
 * Send `pulse` down the channel and measure what comes back from the end wall.
 * In one dimension a source radiates the running sum of its signal, so the source is driven
 * with the first difference of `pulse`; the travelling wave then has the shape of `pulse`.
 */
export async function measureReflection(
  factory: SimFactory,
  termination: Termination,
  pulse: Float32Array,
): Promise<ReflectionMeasurement> {
  const source = differentiate(pulse);
  const incident = await recordChannel(factory, null, source);
  const withWall = await recordChannel(factory, termination, source);
  const reflected = new Float32Array(incident.length);
  for (let i = 0; i < incident.length; i++) reflected[i] = withWall[i] - incident[i];
  const iPeak = argMaxAbs(incident);
  const rPeak = argMaxAbs(reflected);
  const peakRatio = reflected[rPeak] / incident[iPeak];
  let incidentEnergy = 0;
  let reflectedEnergy = 0;
  for (let i = 0; i < incident.length; i++) {
    incidentEnergy += incident[i] * incident[i];
    reflectedEnergy += reflected[i] * reflected[i];
  }
  const energyRatio = Math.sign(peakRatio) * Math.sqrt(reflectedEnergy / incidentEnergy);
  return { peakRatio, energyRatio, incident, reflected };
}

/** Reflection per octave band: √(reflected energy / incident energy) within each band. */
export function bandReflection(
  measurement: ReflectionMeasurement,
  centersHz: readonly number[],
  maxHz: number,
): { hz: number; ratio: number }[] {
  const fftSize = 8192;
  const inc = magnitudeSpectrum(measurement.incident, SAMPLE_RATE, fftSize);
  const ref = magnitudeSpectrum(measurement.reflected, SAMPLE_RATE, fftSize);
  return centersHz.map((hz) => {
    const lo = Math.max(1, Math.round(hz / Math.SQRT2 / inc.binHz));
    const hi = Math.round(Math.min(hz * Math.SQRT2, maxHz) / inc.binHz);
    let incidentEnergy = 0;
    let reflectedEnergy = 0;
    for (let k = lo; k <= hi; k++) {
      incidentEnergy += inc.magnitude[k] ** 2;
      reflectedEnergy += ref.magnitude[k] ** 2;
    }
    return { hz, ratio: Math.sqrt(reflectedEnergy / incidentEnergy) };
  });
}

export const CLAP_HZ = 800;
export const RECORD_CUTOFF_HZ = 4000;
export const OCTAVE_BANDS_HZ = [63, 125, 250, 500, 1000, 2000, 4000] as const;

// ---------------------------------------------------------------------------------------------
// Criterion 1: the outer edge reflects a head-on wave by −30 dB or less.
// ---------------------------------------------------------------------------------------------

export interface EdgeReflectionResult {
  /** Peak reflection of the display "Clap" (800 Hz Ricker) [dB]. */
  clapDb: number;
  /** Peak reflection of the 4 kHz band-limited recording pulse [dB]. */
  pulseDb: number;
  /** Reflection per octave band [dB]. */
  bands: { hz: number; db: number }[];
  worstDb: number;
  limitDb: number;
  pass: boolean;
}

export const EDGE_REFLECTION_LIMIT_DB = -30;

export async function measureEdgeReflection(
  factory: SimFactory,
  absorber: Absorber = DEFAULT_ABSORBER,
): Promise<EdgeReflectionResult> {
  const termination: Termination = { beta: 1, absorber };
  const clap = await measureReflection(factory, termination, ricker(CLAP_HZ));
  const pulse = await measureReflection(factory, termination, windowedSinc(RECORD_CUTOFF_HZ));
  const bands = bandReflection(pulse, OCTAVE_BANDS_HZ, RECORD_CUTOFF_HZ).map((b) => ({
    hz: b.hz,
    db: toDb(b.ratio),
  }));
  const clapDb = toDb(Math.abs(clap.peakRatio));
  const pulseDb = toDb(Math.abs(pulse.peakRatio));
  const worstDb = Math.max(clapDb, pulseDb, ...bands.map((b) => b.db));
  return {
    clapDb,
    pulseDb,
    bands,
    worstDb,
    limitDb: EDGE_REFLECTION_LIMIT_DB,
    pass: worstDb <= EDGE_REFLECTION_LIMIT_DB,
  };
}

// ---------------------------------------------------------------------------------------------
// Criterion 3: a wall of absorption α reflects a head-on wave by √(1 − α), within ±0.05.
// ---------------------------------------------------------------------------------------------

export interface WallReflectionResult {
  alpha: number;
  expected: number;
  /** Reflection factor from the energy of the 800 Hz clap (see ReflectionMeasurement). */
  measured: number;
  /** The same from the peaks, for comparison. */
  peakRatio: number;
  error: number;
  pass: boolean;
}

export const WALL_REFLECTION_ALPHAS = [0.1, 0.5, 0.9] as const;
export const WALL_REFLECTION_TOLERANCE = 0.05;

export async function measureWallReflection(
  factory: SimFactory,
  alpha: number,
): Promise<WallReflectionResult> {
  const measurement = await measureReflection(
    factory,
    { beta: betaFromAlpha(alpha) },
    ricker(CLAP_HZ),
  );
  const expected = reflectionFromAlpha(alpha);
  const error = measurement.energyRatio - expected;
  return {
    alpha,
    expected,
    measured: measurement.energyRatio,
    peakRatio: measurement.peakRatio,
    error,
    pass: Math.abs(error) <= WALL_REFLECTION_TOLERANCE,
  };
}

// ---------------------------------------------------------------------------------------------
// Criterion 2: the five lowest resonances of a fully reflecting 4.0 m × 3.0 m room are within
// 1 % of f = (c/2)·√((m/Lx)² + (n/Ly)²).
// ---------------------------------------------------------------------------------------------

export const MODE_ROOM = { widthM: 4.0, heightM: 3.0 };
export const MODE_TOLERANCE = 0.01;

export function theoreticalModes(count: number): number[] {
  const out: number[] = [];
  for (let m = 0; m <= count; m++) {
    for (let n = 0; n <= count; n++) {
      if (m === 0 && n === 0) continue;
      out.push((SPEED_OF_SOUND / 2) * Math.hypot(m / MODE_ROOM.widthM, n / MODE_ROOM.heightM));
    }
  }
  return out.sort((a, b) => a - b).slice(0, count);
}

export interface RoomModesResult {
  theoryHz: number[];
  measuredHz: number[];
  /** Largest |measured − theory| / theory over the five modes. */
  maxRelativeError: number;
  seconds: number;
  pass: boolean;
}

export async function measureRoomModes(
  factory: SimFactory,
  seconds = 0.5,
): Promise<RoomModesResult> {
  const wx = metersToCells(MODE_ROOM.widthM);
  const wy = metersToCells(MODE_ROOM.heightM);
  const nx = wx + 2;
  const ny = wy + 2;
  const grid: CellGrid = { nx, ny, cells: new Uint8Array(nx * ny) };
  strokeRect(grid, 0, 0, nx, ny, 1, RIGID);

  // Source and probe sit in opposite corners, where no low mode has a node. The source is a
  // low Ricker pulse, so the energy goes into the modes of interest.
  const pulse = ricker(70);
  const steps = Math.round(seconds * SAMPLE_RATE);
  const probe = { x: nx - 5, y: ny - 5 };
  const sim = await factory({
    nx,
    ny,
    coeff: buildCoefficients(grid),
    absorber: NO_ABSORBER,
    source: { x: 4, y: 4 },
    probes: [probe, probe],
    recordCapacity: steps,
  });
  let recording: Float32Array;
  try {
    await sim.run(steps, pulse);
    recording = (await sim.readRecording())[0];
  } finally {
    sim.destroy();
  }

  // Only the free ringing after the source has stopped is analysed.
  const ringing = recording.subarray(pulse.length);
  const spectrum = magnitudeSpectrum(ringing, SAMPLE_RATE, 1 << 20, 'hann');
  const theoryHz = theoreticalModes(5);
  const measuredHz = findPeaks(spectrum, 25, 110);
  let maxRelativeError = Number.POSITIVE_INFINITY;
  if (measuredHz.length === theoryHz.length) {
    maxRelativeError = Math.max(...theoryHz.map((f, i) => Math.abs(measuredHz[i] - f) / f));
  }
  return {
    theoryHz,
    measuredHz,
    maxRelativeError,
    seconds,
    pass: maxRelativeError <= MODE_TOLERANCE,
  };
}

// ---------------------------------------------------------------------------------------------
// Criterion 4: the GPU solver and the reference agree on a 64 × 64 grid after 1,000 steps.
// The scene uses every term of the update rule: walls of every material, the absorbing layer,
// the floor damping, and a source that keeps running so the field is still loud at the end.
// ---------------------------------------------------------------------------------------------

export const AGREEMENT_STEPS = 1000;
export const AGREEMENT_TOLERANCE = 1e-4;

export function agreementScene(seed = 1): { setup: SimSetup; source: Float32Array } {
  const n = 64;
  const rng = createRng(seed);
  const grid = createGrid(n, n);
  // A concrete box keeps most of the sound inside; two gaps let some of it out into the layer.
  strokeRect(grid, 8, 8, n - 8, n - 8, 1, wallCode('concrete'));
  fillRect(grid, 20, 8, 24, 9, AIR);
  fillRect(grid, n - 9, 30, n - 8, 36, AIR);
  // Scattered wall cells of every material.
  for (let i = 0; i < 150; i++) {
    const x = 10 + Math.floor(rng() * (n - 20));
    const y = 10 + Math.floor(rng() * (n - 20));
    grid.cells[y * n + x] = 1 + Math.floor(rng() * WALL_MATERIALS.length);
  }
  const source = { x: 30, y: 33 };
  fillRect(grid, source.x - 3, source.y - 3, source.x + 4, source.y + 4, AIR);
  const probes: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 14, y: 50 },
    { x: 48, y: 13 },
  ];
  for (const p of probes) grid.cells[p.y * n + p.x] = AIR;

  const signal = tone(600, AGREEMENT_STEPS);
  const clap = ricker(CLAP_HZ);
  for (let i = 0; i < clap.length; i++) signal[i] += clap[i];

  // A thin layer (6 cells) so that most of the small grid is room; the box wall crosses it.
  const absorber: Absorber = { ...DEFAULT_ABSORBER, cells: 6 };
  fillRect(grid, 1, 40, 8, 41, wallCode('wood'));
  return {
    setup: {
      nx: n,
      ny: n,
      coeff: buildCoefficients(grid, { absorber, uniformSigmaDt: floorSigma(0.08) * DT }),
      absorber,
      source,
      probes,
      recordCapacity: AGREEMENT_STEPS,
    },
    source: signal,
  };
}

export interface AgreementResult {
  /** Largest |a − b| over the field and both recordings. */
  maxDifference: number;
  /** Largest |pressure| of the reference field at the last step. */
  maxAmplitude: number;
  relative: number;
  pass: boolean;
}

export async function measureAgreement(a: SimFactory, b: SimFactory): Promise<AgreementResult> {
  const { setup, source } = agreementScene();
  const simA = await a(setup);
  const simB = await b(setup);
  try {
    await simA.run(AGREEMENT_STEPS, source);
    await simB.run(AGREEMENT_STEPS, source);
    const fieldA = await simA.readField();
    const fieldB = await simB.readField();
    const recA = await simA.readRecording();
    const recB = await simB.readRecording();
    let maxDifference = 0;
    for (let i = 0; i < fieldA.length; i++) {
      maxDifference = Math.max(maxDifference, Math.abs(fieldA[i] - fieldB[i]));
    }
    for (let ch = 0; ch < 2; ch++) {
      if (recA[ch].length !== AGREEMENT_STEPS || recB[ch].length !== AGREEMENT_STEPS) {
        throw new Error('A recording is incomplete');
      }
      for (let i = 0; i < AGREEMENT_STEPS; i++) {
        maxDifference = Math.max(maxDifference, Math.abs(recA[ch][i] - recB[ch][i]));
      }
    }
    const maxAmplitude = maxAbs(fieldA);
    const relative = maxDifference / maxAmplitude;
    return { maxDifference, maxAmplitude, relative, pass: relative <= AGREEMENT_TOLERANCE };
  } finally {
    simA.destroy();
    simB.destroy();
  }
}

// ---------------------------------------------------------------------------------------------
// Free field: no walls, only the absorbing edge. Used for the picture of criterion 1 (a pulse
// spreads in a circle and leaves) and for the throughput measurement.
// ---------------------------------------------------------------------------------------------

export function freeFieldSetup(
  nx: number,
  ny: number,
  absorber: Absorber = DEFAULT_ABSORBER,
  recordCapacity = 0,
): SimSetup {
  const grid = createGrid(nx, ny);
  const centre = { x: nx >> 1, y: ny >> 1 };
  return {
    nx,
    ny,
    coeff: buildCoefficients(grid, { absorber }),
    absorber,
    source: centre,
    probes: [centre, centre],
    recordCapacity,
  };
}
