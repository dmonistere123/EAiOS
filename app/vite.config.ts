import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Dev: forward the gateway socket to the local hermes serve instance.
      '/api/ws': { target: 'ws://127.0.0.1:9119', ws: true, changeOrigin: true },
    },
  },
})
