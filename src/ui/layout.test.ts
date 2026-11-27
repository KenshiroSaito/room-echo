import { describe, expect, it } from 'vitest';
import { LAYOUT, layoutStage } from './layout';

describe('layoutStage', () => {
  it('fits a 4:3 domain between the panels and keeps its aspect', () => {
    const rect = layoutStage(1280, 900, 4 / 3, true);
    expect(rect.x).toBeGreaterThanOrEqual(LAYOUT.gap + LAYOUT.toolbar + LAYOUT.gap);
    expect(rect.x + rect.width).toBeLessThanOrEqual(1280 - LAYOUT.panel - 2 * LAYOUT.gap);
    expect(rect.y).toBeGreaterThanOrEqual(LAYOUT.topBar);
    expect(rect.y + rect.height).toBeLessThanOrEqual(900 - LAYOUT.bottomStrip - LAYOUT.gap);
    expect(Math.abs(rect.width / rect.height - 4 / 3)).toBeLessThan(0.01);
  });

  it('grows when the panel is hidden', () => {
    const open = layoutStage(1280, 1200, 4 / 3, true);
    const hidden = layoutStage(1280, 1200, 4 / 3, false);
    expect(hidden.width).toBeGreaterThan(open.width);
  });

  it('never returns an empty rectangle', () => {
    const rect = layoutStage(200, 150, 4 / 3, true);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});
