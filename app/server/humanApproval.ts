/** Immutable, private mail packages. Approval claims never launch a Hermes worker. */
import { DatabaseSync } from 'node:sqlite';
import { join,sep } from 'node:path';
import { openSync,closeSync,realpathSync,fstatSync,readFileSync,lstatSync,constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { humanStore,HumanDelegationError,listHumanDelegations } from './humanDelegation.ts';
import type { HumanDelegation,HumanDelegationArtifact } from '../src/domain/humanDelegation.ts';
import type { Approval } from '../src/domain/types.ts';
import type { MailboxIdentity } from '../src/domain/mailRouting.ts';
import { requireReviewedSender } from '../src/domain/mailRouting.ts';
import { mailSettings,verifyMailbox } from './mailRouting.ts';
import type { KeyContext } from './apiKeys.ts';
import { sendHumanMail } from './humanMailProvider.ts';
export interface MailAttachment extends HumanDelegationArtifact {data:Buffer;}
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
function ensure(db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS human_mail_packages(id TEXT PRIMARY KEY, identity TEXT NOT NULL, fingerprint TEXT NOT NULL, decision TEXT, receipt TEXT, error TEXT); CREATE TABLE IF NOT EXISTS human_mail_files(delegation_id TEXT NOT NULL, artifact_id TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY(delegation_id,artifact_id));');}
function read(db:DatabaseSync,id:string):HumanDelegation{const r=db.prepare('SELECT body FROM human_delegations WHERE id=?').get(id) as {body:string}|undefined;if(!r)throw new HumanDelegationError(404,'Delegation not found.');return JSON.parse(r.body);}
function put(db:DatabaseSync,d:HumanDelegation){db.prepare('UPDATE human_delegations SET status=?,body=? WHERE id=?').run(d.status,JSON.stringify(d),d.id);}
function event(db:DatabaseSync,id:string,type:string,note:string){db.prepare('INSERT INTO human_delegation_events(delegation_id,event_type,actor_type,note,occurred_at) VALUES(?,?,?,?,?)').run(id,type,'executive',note,new Date().toISOString());}
export function taskAttachments(home:string,taskId:string){
 const db=new DatabaseSync(join(home,'kanban.db'),{readOnly:true});try{return db.prepare('SELECT id,filename,content_type,size FROM task_attachments WHERE task_id=? ORDER BY id').all(taskId).map(r=>({artifactId:'att-'+r.id,filename:String(r.filename),mimeType:String(r.content_type??'application/octet-stream'),sizeBytes:Number(r.size)}));}finally{db.close();}
}
function snapshot(home:string,taskId:string,ids:unknown):MailAttachment[]{
 if(!Array.isArray(ids)||ids.length>30||ids.some(id=>typeof id!=='string'||!/^att-\d+$/.test(id))||new Set(ids).size!==ids.length)throw new HumanDelegationError(400,'Select valid task attachments.');
 const db=new DatabaseSync(join(home,'kanban.db'),{readOnly:true});let total=0;
 try{return ids.map(id=>{
  const row=db.prepare('SELECT filename,stored_path,content_type FROM task_attachments WHERE task_id=? AND id=?').get(taskId,Number(id.slice(4))) as {filename:string;stored_path:string;content_type:string}|undefined;
  if(!row)throw new HumanDelegationError(409,'A selected attachment is no longer linked to this task.');
  const attachmentRoot=join(home,'kanban','attachments');
  if(lstatSync(attachmentRoot).isSymbolicLink())throw new HumanDelegationError(409,'Attachment directory must not be a symlink.');
  const root=realpathSync(attachmentRoot),path=realpathSync(row.stored_path);
  if(!root.startsWith(realpathSync(home)+sep))throw new HumanDelegationError(409,'Attachment directory is outside the private home.');
  if(!path.startsWith(root+sep))throw new HumanDelegationError(409,'An attachment is outside the task attachment directory.');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=fstatSync(fd);const actual=realpathSync('/proc/self/fd/'+fd);
   if(!st.isFile()||!actual.startsWith(root+sep)||st.size>5*1024*1024)throw new HumanDelegationError(409,'Attachment is unavailable or exceeds the 5 MB limit.');
   const data=readFileSync(fd);if(data.length>5*1024*1024)throw new HumanDelegationError(409,'Attachment exceeds the 5 MB limit.');total+=data.length;if(total>8*1024*1024)throw new HumanDelegationError(409,'Selected attachments exceed the 8 MB total limit.');
   return {artifactId:id,filename:row.filename,mimeType:row.content_type||'application/octet-stream',sizeBytes:data.length,contentHash:hash(data),data};
  }finally{closeSync(fd);}
 });}finally{db.close();}
}
function idleTask(home:string,id:string){const db=new DatabaseSync(join(home,'kanban.db'),{readOnly:true});try{const t=db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!t||t.assignee||t.claim_lock||t.current_run_id||!['todo','triage','ready','blocked'].includes(String(t.status)))throw new HumanDelegationError(409,'The source task is no longer idle and unassigned.');}finally{db.close();}}
export async function submitHumanApproval(ctx:KeyContext,id:string,input:Record<string,unknown>){
 const d=humanStore(ctx.hermesHome,db=>read(db,id));if(!d.package||d.status!=='draft'||d.revision!==input.revision)throw new HumanDelegationError(409,'Reload this draft before requesting approval.');
 idleTask(ctx.hermesHome,d.workItemId);
 const expected=mailSettings(ctx.hermesHome).delegationSender;if(!expected)throw new HumanDelegationError(409,'Configure a delegation sender.');
 if(d.package.sender.accountId!==expected.connectionId||d.package.sender.email.toLowerCase()!==expected.email.toLowerCase())throw new HumanDelegationError(409,'Sender changed since this draft. Prepare a new draft.');
 const identity=await verifyMailbox(ctx,expected.connectionId);requireReviewedSender(expected,identity);
 const files=snapshot(ctx.hermesHome,d.workItemId,input.artifactIds);
 if(identity.provider==='outlook'&&files.reduce((n,f)=>n+f.sizeBytes,0)>2500000)throw new HumanDelegationError(409,'Outlook currently supports at most 2.5 MB of attachments per delegation. No attachment was omitted.');
 return humanStore(ctx.hermesHome,db=>{ensure(db);const current=read(db,id);if(current.status!=='draft'||current.revision!==d.revision)throw new HumanDelegationError(409,'Draft changed.');
  current.package!.artifacts=files.map(({data:_data,...meta})=>meta);
  current.package!.packageHash=hash(JSON.stringify({...current.package,packageHash:'',identity}));
  current.status='pending_approval';current.revision++;current.updatedAt=new Date().toISOString();put(db,current);
  db.prepare('INSERT INTO human_mail_packages(id,identity,fingerprint) VALUES(?,?,?)').run(id,JSON.stringify(identity),current.package!.packageHash);
  for(const f of files)db.prepare('INSERT INTO human_mail_files VALUES(?,?,?)').run(id,f.artifactId,f.data);
  event(db,id,'approval_requested','Blocked and unassigned; no email sent.');return current;
 });
}
export function humanApprovals(home:string):Approval[]{return listHumanDelegations(home).filter(d=>d.status==='pending_approval'&&d.package).map(d=>({id:'human:'+d.id,workItemId:d.workItemId,requestedByAgentId:'human-delegation',actionType:'send',targetSystem:d.package!.sender.provider,targetObject:d.package!.subject,risk:'medium',status:'pending',submittedAt:d.updatedAt,reviewVersion:d.package!.packageHash,humanDelegation:{id:d.id},payload:`From: ${d.package!.sender.email}\nTo: ${d.package!.recipient.displayName} <${d.package!.recipient.email}>\nSubject: ${d.package!.subject}\n\n${d.package!.body}\n\nAttachments:\n${d.package!.artifacts.map(a=>a.filename+' ('+a.sizeBytes+' bytes)').join('\n')||'None'}`,evidence:[],rollbackPlan:'Email cannot be reliably recalled. Approval sends this exact package once.'}));}
export interface HumanMailProvider {verify:typeof verifyMailbox;send:typeof sendHumanMail;}
const provider:HumanMailProvider={verify:verifyMailbox,send:sendHumanMail};
export async function decideHumanApproval(ctx:KeyContext,id:string,input:Record<string,unknown>,mail:HumanMailProvider=provider){
 if(!['approved','rejected','changes_requested'].includes(String(input.decision)))throw new HumanDelegationError(400,'Choose a valid decision.');
 const claim=humanStore(ctx.hermesHome,db=>{ensure(db);const d=read(db,id);
  if(d.status!=='pending_approval'||!d.package||input.reviewVersion!==d.package.packageHash)throw new HumanDelegationError(409,'This approval changed or was already decided.');
  const stored=db.prepare('SELECT * FROM human_mail_packages WHERE id=?').get(id) as {identity:string;fingerprint:string};
  if(!stored||stored.fingerprint!==d.package.packageHash||hash(JSON.stringify({...d.package,packageHash:'',identity:JSON.parse(stored.identity)}))!==stored.fingerprint)throw new HumanDelegationError(409,'Approval package mismatch.');
  d.status=input.decision==='approved'?'sending':'rejected';d.revision++;d.updatedAt=new Date().toISOString();put(db,d);
  db.prepare('UPDATE human_mail_packages SET decision=? WHERE id=?').run(String(input.decision),id);event(db,id,'decision_'+input.decision,'Exact package decision recorded.');
  const files=input.decision==='approved'?d.package.artifacts.map(meta=>{const r=db.prepare('SELECT data FROM human_mail_files WHERE delegation_id=? AND artifact_id=?').get(id,meta.artifactId) as {data:Uint8Array}|undefined;if(!r||hash(Buffer.from(r.data))!==meta.contentHash)throw new HumanDelegationError(409,'Approved attachment is missing or changed.');return {...meta,data:Buffer.from(r.data)};}):[];
  return {d,identity:JSON.parse(stored.identity) as MailboxIdentity,files};
 });
 if(input.decision!=='approved')return {ok:true,auditEventId:id};
 let attempted=false;
 try{
  idleTask(ctx.hermesHome,claim.d.workItemId);
  const current=await mail.verify(ctx,claim.identity.connectionId);requireReviewedSender(claim.identity,current);
  attempted=true;const receipt=await mail.send(ctx,claim.d.package!,claim.identity,claim.files);
  if(!receipt.id)throw new Error('No receipt');
  humanStore(ctx.hermesHome,db=>{const d=read(db,id);d.revision++;d.status='awaiting_acceptance';d.receipt=receipt;d.updatedAt=new Date().toISOString();put(db,d);db.prepare('UPDATE human_mail_packages SET receipt=? WHERE id=?').run(JSON.stringify(receipt),id);event(db,id,'provider_confirmed','Provider confirmed sending; awaiting human acceptance.');});
  return {ok:true,auditEventId:id};
 }catch{
  humanStore(ctx.hermesHome,db=>{const d=read(db,id);d.revision++;d.updatedAt=new Date().toISOString();d.status=attempted?'delivery_uncertain':'send_failed';put(db,d);const reason=attempted?'Delivery outcome is uncertain. Check Sent mail; this message will never be retried automatically.':'Mailbox or source task verification failed before sending. No email sent.';d.deliveryError=reason;put(db,d);db.prepare('UPDATE human_mail_packages SET error=? WHERE id=?').run(reason,id);event(db,id,d.status,reason);});
  return {ok:false,auditEventId:id,error:{code:attempted?'delivery_uncertain':'send_blocked',safeMessage:attempted?'Delivery outcome uncertain. Check Sent mail; no automatic retry.':'Sending blocked: mailbox or task verification failed.',retryable:false}};
 }
}

export function updateHumanStatus(home:string,id:string,input:Record<string,unknown>){
 const transitions:Record<string,string[]>={draft:['cancelled'],pending_approval:['cancelled'],awaiting_acceptance:['accepted','declined','blocked','cancelled'],accepted:['in_progress','blocked','completed','cancelled'],in_progress:['blocked','completed','cancelled'],blocked:['in_progress','completed','cancelled'],no_response:['accepted','cancelled']};
 return humanStore(home,db=>{const d=read(db,id);if(d.revision!==input.revision||!transitions[d.status]?.includes(String(input.status)))throw new HumanDelegationError(409,'This status change is not available. Reload the delegation.');d.status=input.status as HumanDelegation['status'];d.revision++;d.updatedAt=new Date().toISOString();put(db,d);event(db,id,'status_'+d.status,'Status confirmed by executive.');return d;});
}

/** Editing a pending package invalidates the old approval fingerprint, without sending. */
export async function changeHumanSender(ctx:KeyContext,id:string,input:Record<string,unknown>){
 if(typeof input.connectionId!=='string')throw new HumanDelegationError(400,'Choose a connected sender.');
 const identity=await verifyMailbox(ctx,input.connectionId);
 return humanStore(ctx.hermesHome,db=>{ensure(db);const d=read(db,id);
  if(d.status!=='pending_approval'||!d.package||d.package.packageHash!==input.expectedBody)throw new HumanDelegationError(409,'Approval changed. Reload before editing.');
  const row=db.prepare('SELECT decision FROM human_mail_packages WHERE id=?').get(id);
  if(!row||row.decision)throw new HumanDelegationError(409,'Approval was already decided.');
  if(identity.provider==='outlook'&&d.package.artifacts.reduce((n,f)=>n+f.sizeBytes,0)>2500000)throw new HumanDelegationError(409,'Attachments exceed the Outlook limit.');
  d.package.sender={provider:identity.provider,accountId:identity.connectionId,email:identity.email};
  d.package.packageHash=hash(JSON.stringify({...d.package,packageHash:'',identity}));d.revision++;d.updatedAt=new Date().toISOString();put(db,d);
  db.prepare('UPDATE human_mail_packages SET identity=?,fingerprint=? WHERE id=?').run(JSON.stringify(identity),d.package.packageHash,id);
  event(db,id,'sender_changed','Sender changed to '+identity.email+'; fresh review required.');return {ok:true};
 });
}
