import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { humanDirectory,humanDelegation,travelHandoff } from '../adapters';
import type { HumanContact,HumanDelegation } from '../domain/humanDelegation';
import { HumanWorkStatus } from './HumanWorkStatus';
import { HumanDelegationForm } from './HumanDelegationForm';
import { Card } from './ui';
export function TravelHandoff({tripId}:{tripId:string}) {
  const [contacts,setContacts]=useState<HumanContact[]>([]),[contactId,setContactId]=useState(''),[instructions,setInstructions]=useState('Book the selected itinerary. Confirm availability and final prices before booking. Ask me before making substitutions or exceeding my budget.');
  const [draft,setDraft]=useState<HumanDelegation>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;Promise.all([humanDirectory.listContacts(),humanDelegation.list()]).then(([c,d])=>{if(!active)return;const available=c.filter(x=>x.active);setContacts(available);if(available.length===1)setContactId(available[0].id);setDraft(d.find(x=>x.tripId===tripId&&!['cancelled','rejected','declined','send_failed'].includes(x.status)));}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[tripId]);
  async function prepare(){setBusy(true);setError('');try{const result=await travelHandoff.prepare(tripId,contactId,instructions);setDraft(result.delegation);}catch(e){setError(e instanceof Error?e.message:'Could not prepare itinerary.');}finally{setBusy(false);}}
  return <Card className="space-y-4 border-warn/30 p-5">
    <div><p className="text-xs uppercase tracking-widest text-warn">Human booking handoff</p><h2 className="mt-2 text-xl font-semibold">Send the plan. Keep the decisions.</h2><p className="mt-2 text-sm text-ink-dim">Save an itinerary artifact and prepare an email with it attached. Your assistant books the trip, checks off each item and submits confirmations for your final sign-off.</p></div>
    {loading?<p role="status">Loading handoff…</p>:draft?<>
      <p className="text-sm text-ink-dim">Saved itinerary snapshot · subsequent trip edits do not change the reviewed email. Cancel an unfinished draft before preparing a replacement.</p>
      {draft.status==='completed'?<HumanWorkStatus delegation={draft} onChange={setDraft}/>:<HumanDelegationForm key={draft.id} workItemId={draft.workItemId} onStatusChange={d=>setDraft(d.status==='cancelled'?undefined:d)}/>}
      <div className="flex gap-4 text-sm"><Link className="text-signal" to="/artifacts">View itinerary in Artifacts</Link><Link className="text-signal" to="/human-assistant">Open HI Assistant</Link></div>
    </>:<>
      <label className="block text-sm">Book with<select className="mt-2 w-full rounded-lg border border-edge bg-canvas p-3" value={contactId} onChange={e=>setContactId(e.target.value)}><option value="">Choose human assistant</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
      {!contacts.length&&<Link className="text-sm text-signal" to="/human-assistant">Add your human assistant first</Link>}
      <label className="block text-sm">Booking instructions<textarea className="mt-2 w-full rounded-lg border border-edge bg-canvas p-3" rows={4} maxLength={8000} value={instructions} onChange={e=>setInstructions(e.target.value)}/></label>
      <button className="rounded-lg bg-signal px-5 py-3 text-sm font-semibold text-canvas disabled:opacity-50" disabled={!contactId||busy} onClick={()=>void prepare()}>{busy?'Preparing…':'Save itinerary & prepare delegation'}</button>
      <p className="text-xs text-ink-dim">Nothing is sent until you approve the exact email and attachment.</p>
    </>}
    {error&&<p role="alert" className="text-sm text-risk">{error}</p>}
  </Card>;
}
