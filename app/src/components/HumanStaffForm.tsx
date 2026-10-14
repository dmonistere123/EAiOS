import { useState } from 'react';
import { humanDirectory } from '../adapters';
import type { HumanContact, HumanContactInput } from '../domain/humanDelegation';
export function HumanStaffForm({contact,onSaved}:{contact?:HumanContact;onSaved:(contact:HumanContact)=>void}) {
 const [fields,setFields]=useState<HumanContactInput>({displayName:contact?.displayName??'',email:contact?.email??'',phone:contact?.phone??'',title:contact?.title??'',organization:contact?.organization??'',timeZone:contact?.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone,notes:contact?.notes??''});
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function save(){setBusy(true);setError('');try{const c=contact?await humanDirectory.updateContact(contact.id,fields,contact.revision):await humanDirectory.createContact(fields);onSaved(c);}catch(e){setError(e instanceof Error?e.message:'Could not save this person.');}finally{setBusy(false);}}
 const inputs:[keyof HumanContactInput,string,string,number][]=[['displayName','Full name','text',160],['email','Email for delegations','email',254],['title','Role / responsibilities','text',160],['organization','Organization','text',200],['phone','Phone (optional)','tel',64],['timeZone','Time zone','text',100]];
 return <form className="space-y-4" onSubmit={e=>{e.preventDefault();void save();}}>
 <p className="text-sm text-ink-dim">Add a person to your staff. Tasks are prepared as emails for your approval. Saving their profile does not send an invitation or give them application access.</p>
 {inputs.map(([key,label,type,max])=><label key={key} className="block text-xs font-medium text-ink-dim" htmlFor={'human-'+key}>{label}{['displayName','email'].includes(key)?' *':''}<input id={'human-'+key} type={type} required={['displayName','email'].includes(key)} maxLength={max} value={fields[key]??''} onChange={e=>setFields({...fields,[key]:e.target.value})} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"/></label>)}
 <label htmlFor="human-preferences" className="block text-xs font-medium text-ink-dim">Working preferences, availability, and delegation instructions<textarea id="human-preferences" maxLength={4000} rows={4} value={fields.notes??''} onChange={e=>setFields({...fields,notes:e.target.value})} className="mt-1 w-full rounded-lg border border-edge bg-canvas p-3 text-sm text-ink"/></label>
 <p className="text-xs text-ink-faint">Delegation emails use your business sender configured in Settings. Phone is contact information only.</p>
 {error&&<p role="alert" className="text-sm text-risk">{error}</p>}
 <button disabled={busy} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas disabled:opacity-50">{busy?'Saving…':contact?'Save human staff details':'Add human agent'}</button>
 </form>;
}
export function HumanAvatar(){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-6 w-6"><circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg>;}
