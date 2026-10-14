import { randomUUID } from 'node:crypto';
import type { KeyContext } from './apiKeys.ts';
import type { HumanDelegationPackage } from '../src/domain/humanDelegation.ts';
import type { MailboxIdentity } from '../src/domain/mailRouting.ts';
import type { MailAttachment } from './humanApproval.ts';
import { mailComposioRequest } from './mailRouting.ts';
const encoded=(text:string)=>'=?UTF-8?B?'+Buffer.from(text).toString('base64')+'?=';
const base64=(data:Buffer)=>data.toString('base64').match(/.{1,76}/g)?.join('\r\n')??'';
export interface MailReplyReference {sourceMessageId:string;threadId?:string;inReplyTo?:string;}
export function mailMime(pkg:HumanDelegationPackage,files:MailAttachment[],reply?:MailReplyReference):string {
 const boundary='eaios-'+randomUUID();
 const parts=[`From: ${pkg.sender.email}`,`To: ${pkg.recipient.email}`,`Subject: ${encoded(pkg.subject)}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',`--${boundary}`,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',base64(Buffer.from(pkg.body))];
 for(const f of files){const filename=f.filename.replace(/[\r\n"\\]/g,'_');const mime=/^[\w.+-]+\/[\w.+-]+$/.test(f.mimeType)?f.mimeType:'application/octet-stream';parts.push(`--${boundary}`,`Content-Type: ${mime}`,`Content-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,'Content-Transfer-Encoding: base64','',base64(f.data));}
 if(reply?.inReplyTo){if(/[\r\n]/.test(reply.inReplyTo))throw new Error('Invalid reply header');parts.unshift('In-Reply-To: '+reply.inReplyTo,'References: '+reply.inReplyTo);}
 parts.push(`--${boundary}--`,'');return parts.join('\r\n');
}
/** Called only after an atomic executive approval claim. No automatic retry. */
export async function sendHumanMail(ctx:KeyContext,pkg:HumanDelegationPackage,identity:MailboxIdentity,files:MailAttachment[],reply?:MailReplyReference):Promise<{id:string;provider:string}> {
 if(pkg.sender.accountId!==identity.connectionId||pkg.sender.provider!==identity.provider||pkg.sender.email.toLowerCase()!==identity.email.toLowerCase())throw new Error('Mailbox mismatch');
 const proxy=async(endpoint:string,method:string,body?:unknown)=>{
  const result=await mailComposioRequest(ctx,'/api/v3.1/tools/execute/proxy',{connected_account_id:identity.connectionId,endpoint,method,parameters:identity.provider==='outlook'?[{name:'Prefer',value:'IdType="ImmutableId"',type:'header'}]:[],...(body===undefined?{}:{body})});
  if(typeof result.status!=='number'||result.status<200||result.status>=300)throw new Error('Mail provider did not confirm the request');return result;
 };
 if(identity.provider==='gmail'){
  const sent=await proxy('https://gmail.googleapis.com/gmail/v1/users/me/messages/send','POST',{raw:Buffer.from(mailMime(pkg,files,reply)).toString('base64url'),...(reply?.threadId?{threadId:reply.threadId}:{})});
  if(typeof sent.data?.id!=='string'||!sent.data.id)throw new Error('Gmail did not return a receipt');return {id:sent.data.id,provider:'gmail'};
 }
 const message={subject:pkg.subject,body:{contentType:'Text',content:pkg.body},toRecipients:[{emailAddress:{address:pkg.recipient.email,name:pkg.recipient.displayName}}],attachments:files.map(f=>({'@odata.type':'#microsoft.graph.fileAttachment',name:f.filename,contentType:f.mimeType,contentBytes:f.data.toString('base64')}))};
 const draft=reply?await proxy('https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(reply.sourceMessageId)+'/createReply','POST'):await proxy('https://graph.microsoft.com/v1.0/me/messages','POST',message);
 const id=draft.data?.id;if(typeof id!=='string'||!id||draft.data?.isDraft!==true)throw new Error('Outlook draft receipt missing');
 if(reply){
  const {attachments,...content}=message;
  if(attachments.length)throw new Error('Reply attachments are not enabled');
  await proxy('https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(id),'PATCH',content);
 }
 await proxy('https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(id)+'/send','POST');
 // Outlook's accepted send is asynchronous. Retry only receipt reads, never the send.
 for(let attempt=0;attempt<4;attempt++){
  if(attempt)await new Promise(resolve=>setTimeout(resolve,1000));
  try{
   const sent=await proxy('https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(id)+'?$select=id,isDraft,sentDateTime,from','GET');
   if(sent.data?.isDraft===false&&sent.data?.sentDateTime&&sent.data?.from?.emailAddress?.address?.toLowerCase()===identity.email.toLowerCase())return {id,provider:'outlook'};
  }catch{/* A transient receipt lookup failure must never cause another send. */}
 }
 throw new Error('Outlook has not confirmed sending');
}
