import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { KeyContext } from './apiKeys.ts';
import { verifyMailbox } from './mailRouting.ts';
import { ErmStore } from './ermStore.ts';
import { ErmError } from '../src/domain/erm.ts';
import { addresses, mailDraftPayload, type SavedMailDraft } from '../src/domain/mailDraft.ts';
import { sameMailbox } from '../src/domain/mailRouting.ts';

export interface ErmQuickEmailSource { contactId: string; noteId: string }

function invalid(message:string):never {throw new ErmError(400,'quick_email_invalid',message);}
function allowedRecipient(store:ErmStore,source:ErmQuickEmailSource,email:string) {
 const contact=store.contact(source.contactId);
 store.note(source.contactId,source.noteId);
 const matched=contact.emails.find(a=>a.toLowerCase()===email.toLowerCase());
 if(contact.archived||!matched)invalid('Choose an email address saved on this active contact.');
 return matched!;
}

export function requireCurrentQuickEmailContact(ctx:KeyContext,source:ErmQuickEmailSource,draft:SavedMailDraft) {
 if(draft.replyMode || draft.to.length!==1 || draft.cc.length || draft.bcc.length || draft.bodyType!=='Text')invalid('A quick email must be a new plain-text message to one contact, with no extra recipients.');
 allowedRecipient(new ErmStore(ctx.dataRoot??ctx.eaiosRoot),source,draft.to[0]);
}

/** Queue a local approval only. A read-only provider call verifies the selected mailbox. */
export async function queueErmQuickEmail(ctx:KeyContext,contactId:string,noteId:string,raw:Record<string,unknown>,store=new ErmStore(ctx.dataRoot??ctx.eaiosRoot),verify=verifyMailbox) {
 const {connectionId,to,subject,body,requestId}=raw;
 if(Object.keys(raw).some(k=>!['connectionId','to','subject','body','requestId'].includes(k)))invalid('Quick email does not accept attachments or extra recipients. Note attachments stay private.');
 if(typeof connectionId!=='string'||!/^ca_[\w-]{1,120}$/.test(connectionId))return invalid('Choose a verified Outlook sender.');
 if(typeof requestId!=='string'||!/^[-\w]{1,100}$/.test(requestId))return invalid('Invalid request. Reload and try again.');
 if(typeof subject!=='string'||!subject.trim()||subject.length>300||/[\r\n\u0000]/.test(subject)||typeof body!=='string'||!body.trim()||body.length>12000||body.includes('\0'))return invalid('Enter a subject and message. The message can have up to 12,000 characters.');
 if(typeof to!=='string'||to.length>320||/[\s<>;,]/.test(to))return invalid('Choose one saved recipient address.');
 try { if(addresses(to).length!==1)invalid('Choose one saved recipient address.'); } catch { invalid('Choose one saved recipient address.'); }
 const source={contactId,noteId};
 allowedRecipient(store,source,to);
 const identity=await verify(ctx,connectionId,true).catch(()=>{throw new ErmError(409,'quick_email_mailbox','The selected Outlook sender could not be verified. Reconnect it and try again.');});
 if(identity.provider!=='outlook'||identity.connectionId!==connectionId)invalid('Choose a verified Outlook sender.');
 const recipient=allowedRecipient(store,source,to);
 if(recipient.toLowerCase()===identity.email.toLowerCase())invalid('Choose a recipient different from the sending mailbox.');
 const draft:SavedMailDraft={identity,to:[recipient],cc:[],bcc:[],subject:subject.trim(),body,bodyType:'Text'};
 const approvalId='crm_mail_'+createHash('sha256').update(JSON.stringify([contactId,noteId,requestId])).digest('hex').slice(0,32);
 const env={eaios:'approval',actionType:'send',targetSystem:'outlook',targetObject:draft.subject,risk:'medium',requestedBy:'default',ermQuickEmail:source,mailDraft:draft,payload:mailDraftPayload(draft),evidence:[{kind:'note',label:'E-CRM contact note',uri:'/erm?contact='+encodeURIComponent(contactId)+'&note='+encodeURIComponent(noteId)}]};
 const db=new DatabaseSync(join(ctx.hermesHome,'kanban.db'));
 try {
  db.exec('PRAGMA busy_timeout=5000;BEGIN IMMEDIATE');
  const prior=db.prepare('SELECT body FROM tasks WHERE id=?').get(approvalId);
  if(prior){
   const saved=JSON.parse(String(prior.body));
   if(!saved.ermQuickEmail||saved.payload!==env.payload||!saved.mailDraft||!sameMailbox(saved.mailDraft.identity,identity))throw new ErmError(409,'quick_email_conflict','This request already queued a different draft. Open Approvals before trying again.');
  }else{
   const now=Math.floor(Date.now()/1000);
   db.prepare("INSERT INTO tasks (id,title,body,status,assignee,block_kind,created_by,created_at) VALUES(?,?,?,'blocked',NULL,'needs_input','eaios-executive',?)").run(approvalId,'E-CRM email: '+draft.subject,JSON.stringify(env),now);
   db.prepare('INSERT INTO task_events(task_id,kind,payload,created_at) VALUES(?,?,?,?)').run(approvalId,'approval_requested',JSON.stringify({actor:'eaios-executive',source:'erm-note'}),now);
  }
  db.exec('COMMIT');
  return {approvalId};
 }catch(e){if(db.isTransaction)db.exec('ROLLBACK');throw e;}
 finally{db.close();}
}
