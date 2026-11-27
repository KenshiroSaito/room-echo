// Runs /bench in a real browser with WebGPU: the M0 completion criteria on the GPU solver and
// the speed measurement. Saves the results and the screenshots that docs/measurements.md cites.

import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const SCREENSHOTS = 'docs/screenshots';

test('M0 criteria hold on the GPU solver', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));

  await page.goto('/bench/');
  await page.waitForFunction(() => window.__benchResults?.done === true, null, {
    timeout: 540_000,
    polling: 500,
  });
  const results = await page.evaluate(() => window.__benchResults);
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/bench-results.json', JSON.stringify(results, null, 2));

  expect(results.error, 'WebGPU must be available: run with a real GPU').toBeNull();
  expect(results.gpuErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);

  // 1 · the edge reflects a head-on wave by −30 dB or less
  expect(results.edge?.worstDb).toBeLessThanOrEqual(-30);
  // 2 · the five lowest resonances are within 1 %
  expect(results.modes?.measuredHz).toHaveLength(5);
  expect(results.modes?.maxRelativeError).toBeLessThanOrEqual(0.01);
  // 3 · wall reflection within ±0.05
  expect(results.wall).toHaveLength(3);
  for (const wall of results.wall ?? []) expect(Math.abs(wall.error)).toBeLessThanOrEqual(0.05);
  // 4 · GPU and reference agree
  expect(results.agreement?.relative).toBeLessThanOrEqual(1e-4);
  expect(results.agreement?.energyRelative).toBeLessThanOrEqual(1e-4);
  // 5 · speed measured for S, M, L; M takes 48,000 steps within 30 s
  expect(results.throughput.map((t) => t.size)).toEqual(['S', 'M', 'L']);
  expect(results.decision?.seconds).toBeLessThanOrEqual(30);

  mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: `${SCREENSHOTS}/m0-bench.png`, fullPage: true });

  // The picture of criterion 1: a clap spreads in a circle and leaves through the edge.
  const canvas = page.locator('#preview');
  for (const step of [150, 300, 450, 600, 1400]) {
    await page.evaluate((s) => window.__bench.showFreeField(s), step);
    await canvas.screenshot({ path: `${SCREENSHOTS}/m0-free-field-step-${step}.png` });
  }
});
