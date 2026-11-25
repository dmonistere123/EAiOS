import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import mock from './vite.mock.config.ts';
import { createPlannerPreview } from './server/plannerPreview.ts';

const enabled=process.env.EAIOS_PLANNER_PREVIEW==='1';
const run=process.env.EAIOS_PLANNER_BROWSER_TEST_RUN;
if(run&&!/^[0-9a-z-]{1,48}$/.test(run))throw new Error('Invalid browser fixture ID.');
const root=fileURLToPath(new URL(run?'../.local/daily-planner-browser-test-'+run+'/':'../.local/daily-planner-preview/',import.meta.url));
const port=run&&process.env.EAIOS_PLANNER_BROWSER_TEST_PORT?Number(process.env.EAIOS_PLANNER_BROWSER_TEST_PORT):5284;
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid Planner browser test port.');
const origin='http://127.0.0.1:'+port;

export default defineConfig({
 ...mock,
 define:{...mock.define,'import.meta.env.VITE_PLANNER_PREVIEW':JSON.stringify(enabled?'1':'0'),'import.meta.env.VITE_ERM_LIVE':JSON.stringify(enabled?'1':'0')},
 server:{...mock.server,port,fs:{
  strict:true,allow:[fileURLToPath(new URL('./',import.meta.url))],
  deny:['.env','.env.*','*.{crt,pem,key}','**/.git/**','**/.local/**','**/planner-data/**','**/preview-access.json'],
 }},
 plugins:[{
  name:'2ep-private-planner-preview',
  configureServer(server){
   if(!enabled)return;
   const handler=createPlannerPreview(root,origin);
   server.middlewares.use((req,res,next)=>{void handler(req,res,next);});
  },
 },...(mock.plugins??[])],
});
