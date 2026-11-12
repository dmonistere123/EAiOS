import { researchTravel } from './travelResearch.ts';
import {duffel, duffelTestMode} from './duffel.ts';
import {TravelApiError, getTrip, searchTravel} from './travel.ts';
import {shortlist, type TravelPlace, type TravelShortlist} from '../src/domain/travelGuide.ts';

interface Place {id: string; name: string; city_name?: string; iata_country_code: string; iata_code: string; type: string; latitude?: number; longitude?: number; airports?: Place[]}
export async function travelPlaces(query: string): Promise<TravelPlace[]> {
  const text=query.trim();
  if(text.length<2)return [];
  if(text.length>100)throw new TravelApiError(400,'Enter a city or airport name under 100 characters.');
  const places=await duffel<Place[]>(`/places/suggestions?query=${encodeURIComponent(text)}`);
  const airports=places.flatMap(p=>p.type==='city' ? p.airports ?? [] : [p]);
  const seen=new Set<string>();
  return airports.filter(p=>/^[A-Z]{3}$/.test(p.iata_code)&&!seen.has(p.id)&&!!seen.add(p.id)).slice(0,8).map(p=>({id:p.id,name:p.name,city:p.city_name??p.name,country:p.iata_country_code,code:p.iata_code,latitude:p.latitude,longitude:p.longitude}));
}
export async function travelRecommendations(id:string,root:string,requested?:string[]):Promise<TravelShortlist[]> {
  const trip=await getTrip(id,root);
  if(!trip)throw new TravelApiError(404,'Trip not found.');
  if(!trip.originPlace || !trip.destinationPlace)throw new TravelApiError(400,'Choose departure and destination cities to find options.');
  if(trip.planningQuestion)throw new TravelApiError(409,'Answer Ally’s question before searching: '+trip.planningQuestion);
  const searches=[
    {kind:'flight' as const,origin:trip.originPlace.code,destination:trip.destinationPlace.code,departureDate:trip.startsAt.slice(0,10),returnDate:trip.endsAt.slice(0,10)},
    {kind:'hotel' as const,destination:trip.destination,latitude:trip.destinationPlace.latitude,longitude:trip.destinationPlace.longitude,checkIn:trip.startsAt.slice(0,10),checkOut:trip.endsAt.slice(0,10)},
    {kind:'restaurant' as const,destination:trip.diningLocation||trip.destination,date:trip.startsAt.slice(0,10),partySize:1},
    ...(trip.needsCar ? [{kind:'car' as const,pickupLocation:trip.destinationPlace.name,dropoffLocation:trip.destinationPlace.name,latitude:trip.destinationPlace.latitude,longitude:trip.destinationPlace.longitude,departureDate:trip.startsAt.slice(0,10),returnDate:trip.endsAt.slice(0,10),carPreferences:trip.carPreferences}] : []),
  ].filter(p=>!requested||requested.includes(p.kind));
  const researchKinds=searches.filter(p=>p.kind==='hotel'||p.kind==='restaurant').map(p=>p.kind);
  const researched=process.env.EAIOS_TRAVEL_ASSISTED==='1'&&researchKinds.length?researchTravel(trip,root,researchKinds).catch(error=>(['hotel','restaurant'] as const).map(kind=>({kind,options:[],notice:error instanceof Error?error.message:'Web research unavailable.'}))):null;
  return Promise.all(searches.map(async params=>{
    if(researched&&['hotel','restaurant'].includes(params.kind))return (await researched).find(group=>group.kind===params.kind)!;
    try {
      if(params.kind==='car'&&process.env.EAIOS_TRAVEL_ASSISTED==='1'&&!trip.carPreferences)return {kind:'car' as const,options:[],notice:'Rental car requested. Your human assistant will arrange it. Add driver age and pickup/return times in trip details if you want to compare provider rates first.'};
      const rows=await searchTravel(params,root);
      const preference=params.kind==='flight'?trip.preferredAirlines:params.kind==='hotel'?trip.preferredHotels:trip.diningPreferences;
      const options=shortlist(rows,preference,trip.budgetUsd,params.kind==='hotel'||params.kind==='restaurant'?10:3,params.kind==='flight'&&trip.airlinePolicy==='only');
      if(params.kind==='flight'&&preference?.trim()&&!options.some(o=>o.reason.startsWith('Matches')))return {kind:params.kind,options,notice:trip.airlinePolicy==='only'?`No ${preference.trim()} offers were returned for this search. Other airlines are hidden. This does not prove the airline has no flights; ask Ally to change dates or allow alternatives.`:`No ${preference.trim()} offers were returned. These are alternatives from the provider, not matches to your airline preference.`};
      return {kind:params.kind,options,notice:params.kind==='car' ? `${trip.carPreferences?.useTestLocation ? 'Duffel test-location examples; these cars are not at your trip destination. ' : ''}Pay-at-counter rates only. ${options.length === 0 ? (duffelTestMode() ? 'No rates returned here in test mode. You can explicitly select the Duffel test location in your preferences.' : 'No matching rates returned. Try other dates or times.') : 'Review supplier deposit, licence and cancellation conditions before booking.'}` : options.length<3 ? `Only ${options.length} matching option${options.length===1?'':'s'} returned. Try other dates if you want more choices.` : undefined};
    } catch(error) {
      return {kind:params.kind,options:[],notice:error instanceof Error ? error.message : 'Search is unavailable. Try again.'};
    }
  }));
}
