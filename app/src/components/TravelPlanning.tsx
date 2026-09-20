import { useState } from 'react';
import { hermes } from '../adapters';
import type { TravelBooking, TravelTrip } from '../domain/types';
import type { TravelPlanInput, TravelPassenger, TravelAction } from '../domain/travelPlan';
import { Drawer } from './ui';

const inputClass = 'mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink';
const buttonClass = 'rounded-lg border border-signal/40 px-3 py-2 text-xs text-signal disabled:opacity-50';
export function BookingLinks() {
  return <p className="text-xs text-ink-dim">Complete checkout on a provider site: <a className="text-signal underline" href="https://www.kayak.com/flights" target="_blank" rel="noreferrer">Find flights</a> · <a className="text-signal underline" href="https://www.kayak.com/hotels" target="_blank" rel="noreferrer">Find hotels</a> · <a className="text-signal underline" href="https://www.kayak.com/cars" target="_blank" rel="noreferrer">Find cars</a> · <a className="text-signal underline" href="https://www.opentable.com/" target="_blank" rel="noreferrer">Dining</a>. These links start a separate search; prices and availability are set by the provider.</p>;
}
export function PlanDrawer({trip, onClose, onSaved}: {trip: TravelTrip; onClose: () => void; onSaved: () => void}) {
  const [form, setForm] = useState<TravelPlanInput>({kind: 'hotel', title: '', startsAt: `${trip.startsAt.slice(0,10)}T12:00`, endsAt: `${trip.endsAt.slice(0,10)}T12:00`, location: trip.destination, partySize: 1});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    setBusy(true); setError('');
    try { const res = await hermes.addTravelPlan(trip.id, form); if (!res.ok) throw new Error(res.error?.safeMessage); onSaved(); onClose(); }
    catch (e) {setError(e instanceof Error ? e.message : 'Could not save plan.');} finally {setBusy(false);}
  }
  return <Drawer title="Add an itinerary plan" onClose={onClose}>
    <div className="space-y-3">
      <BookingLinks />
      <label className="block text-xs">Reservation type<select className={inputClass} value={form.kind} onChange={e => setForm({...form, kind: e.target.value as TravelPlanInput['kind']})}>{['flight','hotel','car','restaurant'].map(k => <option key={k}>{k}</option>)}</select></label>
      {(['title','location','startsAt','endsAt','externalUrl','notes'] as const).map(key => <label className="block text-xs" key={key}>{({title:'Plan title',location:'Location / route',startsAt:'Start date and time',endsAt:'End date and time',externalUrl:'Provider booking link (HTTPS)',notes:'Notes'})[key]}<input className={inputClass} type={key.includes('At') ? 'datetime-local' : key === 'externalUrl' ? 'url' : 'text'} value={form[key] ?? ''} onChange={e => setForm({...form, [key]:e.target.value})}/></label>)}
      {form.kind === 'restaurant' && <label className="block text-xs">Party size<input className={inputClass} type="number" min="1" max="30" value={form.partySize} onChange={e=>setForm({...form,partySize:Number(e.target.value)})}/></label>}
      {error && <p role="alert" className="text-xs text-risk">{error}</p>}
      <button disabled={busy} className={buttonClass} onClick={()=>void save()}>{busy ? 'Saving…' : 'Add plan for approval'}</button>
    </div>
  </Drawer>;
}
export function TravelBookingActions({booking: b, onRefresh}: {booking: TravelBooking; onRefresh: () => void}) {
  const [expanded, setExpanded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [reference,setReference] = useState(''), [evidence,setEvidence] = useState(''), [accepted,setAccepted] = useState(false);
  const [passenger,setPassenger] = useState<TravelPassenger>({given_name:'',family_name:'',born_on:'',title:'mr',gender:'m',email:'',phone_number:''});
  async function act(action: TravelAction) {
    setBusy(true);setError('');
    try { const result = await hermes.travelAction(b.tripId,b.id,action); if (!result.ok) throw new Error(result.error?.safeMessage); setAccepted(false); onRefresh(); }
    catch (e) {setError(e instanceof Error ? e.message : 'Travel request failed.');} finally {setBusy(false);}
  }
  return <div className="mt-2 space-y-2 text-xs">
    {b.testMode && <strong className="text-warn">Duffel TEST — no real reservation</strong>}
    {b.amount && <div>Total: {b.currency} {b.amount}</div>}
    {b.details && <details><summary className="cursor-pointer text-signal">Full itinerary and provider conditions</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{b.details}</pre></details>}
    {b.kind === 'car' && b.driverName && <p>Driver: {b.driverName}</p>}
    {b.confirmedAt && <p>Confirmation received: {new Date(b.confirmedAt).toLocaleString()}</p>}
    {b.notes && <p>{b.notes}</p>}
    {b.externalUrl?.startsWith('https://') && <a href={b.externalUrl} target="_blank" rel="noreferrer" className="text-signal underline">Open provider checkout</a>}
    {b.confirmationNumber && <p>Confirmation: <strong>{b.confirmationNumber}</strong> — {b.confirmationSource === 'manual' ? 'recorded by you; not provider-verified' : 'verified with provider'}</p>}
    {b.confirmationEvidence && <details><summary>Imported confirmation text</summary><p className="whitespace-pre-wrap">{b.confirmationEvidence}</p></details>}
    {b.outcomeMessage && <p role="status" className="text-warn">{b.outcomeMessage}</p>}
    {b.attemptId && <p className="break-all text-ink-faint">Attempt: {b.attemptId}{b.providerId ? ` · Provider ID: ${b.providerId}` : ''}</p>}
    {['unknown','submitting'].includes(b.status) && <button className={buttonClass} disabled={busy} onClick={()=>void act({action:'reconcile'})}>Check provider status (no purchase)</button>}
    {b.status === 'approved' && <>
      <p>Ready for checkout. No reservation has been made.</p>
      <button className={buttonClass} onClick={()=>setExpanded(!expanded)}>{b.provider === 'external' ? 'Attach / import confirmation' : 'Review checkout'}</button>
      {expanded && (b.provider === 'external' ? <div className="space-y-2">
        <label className="block">Provider confirmation reference<input className={inputClass} value={reference} onChange={e=>setReference(e.target.value)}/></label>
        <label className="block">Paste confirmation email / receipt<textarea className={inputClass} maxLength={20000} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
        <label className="block">Or import a text confirmation<input className={inputClass} type="file" accept=".txt,text/plain" onChange={async e=>{const f=e.target.files?.[0]; if(!f)return; if(f.size>20000){setError('Use a text confirmation under 20 KB.');return;} setEvidence(await f.text());}}/></label>
        <button className={buttonClass} disabled={busy || !reference.trim() || !evidence.trim()} onClick={()=>void act({action:'record',reference,evidence})}>Save recorded confirmation</button>
      </div> : <div className="space-y-2">
        <p>{b.kind === 'car' ? 'One adult driver. Pay at the rental counter; no online charge. Review licence, deposit, pickup and cancellation conditions above.' : 'One adult traveler. Payment uses your Duffel balance. Review the itinerary and provider conditions above.'} Changes and cancellations require the provider.</p>
        <button className={buttonClass} disabled={busy} onClick={()=>void act({action:'quote'})}>Refresh price and availability</button>
        {(['given_name','family_name','born_on','email','phone_number'] as const).map(key=><label key={key} className="block">{({given_name:'Legal first name',family_name:'Legal last name',born_on:'Date of birth',email:'Email',phone_number:'Phone (+country code)'})[key]}<input className={inputClass} value={passenger[key]} type={key==='born_on'?'date':key==='email'?'email':'text'} onChange={e=>setPassenger({...passenger,[key]:e.target.value})}/></label>)}
        {b.kind==='flight'&&<><label className="block">Title<select className={inputClass} value={passenger.title} onChange={e=>setPassenger({...passenger,title:e.target.value as TravelPassenger['title']})}>{['mr','ms','mrs','miss','dr'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="block">Gender (required by airline)<select className={inputClass} value={passenger.gender} onChange={e=>setPassenger({...passenger,gender:e.target.value as 'm'|'f'})}><option value="m">Male</option><option value="f">Female</option></select></label></>}
        <label className="flex gap-2"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>I approve this itinerary, provider conditions and total of {b.currency} {b.amount}{b.testMode ? ' in TEST mode' : ''}.</label>
        <button className={buttonClass} disabled={busy || !accepted || !b.amount} onClick={()=>void act({action:'book',passenger,amount:b.amount!,currency:b.currency!,accepted})}>{busy ? 'Checking provider…' : b.testMode ? 'Approve and submit test booking' : b.kind === 'car' ? 'Approve reservation · pay at counter' : 'Approve and purchase once'}</button>
      </div>)}
    </>}
    {error && <p role="alert" className="text-risk">{error}</p>}
  </div>;
}
