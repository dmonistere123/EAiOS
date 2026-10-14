/** Trusted source lookup and account-bound reply approval. Never assigns an AI mail sender. */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { KeyContext } from './apiKeys.ts';
import { mailComposioRequest,verifyMailbox } from './mailRouting.ts';
import { requireReviewedSender,type MailboxIdentity } from '../src/domain/mailRouting.ts';
import { sendHumanMail,type MailReplyReference } from './humanMailProvider.ts';
import type { HumanDelegationPackage } from '../src/domain/humanDelegation.ts';
import { HumanDelegationError } from './humanDelegation.ts';
export interface BoundReply {identity:MailboxIdentity;sourceIdentity?:MailboxIdentity;reference:MailReplyReference;package:HumanDelegationPackage;sourceSubject:string;sourceAuthor:string;}
function failure(message:string):never{throw new HumanDelegationError(409,message);}
function email(value:unknown):string{
 if(typeof value!=='string'||/[\r\n,;]/.test(value))return failure('Original message has an unsupported reply address.');
 const address=value.match(/<([^<>]+)>$/)?.[1]??value.trim();if(!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address))return failure('Original reply address could not be verified.');return address;
}
export async function readReplySource(ctx:KeyContext,connectionId:string,messageId:string):Promise<BoundReply>{
 if(!messageId||messageId.length>2048||/[\r\n]/.test(messageId))return failure('Choose the original message.');
 const identity=await verifyMailbox(ctx,connectionId);
 const endpoint=identity.provider==='outlook'?'https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(messageId)+'?$select=id,subject,from,replyTo,isDraft,bodyPreview':'https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(messageId)+'?format=metadata';
 const r=await mailComposioRequest(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:identity.connectionId,endpoint,method:'GET',parameters:[]});
 if(r.status!==200||!r.data?.id)return failure('The original message was not found in this mailbox.');
 let to:string,subject:string;const reference:MailReplyReference={sourceMessageId:String(r.data.id)};
 if(identity.provider==='outlook'){
  if(r.data.isDraft===true)return failure('Cannot reply to an unsent draft.');
  if((r.data.replyTo??[]).length>1)return failure('Multiple Reply-To addresses need explicit recipient review.');
  to=email(r.data.replyTo?.[0]?.emailAddress?.address??r.data.from?.emailAddress?.address);subject=String(r.data.subject??'');
 }else{
  const headers=r.data.payload?.headers??[];const header=(name:string)=>headers.find((h:{name:string;value:string})=>h.name.toLowerCase()===name)?.value;
  to=email(header('reply-to')??header('from'));subject=String(header('subject')??'');reference.threadId=r.data.threadId;reference.inReplyTo=header('message-id');
  if(!reference.threadId||!reference.inReplyTo||/[\r\n]/.test(reference.inReplyTo))return failure('Original thread references are unavailable.');
 }
 if(to.toLowerCase()===identity.email.toLowerCase())return failure('Choose an incoming message, not your own sent message.');
 return {identity,reference,sourceSubject:subject,sourceAuthor:to,package:{recipient:{displayName:to,email:to},sender:{provider:identity.provider,accountId:identity.connectionId,email:identity.email},subject:/^re:/i.test(subject)?subject:'Re: '+subject,body:'',artifacts:[],packageHash:''}};
}
function transaction<T>(ctx:KeyContext,fn:(db:DatabaseSync)=>T):T{const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'));try{db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');const r=fn(db);db.exec('COMMIT');return r;}catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}}
function task(db:DatabaseSync,id:string){const t=db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!t)failure('Approval not found.');const env=JSON.parse(String(t.body));if(env.eaios!=='approval')failure('Not an approval task.');return {t,env};}
function idle(t:Record<string,unknown>){if(t.assignee||t.claim_lock||t.current_run_id||!['todo','triage','ready','blocked'].includes(String(t.status)))failure('Mail approval must remain idle and unassigned.');}
export async function bindReplyApproval(ctx:KeyContext,id:string,input:Record<string,unknown>){
 if(typeof input.connectionId!=='string'||typeof input.messageId!=='string'||typeof input.body!=='string'||!input.body.trim()||input.body.length>100000)failure('Choose the source mailbox, original message and reply text.');
 const bound=await readReplySource(ctx,input.connectionId,input.messageId);bound.package.body=input.body;
 if(input.senderConnectionId!==undefined&&typeof input.senderConnectionId!=='string')failure('Choose a verified sender.');
 if(input.senderConnectionId&&input.senderConnectionId!==bound.identity.connectionId){
  bound.sourceIdentity=bound.identity;bound.identity=await verifyMailbox(ctx,input.senderConnectionId as string);
  bound.package.sender={provider:bound.identity.provider,accountId:bound.identity.connectionId,email:bound.identity.email};
 }
 return transaction(ctx,db=>{const {t,env}=task(db,id);idle(t);if(env.decision||t.body!==input.expectedBody)failure('Approval changed. Reload before preparing the reply.');
  if(!isMailApprovalEnvelope(env))failure('This action is not an email approval.');
  if(env.sourceContext?.subject&&env.sourceContext.subject!==bound.sourceSubject)failure('The source message subject does not match this approval.');
  const next={...env,mailReply:bound,payload:`From: ${bound.package.sender.email}\nTo: ${bound.package.recipient.email}\nSubject: ${bound.package.subject}\n\n${bound.package.body}`};
  db.prepare("UPDATE tasks SET body=?,status='blocked',assignee=NULL WHERE id=?").run(JSON.stringify(next),id);return {ok:true};});
}
export function isMailApprovalEnvelope(env:Record<string,unknown>){return String(env.actionType)==='send'&&/gmail|outlook|microsoft|email|e-mail|smtp/i.test(String(env.targetSystem));}
export interface ReplyProvider {verify:typeof verifyMailbox;send:typeof sendHumanMail;source:typeof readReplySource;}
export async function decideReplyApproval(ctx:KeyContext,id:string,input:Record<string,unknown>,provider:ReplyProvider={verify:verifyMailbox,send:sendHumanMail,source:readReplySource}){
 const claimed=transaction(ctx,db=>{const {t,env}=task(db,id);if(!isMailApprovalEnvelope(env))return null;
  if(input.decision!=='approved')return null;
  idle(t);if(env.decision||t.body!==input.expectedBody)failure('This email changed or was already decided.');
  if(!env.mailReply)failure('Verify the originating mailbox and message before approving this email.');
  const bound=env.mailReply as BoundReply;
  const visible=`From: ${bound.package.sender.email}\nTo: ${bound.package.recipient.email}\nSubject: ${bound.package.subject}\n\n${bound.package.body}`;
  if(env.payload!==visible||bound.package.artifacts.length)failure('Mail content differs from its reviewed package. Prepare it again.');
  const parent=db.prepare("SELECT 1 FROM task_links e JOIN tasks p ON p.id=e.parent_id WHERE e.child_id=? AND p.status NOT IN ('done','archived') LIMIT 1").get(id);
  if(parent)failure('A prerequisite is unfinished.');
  const next={...env,decision:'approved',decidedAt:new Date().toISOString(),mailDelivery:{status:'sending'}};
  db.prepare("UPDATE tasks SET body=?,status='blocked',assignee=NULL WHERE id=?").run(JSON.stringify(next),id);
  db.prepare('INSERT INTO task_events(task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(id,'approval_decided',JSON.stringify({actor:'eaios-executive',decision:'approved',sender:bound.identity.email}),Math.floor(Date.now()/1000));return bound;});
 if(!claimed)return null;let attempted=false;
 try{
  const identity=await provider.verify(ctx,claimed.identity.connectionId);requireReviewedSender(claimed.identity,identity);
  const source=await provider.source(ctx,(claimed.sourceIdentity??claimed.identity).connectionId,claimed.reference.sourceMessageId);
  requireReviewedSender(claimed.sourceIdentity??claimed.identity,source.identity);
  if(source.package.recipient.email!==claimed.package.recipient.email||source.package.subject!==claimed.package.subject||JSON.stringify(source.reference)!==JSON.stringify(claimed.reference))throw new Error('Original message changed');
  attempted=true;const receipt=await provider.send(ctx,claimed.package,identity,[],claimed.sourceIdentity?undefined:claimed.reference);if(!receipt.id)throw new Error('No receipt');
  transaction(ctx,db=>{const {env}=task(db,id);db.prepare("UPDATE tasks SET body=?,status='done',assignee=NULL WHERE id=?").run(JSON.stringify({...env,mailDelivery:{status:'sent',receipt}}),id);});return {ok:true,auditEventId:'mail-'+id};
 }catch{
  const status=attempted?'delivery_uncertain':'send_failed';transaction(ctx,db=>{const {env}=task(db,id);db.prepare("UPDATE tasks SET body=?,status='blocked',assignee=NULL WHERE id=?").run(JSON.stringify({...env,mailDelivery:{status}}),id);});
  return {ok:false,auditEventId:'mail-'+id,error:{code:status,safeMessage:attempted?'Email outcome uncertain. Check Sent mail; no automatic retry.':'The reviewed mailbox could not be verified. Nothing was sent.',retryable:false}};
 }
}

export async function listReplySources(ctx:KeyContext,connectionId:string,subject:string){
 const identity=await verifyMailbox(ctx,connectionId);
 if(subject.length>500)failure('Source subject is too long.');
 let endpoint:string;
 if(identity.provider==='outlook'){
  endpoint='https://graph.microsoft.com/v1.0/me/messages?$top=25&$select=id,subject,from,receivedDateTime'+(subject?'&$filter='+encodeURIComponent("subject eq '"+subject.replaceAll("'","''")+"'"):'&$orderby=receivedDateTime desc');
 }else endpoint='https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q='+encodeURIComponent(subject?'subject:"'+subject.replace(/["\\]/g,' ')+'"':'in:inbox');
 const r=await mailComposioRequest(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:identity.connectionId,endpoint,method:'GET',parameters:[]});
 if(r.status!==200)failure('Could not list source messages in this mailbox.');
 if(identity.provider==='outlook')return (r.data?.value??[]).filter((m:{from?:{emailAddress?:{address?:string}}})=>m.from?.emailAddress?.address?.toLowerCase()!==identity.email.toLowerCase()).map((m:{id:string;subject:string;from:{emailAddress:{address:string}};receivedDateTime:string})=>({id:m.id,subject:m.subject,author:m.from?.emailAddress?.address,receivedAt:m.receivedDateTime}));
 const rows=[];for(const m of r.data?.messages??[]){const source=await readReplySource(ctx,connectionId,String(m.id));rows.push({id:source.reference.sourceMessageId,subject:source.sourceSubject,author:source.sourceAuthor});}return rows;
}
