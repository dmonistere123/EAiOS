// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ErmStore } from '../../server/ermStore';
import { queueErmQuickEmail } from '../../server/ermQuickEmail';
import { decideOutlookDraft } from '../../server/mailDrafts';
import { decideApprovalTask, editApprovalTask, resumeApprovedTask } from '../../server/approvalGate';
import type {MailboxIdentity} from '../domain/mailRouting';

const clean:string[]=[];
afterEach(()=>{for(const root of clean.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'erm-email-test-'));clean.push(root);
 const ctx={hermesHome:root,eaiosRoot:root,dataRoot:root};
 const path=join(root,'kanban.db');
 using db=new DatabaseSync(path);
 db.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,body TEXT,status TEXT,assignee TEXT,block_kind TEXT,created_by TEXT,created_at INTEGER,claim_lock TEXT,current_run_id INTEGER);
 CREATE TABLE task_events(task_id TEXT,kind TEXT,payload TEXT,created_at INTEGER);
 CREATE TABLE task_links(parent_id TEXT,child_id TEXT);`);
 const store=new ErmStore(root);
 const contact=store.createContact({name:'Taylor Test',emails:['taylor@example.test']},'contact-fixture');
 const note=store.saveNote(contact.id,{title:'A relationship note',body:'Private note context should not appear in email.',includeInAI:false},'note-fixture');
 const identity:MailboxIdentity={connectionId:'ca_test',provider:'outlook',email:'owner@example.test',providerUserId:'user-123',verifiedAt:'2026-11-21T00:00:00Z'};
 const provider={verify:vi.fn(async()=>identity),send:vi.fn(async()=>({id:'fixture-send',provider:'outlook'})),source:vi.fn(async()=>{throw Error('A new message must not read a reply source');})};
 const input={requestId:'req-fixture',connectionId:identity.connectionId,to:contact.emails[0],subject:'Check in',body:'Hi Taylor, would tomorrow work?'};
 const queue=(data=input)=>queueErmQuickEmail(ctx,contact.id,note.id,data,store,provider.verify);
 function read(approvalId:string){using d=new DatabaseSync(path);return d.prepare('SELECT * FROM tasks WHERE id=?').get(approvalId)!;}
 return {ctx,path,store,contact,note,identity,provider,input,queue,read};
}

describe('E-CRM note quick email',()=>{
 it('queues once, only after verifying one saved recipient and sender, with no email or attachments',async()=>{
  const f=fixture();
  await expect(f.queue({...f.input,to:'not-a-contact@example.test'})).rejects.toThrow(/saved on this active contact/);
  expect(f.provider.verify).not.toHaveBeenCalled();
  await expect(f.queue({...f.input,attachments:['secret']} as typeof f.input)).rejects.toThrow(/does not accept attachments/);
  const {approvalId}=await f.queue();
  expect((await f.queue()).approvalId).toBe(approvalId);
  await expect(f.queue({...f.input,body:'Changed draft'})).rejects.toThrow(/different draft/);
  expect(f.provider.verify).toHaveBeenCalledWith(f.ctx,'ca_test',true);
  const t=f.read(approvalId), env=JSON.parse(String(t.body));
  expect(t).toMatchObject({status:'blocked',assignee:null,block_kind:'needs_input'});
  expect(env).toMatchObject({ermQuickEmail:{contactId:f.contact.id,noteId:f.note.id},actionType:'send',targetSystem:'outlook',mailDraft:{to:[f.input.to],cc:[],bcc:[],body:f.input.body}});
  expect(env).not.toHaveProperty('decision');
  expect(env).not.toHaveProperty('attachments');
  expect(env.payload).not.toContain('Private note context');
  expect(f.provider.send).not.toHaveBeenCalled();
  expect(f.provider.source).not.toHaveBeenCalled();
 });
 it('refuses the generic executor and a stale decision; sends exactly once only after current explicit approval',async()=>{
  const f=fixture(),{approvalId}=await f.queue(),expectedBody=f.read(approvalId).body;
  expect(()=>decideApprovalTask(f.path,approvalId,{decision:'approved',expectedBody})).toThrow(/dedicated mail sender/);
  await expect(decideOutlookDraft(f.ctx,approvalId,{decision:'approved',expectedBody:'stale'},f.provider)).rejects.toThrow(/changed/);
  const env=JSON.parse(String(expectedBody));
  expect(()=>editApprovalTask(f.path,approvalId,JSON.stringify({...env,payload:'Changed'}),expectedBody)).toThrow(/prepare a new one/);
  expect(f.provider.send).not.toHaveBeenCalled();
  const result=await decideOutlookDraft(f.ctx,approvalId,{decision:'approved',expectedBody},f.provider);
  expect(result).toMatchObject({ok:true});expect(f.provider.send).toHaveBeenCalledTimes(1);
  expect(f.provider.send).toHaveBeenCalledWith(f.ctx,expect.objectContaining({recipient:{email:f.input.to,displayName:f.input.to},subject:f.input.subject,body:f.input.body,artifacts:[]}),f.identity,[],undefined);
  expect(f.provider.source).not.toHaveBeenCalled();
  expect(f.read(approvalId).status).toBe('done');
  await expect(decideOutlookDraft(f.ctx,approvalId,{decision:'approved',expectedBody},f.provider)).rejects.toThrow(/changed/);
  expect(f.provider.send).toHaveBeenCalledTimes(1);
 });
 it('rejects a moved recipient before send and prevents an uncertain send being resumed by Hermes',async()=>{
  const f=fixture(),first=await f.queue();
  f.store.updateContact(f.contact.id,{...f.contact,emails:['new@example.test']},f.contact.version);
  await expect(decideOutlookDraft(f.ctx,first.approvalId,{decision:'approved',expectedBody:f.read(first.approvalId).body},f.provider)).rejects.toThrow(/saved on this active contact/);
  expect(f.provider.send).not.toHaveBeenCalled();
  const next=await f.queue({...f.input,requestId:'different',to:'new@example.test'});
  f.provider.send.mockRejectedValueOnce(Error('no receipt'));
  const result=await decideOutlookDraft(f.ctx,next.approvalId,{decision:'approved',expectedBody:f.read(next.approvalId).body},f.provider);
  expect(result).toMatchObject({ok:false,error:{code:'delivery_uncertain',retryable:false}});
  expect(()=>resumeApprovedTask(f.path,next.approvalId,{expectedBody:f.read(next.approvalId).body})).toThrow(/Do not resume/);
  expect(f.provider.send).toHaveBeenCalledTimes(1);
 });
});

it('uses production HTTP routes for a same-origin draft and decision, with no provider write before approval',async()=>{
 const f=fixture(),{createServer}=await import('node:http');
 const {handleApiRequest}=await import('../../server/httpApi');
 const ctx={...f.ctx,requestKeys:new Map([['COMPOSIO_API_KEY','fake-token']])};
 const server=createServer((req,res)=>{void handleApiRequest(req,res,ctx).then(ok=>{if(!ok){res.statusCode=404;res.end();}});});
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
 const local='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const liveFetch=globalThis.fetch;
 const writes:string[]=[];
 vi.stubGlobal('fetch',vi.fn(async(input:string,init?:RequestInit)=>{
  if(String(input).startsWith(local+'/'))return liveFetch(input,init);
  expect(String(input)).toMatch(/^https:\/\/backend\.composio\.dev\//);
  if(String(input).includes('/connected_accounts/'))return Response.json({id:'ca_test',status:'ACTIVE',toolkit:{slug:'outlook'},state:{val:{scope:'Mail.Send Mail.ReadWrite'}}});
  const call=JSON.parse(String(init?.body));
  expect(call.connected_account_id).toBe('ca_test');
  switch(call.endpoint){
   case 'https://graph.microsoft.com/v1.0/me?$select=id,mail':return Response.json({status:200,data:{id:f.identity.providerUserId,mail:f.identity.email}});
   case 'https://graph.microsoft.com/v1.0/me/messages':writes.push('draft');expect(call.body).toMatchObject({subject:f.input.subject,body:{contentType:'Text',content:f.input.body},toRecipients:[{emailAddress:{address:f.input.to}}],attachments:[]});return Response.json({status:201,data:{id:'fixture_message',isDraft:true}});
   case 'https://graph.microsoft.com/v1.0/me/messages/fixture_message/send':writes.push('send');return Response.json({status:202,data:{}});
   case 'https://graph.microsoft.com/v1.0/me/messages/fixture_message?$select=id,isDraft,sentDateTime,from':return Response.json({status:200,data:{id:'fixture_message',isDraft:false,sentDateTime:'2026-11-21T00:00:00Z',from:{emailAddress:{address:f.identity.email}}}});
   default:throw Error('Unexpected provider call: '+call.endpoint);
  }
 }));
 const post=(url:string,input:unknown,origin=local)=>liveFetch(local+url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 try{
  const path='/api/erm/contacts/'+f.contact.id+'/notes/'+f.note.id+'/quick-email';
  expect((await post(path,f.input,'https://foreign.test')).status).toBe(403);
  const draft=await post(path,f.input);
  expect(draft.status).toBe(201);
  const {approvalId}=await draft.json();
  expect(writes).toEqual([]);
  const decide='/api/kanban/approvals/'+approvalId+'/decision';
  const pending=f.read(approvalId);
  expect((await post(decide,{decision:'approved',expectedBody:'stale'})).status).toBe(400);
  expect(writes).toEqual([]);
  const approved=await post(decide,{decision:'approved',expectedBody:pending.body});
  expect(approved.status).toBe(200);
  expect(await approved.json()).toMatchObject({ok:true});
  expect(writes).toEqual(['draft','send']);
  expect(f.read(approvalId).status).toBe('done');
 }finally{vi.unstubAllGlobals();server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}
});
