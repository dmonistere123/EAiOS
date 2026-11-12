import { createHash, randomBytes } from 'node:crypto';
import { humanStore, HumanDelegationError, listHumanDelegations } from './humanDelegation.ts';
import type { HumanDelegation } from '../src/domain/humanDelegation.ts';
import type { Approval } from '../src/domain/types.ts';
import type { DatabaseSync } from 'node:sqlite';

const digest = (s:string) => createHash('sha256').update(s).digest('hex');
export const completionVersion = (d:HumanDelegation) => digest(JSON.stringify([d.id,d.revision,d.checklist,d.completionNote]));
function read(db:DatabaseSync,id:string):HumanDelegation {
  const row=db.prepare('SELECT body FROM human_delegations WHERE id=?').get(id) as {body:string}|undefined;
  if(!row)throw new HumanDelegationError(404,'Delegation not found.');
  return JSON.parse(row.body);
}
function save(db:DatabaseSync,d:HumanDelegation,actor:string,event:string) {
  d.revision++; d.updatedAt=new Date().toISOString();
  db.prepare('UPDATE human_delegations SET status=?,body=? WHERE id=?').run(d.status,JSON.stringify(d),d.id);
  db.prepare('INSERT INTO human_delegation_events(delegation_id,event_type,actor_type,note,occurred_at) VALUES(?,?,?,?,?)').run(d.id,event,actor,'Checklist and completion state recorded.',d.updatedAt);
  return d;
}
function bounded(value:unknown,max:number):string {
  if(value===undefined)return '';
  if(typeof value!=='string'||value.length>max)throw new HumanDelegationError(400,'The entry is too long or invalid.');
  return value.trim();
}
export function updateChecklist(home:string,id:string,input:Record<string,unknown>,actor='executive') {
  return humanStore(home,db=>{
    const d=read(db,id);
    if(input.revision!==d.revision)throw new HumanDelegationError(409,'This task changed. Reload before saving.');
    if(!['awaiting_acceptance','accepted','in_progress','blocked','no_response'].includes(d.status))throw new HumanDelegationError(409,'This checklist cannot be edited while awaiting approval or after closure.');
    if(!Array.isArray(input.items)||input.items.length!==d.checklist?.length||!input.items.length)throw new HumanDelegationError(400,'Save all checklist items.');
    const items=input.items as Record<string,unknown>[];
    if(new Set(items.map(i=>i.id)).size!==items.length)throw new HumanDelegationError(400,'Duplicate checklist item.');
    d.checklist=d.checklist.map(item=>{
      const value=items.find(i=>i.id===item.id);
      if(!value||typeof value.done!=='boolean')throw new HumanDelegationError(400,'Invalid checklist item.');
      const reference=bounded(value.reference,120),notes=bounded(value.notes,4000),cost=bounded(value.cost,100);
      if(value.done&&!reference&&!notes)throw new HumanDelegationError(400,'Add a confirmation reference or outcome note for each completed item.');
      return {...item,done:value.done,reference,notes,cost};
    });
    d.status='in_progress';return save(db,d,actor,'checklist_updated');
  });
}
export function requestHumanCompletion(home:string,id:string,input:Record<string,unknown>,actor='executive') {
  return humanStore(home,db=>{
    const d=read(db,id);
    if(input.revision!==d.revision||!['awaiting_acceptance','accepted','in_progress','blocked','no_response'].includes(d.status))throw new HumanDelegationError(409,'This task changed or is not ready for completion review.');
    if(d.checklist?.some(i=>!i.done))throw new HumanDelegationError(409,'Complete every checklist item before submitting for sign-off.');
    d.completionNote=bounded(input.note,4000);d.status='awaiting_completion';
    return save(db,d,actor,'completion_requested');
  });
}
export function completionApprovals(home:string):Approval[] {
  return listHumanDelegations(home).filter(d=>d.status==='awaiting_completion').map(d=>({
    id:'human-completion:'+d.id,workItemId:d.workItemId,requestedByAgentId:'human-delegation',actionType:'other',targetSystem:'HI Assistant',
    targetObject:'Complete: '+(d.package?.subject.replace(/^Delegation:\s*/,'')||d.workItemId),risk:'low',status:'pending',submittedAt:d.updatedAt,
    reviewVersion:completionVersion(d),humanDelegation:{id:d.id,completion:true},evidence:[],
    payload:[`Assistant: ${d.package?.recipient.displayName??'Human assistant'}`,`Instructions: ${d.instructions}`,...(d.checklist??[]).map(i=>`${i.done?'✓':'○'} ${i.title}\nReference: ${i.reference||'Not provided'}\nFinal cost: ${i.cost||'Not provided'}\nNotes: ${i.notes||'None'}`),`Completion note: ${d.completionNote||'None'}`].join('\n\n'),
    rollbackPlan:'Approval archives this delegation from the open queue. Its itinerary, checklist and history remain saved. Request changes to keep it open. No email is sent and no reservation is purchased.',
  }));
}
export function decideCompletion(home:string,id:string,input:Record<string,unknown>) {
  return humanStore(home,db=>{
    const d=read(db,id);
    if(d.status!=='awaiting_completion'||input.reviewVersion!==completionVersion(d))throw new HumanDelegationError(409,'This completion request changed or was already decided.');
    if(!['approved','rejected','changes_requested'].includes(String(input.decision)))throw new HumanDelegationError(400,'Choose a valid decision.');
    d.status=input.decision==='approved'?'completed':'in_progress';d.completionFeedback=bounded(input.reason??input.note,4000);
    save(db,d,'executive','completion_'+input.decision);return {ok:true,auditEventId:d.id+':'+d.revision};
  });
}
function ensureAccess(db:DatabaseSync) {
  db.exec('CREATE TABLE IF NOT EXISTS human_task_access (token_hash TEXT PRIMARY KEY, delegation_id TEXT NOT NULL UNIQUE, expires_at INTEGER NOT NULL)');
}
export function issueAssistantAccess(home:string,id:string) {
  return humanStore(home,db=>{
    const d=read(db,id);if(['completed','cancelled','rejected','declined'].includes(d.status))throw new HumanDelegationError(409,'This task is closed.');
    ensureAccess(db);const token=randomBytes(32).toString('base64url'),expiresAt=Date.now()+7*86400000;
    db.prepare('DELETE FROM human_task_access WHERE delegation_id=?').run(id);
    db.prepare('INSERT INTO human_task_access VALUES(?,?,?)').run(digest(token),id,expiresAt);
    return {token,expiresAt:new Date(expiresAt).toISOString()};
  });
}
export function revokeAssistantAccess(home:string,id:string) {humanStore(home,db=>{ensureAccess(db);db.prepare('DELETE FROM human_task_access WHERE delegation_id=?').run(id);});}
export function authorizedAssistantTask(home:string,token:string) {
  if(!/^[\w-]{43}$/.test(token))throw new HumanDelegationError(401,'This assistant link is missing, expired or revoked.');
  return humanStore(home,db=>{
    ensureAccess(db);const row=db.prepare('SELECT delegation_id FROM human_task_access WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()) as {delegation_id:string}|undefined;
    if(!row)throw new HumanDelegationError(401,'This assistant link is missing, expired or revoked.');
    return read(db,row.delegation_id);
  });
}
/** Only task-specific fields leave the isolated assistant service. */
export function assistantTaskView(d:HumanDelegation) {
  return {id:d.id,title:d.package?.subject.replace(/^Delegation:\s*/,''),assistant:d.package?.recipient.displayName,status:d.status,revision:d.revision,instructions:d.instructions,checklist:d.checklist??[],completionNote:d.completionNote,completionFeedback:d.completionFeedback};
}
