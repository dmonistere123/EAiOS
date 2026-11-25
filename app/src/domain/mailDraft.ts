import type { MailboxIdentity } from './mailRouting.ts';
export type ReplyMode = 'reply' | 'replyAll';
export interface MailDraftContent { replyMode?:ReplyMode; to:string[]; cc:string[]; bcc:string[]; subject:string; body:string; bodyType:'Text'|'HTML'; }
export interface SavedMailDraft extends MailDraftContent { identity:MailboxIdentity; }
export function addresses(value:string):string[] {
 if(!value.trim())return [];
 return value.split(/[,;]/).map(part=>{
  const address=(part.trim().match(/^[^<>]*<([^<>]+)>$/)?.[1]??part.trim());
  if(!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(address))throw new Error('Recipient addresses need review. Use complete email addresses.');
  return address;
 });
}
/** Parse only explicit mail headers; never infer recipients, senders or provider draft IDs. */
export function parseMailDraft(payload:string):MailDraftContent {
 const lines=payload.replace(/\r\n/g,'\n').split('\n'),headers:Record<string,string>={};let i=0;
 for(;i<lines.length;i++){
  if(!lines[i].trim()){i++;break;}
  const match=lines[i].match(/^(To|Cc|Bcc|From|Subject|Body):\s*(.*)$/i);
  if(!match)throw new Error('This approval lacks a complete To/Subject/body draft. Ask the requesting agent to prepare the full message; a draft ID alone cannot be sent.');
  const key=match[1].toLowerCase();if(key==='body'){if(match[2])lines[i]=match[2];else i++;break;}
  if(key in headers)throw new Error('Duplicate email headers need review.');headers[key]=match[2];
 }
 const to=addresses(headers.to??'');if(!to.length||!headers.subject?.trim())throw new Error('This approval needs explicit To and Subject fields before it can be saved.');
 const body=lines.slice(i).join('\n');
 return {to,cc:addresses(headers.cc??''),bcc:addresses(headers.bcc??''),subject:headers.subject,body,bodyType:/^\s*<(?:html|p|div|table|!doctype)\b/i.test(body)?'HTML':'Text'};
}
export function mailDraftPayload(d:SavedMailDraft):string {
 return `From: ${d.identity.email}\nTo: ${d.to.join(', ')}\n${d.cc.length?'Cc: '+d.cc.join(', ')+'\n':''}${d.bcc.length?'Bcc: '+d.bcc.join(', ')+'\n':''}Subject: ${d.subject}\nBody format: ${d.bodyType}\n\n${d.body}`;
}
