// @vitest-environment node
import {afterEach,expect,it} from 'vitest';
import {createServer,type Server} from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {handlePlannerApi} from '../../server/plannerProduction';
import {PlannerStore} from '../../server/plannerStore';
import {moduleConfig} from '../../server/modules';
import type {ApiContext} from '../../server/httpApi';
const roots:string[]=[],servers:Server[]=[];
afterEach(async()=>{for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});});
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'planner-production-'));roots.push(root);
 writeFileSync(join(root,'modules.local.json'),JSON.stringify({edition:'core',addons:[]}));
 const ctx={dataRoot:root,eaiosRoot:root,hermesHome:join(root,'hermes')} as ApiContext;
 const server=createServer((req,res)=>void handlePlannerApi(req,res,ctx));servers.push(server);
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const send=(body:unknown,originHeader=origin)=>fetch(origin+'/api/daily-planner/actions',{method:'POST',headers:{origin:originHeader,'content-type':'application/json'},body:JSON.stringify(body)});
 return {root,origin,send};
}
it('Core includes a persistent private planner with no preview login or synthetic actions',async()=>{
 const {root,origin,send}=await fixture();
 expect(moduleConfig(root).enabled).toContain('daily-planner');expect(moduleConfig(root).enabled).not.toContain('erm');
 const session=await fetch(origin+'/api/daily-planner/session');expect(await session.json()).toEqual({owner:'local-executive'});
 const command={op:'create',requestId:randomUUID(),owner:'attacker-selected-owner',day:'2026-11-25',lane:'one',title:'Review the proposal'};
 const made=await send(command);expect(made.status).toBe(200);const task=await made.json();
 expect((await send(command)).status).toBe(200);
 const reopened=new PlannerStore(root);expect(reopened.day('local-executive','2026-11-25').tasks).toHaveLength(1);
 expect(reopened.day('attacker-selected-owner','2026-11-25').tasks).toHaveLength(0);
 const journal=await send({op:'journal-add',requestId:randomUUID(),day:'2026-11-25',text:'Private journal entry'});expect(journal.status).toBe(200);
 expect(reopened.day('local-executive','2026-11-25').journal.entries[0].text).toBe('Private journal entry');
 const id=randomUUID();const up=await fetch(origin+'/api/daily-planner/attachments?'+new URLSearchParams({task:task.id,upload:id,name:'brief.txt'}),{method:'POST',headers:{origin},body:'My brief'});expect(up.status).toBe(200);
 expect(await (await fetch(origin+'/api/daily-planner/attachments/'+id)).text()).toBe('My brief');
 expect((await send({...command,requestId:randomUUID()},'https://untrusted.example')).status).toBe(403);
 for(const op of ['delegate','mock-deliver','delegate-decide'])expect((await send({op,requestId:randomUUID()})).status).toBe(403);
 expect((await send([])).status).toBe(400);
 expect((await fetch(origin+'/api/daily-planner/crm?contact='+randomUUID()+'&note='+randomUUID())).status).toBe(404);
});
