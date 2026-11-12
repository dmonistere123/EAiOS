// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTrip,getTrip,updateTravelTrip} from '../../server/travel.ts';
import {applyTripInterpretation,converseTravel} from '../../server/travelConversation.ts';
import {travelStore,writeTrip} from '../../server/travelStore.ts';
import {travelRecommendations} from '../../server/travelGuide.ts';
import {parseResearch,expandResearch} from '../../server/travelResearch.ts';
import {itineraryText} from '../../server/travelHandoff.ts';
import {shortlist} from '../domain/travelGuide';
import type {TravelTrip} from '../domain/types';
let root:string,trip:TravelTrip;
beforeEach(async()=>{
 root=mkdtempSync(join(tmpdir(),'travel-conversation-'));
 trip=(await createTrip({name:'Board visit',destination:'Baton Rouge',purpose:'Board Meeting',tripNotes:'Stay near downtown',originPlace:{id:'bhm',code:'BHM',name:'Birmingham',city:'Birmingham',country:'US'},destinationPlace:{id:'msy',code:'MSY',name:'New Orleans',city:'New Orleans',country:'US'},startsAt:'2027-01-10',endsAt:'2027-01-12'},root)).data!;
});
afterEach(()=>{rmSync(root,{recursive:true,force:true});vi.unstubAllGlobals();vi.unstubAllEnvs();});
const interpreted=(patch:Record<string,unknown>,extra={})=>({patch,reply:'I can refine those options.',needsClarification:false,refreshKinds:[],...extra});
it('keeps arrival airport and chosen flight while changing only the stay area and its research',async()=>{
 trip.bookings=[{id:'flight',tripId:trip.id,kind:'flight',status:'approved',provider:'duffel',airline:'Southwest',flightNumber:'123',origin:'BHM',destination:'MSY',departureAt:'2027-01-10',arrivalAt:'2027-01-10',cabin:'Economy'}];
 travelStore(root,db=>writeTrip(db,trip));
 const result=await applyTripInterpretation(trip,interpreted({destination:'Downtown Baton Rouge',preferredHotels:'IHG'}),'Stay in downtown Baton Rouge at IHG.',root);
 expect(result.trip.destinationPlace?.code).toBe('MSY');expect(result.trip.bookings).toEqual(trip.bookings);
 expect(result.refreshKinds.sort()).toEqual(['hotel','restaurant']);expect(result.trip.conversation).toHaveLength(2);
 const reopened=await getTrip(trip.id,root);expect(reopened?.destination).toBe('Downtown Baton Rouge');expect(reopened?.conversation?.[0].text).toContain('IHG');
 expect(itineraryText(result.trip,'Please book')).toContain('Arrival airport: New Orleans');expect(itineraryText(result.trip,'Please book')).toContain('Board Meeting');
});
it('saves airline-only requirements and never replaces them with a different airline',async()=>{
 const result=await applyTripInterpretation(trip,interpreted({preferredAirlines:'Southwest',airlinePolicy:'only'}),'Southwest only.',root);
 expect(result.refreshKinds).toEqual(['flight']);
 const rows=[{id:'aa',title:'American Airlines',subtitle:'BHM → MSY',kind:'flight' as const,provider:'duffel',meta:{}}];
 expect(shortlist(rows,result.trip.preferredAirlines,undefined,3,true)).toEqual([]);
 expect(shortlist(rows,result.trip.preferredAirlines,undefined,3,false)).toHaveLength(1);
});
it('persists a clarifying question and prevents searches until it is answered',async()=>{
 const pending=await applyTripInterpretation(trip,interpreted({}, {needsClarification:true,reply:'Which city should the hotel be in?'}),'Put me near the office.',root);
 expect(pending.refreshKinds).toEqual([]);await expect(travelRecommendations(trip.id,root)).rejects.toThrow('Answer Ally');
 const answer=await applyTripInterpretation(pending.trip,interpreted({destination:'Baton Rouge'}),'Baton Rouge.',root);
 expect(answer.trip.planningQuestion).toBe('');expect(answer.trip.conversation).toHaveLength(4);
});
it('rejects malformed model changes without altering saved dates, conversation or selections',async()=>{
 await expect(applyTripInterpretation(trip,interpreted({endsAt:'2026-01-01'}),'Change the return.',root)).rejects.toThrow('valid');
 await expect(applyTripInterpretation(trip,interpreted({needsCar:'yes'}),'Car please.',root)).rejects.toThrow('Invalid');
 expect(await getTrip(trip.id,root)).toEqual(trip);
});
it('does not let a slow answer overwrite another edit',async()=>{
 await updateTravelTrip(trip.id,{...trip,name:'New title'},root);
 await expect(applyTripInterpretation(trip,interpreted({preferredHotels:'IHG'}),'IHG please.',root)).rejects.toThrow('changed while');
 expect((await getTrip(trip.id,root))?.name).toBe('New title');
});
it('uses only structured model changes and never writes model-supplied bookings or approvals',async()=>{
 const result=await applyTripInterpretation(trip,interpreted({bookings:[{status:'confirmed'}],approvals:[{status:'approved'}],id:'other',needsCar:true}),'Include a rental car.',root);
 expect(result.trip.bookings).toEqual([]);expect(result.trip.approvals).toEqual([]);expect(result.trip.id).toBe(trip.id);expect(result.trip.needsCar).toBe(true);
});
it('makes one conversational provider call with saved context, without any purchase calls',async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','test');
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(interpreted({diningPreferences:'Seafood'}))}}]})));
 vi.stubGlobal('fetch',fetcher);
 const result=await converseTravel(trip.id,{message:'Find seafood restaurants.'},root);
 expect(result.refreshKinds).toEqual(['restaurant']);expect(fetcher).toHaveBeenCalledTimes(1);
 expect(JSON.parse(fetcher.mock.calls[0][1].body).messages[1].content).toContain('Baton Rouge');
});
it('returns provider errors without applying partial changes or losing the trip',async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','test');vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('no',{status:503})));
 await expect(converseTravel(trip.id,{message:'Change my hotel.'},root)).rejects.toThrow('temporarily unavailable');
 expect(await getTrip(trip.id,root)).toEqual(trip);
});
it('supports ten distinct cited choices while discarding uncited invented options',()=>{
 const options=Array.from({length:12},(_,i)=>({kind:'hotel',name:'Hotel '+i,url:`https://example.com/hotel-${i}`,address:'Baton Rouge',summary:'Near downtown'}));
 const data={output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({options:[...options,{kind:'restaurant',name:'Invented',url:'https://uncited.example/'}]}),annotations:options.map(o=>({url:o.url}))}]}]};
 const groups=parseResearch(data,trip);expect(groups[0].options).toHaveLength(10);expect(groups[1].options).toHaveLength(0);expect(groups[0].options.every(o=>o.amount===undefined)).toBe(true);
});

it('keeps distinct restaurants supported by the same local guide, deduplicating by venue',()=>{
 const options=Array.from({length:10},(_,i)=>({kind:'restaurant',name:'Seafood place '+i,url:'https://example.com/local-guide',address:'Baton Rouge',summary:'Local guide recommendation'}));
 const groups=parseResearch({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({options:[...options,options[0]]}),annotations:[{url:'https://example.com/local-guide'}]}]}]},trip);
 expect(groups[1].options).toHaveLength(10);expect(new Set(groups[1].options.map(o=>o.id)).size).toBe(10);
});

it('binds expanded choices to retrieved sources and rejects unsupported names and addresses',async()=>{
 const response={output:[{type:'message',content:[{type:'output_text',text:'{}',annotations:[{url:'https://example.com/guide',title:'Baton Rouge dining',content:'Parrain’s Seafood Restaurant and Mansurs on the Boulevard are seafood venues in Baton Rouge.'}]}]}]};
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({options:[{kind:'restaurant',name:"Parrain's Seafood Restaurant",sourceIndex:0,address:'123 Invented Street',summary:'Seafood venue.'},{kind:'restaurant',name:'Mansurs on the Boulevard',sourceIndex:0,summary:'Seafood venue.'},{kind:'restaurant',name:'Invented venue',sourceIndex:0},{kind:'restaurant',name:'Another invented venue',sourceIndex:99}]})}}]}))));
 const groups=await expandResearch(response,trip,['restaurant'],'test');
 expect(groups[0].options).toHaveLength(2);expect(groups[0].options.every(o=>o.externalUrl==='https://example.com/guide')).toBe(true);expect(groups[0].options[0].meta.address).toBe('Baton Rouge');
});
