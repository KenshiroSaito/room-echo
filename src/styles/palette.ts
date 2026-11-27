// Colour values that code needs as numbers (the GPU picture). They are the tokens of
// src/styles/tokens.css (spec 00-common 4.2); keep the two in step.

/** --series-1 … --series-8. A wall material takes the series of its position in the list. */
export const SERIES = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#0ca30c',
  '#9085e9',
  '#e66767',
] as const;

/** "#rrggbb" → [r, g, b] in 0 … 1 (sRGB values, as the canvas stores them). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
