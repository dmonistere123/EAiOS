import {AGENT_NAME} from '../config';
import {usePageRail} from '../state/rail';
import {useEffect,useState} from 'react';
import {hermes,travelMode} from '../adapters';
import type {CreateTripInput,TravelSearchResult} from '../adapters/interfaces';
import type {TravelTrip,TravelBooking} from '../domain/types';
import type {TravelPlace,TravelShortlist,CarPreferences} from '../domain/travelGuide';
import {TravelCityPicker} from '../components/TravelCityPicker';
import {PlanDrawer,TravelBookingActions} from '../components/TravelPlanning';
import {Card} from '../components/ui';

const fieldClass='mt-2 w-full rounded-xl border border-edge bg-canvas px-4 py-3 text-sm text-ink';
const primary='rounded-xl bg-signal px-5 py-3 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50';
const secondary='rounded-xl border border-edge px-4 py-2 text-sm text-ink-dim hover:bg-canvas-overlay disabled:opacity-50';
const noRail: import('../state/rail').RailSectionDef[] = [];
const steps=['Trip details','Your preferences','Your options','Your itinerary'];
const dateLabel=(value:string)=>new Date(`${value.slice(0,10)}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const title=(b:TravelBooking)=>b.title??(b.kind==='flight'?`${b.airline} ${b.flightNumber}`:b.kind==='hotel'?b.hotelName:b.kind==='restaurant'?b.restaurantName:`${b.company} ${b.carType}`);
const bookingDate=(b:TravelBooking)=>b.kind==='flight'?b.departureAt:b.kind==='hotel'?b.checkIn:b.kind==='car'?b.pickupAt:b.reservationAt;
const errorText=(e:unknown)=>e instanceof Error?e.message:'Something went wrong. Please try again.';

function DateField({label,value,min,onChange}: {label:string;value:string;min?:string;onChange:(v:string)=>void}) {
  const [open,setOpen]=useState(false);
  const [month,setMonth]=useState(()=>new Date());
  const begin=()=>{setMonth(new Date(`${(value||min||new Date().toISOString().slice(0,10)).slice(0,7)}-01T12:00:00`));setOpen(true);};
  const year=month.getFullYear(), index=month.getMonth();
  const first=new Date(year,index,1).getDay(), days=new Date(year,index+1,0).getDate();
  const iso=(day:number)=>`${year}-${String(index+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  return <div className="relative">
    <label className="block text-sm font-medium">{label}<input className={`${fieldClass} [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:hidden`} type="date" required min={min} value={value} onChange={e=>onChange(e.target.value)} onClick={begin} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();begin();}if(e.key==='Escape')setOpen(false);}}/></label>
    <button type="button" onClick={()=>open?setOpen(false):begin()} className="absolute right-3 top-10 rounded px-2 text-signal" aria-label={`Open ${label.toLowerCase()} calendar`}>▦</button>
    {open&&<div role="dialog" aria-label={`Choose ${label.toLowerCase()}`} className="mt-2 rounded-xl border border-signal/40 bg-canvas-raised p-3 shadow-lg" onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>
      <div className="mb-3 flex items-center justify-between"><button type="button" className="rounded p-2 hover:bg-canvas-overlay" aria-label="Previous month" onClick={()=>setMonth(new Date(year,index-1,1))}>‹</button><span className="text-sm font-medium" aria-live="polite">{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</span><button type="button" className="rounded p-2 hover:bg-canvas-overlay" aria-label="Next month" onClick={()=>setMonth(new Date(year,index+1,1))}>›</button></div>
      <div className="grid grid-cols-7 gap-1">{['S','M','T','W','T','F','S'].map((day,i)=><span key={`weekday-${i}`} className="p-1 text-center text-xs text-ink-faint">{day}</span>)}{Array.from({length:first},(_,i)=><span key={`blank-${i}`}/>)}{Array.from({length:days},(_,i)=>{const day=i+1,date=iso(day);return <button type="button" key={day} aria-label={date} aria-pressed={value===date} disabled={!!min&&date<min} className={`rounded-lg py-2 text-xs hover:bg-signal/20 disabled:opacity-20 ${value===date?'bg-signal text-canvas':'text-ink'}`} onClick={()=>{onChange(date);setOpen(false);}}>{day}</button>;})}</div>
      <button type="button" className="mt-2 w-full p-1 text-xs text-ink-dim" onClick={()=>setOpen(false)}>Close calendar</button>
    </div>}
  </div>;
}

export default function Travel() {
  usePageRail(noRail);
  const [trips,setTrips]=useState<TravelTrip[]>([]);
  const [trip,setTrip]=useState<TravelTrip|null>(null);
  const [step,setStep]=useState(0);
  const [name,setName]=useState('');
  const [origin,setOrigin]=useState<TravelPlace>();
  const [destination,setDestination]=useState<TravelPlace>();
  const [start,setStart]=useState('');
  const [end,setEnd]=useState('');
  const [budget,setBudget]=useState('');
  const [airlines,setAirlines]=useState('');
  const [hotels,setHotels]=useState('');
  const [dining,setDining]=useState('');
  const [needsCar,setNeedsCar]=useState(false);
  const [car,setCar]=useState<CarPreferences>({driverAge:0,residenceCountry:'US',pickupTime:'12:00',dropoffTime:'12:00'});
  const [shortlists,setShortlists]=useState<TravelShortlist[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [addPlan,setAddPlan]=useState(false);
  const [choosing,setChoosing]=useState('');
  const [plannerKey,setPlannerKey]=useState(0);
  const [loadError,setLoadError]=useState('');

  async function loadTrips() {
    try{setTrips(await hermes.listTrips());setLoadError('');}catch(e){setLoadError(errorText(e));}finally{setLoading(false);}
  }
  useEffect(()=>{
    let active=true;
    void hermes.listTrips().then(rows=>{if(active){setTrips(rows);setLoading(false);}}).catch(e=>{if(active){setLoadError(errorText(e));setLoading(false);}});
    return ()=>{active=false;};
  },[]);
  async function refresh() {
    if(!trip)return;
    try{const fresh=await hermes.getTrip(trip.id);if(fresh)setTrip(fresh);await loadTrips();}catch(e){setError(errorText(e));}
  }
  function openTrip(saved:TravelTrip) {
    setTrip(saved);setName(saved.name);setOrigin(saved.originPlace);setDestination(saved.destinationPlace);setStart(saved.startsAt.slice(0,10));setEnd(saved.endsAt.slice(0,10));setBudget(saved.budgetUsd===undefined?'':String(saved.budgetUsd));setAirlines(saved.preferredAirlines??'');setHotels(saved.preferredHotels??'');setDining(saved.diningPreferences??'');setNeedsCar(saved.needsCar??false);setCar(saved.carPreferences??{driverAge:0,residenceCountry:'US',pickupTime:'12:00',dropoffTime:'12:00'});setShortlists([]);setError('');setStep(3);setPlannerKey(k=>k+1);
  }
  function newTrip() {
    setTrip(null);setName('');setOrigin(undefined);setDestination(undefined);setStart('');setEnd('');setBudget('');setAirlines('');setHotels('');setDining('');setNeedsCar(false);setCar({driverAge:0,residenceCountry:'US',pickupTime:'12:00',dropoffTime:'12:00'});setShortlists([]);setError('');setStep(0);setPlannerKey(k=>k+1);
  }
  function checkDetails() {
    if(!origin||!destination){setError('Choose your departure and destination from the city suggestions.');return false;}
    if(origin.code===destination.code){setError('Choose a different destination from your departure airport.');return false;}
    if(!start||!end||end<start){setError('Choose departure and return dates, with return on or after departure.');return false;}
    setError('');return true;
  }
  async function findOptions() {
    if(!checkDetails()){setStep(0);return;}
    if(budget && (!Number.isFinite(Number(budget))||Number(budget)<0)){setError('Enter a positive budget, or leave it blank.');return;}
    if(needsCar&&(!Number.isInteger(car.driverAge)||car.driverAge<18||car.driverAge>100)){setError('Enter the driver’s age at pickup (18–100) to find rental cars.');return;}
    setBusy(true);setError('');setShortlists([]);setStep(2);
    try {
      const input:CreateTripInput={name:name.trim()||`${destination!.city} trip`,destination:destination!.city,originPlace:origin,destinationPlace:destination,startsAt:start,endsAt:end,budgetUsd:budget?Number(budget):undefined,preferredAirlines:airlines,preferredHotels:hotels,diningPreferences:dining,needsCar,carPreferences:needsCar?car:undefined};
      const saved=trip ? await hermes.updateTravelTrip(trip.id,input) : await hermes.createTrip(input);
      if(!saved.ok||!saved.data)throw new Error(saved.error?.safeMessage??'Could not save this trip.');
      setTrip(saved.data);
      await loadTrips();
      setShortlists(await hermes.travelRecommendations(saved.data.id));
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  async function choose(result:TravelSearchResult) {
    if(!trip||choosing)return;
    setChoosing(result.id);setError('');
    try {
      const saved=await hermes.chooseTravelOption(trip.id,result.id);
      if(!saved.ok)throw new Error(saved.error?.safeMessage??'Could not save this choice.');
      await refresh();
    }catch(e){setError(errorText(e));}finally{setChoosing('');}
  }
  async function approvePlan(b:TravelBooking) {
    const approval=trip?.approvals.find(a=>a.bookingId===b.id&&a.status==='pending');if(!approval)return;
    setChoosing(b.id);setError('');
    try{const result=await hermes.decideTravelApproval(approval.id,{decision:'approved'});if(!result.ok)throw new Error(result.error?.safeMessage);await refresh();}catch(e){setError(errorText(e));}finally{setChoosing('');}
  }
  const activeBookings=trip?.bookings.filter(b=>b.status!=='cancelled')??[];
  const optionsFor=(kind:TravelShortlist['kind'])=>shortlists.find(s=>s.kind===kind);
  const total=activeBookings.reduce((sum,b)=>sum+(b.currency==='USD'?Number(b.amount??0):b.costUsd??0),0);

  return <div className="mx-auto max-w-6xl space-y-6 pb-10">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-signal">Travel with {AGENT_NAME}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Let’s plan your next trip.</h1><p className="mt-2 max-w-2xl text-sm text-ink-dim">Tell me where you’re going. I’ll narrow the choices so you can focus on the trip.</p></div>
      {trip&&<button className={secondary} disabled={busy||!!choosing} onClick={newTrip}>Plan another trip</button>}
    </header>
    {travelMode==='mock' ? <p className="rounded-lg bg-warn/10 px-4 py-2 text-xs text-warn">Design preview · example recommendations, not live availability.</p> : import.meta.env.VITE_TRAVEL_LIVE==='1' && <p className="rounded-lg bg-warn/10 px-4 py-2 text-xs text-warn">Test mode · provider prices and bookings are sandbox examples. Your trip plans are saved.</p>}
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-5">
        <ol aria-label="Planning progress" className="grid grid-cols-4 gap-2">{steps.map((label,i)=><li key={label} aria-current={step===i?'step':undefined} className={`border-t-2 pt-3 text-xs ${step===i?'border-signal font-semibold text-signal':'border-edge text-ink-faint'}`}><span className="mr-1.5">{i+1}.</span>{label}</li>)}</ol>
        {error&&<div role="alert" className="rounded-xl border border-risk/30 bg-risk/10 p-4 text-sm text-risk">{error}</div>}
        {step===0&&<Card className="space-y-6 p-6 md:p-8">
          <div><h2 className="text-xl font-semibold">Where are we going?</h2><p className="mt-1 text-sm text-ink-dim">Choose the cities and dates. I’ll use these for all your searches.</p></div>
          {trip&&!destination&&<p className="text-sm text-ink-dim">Your saved destination is {trip.destination}. Select its airport below to find flights.</p>}
          <div key={plannerKey} className="grid gap-5 md:grid-cols-2"><TravelCityPicker label="Leaving from" value={origin} onChange={setOrigin}/><TravelCityPicker label="Going to" value={destination} onChange={setDestination}/></div>
          <div className="grid gap-5 md:grid-cols-2"><DateField label="Departure date" value={start} onChange={setStart}/><DateField label="Return date" value={end} min={start} onChange={setEnd}/></div>
          <label className="block text-sm font-medium">Trip name <span className="font-normal text-ink-faint">(optional)</span><input className={fieldClass} value={name} onChange={e=>setName(e.target.value)} placeholder="For example, Baton Rouge visit"/></label>
          <p className="text-xs text-ink-faint">This first booking flow supports one adult. Nothing is purchased while you plan.</p>
          <button className={primary} onClick={()=>{if(checkDetails())setStep(1);}}>Continue to preferences →</button>
        </Card>}
        {step===1&&<Card className="space-y-6 p-6 md:p-8">
          <div><h2 className="text-xl font-semibold">What makes a good trip for you?</h2><p className="mt-1 text-sm text-ink-dim">Share the preferences that matter to you. If you need a car, we’ll also need driver details for accurate rates.</p></div>
          <label className="block text-sm font-medium">Total trip budget (USD)<input className={fieldClass} type="number" min="0" value={budget} onChange={e=>setBudget(e.target.value)} placeholder="For example, 1,500"/></label>
          <div className="grid gap-5 md:grid-cols-2"><label className="block text-sm font-medium">Preferred airlines<input className={fieldClass} value={airlines} onChange={e=>setAirlines(e.target.value)} placeholder="Any airline, or your favorites"/></label><label className="block text-sm font-medium">Preferred hotels<input className={fieldClass} value={hotels} onChange={e=>setHotels(e.target.value)} placeholder="Any hotel, or IHG, Hilton…"/></label></div>
          <label className="block text-sm font-medium">Dining preferences<textarea className={fieldClass} rows={2} value={dining} onChange={e=>setDining(e.target.value)} placeholder="Seafood, casual dinners, dietary needs…"/></label>
          <fieldset><legend className="text-sm font-medium">Will you need a rental car?</legend><div className="mt-3 flex gap-3">{[false,true].map(v=><label key={String(v)} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-5 py-3 text-sm ${needsCar===v?'border-signal bg-signal/10':'border-edge'}`}><input type="radio" name="car-needed" checked={needsCar===v} onChange={()=>setNeedsCar(v)}/>{v?'Yes, include a car':'No, I’m covered'}</label>)}</div></fieldset>
          {needsCar&&<div className="space-y-3 rounded-xl border border-edge p-4"><p className="text-sm text-ink-dim">Pickup and return near your destination airport, on your trip dates. Times are local to the rental location.</p><div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Driver’s age at pickup<input className={fieldClass} type="number" min="18" max="100" value={car.driverAge||''} onChange={e=>setCar({...car,driverAge:Number(e.target.value)})}/></label>
            <label className="text-sm">Driver’s country of residence<select className={fieldClass} value={car.residenceCountry} onChange={e=>setCar({...car,residenceCountry:e.target.value})}>{[['US','United States'],['CA','Canada'],['GB','United Kingdom'],['MX','Mexico'],['AU','Australia'],['FR','France'],['DE','Germany']].map(([code,name])=><option value={code} key={code}>{name}</option>)}</select></label>
            <label className="text-sm">Car pickup time<input className={fieldClass} type="time" value={car.pickupTime} onChange={e=>setCar({...car,pickupTime:e.target.value})}/></label>
            <label className="text-sm">Car return time<input className={fieldClass} type="time" value={car.dropoffTime} onChange={e=>setCar({...car,dropoffTime:e.target.value})}/></label>
          </div>{import.meta.env.VITE_TRAVEL_SANDBOX==='1'&&<label className="flex items-start gap-2 text-xs text-warn"><input type="checkbox" checked={car.useTestLocation??false} onChange={e=>setCar({...car,useTestLocation:e.target.checked})}/>Use Duffel’s sample car location to test checkout. These cars are not at your destination and cannot create a real rental.</label>}</div>}
          <div className="flex flex-wrap justify-between gap-3"><button className={secondary} onClick={()=>setStep(0)}>← Back</button><button className={primary} disabled={busy} onClick={()=>void findOptions()}>Find my options →</button></div>
        </Card>}
        {step===2&&<div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">A few choices, picked for your trip.</h2><p className="mt-1 text-sm text-ink-dim">Up to three options in each category, sorted using your preferences and available prices.</p></div><button disabled={busy} className={secondary} onClick={()=>setStep(0)}>Edit trip details</button></div>
          {busy&&<div role="status" className="rounded-xl border border-signal/30 bg-signal/5 p-6"><p className="font-medium">Finding options for {destination?.city}…</p><p className="mt-2 text-sm text-ink-dim">Checking flights, hotels, restaurants, and any requested rental cars. Your trip is saved; no purchases are being made.</p></div>}
          {!busy&&(['flight','hotel','restaurant',...(needsCar?['car' as const]:[])] as const).map(kind=>{
            const group=optionsFor(kind), labels={flight:'Flights',hotel:'Hotels',restaurant:'Restaurants',car:'Rental cars'};
            return <section key={kind} className="space-y-3" aria-label={labels[kind]}>
              <h3 className="text-lg font-semibold">{labels[kind]} <span className="ml-2 text-xs font-normal text-ink-faint">{group?.options.length??0} options</span></h3>
              {!!group?.options.length&&group.notice&&<p className="text-sm text-ink-dim">{group.notice}</p>}
              {!!group?.options.length&&<div className="grid gap-3 lg:grid-cols-3">{group.options.map((option,i)=>{
                const selected=activeBookings.some(b=>b.offerId===option.id);
                return <Card key={option.id} className={`flex flex-col p-4 ${selected?'border-signal':''}`}><p className="text-[11px] uppercase tracking-wide text-signal">{selected?'Added to itinerary':`Option ${i+1}`}</p><h4 className="mt-2 text-base font-semibold">{option.title}</h4><p className="mt-2 text-sm font-semibold">{option.amount?`${option.currency} ${option.amount}`:option.priceUsd!==undefined?`USD ${option.priceUsd}`:'Price not supplied'}{option.testMode?' · TEST':''}</p>{kind==='car'&&<p className="mt-2 text-xs text-ink-dim">{option.subtitle}<br/>Pickup: {option.meta.pickupLocation}<br/>{option.meta.pickupAt?.replace('T',' ')} → {option.meta.dropoffAt?.replace('T',' ')}</p>}{kind==='flight'&&option.meta.departureAt&&<div className="mt-3 space-y-1 text-sm"><p>Out: {dateLabel(option.meta.departureAt)} · {option.meta.departureAt.slice(11,16)}–{option.meta.arrivalAt?.slice(11,16)}</p>{option.meta.returnDepartureAt&&<p>Back: {dateLabel(option.meta.returnDepartureAt)} · {option.meta.returnDepartureAt.slice(11,16)}–{option.meta.returnArrivalAt?.slice(11,16)}</p>}<p className="text-xs text-ink-dim">{option.meta.stops==='0'?'Nonstop outbound':option.meta.stops?`${option.meta.stops} outbound connection(s)`:''} · Times local to each airport</p></div>}<p className="mt-2 text-xs text-ink-dim">{option.reason}</p><details className="my-3 text-xs"><summary className="cursor-pointer text-signal">View itinerary details</summary><p className="mt-2 whitespace-pre-wrap">{option.subtitle}</p></details><button className={`${selected?secondary:primary} mt-auto w-full`} disabled={!!choosing||selected} onClick={()=>void choose(option)}>{choosing===option.id?'Adding…':selected?'Selected':'Choose this option'}</button></Card>;
              })}</div>}
              {!group?.options.length&&<div className="rounded-xl border border-edge bg-canvas-raised p-4"><p className="text-sm">{group?.notice || (kind==='flight'?'No flight options to show yet. Try different dates or retry the search.':kind==='hotel'?'Your hotel preference is saved. You can choose a hotel on its website and add the confirmation to this itinerary.':'Your dining preferences are saved. Restaurant suggestions and table availability still need a connected source.')}</p>{kind!=='flight'&&<a className="mt-3 inline-block text-sm text-signal underline" href={kind==='hotel'?'https://www.kayak.com/hotels':kind==='car'?'https://www.kayak.com/cars':'https://www.opentable.com/'} target="_blank" rel="noreferrer">{kind==='hotel'?'Search hotels on Kayak':kind==='car'?'Search cars on Kayak':'Search restaurants on OpenTable'} ↗</a>}</div>}
            </section>;
          })}
          {!busy&&<div className="flex flex-wrap justify-between gap-3"><button className={secondary} disabled={!!choosing} onClick={()=>void findOptions()}>Refresh options</button><button disabled={!trip||!!choosing} className={primary} onClick={()=>setStep(3)}>Review my itinerary →</button></div>}
        </div>}
        {step===3&&trip&&<div className="space-y-5">
          <div><h2 className="text-2xl font-semibold">{trip.name}</h2><p className="mt-1 text-sm text-ink-dim">{trip.destination} · {dateLabel(trip.startsAt)}–{dateLabel(trip.endsAt)}</p><p className="mt-2 text-sm text-ink-dim">Your choices, checkout, and confirmations are all here. Selecting an option does not purchase it.</p></div>
          <div className="flex flex-wrap gap-3"><button className={primary} onClick={()=>{setStep(shortlists.length?2:0);setError('');}}>{shortlists.length?'Back to my options':'Find options for this trip'}</button><button className={secondary} onClick={()=>setAddPlan(true)}>Add an external reservation</button></div>
          {activeBookings.length===0?<Card className="p-8 text-center"><h3 className="text-lg font-medium">Your itinerary is ready to fill.</h3><p className="mt-2 text-sm text-ink-dim">Start with “Find options for this trip.” Your dates and preferences are already filled in.</p></Card>:<div className="space-y-3">{[...activeBookings].sort((a,b)=>bookingDate(a).localeCompare(bookingDate(b))).map(b=><Card key={b.id} className="p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs uppercase tracking-wider text-ink-faint">{b.kind} · {dateLabel(bookingDate(b))}</p><h3 className="mt-1 font-semibold">{title(b)}</h3></div><span className="rounded-full border border-edge px-3 py-1 text-xs">{b.status==='confirmed'?(b.testMode?'Test confirmation':'Booked'):b.status==='recorded'?'Confirmation recorded':b.status==='approved'?'Selected · not booked':b.status}</span></div>{b.status==='proposed'&&<button className={`${secondary} mt-3`} disabled={!!choosing} onClick={()=>void approvePlan(b)}>Use this plan</button>}<TravelBookingActions booking={b} onRefresh={()=>void refresh()}/></Card>)}</div>}
          {addPlan&&<PlanDrawer trip={trip} onClose={()=>setAddPlan(false)} onSaved={()=>void refresh()}/>}
        </div>}
      </div>
      <aside className="space-y-4 xl:sticky xl:top-5">
        <Card className="p-5"><h2 className="text-xs font-semibold uppercase tracking-widest text-ink-dim">Your trip at a glance</h2><p className="mt-4 text-lg font-semibold">{destination?.city||trip?.destination||'Your next destination'}</p><p className="mt-1 text-sm text-ink-dim">{origin?`From ${origin.city}`:'Choose your departure city'}</p><p className="mt-2 text-sm">{start&&end?`${dateLabel(start)}–${dateLabel(end)}`:'Choose your dates'}</p><dl className="mt-4 space-y-2 border-t border-edge pt-4 text-xs"><div className="flex justify-between"><dt className="text-ink-dim">Budget</dt><dd>{budget?`USD ${budget}`:'Flexible'}</dd></div><div className="flex justify-between"><dt className="text-ink-dim">Rental car</dt><dd>{needsCar?'Yes':'No'}</dd></div><div className="flex justify-between"><dt className="text-ink-dim">Selected USD prices</dt><dd>USD {total.toFixed(2)}</dd></div></dl><p className="mt-3 text-xs text-ink-faint">Selected prices are not a complete trip total. Meals, local fees, and other currencies may be additional.</p></Card>
        <Card className="p-5"><h2 className="text-sm font-semibold">Saved trips</h2>{loadError?<p role="alert" className="mt-3 text-xs text-risk">{loadError} <button className="underline" onClick={()=>void loadTrips()}>Retry</button></p>:loading?<p className="mt-3 text-xs text-ink-dim">Loading trips…</p>:trips.length===0?<p className="mt-3 text-xs text-ink-dim">Your plans will appear here.</p>:<ul className="mt-3 space-y-2">{trips.map(t=><li key={t.id}><button disabled={busy||!!choosing} className={`w-full rounded-lg p-2 text-left ${trip?.id===t.id?'bg-signal/10 text-signal':'hover:bg-canvas-overlay'}`} onClick={()=>openTrip(t)}><span className="block text-sm font-medium">{t.name}</span><span className="text-xs text-ink-dim">{dateLabel(t.startsAt)}–{dateLabel(t.endsAt)}</span></button></li>)}</ul>}</Card>
      </aside>
    </div>
  </div>;
}
