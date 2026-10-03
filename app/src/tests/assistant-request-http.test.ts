// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleApiRequest } from '../../server/httpApi';
import { assistantRequests } from '../../server/assistantRequests';
const fake=vi.hoisted(()=>({submits:0,creates:0}));
vi.mock('../../server/allyGateway.ts',()=>({allyChat:vi.fn(),allyChatStream:vi.fn(),createGatewayClient:()=>{
  const client={isConnected:false,onEvent:null,connect:async()=>{client.isConnected=true;},disconnect:()=>{client.isConnected=false;},call:async(m:string,p:Record<string,unknown>)=>{
    if(m==='session.create'){fake.creates++;return{session_id:'http-session',stored_session_id:'http-stored'};}
    if(m==='prompt.submit'){fake.submits++;return{status:'streaming'};}
    if(m==='session.resume')return{session_id:'http-session',running:true,messages:[]};
    if(m==='session.interrupt')return{interrupted:true};
    throw new Error(String(p));
  }};return client;
}}));
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();});
async function app(){
 const root=mkdtempSync(join(tmpdir(),'eaios-http-'));const server=createServer((req,res)=>{void handleApiRequest(req,res,{eaiosRoot:root,hermesHome:root}).then(handled=>{if(!handled){res.statusCode=404;res.end();}});});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 cleanups.push(async()=>{assistantRequests(root).close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await new Promise(resolve=>setTimeout(resolve,2100));rmSync(root,{recursive:true,force:true});});
 return url;
}
describe('Assistant HTTP receipts and reconnectable events',()=>{
 it('acknowledges once, resumes snapshots after subscriber disconnect, and guards cross-origin writes',async()=>{
   fake.submits=0;fake.creates=0;const url=await app();const body=JSON.stringify({id:'http-request-0001',text:'one'});const headers={'content-type':'application/json'};
   const first=await fetch(url+'/api/assistant/requests',{method:'POST',headers,body});expect(first.status).toBe(202);expect((await first.json()).id).toBe('http-request-0001');
   await fetch(url+'/api/assistant/requests',{method:'POST',headers,body});
   const denied=await fetch(url+'/api/assistant/requests',{method:'POST',headers:{...headers,origin:'http://untrusted.example'},body:JSON.stringify({id:'http-request-0002',text:'other'})});expect(denied.status).toBe(400);
   const abort=new AbortController();const stream=await fetch(url+'/api/assistant/requests/http-request-0001/events',{signal:abort.signal});const reader=stream.body!.getReader();const initial=await reader.read();expect(new TextDecoder().decode(initial.value)).toContain('event: snapshot');abort.abort();
   const status=await fetch(url+'/api/assistant/requests/http-request-0001');expect((await status.json()).state).toBe('running');
   const reconnect=await fetch(url+'/api/assistant/requests/http-request-0001/events');const r=reconnect.body!.getReader();expect(new TextDecoder().decode((await r.read()).value)).toContain('http-request-0001');await r.cancel();
   expect(fake.submits).toBe(1);expect(fake.creates).toBe(1);
 });
});
