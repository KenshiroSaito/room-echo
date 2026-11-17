// Every piece of text the screens show (spec 00-common 1). English only.

import type { WallMaterialId } from './sim/materials';

export const STRINGS = {
  appTitle: 'Room Echo',

  materials: {
    concrete: 'Concrete / tile',
    glass: 'Glass',
    plaster: 'Plasterboard',
    wood: 'Wood panel',
    curtain: 'Heavy curtain',
    foam: 'Acoustic foam',
  } satisfies Record<WallMaterialId, string>,

  home: {
    lead: 'The simulation core is in place. The room editor arrives with the next milestone.',
    benchLink: 'Open the measurement page',
  },

  bench: {
    title: 'M0 bench',
    subtitle: 'Checks of the simulation core and its speed on this device',
    noWebGpu: 'This browser has no WebGPU, so nothing can be measured here.',
    adapter: 'GPU',
    running: 'Running',
    waiting: 'Waiting',
    done: 'All measurements finished',
    failed: 'Stopped by an error',
    pass: 'Pass',
    fail: 'Fail',
    checksHeading: 'Completion criteria',
    speedHeading: 'Speed',
    previewHeading: 'Free field',
    previewNote: 'No walls. A clap spreads in a circle and leaves through the edge.',
    criterion: 'Criterion',
    measured: 'Measured',
    limit: 'Limit',
    result: 'Result',
    size: 'Size',
    cells: 'Cells',
    stepsPerSecond: 'Steps per second',
    realTime: 'Speed vs real time',
    edge: '1 · Edge reflection, head-on',
    modes: '2 · Room resonances, 4.0 m × 3.0 m',
    wall: '3 · Wall reflection, head-on',
    agreement: '4 · GPU vs reference, 64 × 64, 1,000 steps',
    throughput: '5 · 48,000 steps at size M',
    edgeLimit: '≤ −30 dB',
    modesLimit: 'within 1 %',
    wallLimit: 'within ±0.05',
    agreementLimit: '≤ 1e-4 of peak',
    throughputLimit: '≤ 30 s',
    worst: 'worst',
    clap: 'clap',
    pulse: 'pulse',
    theory: 'theory',
    maxError: 'largest error',
    expected: 'expected',
    json: 'Results as JSON',
  },
} as const;
