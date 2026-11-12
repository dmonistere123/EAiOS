import { useState } from 'react';
import { humanDelegation } from '../adapters';
export function AssistantAccess({id}:{id:string}) {
  const [link,setLink]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function run(revoke=false){setBusy(true);setError('');try{if(revoke){await humanDelegation.revokeAccess(id);setLink('');}else setLink((await humanDelegation.access(id)).url);}catch(e){setError(e instanceof Error?e.message:'Access could not be updated.');}finally{setBusy(false);}}
  return <div className="mt-3 space-y-2 text-xs">
    <button disabled={busy} onClick={()=>void run()} className="text-signal">Create / replace private assistant link</button>
    <button disabled={busy} onClick={()=>void run(true)} className="ml-4 text-ink-dim">Revoke assistant access</button>
    {link&&<p><a href={link} target="_blank" rel="noreferrer" className="text-signal underline">Open assigned-work view ↗</a><span className="ml-2 text-ink-dim">Valid for seven days. Replaces any previous link.</span></p>}
    {error&&<p role="alert" className="text-risk">{error}</p>}
  </div>;
}
