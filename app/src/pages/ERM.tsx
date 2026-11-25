import { useEffect,useMemo,useRef,useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link,useSearchParams } from 'react-router-dom';
import { erm } from '../adapters';
import {mailRouting} from '../adapters/mailRouting';
import type {ErmAttachment} from '../adapters/erm';
import { AGENT_NAME } from '../config';
import { usePageRail } from '../state/rail';
import { emptyErmContact,ERM_FIELDS } from '../domain/erm';
import type { ErmContact,ErmContactInput,ErmNote,ErmNoteInput,ErmPage,ErmStatus,ErmJob,ErmCsvMapping,ErmImportPreview,ErmAccount,ErmClaim } from '../domain/erm';
import './erm.css';
const date=(s:string)=>new Date(s).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
const message=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';
const blankNotes:ErmPage<ErmNote>={items:[],total:0,hasMore:false,nextCursor:null};
function Modal({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;d?.showModal();return()=>d?.close();},[]);
 return createPortal(<dialog ref={ref} className="erm-dialog erm" aria-labelledby="erm-dialog-title" onCancel={e=>{e.preventDefault();onClose();}}>
  <header><h2 id="erm-dialog-title">{title}</h2><button aria-label="Close dialog" onClick={onClose}>✕</button></header><div className="erm-dialog-body">{children}</div>
 </dialog>,document.body);
}
function Field({label,value,onChange,required=false,type='text'}:{label:string;value:string;onChange:(v:string)=>void;required?:boolean;type?:string}){return <label>{label}<input type={type} value={value} onChange={e=>onChange(e.target.value)} required={required}/></label>;}
export function ContactEditor({existing,initial,save,onClose,onSaved}:{initial?:ErmContactInput;save?:(p:ErmContactInput)=>Promise<ErmContact>;existing?:ErmContact;onClose:()=>void;onSaved:(p:ErmContact)=>void}){
 const [draft,setDraft]=useState<ErmContactInput>(()=>existing?structuredClone(existing):initial?structuredClone(initial):emptyErmContact());
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const requestId=useRef(crypto.randomUUID());
 const [tagsText,setTagsText]=useState(draft.tags.join(', '));
 const set=(key:keyof ErmContactInput,value:unknown)=>setDraft(p=>({...p,[key]:value}));
 return <Modal title={existing?'Edit contact':'Add a customer relationship'} onClose={()=>{if(!busy)onClose();}}><form onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try{onSaved(await (save??((p:ErmContactInput)=>erm.saveContact(p,requestId.current,existing)))({...draft,tags:tagsText.split(',').map(v=>v.trim()).filter(Boolean),emails:draft.emails.filter(Boolean),phones:draft.phones.filter(p=>p.value.trim())}));}catch(e){setError(message(e));}finally{setBusy(false);}}}>
 <div className="erm-grid"><Field label="Full name" value={draft.name} required onChange={v=>set('name',v)}/><Field label="Company" value={draft.company} onChange={v=>set('company',v)}/><Field label="Job title" value={draft.title} onChange={v=>set('title',v)}/><label>Relationship<select value={draft.category} onChange={e=>set('category',e.target.value)}>{['Customer','Prospect','Partner','Other'].map(v=><option key={v}>{v}</option>)}</select></label></div>
 <h3>Email addresses</h3>{draft.emails.map((v,i)=><div className="erm-inline" key={i}><Field label={`Email ${i+1}`} type="email" value={v} onChange={v=>set('emails',draft.emails.map((x,j)=>j===i?v:x))}/><button type="button" aria-label={`Remove email ${i+1}`} onClick={()=>set('emails',draft.emails.filter((_,j)=>j!==i))}>Remove</button></div>)}<button type="button" disabled={draft.emails.length>=10} onClick={()=>set('emails',[...draft.emails,''])}>+ Email</button>
 <h3>Phone numbers</h3>{draft.phones.map((p,i)=><div className="erm-inline" key={i}><Field label="Phone label" value={p.label} onChange={v=>set('phones',draft.phones.map((x,j)=>j===i?{...x,label:v}:x))}/><Field label="Phone number" value={p.value} type="tel" onChange={v=>set('phones',draft.phones.map((x,j)=>j===i?{...x,value:v}:x))}/><button type="button" aria-label={`Remove phone ${i+1}`} onClick={()=>set('phones',draft.phones.filter((_,j)=>j!==i))}>Remove</button></div>)}<button type="button" disabled={draft.phones.length>=10} onClick={()=>set('phones',[...draft.phones,{label:'Mobile',value:''}])}>+ Phone</button>
 <h3>Addresses</h3>{draft.addresses.map((a,i)=><fieldset key={i}><div className="erm-grid">{(['label','street','line2','city','region','postal','country'] as const).map(key=><Field key={key} label={{label:'Address label',street:'Street',line2:'Suite / address line 2',city:'City',region:'State / region',postal:'ZIP / postal code',country:'Country'}[key]} value={a[key]} onChange={v=>set('addresses',draft.addresses.map((x,j)=>i===j?{...x,[key]:v}:x))}/>)}</div><button type="button" onClick={()=>set('addresses',draft.addresses.filter((_,j)=>j!==i))}>Remove address</button></fieldset>)}<button type="button" disabled={draft.addresses.length>=5} onClick={()=>set('addresses',[...draft.addresses,{label:'Work',street:'',line2:'',city:'',region:'',postal:'',country:''}])}>+ Address</button>
 <div className="erm-grid erm-spaced"><Field label="Website (https://…)" type="url" value={draft.website} onChange={v=>set('website',v)}/><Field label="Preferred contact method" value={draft.preferred} onChange={v=>set('preferred',v)}/><Field label="Tags (comma separated)" value={tagsText} onChange={setTagsText}/></div>
 {error&&<p role="alert" className="erm-error">{error}</p>}<footer><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save contact'}</button></footer></form></Modal>;
}
function NoteDialog({contact,note,onClose,onSaved}:{contact:ErmContact;note?:ErmNote;onClose:()=>void;onSaved:()=>void}){
 const contactId=contact.id;
 const [current,setCurrent]=useState(note),[editing,setEditing]=useState(!note),[draft,setDraft]=useState<ErmNoteInput>(note??{title:'',body:'',includeInAI:true,followUpOn:null});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[attachmentError,setAttachmentError]=useState('');
 const [files,setFiles]=useState<{file:File;id:string}[]>([]),[attachments,setAttachments]=useState<ErmAttachment[]>([]);
 const [composing,setComposing]=useState(false),[approvalId,setApprovalId]=useState(''),[senders,setSenders]=useState<{connectionId:string;mailbox?:{email:string};error?:string}[]>([]);
 const [from,setFrom]=useState(''),[to,setTo]=useState(contact.emails[0]??''),[subject,setSubject]=useState(''),[emailBody,setEmailBody]=useState('');
 const requestId=useRef(crypto.randomUUID()),emailId=useRef(crypto.randomUUID()),dirty=useRef(false),savedWithoutFiles=useRef(false);
 const close=()=>{if(!busy)(dirty.current?onSaved:onClose)();};
 const noteId=current?.id;
 useEffect(()=>{if(!noteId)return;let active=true;void erm.noteAttachments(contactId,noteId).then(items=>{if(active)setAttachments(previous=>[...items,...previous.filter(p=>!items.some(i=>i.id===p.id))]);}).catch(e=>{if(active)setAttachmentError(message(e));});return()=>{active=false;};},[contactId,noteId]);
 async function beginEmail(){
  setComposing(true);setError('');setBusy(true);
  try{const available=(await mailRouting.outlookChoices()).filter(s=>s.mailbox&&!s.error);setSenders(available);if(available.length===1)setFrom(available[0].connectionId);if(!available.length)setError('No verified Outlook sending account is available.');}
  catch(e){setError(message(e));}finally{setBusy(false);}
 }
 async function save(draftEmail=false){
  setBusy(true);setError('');
  try{
   const saved=savedWithoutFiles.current&&current?current:await erm.saveNote(contactId,draft,requestId.current,current);
   dirty.current=true;setCurrent(saved);setDraft(saved);savedWithoutFiles.current=true;
   for(const entry of files){
    const a=await erm.uploadNoteAttachment(contactId,saved.id,entry.file,entry.id);
    setAttachments(items=>items.some(x=>x.id===a.id)?items:[...items,a]);setFiles(items=>items.filter(x=>x.id!==entry.id));
   }
   savedWithoutFiles.current=false;setEditing(false);
   if(draftEmail)await beginEmail();
  }catch(e){setError((savedWithoutFiles.current?'The note was saved. ':'')+message(e));}finally{setBusy(false);}
 }
 async function completeFollowUp(){
  if(!current)return;setBusy(true);setError('');
  try{const saved=await erm.saveNote(contactId,{...current,followUpOn:null},crypto.randomUUID(),current);setCurrent(saved);setDraft(saved);dirty.current=true;}
  catch(e){setError(message(e));}finally{setBusy(false);}
 }
 return <Modal title={editing?(note?'Edit note':'Add a note'):current!.title} onClose={close}>
 {current&&<p className="erm-muted">Created {date(current.createdAt)}{current.version>1&&` · Updated ${date(current.updatedAt)}`} · {current.includeInAI?'Included in AI review':'Private to your record; excluded from AI'}</p>}
 {editing?<form onSubmit={e=>{e.preventDefault();void save((e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')==='quick-email');}}>
 <Field label="Note title" value={draft.title} required onChange={title=>{savedWithoutFiles.current=false;setDraft(d=>({...d,title}));}}/>
 <label className="erm-spaced">Your notes<textarea className="erm-long-note" value={draft.body} required maxLength={50000} onChange={e=>{savedWithoutFiles.current=false;setDraft(d=>({...d,body:e.target.value}));}}/></label>
 <Field label="Follow up on (optional)" type="date" value={draft.followUpOn??''} onChange={value=>{savedWithoutFiles.current=false;setDraft(d=>({...d,followUpOn:value||null}));}}/>
 <p className="erm-muted">Due and overdue follow-ups appear in Today until marked done or rescheduled.</p>
 <label>Note attachments<input type="file" multiple disabled={busy} onChange={e=>{
  const picked=Array.from(e.target.files??[]);e.target.value='';
  if(picked.some(f=>!f.size||f.size>10*1024*1024)||attachments.length+files.length+picked.length>5){setError('Choose up to five non-empty files per note, each 10 MB or smaller.');return;}
  setError('');setFiles(items=>[...items,...picked.map(file=>({file,id:crypto.randomUUID()}))]);
 }}/></label>
 {files.map(f=><p key={f.id}>{f.file.name} <button type="button" disabled={busy} onClick={()=>setFiles(v=>v.filter(x=>x.id!==f.id))}>Remove pending file</button></p>)}
 <label className="erm-check"><input type="checkbox" checked={draft.includeInAI} onChange={e=>{savedWithoutFiles.current=false;setDraft(d=>({...d,includeInAI:e.target.checked}));}}/>Allow {AGENT_NAME} to use this note for this customer’s AI review</label>
 <footer><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy?'Saving…':'Save note'}</button>{!!contact.emails.length&&<button value="quick-email" disabled={busy}>Save note & draft email</button>}</footer>
 </form>:<><div className="erm-note-reader">{current!.body}</div>
 {current!.followUpOn&&<p>Follow-up: <strong>{current!.followUpOn}</strong> <button disabled={busy} onClick={()=>void completeFollowUp()}>Mark follow-up done</button></p>}
 {!composing&&<footer><button onClick={close}>Back to contact</button><button className="primary" onClick={()=>{setEditing(true);setError('');}}>Edit note</button><button onClick={()=>void beginEmail()} disabled={busy||!contact.emails.length}>Draft quick email</button></footer>}
 {!contact.emails.length&&<p className="erm-muted">Add an email address to this contact to draft a quick email.</p>}</>}
 {!!attachments.length&&<div><h3>Attachments</h3><ul>{attachments.map(a=><li key={a.id}><a href={erm.noteAttachmentUrl(contactId,current!.id,a.id)} download={a.name}>{a.name}</a> <small>{Math.ceil(a.size/1024)} KB</small></li>)}</ul></div>}
 {attachmentError&&<p className="erm-muted" role="status">Attachments could not load: {attachmentError}</p>}
 {composing&&current&&<section><h3>Quick email</h3><p className="erm-muted">This creates a draft in Approvals. The note and its attachments are not sent or attached automatically.</p>
 {approvalId?<p role="status">Draft queued. <Link to={`/approvals?focus=${encodeURIComponent(approvalId)}`}>Review in Approvals</Link></p>:<form onSubmit={async e=>{
  e.preventDefault();setBusy(true);setError('');
  try{const result=await erm.queueQuickEmail(contactId,current.id,{connectionId:from,to,subject,body:emailBody,requestId:emailId.current});setApprovalId(result.approvalId);}
  catch(e){setError(message(e));}finally{setBusy(false);}
 }}>
 <label>From<select value={from} required onChange={e=>setFrom(e.target.value)}><option value="">Choose a verified Outlook mailbox</option>{senders.map(s=><option key={s.connectionId} value={s.connectionId}>{s.mailbox?.email}</option>)}</select></label>
 <label>To<select value={to} required onChange={e=>setTo(e.target.value)}>{contact.emails.map(a=><option key={a}>{a}</option>)}</select></label>
 <Field label="Subject" value={subject} required onChange={setSubject}/>
 <label>Message<textarea value={emailBody} rows={6} maxLength={12000} required onChange={e=>setEmailBody(e.target.value)}/></label>
 <footer><button type="button" disabled={busy} onClick={()=>{setComposing(false);setError('');}}>Back to note</button><button className="primary" disabled={busy||!from||!to||!subject.trim()||!emailBody.trim()}>Queue for approval</button></footer>
 </form>}</section>}
 {error&&<p className="erm-error" role="alert">{error}</p>}
 </Modal>;
}
function ImportDialog({onClose,onImported}:{onClose:()=>void;onImported:()=>void}){
 const [text,setText]=useState(''),[headers,setHeaders]=useState<string[]>([]),[mapping,setMapping]=useState<ErmCsvMapping>({}),[preview,setPreview]=useState<ErmImportPreview|null>(null),[selected,setSelected]=useState<string[]>([]),[accounts,setAccounts]=useState<ErmAccount[]>([]),[account,setAccount]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState('');
 const requestId=useRef(crypto.randomUUID());
 const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(e){setError(message(e));}finally{setBusy(false);}};
 const show=(p:ErmImportPreview)=>{setPreview(p);setSelected([]);requestId.current=crypto.randomUUID();setReceipt('');};
 return <Modal title="Import contacts — review before adding" onClose={()=>{if(!busy)onClose();}}>
 <p className="erm-muted">Your E-CRM contacts are independent. Imports never overwrite your edits or merge people automatically.</p>
 {!preview?<><h3>From a CSV file</h3><p className="erm-muted">Up to 500 rows / 1 MB. Include a full-name column.</p><label>Choose CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void run(async()=>{if(file.size>1000000)throw new Error('Choose a CSV smaller than 1 MB.');const t=await file.text(),r=await erm.csvColumns(t);setText(t);setHeaders(r.headers);setMapping(r.mapping);});}}/></label>
 {headers.length>0&&<><div className="erm-grid erm-spaced">{ERM_FIELDS.map(f=><label key={f}>{{name:'Full name (required)',company:'Company',title:'Job title',email:'Primary email',email2:'Additional email',mobile:'Mobile phone',workPhone:'Work phone',homePhone:'Home phone',street:'Street',line2:'Address line 2',city:'City',region:'State / region',postal:'ZIP / postal code',country:'Country',website:'Website',preferred:'Preferred contact method'}[f]}<select value={mapping[f]??''} onChange={e=>setMapping(m=>{const next={...m};if(e.target.value)next[f]=e.target.value;else delete next[f];return next;})}><option value="">Do not import</option>{headers.map(h=><option key={h}>{h}</option>)}</select></label>)}</div><button disabled={busy||!mapping.name} className="primary" onClick={()=>void run(async()=>show(await erm.csvPreview(text,mapping)))}>Review CSV contacts</button></>}
 <hr/><h3>From Outlook</h3><p className="erm-muted">Choose a connected account, then select contacts from its default Contacts folder. Outlook import needs contact-read access in addition to email access.</p>
 <button disabled={busy} onClick={()=>void run(async()=>{const a=await erm.accounts();setAccounts(a);if(!a.length)setError('No Outlook accounts are connected. You can still add contacts manually or import CSV.');})}>Choose Outlook account</button>
 {accounts.length>0&&<><label>Account<select value={account} onChange={e=>setAccount(e.target.value)}><option value="">Select an account</option>{accounts.map(a=><option key={a.connectionId} value={a.connectionId} disabled={!!a.error}>{a.email??a.error??'Unavailable account'}</option>)}</select></label><button disabled={busy||!account} onClick={()=>void run(async()=>show(await erm.outlookPreview(account)))}>Review Outlook contacts</button></>}
 </>:<><p>{preview.items.length} source rows · Select the people to add.</p><button disabled={busy||!!receipt} onClick={()=>setSelected([...new Set(preview.items.filter(i=>i.contact&&!i.error&&!i.existingId&&!i.possibleDuplicate).map(i=>i.id))])}>Select new contacts without warnings</button>
 <div className="erm-import-list">{preview.items.map((c,i)=><label key={c.id+':'+i} className="erm-import-row"><input type="checkbox" disabled={busy||!!receipt||!c.contact||!!c.error||!!c.existingId} checked={selected.includes(c.id)} onChange={e=>setSelected(ids=>e.target.checked?[...new Set([...ids,c.id])]:ids.filter(id=>id!==c.id))}/><span><strong>{c.contact?.name??`Row ${i+1}`}</strong><small>{c.contact?.company} {c.contact?.emails.join(' · ')}</small>{(c.error||c.existingId||c.possibleDuplicate)&&<small className="erm-warning">{c.error??(c.existingId?'Previously imported — your existing record will be preserved':`May match ${c.possibleDuplicate}. Selecting this creates a separate record.`)}</small>}</span></label>)}</div>
 {receipt?<p role="status">{receipt}</p>:<button className="primary" disabled={busy||!selected.length} onClick={()=>void run(async()=>{const r=await erm.importContacts(preview.id,selected,requestId.current);setReceipt(`${r.imported} added · ${r.skipped} already imported`);onImported();})}>{busy?'Importing…':`Import ${selected.length} selected`}</button>}
 <footer><button disabled={busy} onClick={()=>{setPreview(null);setReceipt('');}}>Back to sources</button>{preview.nextCursor&&<button disabled={busy||(!receipt&&selected.length>0)} onClick={()=>void run(async()=>show(await erm.outlookPreview(account,preview.nextCursor)))}>Next Outlook page</button>}<button disabled={busy} onClick={onClose}>Done</button></footer></>}
 {busy&&<p role="status">Working…</p>}{error&&<p role="alert" className="erm-error">{error}</p>}
 </Modal>;
}
function Claims({claims,onNote}:{claims:ErmClaim[];onNote:(id:string)=>void}){return <div>{claims.map((c,i)=><article className="erm-claim" key={i}><span className="erm-kicker">{c.kind==='suggestion'?'Suggested next step':'AI interpretation'}</span><p>{c.text}</p>{c.evidence.map((e,j)=><button className="erm-source" key={j} onClick={()=>onNote(e.noteId)} title={e.quote}>Note {j+1}: “{e.quote.slice(0,95)}{e.quote.length>95?'…':''}”</button>)}</article>)}</div>;}
export default function ERM(){
 const [params,setParams]=useSearchParams(),id=params.get('contact')??'',linkedNote=params.get('note')??'';
 const [query,setQuery]=useState(''),[archived,setArchived]=useState(false),[directory,setDirectory]=useState<ErmPage<ErmContact>>({items:[],total:0,hasMore:false,nextCursor:null}),[contact,setContact]=useState<ErmContact|null>(null),[notes,setNotes]=useState(blankNotes),[review,setReview]=useState<ErmJob|null>(null),[status,setStatus]=useState<ErmStatus|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0),[editor,setEditor]=useState<'new'|'edit'|null>(null),[noteEditor,setNoteEditor]=useState<ErmNote|'new'|null>(null),[importing,setImporting]=useState(false),[question,setQuestion]=useState(''),[job,setJob]=useState<ErmJob|null>(null),[aiBusy,setAiBusy]=useState(false),[history,setHistory]=useState(false);
 const currentId=useRef(id);
 useEffect(()=>{currentId.current=id;},[id]);
 const select=(id:string)=>{setParams({contact:id});setNoteEditor(null);setHistory(false);};
 useEffect(()=>{void erm.status().then(setStatus).catch(e=>setError(message(e)));},[]);
 useEffect(()=>{const c=new AbortController();const timer=setTimeout(()=>{void erm.contacts(query,null,archived,c.signal).then(setDirectory).catch(e=>{if(!c.signal.aborted)setError(message(e));});},180);return()=>{clearTimeout(timer);c.abort();};},[query,archived,revision]);
 useEffect(()=>{const c=new AbortController();setContact(null);setNoteEditor(null);setEditor(null);setHistory(false);setNotes(blankNotes);setReview(null);setJob(null);setQuestion('');setError('');setAiBusy(false);if(!id)return()=>c.abort();setLoading(true);void Promise.all([erm.contact(id,c.signal),erm.notes(id,null,c.signal),erm.review(id,c.signal)]).then(([p,n,r])=>{if(c.signal.aborted)return;setContact(p);setNotes(n);setReview(r);}).catch(e=>{if(!c.signal.aborted)setError(message(e));}).finally(()=>{if(!c.signal.aborted)setLoading(false);});return()=>c.abort();},[id,revision]);
 useEffect(()=>{if(!job||!['queued','running'].includes(job.status))return;const c=new AbortController();const timer=setTimeout(()=>{void erm.job(job.id,c.signal).then(j=>{if(c.signal.aborted||currentId.current!==j.contactId)return;setJob(j);if(j.status==='completed'&&j.kind==='review')setReview(j);}).catch(e=>{if(!c.signal.aborted){setError(message(e));setJob(null);}});},1300);return()=>{clearTimeout(timer);c.abort();};},[job]);
 useEffect(()=>{if(!linkedNote||!id)return;const c=new AbortController();void erm.note(id,linkedNote,c.signal).then(n=>{if(!c.signal.aborted)setNoteEditor(n);}).catch(e=>{if(!c.signal.aborted)setError(message(e));});return()=>c.abort();},[id,linkedNote]);
 const closeNote=()=>{setNoteEditor(null);if(linkedNote)setParams({contact:id},{replace:true});};
 const openNote=async(noteId:string)=>{try{const n=await erm.note(id,noteId);if(currentId.current===id)setNoteEditor(n);}catch(e){setError(message(e));}};
 const historyContent=useMemo(()=> <div className="erm erm-history"><p className="erm-muted">{contact?'Your timestamped customer record. Click any note to read it in full.':'Select a contact to see their history.'}</p>{contact&&<button className="primary" onClick={()=>setNoteEditor('new')}>+ Add note</button>}{notes.items.map(n=><button className="erm-note-card" key={n.id} onClick={()=>setNoteEditor(n)}><small>{date(n.createdAt)}</small><strong>{n.title}</strong><span>{n.body.slice(0,130)}{n.body.length>130?'…':''}</span><small>{n.includeInAI?'Available to '+AGENT_NAME:'Excluded from AI'} · Open note ↗</small></button>)}{contact&&!notes.items.length&&<p className="erm-muted">Add the first conversation, meeting note, or customer update.</p>}{notes.nextCursor&&<button onClick={()=>{void erm.notes(id,notes.nextCursor).then(n=>{if(currentId.current===id)setNotes(p=>({...n,items:[...p.items,...n.items]}));}).catch(e=>setError(message(e)));}}>Older notes</button>}</div>,[contact,notes,id]);
 const rail=useMemo(()=>[{key:'erm-notes',title:'Customer notes & history',count:notes.total,node:historyContent}],[notes.total,historyContent]);usePageRail(rail);
 const working=aiBusy||!!job&&['queued','running'].includes(job.status);
 async function analyze(q=''){if(!contact||working)return;const selectedId=contact.id;setAiBusy(true);setError('');try{const j=await erm.analyze(selectedId,q,crypto.randomUUID());if(currentId.current===selectedId)setJob(j);}catch(e){if(currentId.current===selectedId)setError(message(e));}finally{if(currentId.current===selectedId)setAiBusy(false);}}
 const answer=job?.result??review?.result;
 return <div className="erm"><header className="erm-page-head"><div><span className="erm-kicker">The App Stack / Customer relationships</span><h1>E-CRM — Enhanced CRM</h1><p className="erm-muted">Your relationships. Your context. {AGENT_NAME}, ready to help.</p></div><div className="erm-actions"><button onClick={()=>setImporting(true)}>Import contacts</button><button className="primary" onClick={()=>setEditor('new')}>+ Add contact</button></div></header>
 {status?.preview&&<p className="erm-preview">LOCAL STAGING · Contacts and notes save in a separate local database. Outlook and AI providers are disconnected.</p>}
 {error&&<p role="alert" className="erm-error">{error} <button onClick={()=>setRevision(r=>r+1)}>Reload saved records</button></p>}
 <div className="erm-workspace"><aside className="erm-directory"><h2>Relationships <small>{directory.total}</small></h2><label className="erm-search">Find a contact<input type="search" placeholder="Name, company, email…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="erm-check"><input type="checkbox" checked={archived} onChange={e=>setArchived(e.target.checked)}/>Archived contacts</label>
 {directory.items.map(p=><button className={'erm-person'+(p.id===id?' selected':'')} key={p.id} onClick={()=>select(p.id)}><span className="erm-avatar">{p.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</span><span><strong>{p.name}</strong><small>{p.company||p.category}</small></span></button>)}{!directory.items.length&&<p className="erm-muted">{query?'No contacts match this search.':'Start with a contact or import your customer list.'}</p>}
 {directory.nextCursor&&<button onClick={()=>{void erm.contacts(query,directory.nextCursor,archived).then(p=>setDirectory(d=>({...p,items:[...d.items,...p.items]}))).catch(e=>setError(message(e)));}}>More contacts</button>}</aside>
 <div className="erm-main">{loading?<section className="erm-panel">Loading customer record…</section>:!contact?<section className="erm-panel erm-empty"><span className="erm-orb">◈</span><h2>Start with a relationship</h2><p>Add a customer, capture what matters, and let {AGENT_NAME} help you prepare for the next conversation.</p><button className="primary" onClick={()=>setEditor('new')}>Add your first contact</button></section>:<>
 <section className="erm-panel"><div className="erm-contact-head"><span className="erm-avatar large">{contact.name.split(' ').map(w=>w[0]).slice(0,2).join('')}</span><div><span className="erm-kicker">{contact.category}{contact.archived?' · Archived':''}</span><h2>{contact.name}</h2><p>{[contact.title,contact.company].filter(Boolean).join(' · ')}</p></div><button onClick={()=>setEditor('edit')}>Edit</button></div>
 <div className="erm-contact-details"><div><h3>Contact</h3>{contact.emails.map(e=><p key={e}><a href={'mailto:'+encodeURIComponent(e)}>{e}</a></p>)}{contact.phones.map((p,i)=><p key={i}><span>{p.label}</span> {p.value}</p>)}{!contact.emails.length&&!contact.phones.length&&<p className="erm-muted">Add email and phone details when you have them.</p>}{contact.website&&<p><a href={contact.website} target="_blank" rel="noreferrer">{contact.website}</a></p>}</div><div><h3>Address & preferences</h3>{contact.addresses.map((a,i)=><address key={i}><strong>{a.label}</strong><br/>{[a.street,a.line2,[a.city,a.region,a.postal].filter(Boolean).join(', '),a.country].filter(Boolean).map((line,j)=><span key={j}>{line}<br/></span>)}</address>)}<p className="erm-muted">{contact.preferred?'Prefers '+contact.preferred:'Contact preference not set'}</p>{contact.tags.filter(Boolean).length>0&&<p>{contact.tags.join(' · ')}</p>}</div></div>
 <div className="erm-record-footer"><span>Updated {date(contact.updatedAt)}</span><button onClick={()=>setHistory(true)}>Notes & history ({notes.total})</button><button onClick={()=>{void erm.archive(contact,!contact.archived).then(()=>setRevision(r=>r+1)).catch(e=>setError(message(e)));}}>{contact.archived?'Restore contact':'Archive contact'}</button></div></section>
 <section className="erm-panel erm-ai"><header><div><span className="erm-kicker">◈ {AGENT_NAME} / Customer review</span><h2>Prepare for what comes next</h2></div><button disabled={working||!status?.model.available||contact.archived} onClick={()=>void analyze()}>{working?'Reviewing…':answer?'Refresh review':'Generate review'}</button></header>
 <p className="erm-muted">Based on this customer’s included notes. AI interpretations and suggestions stay separate from your saved facts.</p>
 {!status?.model.available&&<p className="erm-unavailable">{status?.model.reason??'Checking AI connection…'}</p>}
 {job?.error&&<p role="alert" className="erm-error">{job.error}</p>}{!job&&review?.error&&<p className="erm-warning">{review.error}</p>}
 {answer?<><Claims claims={answer.overview} onNote={id=>void openNote(id)}/>{answer.recommendations.length>0&&<h3>Recommended next steps</h3>}<Claims claims={answer.recommendations} onNote={id=>void openNote(id)}/><p className="erm-muted">{date(answer.generatedAt)} · {answer.includedNotes} of {answer.eligibleNotes} eligible notes · {answer.model}</p></>:<div className="erm-ai-empty"><h3>Your customer context starts here</h3><p>Capture meeting notes, priorities, open questions, and follow-ups. Then ask {AGENT_NAME} to review the relationship.</p><button onClick={()=>setNoteEditor('new')}>+ Add a customer note</button></div>}
 <form className="erm-question" onSubmit={e=>{e.preventDefault();void analyze(question);}}><label>Ask {AGENT_NAME} about this customer<textarea rows={2} maxLength={3000} value={question} onChange={e=>setQuestion(e.target.value)} placeholder="What should I focus on in our next conversation?"/></label><button className="primary" disabled={working||!question.trim()||!status?.model.available||contact.archived}>Ask {AGENT_NAME}</button></form>
 </section></>}</div></div>
 {editor&&<ContactEditor key={editor==='edit'?id:'new'} existing={editor==='edit'?contact??undefined:undefined} onClose={()=>setEditor(null)} onSaved={p=>{setEditor(null);select(p.id);setRevision(r=>r+1);}}/>}
 {noteEditor&&contact&&<NoteDialog key={typeof noteEditor==='string'?'new':noteEditor.id} contact={contact} note={typeof noteEditor==='string'?undefined:noteEditor} onClose={closeNote} onSaved={()=>{closeNote();setRevision(r=>r+1);}}/>}
 {importing&&<ImportDialog onClose={()=>setImporting(false)} onImported={()=>setRevision(r=>r+1)}/>}
 {history&&!noteEditor&&<Modal title="Customer notes & history" onClose={()=>setHistory(false)}>{historyContent}</Modal>}
 </div>;
}
