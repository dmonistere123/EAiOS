// @vitest-environment node
import {it,expect,afterEach} from 'vitest';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {handleErmApi} from '../../server/ermApi';
import {moduleConfig,optionalModuleForPath} from '../../server/modules';
import {emptyErmContact} from '../domain/erm';
const cleanups:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const c of cleanups)await c();cleanups.length=0;});
async function server(enabled=true){const root=mkdtempSync(join(tmpdir(),'erm-http-'));writeFileSync(join(root,'modules.local.json'),JSON.stringify({edition:enabled?'full':'core',addons:[]}));const s=createServer((req,res)=>{void handleErmApi(req,res,{eaiosRoot:root,hermesHome:join(root,'hermes')},true).then(ok=>{if(!ok){res.statusCode=404;res.end();}});});await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const addr=s.address() as {port:number};cleanups.push(async()=>{s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));rmSync(root,{recursive:true,force:true});});return {root,url:`http://127.0.0.1:${addr.port}/api/erm/`};}
it('excludes ERM from Core and identifies both UI/API routes',async()=>{const {root,url}=await server(false);expect(moduleConfig(root).enabled).not.toContain('erm');expect((await fetch(url+'contacts')).status).toBe(404);for(const p of ['/erm','/api/erm/contacts'])expect(optionalModuleForPath(p)).toBe('erm');});
it('persists full records and rejects foreign origins and unsupported methods',async()=>{const {url}=await server();expect((await fetch(url+'contacts',{headers:{Origin:'https://elsewhere.invalid'}})).status).toBe(403);expect((await fetch(url+'contacts',{method:'DELETE'})).status).toBe(405);const r=await fetch(url+'contacts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'create',contact:{...emptyErmContact(),name:'HTTP fixture',emails:['person@example.com']}})});expect(r.status).toBe(201);const p=await r.json();expect((await (await fetch(url+'contacts/'+p.id)).json()).emails).toEqual(['person@example.com']);expect(r.headers.get('cache-control')).toBe('no-store');});
it('reports honest isolated capabilities and enforces note/contact scoping',async()=>{const {url}=await server();const status=await (await fetch(url+'status')).json();expect(status.model.available).toBe(false);expect((await fetch(url+'import/accounts')).status).toBe(503);const req=async(path:string,b:unknown)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const p=await (await req('contacts',{requestId:'p',contact:{...emptyErmContact(),name:'P'}})).json();const n=await (await req('contacts/'+p.id+'/notes',{requestId:'n',note:{title:'Note',body:'Our conversation details.',includeInAI:true}})).json();expect((await fetch(url+'contacts/not-the-owner/notes/'+n.id)).status).toBe(404);expect((await req('contacts/'+p.id+'/analyze',{requestId:'j'})).status).toBe(503);expect((await req('contacts/'+p.id+'/archive',{version:p.version,archived:'true'})).status).toBe(400);});
it('keeps attachments private and scoped to a note, verifies exact bytes, and deduplicates retries',async()=>{
 const {url}=await server(),origin=new URL(url).origin;
 const req=(path:string,b:unknown)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 const p=await (await req('contacts',{requestId:'file-contact',contact:{...emptyErmContact(),name:'Attachment fixture'}})).json();
 const notePath='contacts/'+p.id+'/notes';
 const n=await (await req(notePath,{requestId:'file-note',note:{title:'A private attachment',body:'Context',includeInAI:false,followUpOn:'2026-11-21'}})).json();
 expect((await (await fetch(url+'follow-ups?through=2026-11-21')).json()).items).toEqual([expect.objectContaining({contactId:p.id,noteId:n.id})]);
 const path=url+notePath+'/'+n.id+'/attachments',bytes=new Uint8Array([0,1,2,255,3]);
 const add=(value:Uint8Array=bytes,host=origin)=>fetch(path+'?name=Notes%20%E2%80%94%20Nov.pdf&requestId=file1',{method:'POST',body:value.slice().buffer,headers:{Origin:host,'Content-Type':'application/octet-stream'}});
 expect((await add(bytes,'https://foreign.test')).status).toBe(403);
 const r=await add();expect(r.status).toBe(201);const a=await r.json();
 expect((await (await add()).json()).id).toBe(a.id);
 expect((await add(new Uint8Array([7]))).status).toBe(409);
 expect(await (await fetch(path)).json()).toEqual([a]);
 const f=await fetch(path+'/'+a.id);expect(f.headers.get('Content-Type')).toBe('application/octet-stream');
 expect(f.headers.get('Content-Disposition')).toMatch(/^attachment;.*filename\*=UTF-8/);
 expect(new Uint8Array(await f.arrayBuffer())).toEqual(bytes);
 expect((await fetch(url+'contacts/another/notes/'+n.id+'/attachments/'+a.id)).status).toBe(404);
});
