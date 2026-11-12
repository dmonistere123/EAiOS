// @vitest-environment node
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeTravelStage } from '../../server/travelHandoffStage.ts';
import { prepareTravelHandoff } from '../../server/travelHandoff.ts';
import { listHumanContacts,getHumanDelegation } from '../../server/humanDelegation.ts';
import { submitHumanApproval,decideHumanApproval,updateHumanStatus } from '../../server/humanApproval.ts';
import { completionApprovals,decideCompletion,updateChecklist,requestHumanCompletion,issueAssistantAccess,revokeAssistantAccess,authorizedAssistantTask,assistantTaskView } from '../../server/humanCompletion.ts';
import { handleAssistantPortal } from '../../server/assistantPortal.ts';
import { travelAction } from '../../server/travelBooking.ts';
import { duffel } from '../../server/duffel.ts';
import { parseResearch } from '../../server/travelResearch.ts';
import { getTrip } from '../../server/travel.ts';
import { createServer } from 'node:http';
let root:string;
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'travel-hi-'));vi.stubEnv('EAIOS_TRAVEL_ASSISTED','1');});
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();rmSync(root,{recursive:true,force:true});});
async function prepared(){
 const identity=initializeTravelStage(root),ctx={hermesHome:root,eaiosRoot:root,dataRoot:root},contact=listHumanContacts(root)[0];
 const result=await prepareTravelHandoff(ctx,'staging-demo',{contactId:contact.id,instructions:'Ask before substitutions.'},identity);
 const verify=vi.fn(async()=>identity),send=vi.fn(async()=>({id:'fixture-receipt',provider:'fixture'}));
 return {identity,ctx,contact,result,verify,send};
}
async function sent(){
 const x=await prepared(),d=x.result.delegation;
 const submitted=await submitHumanApproval(x.ctx,d.id,{revision:d.revision,artifactIds:[x.result.artifactId]},x.verify);
 await decideHumanApproval(x.ctx,d.id,{decision:'approved',reviewVersion:submitted.package!.packageHash},{verify:x.verify,send:x.send});
 return {...x,d:getHumanDelegation(root,d.id).delegation};
}
it('creates one real saved artifact and draft without sending, then sends exactly reviewed bytes',async()=>{
 const x=await prepared();expect(x.result.delegation.checklist).toHaveLength(4);expect(x.send).not.toHaveBeenCalled();
 const db=new DatabaseSync(join(root,'kanban.db'));const file=db.prepare('SELECT * FROM task_attachments').get()!;
 const bytes=readFileSync(String(file.stored_path));expect(bytes.toString()).toContain('NOT A RESERVATION');expect(bytes.toString()).toContain('Ask before substitutions.');expect(db.prepare('SELECT assignee FROM tasks').get()?.assignee).toBeNull();
 const repeat=await prepareTravelHandoff(x.ctx,'staging-demo',{contactId:x.contact.id,instructions:'Changed instructions'},x.identity);expect(repeat.delegation.id).toBe(x.result.delegation.id);expect(db.prepare('SELECT count(*) n FROM tasks').get()?.n).toBe(1);db.close();
 await expect(submitHumanApproval(x.ctx,x.result.delegation.id,{revision:1,artifactIds:[]},x.verify)).rejects.toThrow('itinerary attachment');
 const approved=await submitHumanApproval(x.ctx,x.result.delegation.id,{revision:1,artifactIds:[x.result.artifactId]},x.verify);
 await decideHumanApproval(x.ctx,approved.id,{decision:'approved',reviewVersion:approved.package!.packageHash},{verify:x.verify,send:x.send});
 expect(x.send).toHaveBeenCalledTimes(1);expect(getHumanDelegation(root,approved.id).delegation.status).toBe('awaiting_acceptance');
});
it('requires all evidence, rejects stale edits and keeps completion pending until executive sign-off',async()=>{
 const {d,ctx,contact,identity}=await sent();
 expect(()=>updateHumanStatus(root,d.id,{revision:d.revision,status:'completed'})).toThrow('every checklist');
 expect(()=>requestHumanCompletion(root,d.id,{revision:d.revision})).toThrow('every checklist');
 expect(()=>updateChecklist(root,d.id,{revision:d.revision,items:d.checklist!.map(i=>({...i,done:true}))})).toThrow('confirmation');
 const updated=updateChecklist(root,d.id,{revision:d.revision,items:d.checklist!.map(i=>({...i,done:true,reference:'CONF-'+i.id,cost:'USD 100',notes:'Booked by assistant'}))},'human_assistant');
 expect(()=>updateChecklist(root,d.id,{revision:d.revision,items:updated.checklist})).toThrow('changed');
 const pending=requestHumanCompletion(root,d.id,{revision:updated.revision,note:'All bookings complete'},'human_assistant');expect(pending.status).toBe('awaiting_completion');
 const approval=completionApprovals(root)[0];expect(approval.payload).toContain('CONF-sample-flight');
 expect(()=>updateChecklist(root,d.id,{revision:pending.revision,items:updated.checklist})).toThrow('awaiting approval');
 decideCompletion(root,d.id,{decision:'changes_requested',reviewVersion:approval.reviewVersion,note:'Please verify dinner time'});
 expect(getHumanDelegation(root,d.id).delegation.status).toBe('in_progress');
 expect(()=>decideCompletion(root,d.id,{decision:'approved',reviewVersion:approval.reviewVersion})).toThrow('already decided');
 const changed=getHumanDelegation(root,d.id).delegation;requestHumanCompletion(root,d.id,{revision:changed.revision});
 decideCompletion(root,d.id,{decision:'approved',reviewVersion:completionApprovals(root)[0].reviewVersion});
 const final=getHumanDelegation(root,d.id);expect(final.delegation.status).toBe('completed');expect(final.delegation.checklist).toHaveLength(4);expect(final.events.some(e=>e.actorType==='human_assistant')).toBe(true);expect(completionApprovals(root)).toEqual([]);
 const repeat=await prepareTravelHandoff(ctx,'staging-demo',{contactId:contact.id,instructions:'Book again'},identity);expect(repeat.delegation.id).toBe(d.id);expect(repeat.delegation.status).toBe('completed');
});
it('binds access to one task, redacts mailbox data and immediately invalidates rotated or revoked links',async()=>{
 const {d}=await sent(),first=issueAssistantAccess(root,d.id);
 expect(authorizedAssistantTask(root,first.token).id).toBe(d.id);expect(assistantTaskView(d)).not.toHaveProperty('package');
 const second=issueAssistantAccess(root,d.id);expect(()=>authorizedAssistantTask(root,first.token)).toThrow('revoked');
 revokeAssistantAccess(root,d.id);expect(()=>authorizedAssistantTask(root,second.token)).toThrow('revoked');expect(()=>authorizedAssistantTask(root,'invalid')).toThrow();
});
it('assistant HTTP service refuses executive routes and cross-origin edits',async()=>{
 const {d}=await sent(),access=issueAssistantAccess(root,d.id),server=createServer((req,res)=>{void handleAssistantPortal(req,res,root);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();if(!addr||typeof addr==='string')throw Error();const base='http://127.0.0.1:'+addr.port;
 const headers={authorization:'Bearer '+access.token,'content-type':'application/json'};
 try{
  expect((await fetch(base+'/api/assistant-task')).status).toBe(401);
  expect((await fetch(base+'/api/assistant-task',{headers})).status).toBe(200);
  expect((await fetch(base+'/api/assistant-task/completion-decision',{method:'POST',headers,body:'{}'})).status).toBe(404);
  expect((await fetch(base+'/api/human-delegations',{headers})).status).toBe(404);
  expect((await fetch(base+'/api/assistant-task/checklist',{method:'POST',headers:{...headers,origin:'https://other.example'},body:'{}'})).status).toBe(400);
  const itinerary=await fetch(base+'/api/assistant-task/itinerary',{headers});expect(await itinerary.text()).toContain('NOT A RESERVATION');
 }finally{await new Promise<void>(r=>server.close(()=>r()));}
});
it('blocks provider booking before network calls in assisted mode, including direct Duffel transport',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch');
 await expect(travelAction('anything','anything',{action:'book',accepted:true,amount:'10.00',currency:'USD',passenger:{} as never},root)).rejects.toThrow('planning only');
 for(const path of ['/air/orders','/stays/bookings','/cars/bookings'])await expect(duffel(path,{})).rejects.toThrow('disabled');
 expect(fetcher).not.toHaveBeenCalled();
});
it('accepts only research suggestions backed by returned HTTPS citations',async()=>{
 initializeTravelStage(root);const trip=(await getTrip('staging-demo',root))!;
 const data={output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({options:[{kind:'hotel',name:'Verified hotel',url:'https://hotel.example/'},{kind:'restaurant',name:'Invented',url:'https://invented.example/'}]}),annotations:[{type:'url_citation',url:'https://hotel.example/'}]}]}]};
 const groups=parseResearch(data,trip);expect(groups[0].options).toHaveLength(1);expect(groups[1].options).toHaveLength(0);expect(groups[0].options[0].amount).toBeUndefined();
});
