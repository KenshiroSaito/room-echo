// Where the domain goes on screen (spec 00-common 4.4). The canvas covers the whole window and
// the panels float over it; the domain is fitted into the space the panels leave free, so no
// wall hides under a panel.

import type { ScreenRect } from '../state/store';

/** Panel sizes [CSS px], shared with the stylesheets (src/ui/*.module.css). */
export const LAYOUT = {
  gap: 12,
  topBar: 48,
  bottomStrip: 96,
  bottomStripNarrow: 64,
  toolbar: 72,
  panel: 280,
  /** The tab that stays when the panel is hidden. */
  panelTab: 40,
  /** Below this width the right panel becomes a bottom sheet (finished in M3). */
  narrow: 768,
} as const;

/** The largest rectangle of the given aspect (width / height) that fits the free space. */
export function layoutStage(
  viewportWidth: number,
  viewportHeight: number,
  aspect: number,
  panelOpen: boolean,
): ScreenRect {
  const { gap } = LAYOUT;
  const narrow = viewportWidth < LAYOUT.narrow;
  const left = narrow ? gap : gap + LAYOUT.toolbar + gap;
  const right = narrow ? gap : gap + (panelOpen ? LAYOUT.panel : LAYOUT.panelTab) + gap;
  const top = LAYOUT.topBar + gap;
  const bottom = (narrow ? LAYOUT.bottomStripNarrow : LAYOUT.bottomStrip) + 2 * gap;
  const freeWidth = Math.max(1, viewportWidth - left - right);
  const freeHeight = Math.max(1, viewportHeight - top - bottom);
  let width = freeWidth;
  let height = width / aspect;
  if (height > freeHeight) {
    height = freeHeight;
    width = height * aspect;
  }
  return {
    x: Math.round(left + (freeWidth - width) / 2),
    y: Math.round(top + (freeHeight - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  };
}
