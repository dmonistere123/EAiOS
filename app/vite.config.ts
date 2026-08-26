import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Node-side env (NOT inlined into the client bundle — safe for secrets).
  const env = loadEnv(mode, __dirname, '')
  const composioKey = env.COMPOSIO_API_KEY ?? ''

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        // Dev: forward the gateway socket to the local hermes serve instance.
        '/api/ws': { target: 'ws://127.0.0.1:9119', ws: true, changeOrigin: true },
        // Dev: Composio REST with the API key injected server-side — the
        // browser bundle never carries the key (spec: no secrets in client).
        '/composio-api': {
          // NOTE: docs say api.composio.dev but that host is NXDOMAIN (Aug 2026);
          // the working v3 host is backend.composio.dev.
          target: 'https://backend.composio.dev',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/composio-api/, ''),
          headers: composioKey ? { 'x-api-key': composioKey } : {},
        },
      },
    },
  }
})
