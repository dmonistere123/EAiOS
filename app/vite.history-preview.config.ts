import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { listTelegramConversations, readConversation } from './server/assistantConversations';
// Real, read-only Telegram history. All other backend routes are disabled.
export default defineConfig({envDir:false,envPrefix:[],define:{'import.meta.env.VITE_HERMES_LIVE':JSON.stringify('0'),'import.meta.env.VITE_HERMES_TOKEN':JSON.stringify('')},plugins:[react(),tailwindcss(),{
 name:'history-preview',
 transform(code,id){if(id.endsWith('/src/adapters/index.ts'))return code+`\nhermes.listSessionsFor=async(_p,filter={})=>{const r=await fetch('/api/preview/telegram?'+new URLSearchParams({q:filter.query||'',day:filter.day||''}));if(!r.ok)throw Error('Unavailable');return(await r.json()).sessions;};hermes.getSessionTranscript=async(_p,id)=>{const r=await fetch('/api/preview/history?id='+encodeURIComponent(id));if(!r.ok)throw Error('Unavailable');const data=await r.json();if(data.limited)data.messages.unshift({id:'limit',role:'ally',text:'Showing the latest part of this day. Older messages remain stored.',at:new Date().toISOString()});return data.messages;};`;},
 configureServer(server){server.middlewares.use((req,res,next)=>{
  const url=new URL(req.url??'/','http://localhost');
  if(!/^\/(api|composio-api|knowledge-api|podcasts-api)(\/|$)/.test(url.pathname))return next();
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  try{
   const home=process.env.EAIOS_HISTORY_HOME;if(!home||req.method!=='GET')throw Error();
   const sessions=listTelegramConversations(home,undefined,{query:url.searchParams.get('q')||'',day:url.searchParams.get('day')||''});
   if(url.pathname==='/api/preview/telegram')return res.end(JSON.stringify({sessions}));
   const id=url.searchParams.get('id');
   if(url.pathname==='/api/preview/history'&&sessions.some(s=>s.id===id))return res.end(JSON.stringify(readConversation(home,id!)));
   throw Error();
  }catch{res.statusCode=503;res.end(JSON.stringify({error:'Backend unavailable in read-only preview'}));}
 });}
}],server:{host:'127.0.0.1',port:5287,strictPort:true}});
