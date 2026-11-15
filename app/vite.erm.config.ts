import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { mkdirSync,writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { handleErmApi } from './server/ermApi.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const dataRoot=join(root,'.local','erm-stage'),hermesHome=join(dataRoot,'hermes');
mkdirSync(hermesHome,{recursive:true,mode:0o700});
writeFileSync(join(dataRoot,'modules.local.json'),JSON.stringify({edition:'full',addons:['erm']}));
export default defineConfig({envDir:false,envPrefix:[],define:{
 'import.meta.env.VITE_AGENT_NAME':JSON.stringify(process.env.EAIOS_MOCK_AGENT_NAME||'Ally'),
 'import.meta.env.VITE_HERMES_LIVE':JSON.stringify('0'),
 'import.meta.env.VITE_ERM_LIVE':JSON.stringify('1'),
 'import.meta.env.VITE_HERMES_TOKEN':JSON.stringify(''),
},plugins:[react(),tailwindcss(),{name:'isolated-erm',configureServer(server){
 server.middlewares.use((req,res,next)=>{void(async()=>{
  if(await handleErmApi(req,res,{eaiosRoot:root,hermesHome,dataRoot},true))return;
  if(/^\/(api|composio-api|knowledge-api|podcasts-api)(\/|$)/.test(req.url??'')){res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Other backends are disabled in isolated ERM staging.'}));return;}
  next();
 })().catch(next);});
}}],server:{host:'127.0.0.1',port:5298,strictPort:true}});
