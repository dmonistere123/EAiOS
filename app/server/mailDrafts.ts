import {checkDcrApproval} from './dcrProduction.ts';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import type {KeyContext} from './apiKeys.ts';
import {HumanDelegationError} from './humanDelegation.ts';
import {verifyMailbox} from './mailRouting.ts';
import {requireReviewedSender} from '../src/domain/mailRouting.ts';
import {parseMailDraft,mailDraftPayload,type SavedMailDraft} from '../src/domain/mailDraft.ts';
import {sendHumanMail} from './humanMailProvider.ts';
import {readReplySource,replyRecipients} from './mailReplies.ts';
import {requireCurrentQuickEmailContact} from './ermQuickEmail.ts';
function fail(message:string):never{throw new HumanDelegationError(409,message);}
function transaction<T>(ctx:KeyContext,fn:(db:DatabaseSync)=>T):T{const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'));try{db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');const result=fn(db);db.exec('COMMIT');return result;}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}}
function read(db:DatabaseSync,id:string){const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!task)fail('Draft no longer exists. Reload Approvals.');const env=JSON.parse(String(task.body));if(env.eaios!=='approval'||env.actionType!=='send'||!/^outlook$/i.test(env.targetSystem))fail('This is not an Outlook email approval.');return {task,env};}
function idle(task:Record<string,unknown>,env:Record<string,unknown>,version:unknown){if(task.assignee||task.claim_lock||task.current_run_id||!['todo','triage','ready','blocked'].includes(String(task.status))||env.decision||task.body!==version)fail('This draft changed, was already decided, or is no longer idle. Reload before saving or sending.');}
export const outlookDraftProvider={verify:(ctx:KeyContext,id:string)=>verifyMailbox(ctx,id,true),send:sendHumanMail,source:readReplySource};
export async function saveOutlookDraft(ctx:KeyContext,id:string,input:Record<string,unknown>,provider=outlookDraftProvider){
 if(typeof input.connectionId!=='string'||typeof input.body!=='string'||!input.body.trim()||input.body.length>100000||!['Text','HTML'].includes(String(input.bodyType)))fail('Choose an Outlook account, body format and nonempty message body.');
 if(input.replyMode!==undefined&&!['reply','replyAll'].includes(String(input.replyMode)))fail('Choose Reply or Reply All.');
 const identity=await provider.verify(ctx,input.connectionId as string);if(identity.provider!=='outlook')fail('Only connected Outlook senders are supported here.');
 const snapshot=transaction(ctx,db=>{const {task,env}=read(db,id);idle(task,env,input.expectedBody);if(env.ermQuickEmail)fail('This new message is reviewed as queued. Reject it and prepare a new draft to make changes.');return env;});
 let selected:ReturnType<typeof replyRecipients>|undefined;
 const mode=input.replyMode??snapshot.mailDraft?.replyMode;
 if(mode){
  if(!snapshot.mailReply?.reference?.sourceMessageId)fail('Original email identifiers are missing.');
  const sourceIdentity=snapshot.mailReply.sourceIdentity??snapshot.mailReply.identity;
  requireReviewedSender(sourceIdentity,identity);
  const source=await provider.source(ctx,sourceIdentity.connectionId,snapshot.mailReply.reference.sourceMessageId);
  requireReviewedSender(sourceIdentity,source.identity);
  if(JSON.stringify(source.reference)!==JSON.stringify(snapshot.mailReply.reference)||source.package.subject!==snapshot.mailReply.package.subject)fail('Original message changed. Verify it again.');
  selected=replyRecipients(source,mode,identity.email);
 }
 return transaction(ctx,db=>{const {task,env}=read(db,id);idle(task,env,input.expectedBody);
  if(!env.mailReply?.reference?.sourceMessageId)fail('Original email identifiers are missing. Verify the original mailbox and message before saving; this reply will not be flattened into a new email.');
  const sourceIdentity=env.mailReply.sourceIdentity??env.mailReply.identity;
  try{requireReviewedSender(sourceIdentity,identity);}catch{fail('Choose the Outlook account that owns the original conversation. Sending from another mailbox would lose reply threading.');}
  if(env.attachments?.length||env.mailReply?.package?.artifacts?.length)fail('This draft has attachments. Its attachment package must be prepared and reviewed before sending; none will be silently omitted.');
  let content;
  try{content=env.mailDraft??parseMailDraft(env.payload??'');}catch(e){fail(e instanceof Error?e.message:'Full draft content is required.');}
  const draft:SavedMailDraft={to:selected?.to??content.to,cc:selected?.cc??content.cc,bcc:selected?.bcc??content.bcc,...(mode?{replyMode:mode}:{}),subject:env.mailReply.package.subject,body:input.body as string,bodyType:input.bodyType as 'Text'|'HTML',identity};
  const next={...env,mailDraft:draft,payload:mailDraftPayload(draft)};
  const body=JSON.stringify(next);db.prepare("UPDATE tasks SET body=?,status='blocked',assignee=NULL WHERE id=?").run(body,id);
  db.prepare('INSERT INTO task_events(task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(id,'mail_draft_saved',JSON.stringify({actor:'eaios-executive',sender:identity.email}),Math.floor(Date.now()/1000));
  return {draft,reviewVersion:body};
 });
}
export async function decideOutlookDraft(ctx:KeyContext,id:string,input:Record<string,unknown>,provider=outlookDraftProvider){
 const claimed=transaction(ctx,db=>{
  const row=db.prepare('SELECT body FROM tasks WHERE id=?').get(id);if(!row)return null;
  const candidate=JSON.parse(String(row.body));if(!candidate.mailDraft||input.decision!=='approved')return null;
  const {task,env}=read(db,id);idle(task,env,input.expectedBody);checkDcrApproval(ctx,env);const draft=env.mailDraft as SavedMailDraft;
  if(env.ermQuickEmail){
   if(env.mailReply)fail('A quick email cannot be attached to an Outlook conversation. Nothing was sent.');
   requireCurrentQuickEmailContact(ctx,env.ermQuickEmail,draft);
  }else{
   if(!env.mailReply?.reference?.sourceMessageId)fail('Original conversation reference is missing. Nothing was sent.');
   requireReviewedSender(env.mailReply.sourceIdentity??env.mailReply.identity,draft.identity);
  }
  if(env.payload!==mailDraftPayload(draft)||draft.identity.provider!=='outlook'||env.attachments?.length)fail('Saved email content differs from this approval. Save and review it again.');
  if(db.prepare("SELECT 1 FROM task_links e JOIN tasks p ON p.id=e.parent_id WHERE e.child_id=? AND p.status NOT IN ('done','archived') LIMIT 1").get(id))fail('A prerequisite is unfinished.');
  db.prepare("UPDATE tasks SET body=?,status='blocked',assignee=NULL WHERE id=?").run(JSON.stringify({...env,decision:'approved',decidedAt:new Date().toISOString(),mailDelivery:{status:'sending'}}),id);
  db.prepare('INSERT INTO task_events(task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(id,'approval_decided',JSON.stringify({actor:'eaios-executive',decision:'approved',sender:draft.identity.email}),Math.floor(Date.now()/1000));
  return {draft,reply:env.mailReply,quickEmail:env.ermQuickEmail};
 });
 if(!claimed)return null;let attempted=false;
 try{
  const identity=await provider.verify(ctx,claimed.draft.identity.connectionId);requireReviewedSender(claimed.draft.identity,identity);
  if(claimed.quickEmail)requireCurrentQuickEmailContact(ctx,claimed.quickEmail,claimed.draft);
  let reference;
  if(claimed.reply){const original=claimed.reply;const sourceIdentity=original.sourceIdentity??original.identity;const current=await provider.source(ctx,sourceIdentity.connectionId,original.reference.sourceMessageId);requireReviewedSender(sourceIdentity,current.identity);
   if(current.package.recipient.email!==claimed.draft.to[0]||current.package.subject!==claimed.draft.subject||JSON.stringify(current.reference)!==JSON.stringify(original.reference))throw Error('Original message changed');
   if(claimed.draft.replyMode){const recipients=replyRecipients(current,claimed.draft.replyMode,identity.email);if(JSON.stringify(recipients)!==JSON.stringify({to:claimed.draft.to,cc:claimed.draft.cc,bcc:claimed.draft.bcc}))throw Error('Original recipients changed');}
   if(identity.connectionId===sourceIdentity.connectionId)reference=original.reference;
  }
  const d=claimed.draft;attempted=true;
  const receipt=await provider.send(ctx,{recipient:{email:d.to[0],displayName:d.to[0]},to:d.to,cc:d.cc,bcc:d.bcc,bodyType:d.bodyType,preserveReplyHistory:!!claimed.reply,sender:{provider:'outlook',accountId:identity.connectionId,email:identity.email},subject:d.subject,body:d.body,artifacts:[],packageHash:''},identity,[],reference);
  if(!receipt.id)throw Error('No send receipt');
  transaction(ctx,db=>{const {env}=read(db,id);db.prepare("UPDATE tasks SET body=?,status='done',assignee=NULL WHERE id=?").run(JSON.stringify({...env,mailDelivery:{status:'sent',receipt}}),id);});
  return {ok:true,auditEventId:'mail-'+id};
 }catch{
  const status=attempted?'delivery_uncertain':'send_failed';transaction(ctx,db=>{const {env}=read(db,id);db.prepare("UPDATE tasks SET body=?,status='blocked',assignee=NULL WHERE id=?").run(JSON.stringify({...env,mailDelivery:{status}}),id);});
  return {ok:false,auditEventId:'mail-'+id,error:{code:status,safeMessage:attempted?'Email outcome is uncertain. Check Sent mail; do not retry this approval.':claimed.quickEmail?'The selected account or saved contact address could not be verified. Nothing was sent. Prepare a new approval.':'The saved account or original message could not be verified. Nothing was sent. Reconnect and prepare a new approval.',retryable:false}};
 }
}
