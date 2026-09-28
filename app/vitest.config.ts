import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    // Runtime polling uses process-level timers and singleton adapters. Keep
    // files serial so a completed file cannot race another file's fixtures.
    fileParallelism: false,
    // Tests always run against the mock adapter — .env.local enables live
    // mode for dev, and must never leak the real gateway into the suite.
    env: { VITE_HERMES_LIVE: '0', VITE_TELEGRAM_HOME_DELIVERY: 'telegram:-1001234567890' },
  },
});
