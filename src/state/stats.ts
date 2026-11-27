// What the engine reports back every frame, for the readouts next to the picture.

import { create } from 'zustand';

export interface Stats {
  /** Steps since the last clap, tone start or reset ("t = 12.4 ms"). */
  eventSteps: number;
  /** The automatic gain g ("Gain ×8"). */
  gain: number;
  /** Frames drawn in the last second. */
  fps: number;
  /** Steps the solver has taken since it was created. */
  stepCount: number;
}

export const useStats = create<Stats>()(() => ({
  eventSteps: 0,
  gain: 1,
  fps: 0,
  stepCount: 0,
}));
