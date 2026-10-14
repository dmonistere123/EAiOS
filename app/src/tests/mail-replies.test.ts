// @vitest-environment node
import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {bindReplyApproval,decideReplyApproval,readReplySource,type BoundReply,type ReplyProvider} from '../../server/mailReplies.ts';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();roots.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
function setup(){
 const home=mkdtempSync(join(tmpdir(),'reply-test-'));roots.push(home);const db=new DatabaseSync(join(home,'kanban.db'));
 db.exec('CREATE TABLE tasks(id TEXT PRIMARY KEY,body TEXT,status TEXT,assignee TEXT,claim_lock TEXT,current_run_id INTEGER);CREATE TABLE task_links(parent_id TEXT,child_id TEXT);CREATE TABLE task_events(task_id TEXT,kind TEXT,payload TEXT,created_at INTEGER)');
 const old=JSON.stringify({eaios:'approval',actionType:'send',targetSystem:'outlook',requestedBy:'ally',payload:'Draft',sourceContext:{subject:'Question'}});db.prepare('INSERT INTO tasks(id,body,status) VALUES(?,?,?)').run('t_email',old,'blocked');db.close();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.includes('connected_accounts'))return Response.json({id:'ca_work',status:'ACTIVE',toolkit:{slug:'outlook'}});
  const body=JSON.parse(String(init?.body));expect(body.method).toBe('GET');expect(body.connected_account_id).toBe('ca_work');
  return Response.json({status:200,data:body.endpoint.includes('/messages/')?{id:'message-1',subject:'Question',from:{emailAddress:{address:'customer@example.com'}},isDraft:false}:{id:'work-user',mail:'work@example.com'}});
 }));
 const ctx={hermesHome:home,eaiosRoot:home,requestKeys:new Map([['COMPOSIO_API_KEY','fixture']])};
 const row=()=>{const db=new DatabaseSync(join(home,'kanban.db'));try{return db.prepare('SELECT * FROM tasks').get()!;}finally{db.close();}};
 return {home,ctx,old,row};
}
async function prepared(){const x=setup();await bindReplyApproval(x.ctx,'t_email',{expectedBody:x.old,connectionId:'ca_work',messageId:'message-1',body:'Reviewed reply'});const body=String(x.row().body);const bound=JSON.parse(body).mailReply as BoundReply;
 const provider:ReplyProvider={verify:vi.fn(async()=>bound.identity),source:vi.fn(async()=>({...bound,package:{...bound.package,body:''}})),send:vi.fn(async()=>({id:'receipt',provider:'outlook'}))};return {...x,body,bound,provider};}
it('binds the reply to its verified source inbox and sends through that exact identity without assigning an AI',async()=>{
 const x=await prepared();expect(x.bound.package.sender.email).toBe('work@example.com');expect(x.bound.package.recipient.email).toBe('customer@example.com');expect(x.row().assignee).toBeNull();
 await expect(decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.old},x.provider)).rejects.toThrow('changed');
 const result=await decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.body},x.provider);expect(result?.ok).toBe(true);expect(x.provider.send).toHaveBeenCalledWith(x.ctx,x.bound.package,x.bound.identity,[],x.bound.reference);expect(x.row().status).toBe('done');expect(x.row().assignee).toBeNull();
 await expect(decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.body},x.provider)).rejects.toThrow();expect(x.provider.send).toHaveBeenCalledTimes(1);
});
it('leaves legacy mail blocked until the original inbox is verified',async()=>{
 const x=setup();await expect(decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.old})).rejects.toThrow('Verify');expect(x.row().status).toBe('blocked');expect(JSON.parse(String(x.row().body)).decision).toBeUndefined();
});
it('a changed mailbox or source recipient cannot fall back to another identity',async()=>{
 const x=await prepared();x.provider.source=vi.fn(async()=>({...x.bound,package:{...x.bound.package,recipient:{email:'other@example.com',displayName:'Other'}}}));
 expect((await decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.body},x.provider))?.ok).toBe(false);expect(x.provider.send).not.toHaveBeenCalled();expect(JSON.parse(String(x.row().body)).mailDelivery.status).toBe('send_failed');
});
it('a lost send response is recorded as uncertain and never purchased or sent again',async()=>{
 const x=await prepared();x.provider.send=vi.fn(async()=>{throw new Error('network timeout');});await decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.body},x.provider);
 expect(JSON.parse(String(x.row().body)).mailDelivery.status).toBe('delivery_uncertain');await expect(decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.body},x.provider)).rejects.toThrow();expect(x.provider.send).toHaveBeenCalledTimes(1);
});
it('source lookup rejects messages absent from the selected mailbox',async()=>{
 const x=setup();vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(url.includes('connected_accounts'))return Response.json({id:'ca_work',status:'ACTIVE',toolkit:{slug:'outlook'}});return Response.json(JSON.parse(String(init?.body)).endpoint.includes('/messages/')?{status:404}:{status:200,data:{id:'work-user',mail:'work@example.com'}});}));
 await expect(readReplySource(x.ctx,'ca_work','not-here')).rejects.toThrow('not found');
});
it('explicit sender switch preserves source inbox and sends a new message only after fresh approval',async()=>{
 const x=await prepared();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.includes('connected_accounts'))return Response.json({id:url.endsWith('ca_business')?'ca_business':'ca_work',status:'ACTIVE',toolkit:{slug:'outlook'}});
  const b=JSON.parse(String(init?.body));expect(b.method).toBe('GET');
  return Response.json({status:200,data:b.endpoint.includes('/messages/')?{id:'message-1',subject:'Question',from:{emailAddress:{address:'customer@example.com'}},isDraft:false}:{id:b.connected_account_id,mail:b.connected_account_id==='ca_business'?'business@example.com':'work@example.com'}});
 }));
 await bindReplyApproval(x.ctx,'t_email',{expectedBody:x.body,connectionId:'ca_work',senderConnectionId:'ca_business',messageId:'message-1',body:'Edited reply'});
 const edited=String(x.row().body),bound=JSON.parse(edited).mailReply as BoundReply;
 expect(bound.sourceIdentity?.connectionId).toBe('ca_work');expect(bound.package.sender.email).toBe('business@example.com');
 await expect(decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:x.body},x.provider)).rejects.toThrow('changed');
 x.provider.verify=vi.fn(async()=>bound.identity);
 x.provider.source=vi.fn(async()=>({...bound,identity:bound.sourceIdentity!}));
 expect((await decideReplyApproval(x.ctx,'t_email',{decision:'approved',expectedBody:edited},x.provider))?.ok).toBe(true);
 expect(x.provider.source).toHaveBeenCalledWith(x.ctx,'ca_work','message-1');
 expect(x.provider.send).toHaveBeenCalledWith(x.ctx,bound.package,bound.identity,[],undefined);
});
