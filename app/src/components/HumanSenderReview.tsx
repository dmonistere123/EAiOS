import {useState} from 'react';
import {humanDelegation,mailRouting} from '../adapters';
import type {Approval} from '../domain/types';
import type {MailboxIdentity} from '../domain/mailRouting';
import {refreshApprovals} from '../state/runtime';
export function HumanSenderReview({approval,onSaved}:{approval:Approval;onSaved:()=>void}){
 const [choices,setChoices]=useState<MailboxIdentity[]>([]),[sender,setSender]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function run(fn:()=>Promise<void>){setBusy(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'Could not change sender.');}finally{setBusy(false);}}
 return <section className="space-y-2 rounded border border-edge p-3"><button disabled={busy} className="text-sm text-signal" onClick={()=>void run(async()=>setChoices((await mailRouting.choices()).flatMap(c=>c.mailbox?[c.mailbox]:[])))}>Edit sending account</button>{choices.length>0&&<><label className="block text-sm">Send from<select className="block w-full rounded border border-edge bg-canvas p-2" value={sender} onChange={e=>setSender(e.target.value)}><option value="">Choose connected mailbox</option>{choices.map(c=><option key={c.connectionId} value={c.connectionId}>{c.email}</option>)}</select></label><button disabled={busy||!sender} className="text-sm text-signal" onClick={()=>void run(async()=>{await humanDelegation.changeSender(approval.humanDelegation!.id,sender,approval.reviewVersion??'');await refreshApprovals();onSaved();})}>Save sender for review</button><p className="text-xs text-ink-dim">Sends nothing. Reopen this approval to review the updated From address.</p></>}{error&&<p role="alert" className="text-sm text-risk">{error}</p>}</section>;
}
