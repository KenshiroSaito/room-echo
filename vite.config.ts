import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  appType: 'mpa',
  build: {
    target: 'es2023',
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench/index.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
