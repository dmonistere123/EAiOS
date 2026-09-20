import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Deliberately independent of vite.config.ts: no Hermes filesystem handlers,
// credentials, backend proxies, or live gateway connections in this profile.
export default defineConfig({
  envDir: false,
  envPrefix: [],
  define: {
    'import.meta.env.VITE_HERMES_LIVE': JSON.stringify('0'),
    'import.meta.env.VITE_HERMES_TOKEN': JSON.stringify(''),
  },
  plugins: [react(), tailwindcss(), {
    name: 'isolated-mock-backends',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        if (/^\/(api|composio-api|knowledge-api|podcasts-api)(\/|$)/.test(path)) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Backend disabled in isolated mock development.' }));
          return;
        }
        next();
      });
    },
  }],
  server: {
    host: '127.0.0.1',
    port: 5273,
    strictPort: true,
  },
});
