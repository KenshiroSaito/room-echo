import { defineConfig } from '@playwright/test';

// WebGPU needs a real GPU. The installed Chrome is used (channel: 'chrome') rather than the
// bundled headless shell, which has no GPU. Set HEADED=1 to watch the run.
export default defineConfig({
  testDir: 'e2e',
  timeout: 600_000,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    channel: 'chrome',
    headless: !process.env.HEADED,
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal'],
    },
  },
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173/bench/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
