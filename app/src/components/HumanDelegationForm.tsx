import { HumanWorkStatus } from './HumanWorkStatus';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { humanDirectory, humanDelegation } from '../adapters';
import { refreshApprovals } from '../state/runtime';
import type { HumanContact, HumanDelegation, HumanDelegationArtifact } from '../domain/humanDelegation';
export function HumanDelegationForm({workItemId}:{workItemId:string}) {
 const [attachments,setAttachments]=useState<Omit<HumanDelegationArtifact,'contentHash'>[]>([]),[selectedFiles,setSelectedFiles]=useState<string[]>([]),[filesReady,setFilesReady]=useState(false);
 const [contacts,setContacts]=useState<HumanContact[]>([]),[contactId,setContactId]=useState('');
 const [instructions,setInstructions]=useState(''),[dueAt,setDueAt]=useState('');
 const [draft,setDraft]=useState<HumanDelegation>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{humanDelegation.attachments(workItemId).then(files=>{setAttachments(files);setSelectedFiles(files.map(f=>f.artifactId));setFilesReady(true);}).catch(()=>setError('Task attachments could not be loaded. Approval remains blocked.'));},[workItemId]);
 useEffect(()=>{Promise.all([humanDirectory.listContacts(),humanDelegation.list()]).then(([c,d])=>{setContacts(c.filter(x=>x.active));setDraft(d.find(x=>x.workItemId===workItemId&&!['cancelled','rejected','completed','declined','send_failed'].includes(x.status)));}).catch(e=>setError(e.message));},[workItemId]);
 const style='mt-1 w-full rounded-lg border border-edge bg-canvas p-2 text-sm text-ink';
 async function prepare(){setBusy(true);setError('');try{setDraft(await humanDelegation.prepare({workItemId,contactId,instructions,...(dueAt?{dueAt:new Date(dueAt).toISOString()}:{} )}));}catch(e){setError(e instanceof Error?e.message:'Unable to prepare draft.');}finally{setBusy(false);}}
 return <div className="mt-4 space-y-3">
 <Link className="text-sm text-signal" to="/settings">Manage human assistants and sending mailbox</Link>
 {!draft?<><label className="block text-sm" htmlFor="human-contact">Human assistant<select id="human-contact" className={style} value={contactId} onChange={e=>setContactId(e.target.value)}><option value="">Choose a saved assistant</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.displayName} — {c.email}</option>)}</select></label>
 <label className="block text-sm" htmlFor="human-due">Due date (optional)<input id="human-due" type="datetime-local" className={style} value={dueAt} onChange={e=>setDueAt(e.target.value)}/></label>
 <label className="block text-sm" htmlFor="human-instructions">Requested outcome and instructions<textarea id="human-instructions" rows={4} maxLength={8000} className={style} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
 <button disabled={busy||!contactId} onClick={()=>void prepare()} className="w-full rounded-lg bg-signal p-3 text-sm font-semibold text-canvas disabled:opacity-50">{busy?'Preparing…':'Save email draft'}</button></>:<div className="rounded-lg border border-edge p-3 text-sm"><p className="text-ok">{draft.status==='draft'?'Draft saved — no email sent.':draft.status.replaceAll('_',' ')}</p><p>From: {draft.package?.sender.email}</p><p>To: {draft.package?.recipient.email}</p><p>Subject: {draft.package?.subject}</p><pre className="mt-3 whitespace-pre-wrap font-sans">{draft.package?.body}</pre></div>}
 {draft?.status==='draft'&&<section className="space-y-2"><h3 className="text-sm font-semibold">Attachments included with this email</h3>{attachments.map(f=><label key={f.artifactId} className="block text-sm"><input type="checkbox" checked={selectedFiles.includes(f.artifactId)} onChange={e=>setSelectedFiles(ids=>e.target.checked?[...ids,f.artifactId]:ids.filter(id=>id!==f.artifactId))}/> {f.filename} ({f.sizeBytes} bytes)</label>)}{filesReady&&attachments.length===0&&<p className="text-xs text-ink-dim">This task has no linked attachments.</p>}<button disabled={busy||!filesReady} className="w-full rounded-lg bg-signal p-3 text-sm font-semibold text-canvas disabled:opacity-50" onClick={()=>{setBusy(true);setError('');void humanDelegation.submit(draft.id,draft.revision,selectedFiles).then(async d=>{setDraft(d);await refreshApprovals();}).catch(e=>setError(e.message)).finally(()=>setBusy(false));}}>Request approval to send</button></section>}
 {draft?.status==='pending_approval'&&<Link to="/approvals" className="text-sm text-signal">Review this email in Approvals</Link>}
 {draft&&<HumanWorkStatus delegation={draft} onChange={d=>setDraft(d.status==='cancelled'?undefined:d)}/>}
 <p className="text-xs text-ink-dim">Preparing or submitting this package sends nothing. Only approval sends the exact reviewed email. The task is not assigned to an AI worker.</p>
 {error&&<p role="alert" className="text-sm text-risk">{error}</p>}
 </div>;
}
