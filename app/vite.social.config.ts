import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { handleApiRequest } from './server/httpApi.ts';
// Real Social APIs and persistence, isolated from every production data root.
const root=fileURLToPath(new URL('../.local/social-sandbox/',import.meta.url));
mkdirSync(root,{recursive:true,mode:0o700});
mkdirSync(root+'/app',{recursive:true,mode:0o700});
export default defineConfig({envDir:false,envPrefix:[],define:{'import.meta.env.VITE_SOCIAL_PREVIEW':JSON.stringify('1'),'import.meta.env.VITE_HERMES_LIVE':JSON.stringify('0'),'import.meta.env.VITE_HERMES_TOKEN':JSON.stringify('')},plugins:[react(),tailwindcss(),{
  name:'isolated-social-api',configureServer(server){server.middlewares.use(async(req,res,next)=>{
    const path=(req.url??'').split('?')[0];
    if(path==='/api/settings/api-keys'||path==='/api/social'||path.startsWith('/api/social/')) {try{await handleApiRequest(req,res,{hermesHome:root,eaiosRoot:root,dataRoot:root});}catch{res.statusCode=500;res.end(JSON.stringify({error:'Social preview unavailable.'}));}return;}
    if(/^\/(api|composio-api|knowledge-api|podcasts-api)(\/|$)/.test(path)){res.statusCode=503;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:'This preview enables only isolated Social Media data.'}));return;}next();
  });}
}],server:{host:'127.0.0.1',port:5279,strictPort:true}});
