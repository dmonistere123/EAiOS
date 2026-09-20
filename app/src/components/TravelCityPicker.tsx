import {useEffect,useId,useState} from 'react';
import {hermes} from '../adapters';
import type {TravelPlace} from '../domain/travelGuide';

export function TravelCityPicker({label,value,onChange}: {label:string;value?:TravelPlace;onChange:(place?:TravelPlace)=>void}) {
  const id=useId();
  const display=(place:TravelPlace)=>`${place.city} — ${place.name}`;
  const [query,setQuery]=useState(value?display(value):'');
  const [places,setPlaces]=useState<TravelPlace[]>([]);
  const [status,setStatus]=useState('');
  useEffect(()=>{
    if(value && query===display(value))return;
    let active=true;
    if(query.trim().length<2)return;
    const timer=setTimeout(()=>{
      setStatus('Finding airports…');
      void hermes.travelPlaces(query).then(rows=>{if(active){setPlaces(rows);setStatus(rows.length?'Choose an airport below.':'No matching airports. Try the nearest larger city.');}}).catch(()=>{if(active){setPlaces([]);setStatus('Airport search is unavailable. Please try again shortly.');}});
    },300);
    return ()=>{active=false;clearTimeout(timer);};
  },[query,value]);
  return <div>
    <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
    <input id={id} className="mt-2 w-full rounded-xl border border-edge bg-canvas px-4 py-3 text-sm text-ink" placeholder="Start typing a city, such as Birmingham" autoComplete="off" value={query} onChange={e=>{setQuery(e.target.value);setPlaces([]);setStatus('');onChange(undefined);}} aria-describedby={`${id}-status`}/>
    <p id={`${id}-status`} aria-live="polite" className="mt-2 text-xs text-ink-dim">{value ? `${value.city}, ${value.country} · ${value.name}` : status || 'Choose by name. No airport codes to remember.'}</p>
    {!value && places.length>0 && <ul className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-edge bg-canvas-raised">{places.map(p=><li key={p.id}><button type="button" className="w-full border-b border-edge px-4 py-3 text-left hover:bg-canvas-overlay focus:bg-canvas-overlay" onClick={()=>{onChange(p);setQuery(display(p));setPlaces([]);setStatus('');}}><span className="block text-sm font-medium">{p.city}, {p.country}</span><span className="text-xs text-ink-dim">{p.name}</span></button></li>)}</ul>}
  </div>;
}
