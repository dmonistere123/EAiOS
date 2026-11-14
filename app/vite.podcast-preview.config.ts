import { defineConfig, mergeConfig } from 'vite';
import mock from './vite.mock.config.ts';

// Uses only mock adapters and a loopback static media server. No live API access.
export default mergeConfig(mock, defineConfig({
  define: { 'import.meta.env.VITE_PODCAST_PROMO_PREVIEW': JSON.stringify('1') },
  server: {
    port: 5292,
    proxy: {
      '/promo-preview': {
        target: 'http://127.0.0.1:5291',
        rewrite: path => path.replace(/^\/promo-preview/, ''),
      },
    },
  },
}));
