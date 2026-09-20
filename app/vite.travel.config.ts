import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
import {handleApiRequest} from './server/httpApi.ts';

// An isolated travel sandbox: only travel routes run, with separate persistent data.
const root = fileURLToPath(new URL('../.local/travel-sandbox/', import.meta.url));
if (!process.env.DUFFEL_API_KEY?.startsWith('duffel_test_')) throw new Error('dev:travel requires a Duffel TEST token in .local/duffel-test.env.');
process.env.EAIOS_DUFFEL_LIVE_BOOKING = '0';
export default defineConfig({
  envDir: false, envPrefix: [],
  define: {'import.meta.env.VITE_TRAVEL_SANDBOX': JSON.stringify('1'), 'import.meta.env.VITE_HERMES_LIVE': JSON.stringify('0'), 'import.meta.env.VITE_TRAVEL_LIVE': JSON.stringify('1'), 'import.meta.env.VITE_HERMES_TOKEN': JSON.stringify('')},
  plugins: [react(),tailwindcss(),{
    name:'isolated-travel-api',
    configureServer(server) {
      server.middlewares.use(async(req,res,next)=>{
        const path=(req.url??'').split('?')[0];
        if (path.startsWith('/api/travel/')) {
          try {if(await handleApiRequest(req,res,{hermesHome:root,eaiosRoot:root,dataRoot:root}))return;}
          catch {res.statusCode=500;res.end(JSON.stringify({error:'Travel sandbox request failed.'}));return;}
        }
        if (/^\/(api|composio-api|knowledge-api|podcasts-api)(\/|$)/.test(path)) {res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'This preview enables only the isolated travel API.'}));return;}
        next();
      });
    },
  }],
  server:{host:'127.0.0.1',port:5274,strictPort:true},
});
