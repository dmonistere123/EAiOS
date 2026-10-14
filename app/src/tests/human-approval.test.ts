// @vitest-environment node
import { afterEach,expect,it,vi } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHumanContact,prepareHumanDraft,humanStore,getHumanDelegation } from '../../server/humanDelegation.ts';
import { saveMailSettings } from '../../server/mailRouting.ts';
import { changeHumanSender,submitHumanApproval,decideHumanApproval,humanApprovals,updateHumanStatus } from '../../server/humanApproval.ts';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllGlobals();roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true}));});
async function setup(){
 const home=mkdtempSync(join(tmpdir(),'human-mail-'));roots.push(home);mkdirSync(join(home,'kanban','attachments'),{recursive:true});
 const file=join(home,'kanban','attachments','brief.txt');writeFileSync(file,'reviewed attachment');
 const db=new DatabaseSync(join(home,'kanban.db'));db.exec('CREATE TABLE tasks(id TEXT,title TEXT,body TEXT,status TEXT,assignee TEXT);CREATE TABLE task_attachments(id INTEGER,task_id TEXT,filename TEXT,stored_path TEXT,content_type TEXT,size INTEGER)');db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?)').run('t_test','Prepare briefing','Context','todo',null);db.prepare('INSERT INTO task_attachments VALUES(?,?,?,?,?,?)').run(1,'t_test','brief.txt',file,'text/plain',19);db.close();
 vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{if(url.includes('/connected_accounts/'))return Response.json({id:'ca_business',status:'ACTIVE',toolkit:{slug:'outlook'}});expect(JSON.parse(String(init?.body)).method).toBe('GET');return Response.json({status:200,data:{mail:'business@example.com',id:'business-user'}});}));
 const ctx={hermesHome:home,eaiosRoot:home,requestKeys:new Map([['COMPOSIO_API_KEY','fixture']])};
 const settings=await saveMailSettings(ctx,{connectionId:'ca_business',expectedEmail:'business@example.com',revision:0});const identity=settings.delegationSender!;
 const c=createHumanContact(home,{displayName:'Assistant Example',email:'assistant@example.com'});
 const draft=prepareHumanDraft(home,{workItemId:'t_test',contactId:c.id},identity);
 const provider={verify:vi.fn(async()=>identity),send:vi.fn<import('../../server/humanApproval.ts').HumanMailProvider['send']>(async()=>({id:'receipt-1',provider:'outlook'}))};
 return {ctx,home,file,draft,identity,provider};
}
it('submits without sending; approval sends the reviewed immutable attachment once',async()=>{
 const x=await setup();const d=await submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:['att-1']});
 expect(humanApprovals(x.home)[0].payload).toContain('From: business@example.com');expect(x.provider.send).not.toHaveBeenCalled();
 writeFileSync(x.file,'changed after review');
 const input={decision:'approved',reviewVersion:d.package!.packageHash};
 expect((await decideHumanApproval(x.ctx,d.id,input,x.provider)).ok).toBe(true);
 expect(x.provider.send.mock.calls[0][3][0].data.toString()).toBe('reviewed attachment');
 await expect(decideHumanApproval(x.ctx,d.id,input,x.provider)).rejects.toThrow('already decided');expect(x.provider.send).toHaveBeenCalledTimes(1);
 expect(getHumanDelegation(x.home,d.id).delegation.status).toBe('awaiting_acceptance');
 const db=new DatabaseSync(join(x.home,'kanban.db'));expect(db.prepare('SELECT assignee FROM tasks').get()?.assignee).toBeNull();db.close();
});
it('reject and request-changes decisions send nothing',async()=>{
 for(const decision of ['rejected','changes_requested']){const x=await setup();const d=await submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:[]});await decideHumanApproval(x.ctx,d.id,{decision,reviewVersion:d.package!.packageHash},x.provider);expect(x.provider.send).not.toHaveBeenCalled();}
});
it('concurrent approval requests claim only one send',async()=>{
 const x=await setup(),d=await submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:[]});const input={decision:'approved',reviewVersion:d.package!.packageHash};
 const outcomes=await Promise.allSettled([decideHumanApproval(x.ctx,d.id,input,x.provider),decideHumanApproval(x.ctx,d.id,input,x.provider)]);
 expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(1);expect(x.provider.send).toHaveBeenCalledTimes(1);
});
it('connection identity changes block sending without falling back',async()=>{
 const x=await setup(),d=await submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:[]});x.provider.verify.mockResolvedValue({...x.identity,email:'work@example.com'});
 expect((await decideHumanApproval(x.ctx,d.id,{decision:'approved',reviewVersion:d.package!.packageHash},x.provider)).ok).toBe(false);expect(x.provider.send).not.toHaveBeenCalled();expect(getHumanDelegation(x.home,d.id).delegation.status).toBe('send_failed');
});
it('uncertain provider outcomes are retained and cannot be retried',async()=>{
 const x=await setup(),d=await submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:[]});x.provider.send.mockRejectedValue(new Error('timeout after provider accepted'));
 const input={decision:'approved',reviewVersion:d.package!.packageHash};await decideHumanApproval(x.ctx,d.id,input,x.provider);expect(getHumanDelegation(x.home,d.id).delegation.status).toBe('delivery_uncertain');await expect(decideHumanApproval(x.ctx,d.id,input,x.provider)).rejects.toThrow();expect(x.provider.send).toHaveBeenCalledTimes(1);
 expect(()=>updateHumanStatus(x.home,d.id,{revision:3,status:'completed'})).toThrow();
});
it('rejects missing, unrelated and symlink-escaping attachments without changing draft state',async()=>{
 const x=await setup();await expect(submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:['att-2']})).rejects.toThrow('linked');
 const external=join(x.home,'private.txt');writeFileSync(external,'secret');rmSync(x.file);symlinkSync(external,x.file);
 await expect(submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:['att-1']})).rejects.toThrow('outside');expect(getHumanDelegation(x.home,x.draft.id).delegation.status).toBe('draft');
});
it('rejects tampered content even if the stored hash string was left intact',async()=>{
 const x=await setup(),d=await submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:[]});
 humanStore(x.home,db=>{const changed={...d,package:{...d.package!,body:'unreviewed'}};db.prepare('UPDATE human_delegations SET body=? WHERE id=?').run(JSON.stringify(changed),d.id);});
 await expect(decideHumanApproval(x.ctx,d.id,{decision:'approved',reviewVersion:d.package!.packageHash},x.provider)).rejects.toThrow('mismatch');expect(x.provider.send).not.toHaveBeenCalled();
});

it('editing a human approval sender invalidates old approval and retains attachment bytes',async()=>{
 const x=await setup(),d=await submitHumanApproval(x.ctx,x.draft.id,{revision:1,artifactIds:['att-1']});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.includes('connected_accounts')?Response.json({id:'ca_work',status:'ACTIVE',toolkit:{slug:'outlook'}}):Response.json({status:200,data:{id:'work-user',mail:'work@example.com'}})));
 await changeHumanSender(x.ctx,d.id,{connectionId:'ca_work',expectedBody:d.package!.packageHash});
 const changed=getHumanDelegation(x.home,d.id).delegation;
 expect(changed.package!.sender.email).toBe('work@example.com');expect(changed.package!.artifacts).toEqual(d.package!.artifacts);
 await expect(decideHumanApproval(x.ctx,d.id,{decision:'approved',reviewVersion:d.package!.packageHash},x.provider)).rejects.toThrow();
 expect(x.provider.send).not.toHaveBeenCalled();
 x.provider.verify.mockResolvedValue({...x.identity,connectionId:'ca_work',email:'work@example.com',providerUserId:'work-user'});
 expect((await decideHumanApproval(x.ctx,d.id,{decision:'approved',reviewVersion:changed.package!.packageHash},x.provider)).ok).toBe(true);
 expect(x.provider.send.mock.calls[0][3][0].data.toString()).toBe('reviewed attachment');
});
