// The site itself in real Chrome with WebGPU: the M1 completion criteria (spec 10-room-echo 7)
// and the screenshots of the main screens. Measured values go to test-results/app-results.json
// for docs/measurements.md.

import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const SHOTS = 'docs/screenshots';
const results: Record<string, unknown> = {};

type Vec = [number, number];
interface WallSpec {
  a: Vec;
  b: Vec;
  m: string;
}

async function openApp(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto('/?test');
  await page.waitForFunction(() => !!window.__roomEcho);
  return problems;
}

/** Replace the scene, silence the field and stop the clock. */
async function scene(
  page: Page,
  options: { walls: WallSpec[]; source: Vec; floor?: string; size?: 'S' | 'M' | 'L' },
): Promise<void> {
  await page.evaluate((o) => {
    const room = window.__roomEcho!.room;
    if (o.size) room.getState().setSize(o.size);
    room.setState({
      walls: o.walls as never,
      source: o.source,
      floor: (o.floor ?? 'wood') as never,
      sourceType: 'clap',
      playing: false,
    });
    room.setState({ resetCount: room.getState().resetCount + 1 });
  }, options);
}

/** Clap at the source and run `steps` steps at once, the clock stopped. */
async function clapAndRun(page: Page, steps: number): Promise<void> {
  await page.evaluate(async (n) => {
    const { room, engine } = window.__roomEcho!;
    room.getState().clap();
    room.setState({ playing: false });
    await engine.fastForward(n);
  }, steps);
}

async function nextFrames(page: Page, frames = 2): Promise<void> {
  await page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let left = n;
        const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      }),
    frames,
  );
}

/** Screen position of a point of the domain [cm]. */
async function toScreen(page: Page, p: Vec): Promise<Vec> {
  return page.evaluate(
    ({ p }) => {
      const { room } = window.__roomEcho!;
      const { stage, size } = room.getState();
      const widthCm = { S: 6, M: 8, L: 12 }[size] * 100;
      const scale = stage!.width / widthCm;
      return [stage!.x + p[0] * scale, stage!.y + p[1] * scale] as Vec;
    },
    { p },
  );
}

test.describe.configure({ mode: 'serial' });

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/app-results.json', JSON.stringify(results, null, 2));
});

test('opens on the bedroom, already sounding, with the hint after 5 s', async ({ page }) => {
  const problems = await openApp(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/m1-first-view.png` });
  const early = await page.evaluate(() => window.__roomEcho!.stats.getState().eventSteps);
  expect(early).toBeGreaterThan(0);
  await expect(page.getByText('Click anywhere to clap')).toHaveCount(0);
  await page.waitForTimeout(5000);
  await expect(page.getByText('Click anywhere to clap')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/m1-click-hint.png` });

  // Clicking claps there and hides the hint.
  const at = await toScreen(page, [300, 250]);
  await page.mouse.click(at[0], at[1]);
  await expect(page.getByText('Click anywhere to clap')).toHaveCount(0);
  const source = await page.evaluate(() => window.__roomEcho!.room.getState().source);
  expect(Math.abs(source[0] - 300)).toBeLessThanOrEqual(2);
  expect(problems).toEqual([]);
});

test('criterion 1: a 10-wall floor plan is drawn with the mouse', async ({ page }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Clear walls' }).click();
  await page.getByRole('button', { name: /^Wall/ }).click();

  // A bedroom with a closet and an entry hall, 10 walls. Every wall starts and ends on the
  // 5 cm grid or on an end point of an earlier wall.
  const plan: { a: Vec; b: Vec; m: string }[] = [
    { a: [180, 120], b: [620, 120], m: 'Plasterboard' },
    { a: [620, 120], b: [620, 480], m: 'Plasterboard' },
    { a: [620, 480], b: [420, 480], m: 'Plasterboard' },
    { a: [340, 480], b: [180, 480], m: 'Plasterboard' },
    { a: [180, 480], b: [180, 120], m: 'Plasterboard' },
    { a: [180, 300], b: [270, 300], m: 'Wood panel' },
    { a: [270, 300], b: [270, 400], m: 'Wood panel' },
    { a: [420, 480], b: [420, 560], m: 'Plasterboard' },
    { a: [340, 480], b: [340, 560], m: 'Plasterboard' },
    { a: [300, 120], b: [500, 120], m: 'Glass' },
  ];
  const started = Date.now();
  let shotTaken = false;
  for (const wall of plan) {
    await page.getByRole('radio', { name: new RegExp(wall.m) }).click();
    const a = await toScreen(page, wall.a);
    const b = await toScreen(page, wall.b);
    await page.mouse.move(a[0], a[1]);
    await page.mouse.down();
    await page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, { steps: 4 });
    await page.mouse.move(b[0], b[1], { steps: 4 });
    if (!shotTaken && wall.m === 'Wood panel') {
      await page.screenshot({ path: `${SHOTS}/m1-drawing.png` });
      shotTaken = true;
    }
    await page.mouse.up();
  }
  const seconds = (Date.now() - started) / 1000;
  const walls = await page.evaluate(() => window.__roomEcho!.room.getState().walls);
  expect(walls).toHaveLength(plan.length);
  for (let i = 0; i < plan.length; i++) {
    for (const end of ['a', 'b'] as const) {
      expect(Math.abs(walls[i][end][0] - plan[i][end][0])).toBeLessThanOrEqual(5);
      expect(Math.abs(walls[i][end][1] - plan[i][end][1])).toBeLessThanOrEqual(5);
    }
  }
  // Corners close exactly: snapping puts both ends on the same point.
  expect(walls[1].a).toEqual(walls[0].b);
  expect(walls[4].b).toEqual(walls[0].a);

  await page.getByRole('button', { name: /^Source/ }).click();
  await page.evaluate(() => {
    const room = window.__roomEcho!.room;
    room.getState().clap([400, 220]);
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/m1-floor-plan.png` });

  // Cut an 80 cm opening into the right wall with the eraser, then undo it.
  await page.getByRole('button', { name: /^Erase/ }).click();
  const from = await toScreen(page, [620, 230]);
  const to = await toScreen(page, [620, 290]);
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move(to[0], to[1], { steps: 8 });
  await page.screenshot({ path: `${SHOTS}/m1-erase.png` });
  await page.mouse.up();
  const afterErase = await page.evaluate(() => window.__roomEcho!.room.getState().walls);
  expect(afterErase).toHaveLength(plan.length + 1);
  await page.keyboard.press('ControlOrMeta+z');
  const afterUndo = await page.evaluate(() => window.__roomEcho!.room.getState().walls);
  expect(afterUndo).toHaveLength(plan.length);

  results.criterion1 = { walls: plan.length, drags: plan.length, scriptedSeconds: seconds };
});

test('criterion 2: the frame after a wall is drawn already uses it', async ({ page }) => {
  await openApp(page);
  await scene(page, { walls: [], source: [400, 300] });
  await clapAndRun(page, 200);
  // The front is now about 0.9 m out. Put a wall across it, 0.6 m right of the source.
  const before = await page.evaluate(() => {
    const { engine } = window.__roomEcho!;
    return engine.solver.stepCount;
  });
  const wall: WallSpec = { a: [460, 200], b: [460, 400], m: 'concrete' };
  const field = await page.evaluate(async (w) => {
    const { engine, room } = window.__roomEcho!;
    const cells: { x: number; y: number }[] = [];
    for (let y = w.a[1] + 10; y <= w.b[1] - 10; y += 5) cells.push(engine.cellAt([w.a[0], y]));
    const readAt = async () => {
      const f = await engine.readField();
      const nx = engine.solver.nx;
      return cells.map((c) => f[c.y * nx + c.x]);
    };
    const without = await readAt();
    room.getState().addWall(w as never);
    room.setState({ playing: true });
    // The very next display frame.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const withWall = await readAt();
    return { without, withWall, steps: engine.solver.stepCount };
  }, wall);
  expect(field.steps).toBeGreaterThan(before);
  expect(Math.max(...field.without.map(Math.abs))).toBeGreaterThan(0);
  expect(field.withWall.every((p) => p === 0)).toBe(true);
  results.criterion2 = {
    stepsAfterEdit: field.steps - before,
    largestPressureInWallCellsBefore: Math.max(...field.without.map(Math.abs)),
    largestPressureInWallCellsAfter: Math.max(...field.withWall.map(Math.abs)),
  };
  await page.evaluate(() => window.__roomEcho!.room.setState({ playing: false }));
  await page.evaluate(() => window.__roomEcho!.engine.fastForward(220));
  await nextFrames(page);
  await page.screenshot({ path: `${SHOTS}/m1-new-wall.png` });
});

test('criterion 3: acoustic foam reflects visibly less than concrete', async ({ page }) => {
  await openApp(page);
  const source: Vec = [400, 300];
  // Wall 1 m below the source; its face is 0.95 m away.
  const wallAt = (m: string): WallSpec[] => [{ a: [150, 400], b: [650, 400], m }];
  // After 440 steps the reflected front is about 0.6 m above the source, the direct front
  // 2.5 m above it. Sample the column above the source, 0.2 m to 1.0 m up.
  const sample = async (walls: WallSpec[]): Promise<number[]> => {
    await scene(page, { walls, source });
    await clapAndRun(page, 440);
    return page.evaluate(async () => {
      const { engine } = window.__roomEcho!;
      const f = await engine.readField();
      const nx = engine.solver.nx;
      const values: number[] = [];
      for (let y = 200; y <= 280; y += 1) {
        const c = engine.cellAt([400, y]);
        values.push(f[c.y * nx + c.x]);
      }
      return values;
    });
  };
  const free = await sample([]);
  const concrete = await sample(wallAt('concrete'));
  await page.evaluate(() => window.__roomEcho!.engine.fastForward(60));
  await nextFrames(page);
  await page.screenshot({ path: `${SHOTS}/m1-reflection-concrete.png` });
  const foam = await sample(wallAt('foam'));
  await page.evaluate(() => window.__roomEcho!.engine.fastForward(60));
  await nextFrames(page);
  await page.screenshot({ path: `${SHOTS}/m1-reflection-foam.png` });

  const reflected = (withWall: number[]) =>
    Math.max(...withWall.map((p, i) => Math.abs(p - free[i])));
  const rConcrete = reflected(concrete);
  const rFoam = reflected(foam);
  const ratio = rFoam / rConcrete;
  results.criterion3 = {
    reflectedPeakConcrete: rConcrete,
    reflectedPeakFoam: rFoam,
    ratio,
    expectedRatio: Math.sqrt(1 - 0.7775) / Math.sqrt(1 - 0.0175),
  };
  expect(ratio).toBeLessThan(0.6);
});

test('criterion 4: a 71.5 Hz tone in a 4.0 × 3.0 m room shows the (1, 1) mode', async ({
  page,
}) => {
  await openApp(page);
  // Inside faces at x = 200 … 600 and y = 150 … 450: wall centres 5 cm further out.
  const room: WallSpec[] = [
    { a: [195, 145], b: [605, 145], m: 'concrete' },
    { a: [605, 145], b: [605, 455], m: 'concrete' },
    { a: [605, 455], b: [195, 455], m: 'concrete' },
    { a: [195, 455], b: [195, 145], m: 'concrete' },
  ];
  await scene(page, { walls: room, source: [235, 185] });
  const ratios: Record<string, number> = {};
  for (const hz of [71.5, 57.2]) {
    await page.evaluate(async (f) => {
      const { engine, room } = window.__roomEcho!;
      room.setState({ resetCount: room.getState().resetCount + 1 });
      room.setState({ sourceType: 'tone', toneHz: f, view: 'energy', playing: false });
      // One second of sound: the tone builds up to its standing wave.
      await engine.fastForward(48_000);
    }, hz);
    const energy = await page.evaluate(async () => {
      const { engine } = window.__roomEcho!;
      const e = await engine.readEnergy();
      const nx = engine.solver.nx;
      const mean = (x0: number, x1: number, y0: number, y1: number) => {
        let sum = 0;
        let n = 0;
        for (let y = y0; y <= y1; y += 4) {
          for (let x = x0; x <= x1; x += 4) {
            const c = engine.cellAt([x, y]);
            sum += e[c.y * nx + c.x];
            n++;
          }
        }
        return sum / n;
      };
      return {
        // Three corners away from the source, 40 cm patches.
        corners:
          (mean(560, 595, 155, 190) + mean(205, 240, 410, 445) + mean(560, 595, 410, 445)) / 3,
        // The two nodal lines of the (1, 1) mode, away from the walls.
        cross: (mean(395, 405, 190, 410) + mean(240, 560, 295, 305)) / 2,
        // Middles of the long and the short walls.
        longWalls: (mean(380, 420, 155, 190) + mean(380, 420, 410, 445)) / 2,
        shortWalls: (mean(205, 240, 280, 320) + mean(560, 595, 280, 320)) / 2,
      };
    });
    ratios[`${hz} Hz`] = 10 * Math.log10(energy.corners / energy.cross);
    results[`criterion4_${hz}Hz`] = {
      cornersOverCrossDb: 10 * Math.log10(energy.corners / energy.cross),
      shortWallsOverLongWallsDb: 10 * Math.log10(energy.shortWalls / energy.longWalls),
    };
    if (hz === 71.5) {
      // Let the picture run so the automatic gain settles as a visitor would see it.
      await page.evaluate(() => window.__roomEcho!.room.setState({ playing: true }));
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${SHOTS}/m1-energy-71hz.png` });
      await page.evaluate(() => window.__roomEcho!.room.setState({ view: 'wave' }));
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/m1-wave-71hz.png` });
      await page.evaluate(() => window.__roomEcho!.room.setState({ playing: false }));
    }
  }
  // At 71.5 Hz the corners are loud and the middle cross is quiet.
  expect(ratios['71.5 Hz']).toBeGreaterThan(10);
  // At 57.2 Hz, the (0, 1) mode: no quiet vertical line through the middle.
  expect(ratios['57.2 Hz']).toBeLessThan(ratios['71.5 Hz']);
});

/** Display frames per second over `seconds`, from requestAnimationFrame in the page. */
async function frameRate(page: Page, seconds: number): Promise<{ fps: number; gaps: number }> {
  return page.evaluate(
    (s) =>
      new Promise<{ fps: number; gaps: number }>((resolve) => {
        const times: number[] = [];
        const start = performance.now();
        const tick = (t: number) => {
          (window as unknown as { __tick?: () => void }).__tick?.();
          times.push(t);
          if (t - start < s * 1000) requestAnimationFrame(tick);
          else {
            const gaps = times.slice(1).filter((x, i) => x - times[i] > 25).length;
            resolve({
              fps: (times.length - 1) / ((times[times.length - 1] - times[0]) / 1000),
              gaps,
            });
          }
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );
}

/** Time from submitting a frame's GPU work to the queue being empty, over `seconds`. */
async function gpuTime(page: Page, seconds: number): Promise<{ median: number; p95: number }> {
  return page.evaluate(
    (s) =>
      new Promise<{ median: number; p95: number }>((resolve) => {
        const device = (window.__roomEcho!.engine as unknown as { device: GPUDevice }).device;
        const lags: number[] = [];
        const start = performance.now();
        const tick = () => {
          const t = performance.now();
          device.queue.onSubmittedWorkDone().then(() => lags.push(performance.now() - t));
          if (t - start < s * 1000) requestAnimationFrame(tick);
          else
            setTimeout(() => {
              lags.sort((a, b) => a - b);
              resolve({
                median: lags[lags.length >> 1],
                p95: lags[Math.floor(lags.length * 0.95)],
              });
            }, 200);
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );
}

test('criterion 5: size M keeps up with the display', async ({ page, browser }) => {
  // The machine's own frame rate: a page that only clears a WebGPU canvas every frame.
  const blank = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await blank.goto('/bench/?checks=0');
  await blank.evaluate(async () => {
    document.body.innerHTML =
      '<canvas id="c" style="position:fixed;inset:0;width:100vw;height:100vh"></canvas>';
    const canvas = document.getElementById('c') as HTMLCanvasElement;
    canvas.width = 1280;
    canvas.height = 900;
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const context = canvas.getContext('webgpu')!;
    context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
    (window as unknown as { __tick: () => void }).__tick = () => {
      const encoder = device.createCommandEncoder();
      encoder
        .beginRenderPass({
          colorAttachments: [
            { view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' },
          ],
        })
        .end();
      device.queue.submit([encoder.finish()]);
    };
  });
  const baseline = await frameRate(blank, 10);
  await blank.close();

  await openApp(page);
  await page.waitForTimeout(1500);
  const skippedBefore = await page.evaluate(() => window.__roomEcho!.engine.skippedFrames);
  const m = await frameRate(page, 10);
  const skipped =
    (await page.evaluate(() => window.__roomEcho!.engine.skippedFrames)) - skippedBefore;
  const mGpu = await gpuTime(page, 4);
  await page.evaluate(() => window.__roomEcho!.room.setState({ view: 'energy' }));
  const energyGpu = await gpuTime(page, 4);
  await page.evaluate(() => {
    const room = window.__roomEcho!.room;
    room.setState({ view: 'wave' });
    room.getState().setSize('L');
    room.getState().clap();
  });
  await page.waitForTimeout(1500);
  const l = await frameRate(page, 6);
  const lGpu = await gpuTime(page, 4);
  await page.screenshot({ path: `${SHOTS}/m1-size-l.png` });
  await page.evaluate(() => window.__roomEcho!.room.getState().setPanelOpen(false));
  await nextFrames(page, 3);
  await page.screenshot({ path: `${SHOTS}/m1-panel-hidden.png` });

  results.criterion5 = {
    baselineFps: baseline.fps,
    baselineGaps: baseline.gaps,
    sizeM: { fps: m.fps, gaps: m.gaps, skippedForGpu: skipped, gpuMs: mGpu },
    sizeMEnergyGpuMs: energyGpu,
    sizeL: { fps: l.fps, gaps: l.gaps, gpuMs: lGpu },
  };
  // The app keeps the frame rate the machine gives an empty WebGPU page, never waits for its
  // own GPU work, and leaves more than half of each 16.7 ms frame free.
  expect(m.fps).toBeGreaterThanOrEqual(Math.min(baseline.fps, 60) - 1.5);
  expect(skipped).toBe(0);
  expect(mGpu.median).toBeLessThan(8.3);
});
