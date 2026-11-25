import {UNSAFE_DataRouterContext,useBlocker} from 'react-router-dom';
import {useContext,useEffect,useRef,useState} from 'react';
import {mailRouting} from '../adapters';
import type {Approval} from '../domain/types';
import {sameMailbox,type MailboxIdentity} from '../domain/mailRouting';
import {parseMailDraft,mailDraftPayload,type MailDraftContent} from '../domain/mailDraft';
function NavigationGuard({dirty}:{dirty:boolean}){const blocker=useBlocker(dirty);return blocker.state==='blocked'?<div role="alertdialog" aria-label="Unsaved email changes" className="rounded border border-warn p-3"><p>Leave this page and discard your unsaved email edits?</p><button onClick={()=>blocker.reset()}>Keep editing</button><button className="ml-4" onClick={()=>blocker.proceed()}>Discard and leave</button></div>:null;}
export function OutlookDraftEditor({approval,onSaved,onBlocked,onDirty}:{approval:Approval;onSaved:(approval:Approval)=>void;onBlocked:(blocked:boolean)=>void;onDirty:(dirty:boolean)=>void}){
 const dataRouter=useContext(UNSAFE_DataRouterContext);
 let initial:MailDraftContent|undefined,initialError='';
 try{initial=approval.mailDraft??parseMailDraft(approval.payload??'');}catch(e){initialError=e instanceof Error?e.message:'Draft content is unavailable.';}
 const [replyMode,setReplyMode]=useState(initial?.replyMode??'');
 const [body,setBody]=useState(initial?.body??''),[bodyType,setBodyType]=useState<'Text'|'HTML'>(initial?.bodyType??'Text');
 const [sender,setSender]=useState(approval.mailDraft?.identity.connectionId??approval.mailReply?.senderConnectionId??'');
 const [choices,setChoices]=useState<MailboxIdentity[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const lock=useRef(false),alive=useRef(true);
 const baselineSender=approval.mailDraft?.identity.connectionId??approval.mailReply?.senderConnectionId??'';
 const currentIdentity=choices.find(c=>c.connectionId===sender);
 const identityChanged=!!(approval.mailDraft&&currentIdentity&&sender===baselineSender&&!sameMailbox(approval.mailDraft.identity,currentIdentity));
 const dirty=replyMode!==(initial?.replyMode??'')||body!==initial?.body||bodyType!==initial?.bodyType||sender!==baselineSender||identityChanged;
 const hasSource=!!(approval.mailReply?.sourceConnectionId&&approval.mailReply?.sourceMessageId);
 const ownsSource=sender===approval.mailReply?.sourceConnectionId;
 const valid=choices.some(c=>c.connectionId===sender&&c.provider==='outlook');
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{setReplyMode(initial?.replyMode??'');setBody(initial?.body??'');setBodyType(initial?.bodyType??'Text');setSender(baselineSender);},[approval.reviewVersion,initial?.body,initial?.bodyType,initial?.replyMode,baselineSender]); // New server revision is authoritative.
 async function load(){setLoading(true);setError('');try{const rows=await mailRouting.outlookChoices();if(!alive.current)return;setChoices(rows.flatMap(row=>row.mailbox?.provider==='outlook'?[row.mailbox]:[]));if(rows.some(row=>row.error))setError('Some Outlook accounts could not be verified. Check Connections and refresh accounts.');}catch{if(alive.current){setChoices([]);setError('Outlook accounts could not be loaded. Check Connections and refresh accounts.');}}finally{if(alive.current)setLoading(false);}}
 useEffect(()=>{void load();},[approval.id]);
 useEffect(()=>{onDirty(dirty||saving);},[dirty,saving,onDirty]);
 useEffect(()=>{onBlocked(loading||saving||dirty||!valid||!approval.mailDraft||!hasSource||!ownsSource||!!initialError);},[loading,saving,dirty,valid,approval.mailDraft,hasSource,ownsSource,initialError,onBlocked]);
 useEffect(()=>{if(!dirty)return;const handler=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
 const style='mt-1 w-full rounded-lg border border-edge bg-canvas p-2 text-sm text-ink';
 async function save(){if(lock.current||!valid||!initial||!hasSource||!ownsSource)return;lock.current=true;setSaving(true);setError('');setNotice('');try{
  const result=await mailRouting.saveOutlookDraft(approval.id,{connectionId:sender,body,bodyType,...(replyMode?{replyMode:replyMode as 'reply'|'replyAll'}:{}),expectedBody:approval.reviewVersion??''});
  if(alive.current){onSaved({...approval,mailDraft:result.draft,payload:mailDraftPayload(result.draft),reviewVersion:result.reviewVersion});setNotice('Saved. Review the message, then Approve & send. No email has been sent.');}
 }catch(e){if(alive.current)setError(e instanceof Error?e.message:'Save failed. Your edits are still here; nothing was sent.');}finally{lock.current=false;if(alive.current)setSaving(false);}}
 return <section aria-label="Outlook email draft" className="space-y-3 rounded-lg border border-edge p-3">
 <h3 className="text-sm font-semibold">Outgoing reply</h3>
 <label className="block text-sm font-semibold">Reply recipients<select className={style} value={replyMode} disabled={saving} onChange={e=>{setReplyMode(e.target.value);setNotice('');}}><option value="">Keep saved recipients</option><option value="reply">Reply — sender only</option><option value="replyAll">Reply All — sender and original To/Cc</option></select></label>
 <p className="text-xs text-ink-dim">Reply All includes the original visible recipients, excluding your mailbox and duplicates. Save to verify and review the exact To/Cc before approving.</p>
 {replyMode!==(initial?.replyMode??'')&&<p role="status" className="text-xs text-warn">Recipient choice changed. The addresses below are the previously saved recipients until you save.</p>}
 {dataRouter&&<NavigationGuard dirty={dirty||saving}/>}
 {!hasSource&&<p role="alert" className="text-sm text-warn">The original email identifiers are missing. Verify the original mailbox and message before saving or sending. Your existing email context is preserved; this reply will not be sent as a new email.</p>}
 {hasSource&&sender&&!ownsSource&&<p role="alert" className="text-sm text-warn">Choose the Outlook account that owns the original conversation to preserve its reply thread.</p>}
 {initialError?<p role="alert" className="text-sm text-risk">{initialError}</p>:<>
 <div className="break-words text-xs text-ink-dim"><p>To: {initial?.to.join(', ')}</p>{!!initial?.cc.length&&<p>Cc: {initial.cc.join(', ')}</p>}{!!initial?.bcc.length&&<p>Bcc: {initial.bcc.join(', ')}</p>}<p>Subject: {initial?.subject}</p></div>
 <p className="text-sm text-ink-dim">Choose the actual sender in the From dropdown. Changing an address in the message body does not change who sends it.</p>
 <label className="block text-sm font-semibold text-signal">From<select className={style} value={sender} disabled={saving||loading} onChange={e=>{setSender(e.target.value);setNotice('');}}><option value="">Choose a connected Outlook account</option>{sender&&!valid&&<option value={sender} disabled>Previously selected account unavailable — refresh or choose another</option>}{choices.map(c=><option key={c.connectionId} value={c.connectionId}>{c.email}</option>)}</select></label>
 <button className="text-xs text-signal" disabled={saving||loading} onClick={()=>void load()}>Refresh Outlook accounts</button>
 {!loading&&!!choices.length&&<p className="text-xs text-ink-dim">{choices.length} verified Outlook {choices.length===1?'account available':'accounts available'}. Open the From dropdown to see the choices. A threaded reply must use the account that owns the original conversation.</p>}
 {identityChanged&&<p role="alert" className="text-sm text-warn">This connection now identifies a different mailbox. Review From and save a fresh revision before sending.</p>}
 {!loading&&!choices.length&&<p role="status" className="text-sm text-warn">No verified Outlook accounts can send. Connect Outlook with mail sending permissions in Connections.</p>}
 <label className="block text-sm">Body format<select className={style} value={bodyType} disabled={saving} onChange={e=>setBodyType(e.target.value as 'Text'|'HTML')}><option value="Text">Plain text</option><option value="HTML">HTML source</option></select></label>
 <label className="block text-sm">Message body<textarea className={style} rows={10} value={body} disabled={saving} onChange={e=>{setBody(e.target.value);setNotice('');}}/></label>
 {bodyType==='HTML'&&<p className="text-xs text-ink-dim">Edit HTML source. It is saved and sent as HTML; this editor does not execute it or load embedded images.</p>}
 <div className="flex flex-wrap gap-3"><button className="rounded bg-signal px-3 py-2 text-sm font-semibold text-canvas disabled:opacity-50" disabled={saving||loading||!valid||!body.trim()||!hasSource||!ownsSource} onClick={()=>void save()}>{saving?'Saving…':'Save draft'}</button>{dirty&&<button className="text-sm text-signal" disabled={saving} onClick={()=>{setReplyMode(initial?.replyMode??'');setBody(initial?.body??'');setBodyType(initial?.bodyType??'Text');setSender(baselineSender);setError('');}}>Discard edits</button>}</div>
 {dirty&&<p role="status" className="text-sm text-warn">Unsaved changes — save before approving and sending.</p>}
 <p className="text-xs text-ink-dim">Original thread references and quoted reply history are retained. The saved recipient choice is retained when editing or reopening. Saving sends nothing.</p>
 </>}
 {notice&&<p role="status" className="text-sm text-ok">{notice}</p>}{error&&<p role="alert" className="text-sm text-risk">{error}</p>}
 </section>;
}
