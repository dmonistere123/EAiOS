import {useState} from 'react';
import {mailRouting} from '../adapters';
import type {Approval} from '../domain/types';
import type {MailboxIdentity} from '../domain/mailRouting';
import {refreshApprovals} from '../state/runtime';
export function ReplyMailboxReview({approval,onPrepared}:{approval:Approval;onPrepared:()=>void}){
 const [choices,setChoices]=useState<MailboxIdentity[]>([]),[connection,setConnection]=useState(approval.mailReply?.sourceConnectionId??''),[message,setMessage]=useState(approval.mailReply?.sourceMessageId??'');
 const [messages,setMessages]=useState<{id:string;subject:string;author:string;receivedAt?:string}[]>([]);
 const initial=approval.payload?.split(/\nBody:\s*\n?/i);const [body,setBody]=useState(approval.mailReply?.body??(initial&&initial.length>1?initial.slice(1).join('\n'):approval.payload??''));
 const [sender,setSender]=useState(approval.mailReply?.senderConnectionId??'');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Mailbox verification failed.');}finally{setBusy(false);}}
 const style='mt-1 w-full rounded-lg border border-edge bg-canvas p-2 text-sm text-ink';
 return <section className="space-y-3 rounded-lg border border-warn/40 p-3"><h3 className="text-sm font-semibold">Review email and sending account</h3><p className="text-xs text-ink-dim">Replies default to the original inbox. You can explicitly choose another connected sender below. Switching inboxes sends a new email to the original reply recipient; it cannot use the original mailbox’s reply thread.</p>
 <button disabled={busy} className="text-sm text-signal" onClick={()=>void run(async()=>setChoices((await mailRouting.choices()).flatMap(c=>c.mailbox?[c.mailbox]:[])))}>Find connected mailboxes</button>
 <label className="block text-xs">Original inbox<select className={style} value={connection} onChange={e=>{setConnection(e.target.value);setMessage('');setMessages([]);}}><option value="">Choose mailbox</option>{choices.map(c=><option key={c.connectionId} value={c.connectionId}>{c.email} ({c.provider})</option>)}</select></label>
 <button disabled={busy||!connection} className="text-sm text-signal disabled:opacity-50" onClick={()=>void run(async()=>setMessages(await mailRouting.messages(connection,approval.sourceContext?.subject??'')))}>Find original message</button>
 <label className="block text-xs">Original message<select className={style} value={message} onChange={e=>setMessage(e.target.value)}><option value="">Choose message</option>{approval.mailReply?.sourceMessageId&&connection===approval.mailReply.sourceConnectionId&&<option value={approval.mailReply.sourceMessageId}>Previously verified original message</option>}{messages.map(m=><option key={m.id} value={m.id}>{m.author} — {m.subject}{m.receivedAt?' — '+new Date(m.receivedAt).toLocaleString():''}</option>)}</select></label>
 <label className="block text-xs">Send from<select className={style} value={sender} onChange={e=>setSender(e.target.value)}><option value="">Original inbox (default)</option>{choices.map(c=><option key={c.connectionId} value={c.connectionId}>{c.email}</option>)}</select></label>
 <label className="block text-xs">Reply text (message body only)<textarea className={style} rows={6} value={body} onChange={e=>setBody(e.target.value)}/></label>
 <button disabled={busy||!connection||!message||!body.trim()} className="rounded bg-signal px-3 py-2 text-sm font-semibold text-canvas disabled:opacity-50" onClick={()=>void run(async()=>{await mailRouting.prepareReply(approval.id,{connectionId:connection,messageId:message,senderConnectionId:sender||connection,body,expectedBody:approval.reviewVersion??''});await refreshApprovals();onPrepared();})}>Save verified reply for review</button>
 <p className="text-xs text-ink-faint">This step sends nothing. Reopen the approval to review From, To and the complete reply.</p>{error&&<p role="alert" className="text-xs text-risk">{error}</p>}</section>;
}
