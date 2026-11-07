import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import {insightsSnapshot,generateInsights,insightDays,InsightsError} from './server/executiveInsights';
import {requireSameOriginJson} from './server/updates';
const home=process.env.EAIOS_INSIGHTS_PREVIEW_HOME;
const dataRoot=process.env.EAIOS_INSIGHTS_PREVIEW_DATA_ROOT;
if(!home||!dataRoot)throw new Error('Explicit preview home and data root required');
const ctx={hermesHome:home,dataRoot,eaiosRoot:process.cwd()+'/..',insightsReportRoot:process.cwd()+'/../.local/insights-preview'};
export default defineConfig({envDir:false,envPrefix:[],define:{'import.meta.env.VITE_HERMES_LIVE':JSON.stringify('0'),'import.meta.env.VITE_HERMES_TOKEN':JSON.stringify('')},plugins:[react(),tailwindcss(),{name:'insights-only-preview',enforce:'pre',
 transform(code,id){if(id.endsWith('/src/pages/ExecutiveInsights.tsx'))return code.replace('<header className=', '<p className="rounded-lg border border-signal/30 p-3 text-sm text-signal">Executive Insights preview: real local activity. Other modules use demo data. Generate uses your existing API key only when clicked.</p><header className=');},
 configureServer(server){server.middlewares.use((req,res,next)=>{const url=new URL(req.url??'/','http://localhost');if(!/^\/(api|composio-api|knowledge-api|podcasts-api)(\/|$)/.test(url.pathname))return next();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  void(async()=>{try{
   if(url.pathname==='/api/executive-insights'&&req.method==='GET'){res.end(JSON.stringify(insightsSnapshot(ctx,insightDays(url.searchParams.get('days')??30))));return;}
   if(url.pathname==='/api/executive-insights/generate'&&req.method==='POST'){requireSameOriginJson(req);let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw new InsightsError(413,'Too large');}res.end(JSON.stringify(await generateInsights(ctx,insightDays(JSON.parse(body).days))));return;}
   res.statusCode=503;res.end(JSON.stringify({error:'Only Executive Insights is enabled in this preview.'}));
  }catch(e){res.statusCode=e instanceof InsightsError?e.status:503;res.end(JSON.stringify({error:e instanceof InsightsError?e.message:'Insights preview unavailable.'}));}})();
 });}
}],server:{host:'127.0.0.1',port:5288,strictPort:true}});
