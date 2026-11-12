import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({envDir:false,envPrefix:[],plugins:[react(),tailwindcss()],define:{
  'import.meta.env.VITE_HERMES_LIVE':JSON.stringify('0'),
  'import.meta.env.VITE_HERMES_TOKEN':JSON.stringify(''),
  'import.meta.env.VITE_TRAVEL_LIVE':JSON.stringify('1'),
  'import.meta.env.VITE_TRAVEL_HANDOFF':JSON.stringify('1'),
  'import.meta.env.VITE_HUMAN_APPROVAL_TEST':JSON.stringify('1'),
},build:{outDir:'../.local/travel-hi-dist',emptyOutDir:true}});
