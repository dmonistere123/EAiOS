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
    // Tests always run against the mock adapter — .env.local enables live
    // mode for dev, and must never leak the real gateway into the suite.
    env: { VITE_HERMES_LIVE: '0' },
  },
});
