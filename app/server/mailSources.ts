import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import type {KeyContext} from './apiKeys.ts';
import {mailComposioRequest,verifyMailbox} from './mailRouting.ts';
import {readReplySource} from './mailReplies.ts';
import {HumanDelegationError} from './humanDelegation.ts';
import {parseMailDraft} from '../src/domain/mailDraft.ts';
const subjectKey=(value:string)=>value.trim().toLowerCase().replace(/[–—]/g,'-').replace(/\s+/g,' ');
const fail=(message:string):never=>{throw new HumanDelegationError(409,message);};
async function graph(ctx:KeyContext,connectionId:string,endpoint:string){const r=await mailComposioRequest(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:connectionId,endpoint,method:'GET',parameters:[{name:'Prefer',value:'IdType="ImmutableId"',type:'header'}]});if(r.status!==200)throw new HumanDelegationError(409,'Original Outlook message/history is unavailable. Check the connection and source selection.');return r.data;}
async function pages(ctx:KeyContext,connectionId:string,url:string,limit=10){const rows:any[]=[];for(let page=0;page<limit;page++){const data=await graph(ctx,connectionId,url);if(!Array.isArray(data.value))fail('Unexpected Outlook history response.');rows.push(...data.value);const next=data['@odata.nextLink'];if(!next)return rows;const parsed=new URL(next);if(parsed.origin!=='https://graph.microsoft.com'||!parsed.pathname.startsWith('/v1.0/me/messages'))fail('Unexpected history pagination.');url=next;}return fail('Conversation exceeds the supported history limit. No partial history is presented as complete.');}
export async function outlookHistory(ctx:KeyContext,connectionId:string,messageId:string){
 const identity=await verifyMailbox(ctx,connectionId);if(identity.provider!=='outlook')fail('Choose the original Outlook mailbox.');
 if(!messageId||messageId.length>2048||/[\r\n]/.test(messageId))fail('Choose an original message ID.');
 const original=await graph(ctx,connectionId,'https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(messageId)+'?$select=id,conversationId,internetMessageId,subject,isDraft,from,receivedDateTime');
 if(original.isDraft||!original.id||!original.conversationId||!original.internetMessageId)fail('A received original message with authoritative thread identifiers is required.');
 const rows=await pages(ctx,connectionId,'https://graph.microsoft.com/v1.0/me/messages?$top=100&$select=id,internetMessageId,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,body,hasAttachments,webLink,isDraft&$filter='+encodeURIComponent("conversationId eq '"+String(original.conversationId).replaceAll("'","''")+"'"));
 if(!rows.some(m=>m.id===original.id))fail('The selected original is missing from the returned conversation.');
 let size=0;const messages=[];
 for(const m of rows){if(m.isDraft)continue;if(m.conversationId!==original.conversationId||typeof m.body?.content!=='string')fail('Conversation response is incomplete.');size+=m.body.content.length;if(size>16000000)fail('Conversation exceeds the supported history size. Open the original mailbox to review it.');
  const attachments=m.hasAttachments?await pages(ctx,connectionId,'https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(m.id)+'/attachments?$top=100&$select=id,name,size,contentType,isInline',5):[];
  messages.push({id:m.id,internetMessageId:m.internetMessageId,subject:m.subject,from:m.from?.emailAddress,to:(m.toRecipients??[]).map((r:any)=>r.emailAddress),cc:(m.ccRecipients??[]).map((r:any)=>r.emailAddress),receivedAt:m.receivedDateTime??m.sentDateTime,body:m.body,webLink:m.webLink,attachments:attachments.map((a:any)=>({id:a.id,name:a.name,size:a.size,contentType:a.contentType,isInline:a.isInline}))});
 }
 messages.sort((a,b)=>String(a.receivedAt).localeCompare(String(b.receivedAt)));
 return {identity,reference:{sourceMessageId:original.id,conversationId:original.conversationId,internetMessageId:original.internetMessageId},messages,complete:true};
}
export async function associateOutlookSource(ctx:KeyContext,id:string,input:Record<string,unknown>,provider={history:outlookHistory,source:readReplySource}){
 if(typeof input.connectionId!=='string'||typeof input.messageId!=='string'||typeof input.internetMessageId!=='string'||typeof input.conversationId!=='string')fail('Preview and explicitly confirm the original Outlook message first.');
 const history=await provider.history(ctx,String(input.connectionId),String(input.messageId));
 if(history.reference.internetMessageId!==input.internetMessageId||history.reference.conversationId!==input.conversationId)fail('Original message identity changed. Preview it again.');
 const bound=await provider.source(ctx,String(input.connectionId),String(history.reference.sourceMessageId));
 const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'));try{db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');const row=db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!row)throw new HumanDelegationError(404,'Approval no longer exists.');const env=JSON.parse(String(row.body));
  if(env.eaios!=='approval'||env.targetSystem!=='outlook'||env.actionType!=='send'||env.decision||row.body!==input.expectedBody||row.assignee||row.claim_lock||row.current_run_id||!['todo','triage','ready','blocked'].includes(String(row.status)))fail('Approval changed or is not idle. Reload before associating its source.');
  const outgoing=env.mailDraft??parseMailDraft(env.payload??'');
  if(subjectKey(outgoing.subject)!==subjectKey(bound.package.subject)||!outgoing.to.some((a:string)=>a.toLowerCase()===bound.package.recipient.email.toLowerCase()))fail('Selected source does not match the reviewed reply subject and recipient. Resolve this discrepancy before linking.');
  bound.reference=history.reference;bound.package.body=outgoing.body;
  const next={...env,mailReply:bound,mailSource:{...history.reference,connectionId:history.identity.connectionId,providerUserId:history.identity.providerUserId,verifiedAt:history.identity.verifiedAt}};
  const version=JSON.stringify(next);db.prepare('UPDATE tasks SET body=? WHERE id=?').run(version,id);db.prepare('INSERT INTO task_events(task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(id,'mail_source_verified',JSON.stringify({actor:'eaios-executive',connectionId:history.identity.connectionId,sourceMessageId:history.reference.sourceMessageId}),Math.floor(Date.now()/1000));db.exec('COMMIT');
  return {reviewVersion:version,mailReply:{senderEmail:bound.identity.email,recipientEmail:bound.package.recipient.email,sourceConnectionId:bound.identity.connectionId,sourceMessageId:bound.reference.sourceMessageId,senderConnectionId:bound.identity.connectionId,subject:bound.package.subject,body:outgoing.body}};
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}finally{db.close();}
}
/** Future creators submit provider IDs from the read that produced the draft; this only verifies, never writes a task. */
export async function prepareOutlookEnvelope(ctx:KeyContext,input:Record<string,unknown>){
 const env=input.envelope as Record<string,any>;const source=env?.mailSource;
 if(!env||env.eaios!=='approval'||env.actionType!=='send'||env.targetSystem!=='outlook'||env.decision||!source?.connectionId||!source?.sourceMessageId||!source?.internetMessageId||!source?.conversationId)fail('Outlook reply approvals require the verified source mailbox, immutable message ID, Internet Message-ID and conversation ID from the original read.');
 const history=await outlookHistory(ctx,source.connectionId,source.sourceMessageId);
 if(history.reference.internetMessageId!==source.internetMessageId||history.reference.conversationId!==source.conversationId)fail('Source identifiers do not match the selected Outlook message.');
 const bound=await readReplySource(ctx,source.connectionId,history.reference.sourceMessageId);const outgoing=parseMailDraft(String(env.payload??''));
 if(subjectKey(outgoing.subject)!==subjectKey(bound.package.subject)||!outgoing.to.some(a=>a.toLowerCase()===bound.package.recipient.email.toLowerCase()))fail('The original message does not match this reply subject and recipient.');
 bound.reference=history.reference;bound.package.body=outgoing.body;
 return {envelope:{...env,mailReply:bound,mailSource:{...history.reference,connectionId:history.identity.connectionId,providerUserId:history.identity.providerUserId,verifiedAt:history.identity.verifiedAt}}};
}
