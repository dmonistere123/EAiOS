// @vitest-environment node
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createTrip, travelAgent, getTrip, addTravelPlan, decideTravelApproval, searchTravel, proposeBooking} from '../../server/travel.ts';
import {travelAction} from '../../server/travelBooking.ts';
import {travelStore,readTrip,writeTrip} from '../../server/travelStore.ts';
import type {TravelPassenger} from '../domain/travelPlan';
let root: string;
const passenger: TravelPassenger = {given_name:'Amelia',family_name:'Earhart',born_on:'1987-07-24',title:'ms',gender:'f',email:'test@example.com',phone_number:'+442080160509'};
const offer = () => ({id:'off_test',expires_at:new Date(Date.now()+600000).toISOString(),live_mode:false,total_amount:'123.45',total_currency:'USD',owner:{name:'Duffel Airways'},passengers:[{id:'pas_test'}],slices:[{segments:[{operating_carrier:{name:'Duffel Airways'},marketing_carrier_flight_number:'100',origin:{iata_code:'LHR'},destination:{iata_code:'JFK'},departing_at:'2027-01-10T10:00:00',arriving_at:'2027-01-10T18:00:00'}]}],conditions:{change_before_departure:{allowed:false}}});
const reply=(data:unknown,status=200)=>new Response(JSON.stringify({data}),{status,headers:{'Content-Type':'application/json'}});
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'eaios-travel-test-'));vi.stubEnv('DUFFEL_API_KEY','duffel_test_fixture');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
async function makeTrip() {return (await createTrip({name:'Trip',destination:'New York',startsAt:'2027-01-10',endsAt:'2027-01-12',budgetUsd:2000,preferredAirlines:'Delta',preferredHotels:'Hilton',diningPreferences:'Vegetarian'},root)).data!;}
async function prepare() {
 const trip=await makeTrip();
 await searchTravel({kind:'flight',origin:'LHR',destination:'JFK',departureDate:'2027-01-10'},root);
 const b=(await proposeBooking(trip.id,'off_test',undefined,root)).data!;
 await decideTravelApproval((await getTrip(trip.id,root))!.approvals[0].id,{decision:'approved'},root);
 await travelAction(trip.id,b.id,{action:'quote'},root);
 return {trip,b};
}
const buy = {action:'book' as const,passenger,amount:'123.45',currency:'USD',accepted:true};
function provider(mode: 'ok'|'timeout'|'unpaid'='ok') {
 let order: Record<string,unknown>|undefined;
 const calls=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
  const url=String(input);
  if(url.includes('offer_requests')) return reply({offers:[offer()]});
  if(url.includes('/air/offers/')) return reply(offer());
  if(init?.method==='POST' && url.endsWith('/air/orders')) {
   const body=JSON.parse(init.body as string).data;
   order={id:'ord_test',live_mode:false,offer_id:'off_test',metadata:body.metadata,booking_reference:'ABC123',payment_status:{awaiting_payment:mode==='unpaid'}};
   if(mode==='timeout') throw new Error('response lost after provider committed');
   return reply(order);
  }
  if(url.includes('/air/orders?')) return reply(order ? [order] : []);
  throw Error(`Unexpected URL ${url}`);
 });
 vi.stubGlobal('fetch',calls); return calls;
}
describe('persistent travel and purchase state',()=>{
 it('persists preferences and trips across a new Node process and keeps other roots isolated',async()=>{
  const trip=await makeTrip();
  const storeUrl=new URL('../../server/travelStore.ts',import.meta.url).href;
  const script=`import {travelStore,readTrip} from ${JSON.stringify(storeUrl)}; console.log(JSON.stringify(travelStore(${JSON.stringify(root)},db=>readTrip(db,${JSON.stringify(trip.id)}))));`;
  const restored=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'}));
  expect(restored.diningPreferences).toBe('Vegetarian');expect(restored.budgetUsd).toBe(2000);
  expect(await getTrip(trip.id,join(root,'other-box'))).toBeNull();
 });
 it('approval never confirms; manual evidence is recorded without claiming provider verification',async()=>{
  const trip=await makeTrip();
  const b=(await addTravelPlan(trip.id,{kind:'hotel',title:'Hotel',location:'NYC',startsAt:'2027-01-10',externalUrl:'https://example.com'},root)).data!;
  const a=(await getTrip(trip.id,root))!.approvals[0];
  await decideTravelApproval(a.id,{decision:'approved'},root);
  expect((await getTrip(trip.id,root))!.bookings[0].status).toBe('approved');
  await expect(travelAction(trip.id,b.id,{action:'record',reference:'A123',evidence:''},root)).rejects.toThrow('confirmation text');
  const result=await travelAction(trip.id,b.id,{action:'record',reference:'A123',evidence:'Provider email: reservation A123 confirmed'},root);
  expect(result.data?.status).toBe('recorded');expect(result.data?.confirmationSource).toBe('manual');
  await expect(decideTravelApproval(a.id,{decision:'approved'},root)).rejects.toThrow('already been decided');
 });
 it('rejects invalid dates, negative budgets and unsafe external URLs',async()=>{
  await expect(createTrip({name:'x',destination:'x',startsAt:'bad',endsAt:'bad'},root)).rejects.toThrow('valid dates');
  const trip=await makeTrip();
  await expect(addTravelPlan(trip.id,{kind:'hotel',title:'x',location:'x',startsAt:'2027-01-10',externalUrl:'javascript:alert(1)'},root)).rejects.toThrow('HTTPS');
 });
 it('sends one order under concurrent duplicate submissions and saves the provider confirmation',async()=>{
  const calls=provider();const {trip,b}=await prepare();
  const results=await Promise.allSettled([travelAction(trip.id,b.id,buy,root),travelAction(trip.id,b.id,buy,root)]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect(calls.mock.calls.filter(([url,init])=>String(url).endsWith('/air/orders') && init?.method==='POST')).toHaveLength(1);
  const saved=(await getTrip(trip.id,root))!.bookings[0];expect(saved.status).toBe('confirmed');expect(saved.confirmationNumber).toBe('ABC123');expect(saved.testMode).toBe(true);
 });
 it('does not confirm unpaid provider orders',async()=>{
  provider('unpaid');const {trip,b}=await prepare();
  expect((await travelAction(trip.id,b.id,buy,root)).data?.status).toBe('unknown');
 });
 it('retains uncertain outcomes, blocks retry and reconciles by metadata without another purchase',async()=>{
  const calls=provider('timeout');const {trip,b}=await prepare();
  expect((await travelAction(trip.id,b.id,buy,root)).data?.status).toBe('unknown');
  await expect(travelAction(trip.id,b.id,buy,root)).rejects.toThrow('cannot be retried');
  const result=await travelAction(trip.id,b.id,{action:'reconcile'},root);
  expect(result.data?.confirmationNumber).toBe('ABC123');
  expect(calls.mock.calls.filter(([url,init])=>String(url).endsWith('/air/orders') && init?.method==='POST')).toHaveLength(1);
 });
 it('blocks a changed price without submitting an order',async()=>{
  provider();const {trip,b}=await prepare();
  const calls=vi.fn(async()=>reply({...offer(),total_amount:'999.99'}));vi.stubGlobal('fetch',calls);
  await expect(travelAction(trip.id,b.id,buy,root)).rejects.toThrow('changed');
  expect(calls).toHaveBeenCalledTimes(1);expect((await getTrip(trip.id,root))!.bookings[0].status).toBe('approved');
 });
 it('does not reinterpret another currency as USD',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>reply({offers:[{...offer(),total_currency:'GBP'}]})));
  const rows=await searchTravel({kind:'flight',origin:'LHR',destination:'JFK',departureDate:'2027-01-10'},root);
  expect(rows[0].priceUsd).toBeUndefined();expect(rows[0].currency).toBe('GBP');
 });
 it('rejects a second plan for the same already submitted offer',async()=>{
  provider('timeout');const {trip,b}=await prepare();await travelAction(trip.id,b.id,buy,root);
  const other=(await proposeBooking(trip.id,'off_test',undefined,root)).data!;
  const a=(await getTrip(trip.id,root))!.approvals.at(-1)!;await decideTravelApproval(a.id,{decision:'approved'},root);await travelAction(trip.id,other.id,{action:'quote'},root);
  await expect(travelAction(trip.id,other.id,buy,root)).rejects.toThrow('already submitted');
 });
 it('keeps interrupted submissions blocked after restart and empty reconciliation',async()=>{
  provider();const {trip,b}=await prepare();
  travelStore(root,db=>{const t=readTrip(db,trip.id)!;t.bookings[0].status='submitting';t.bookings[0].attemptId='interrupted';writeTrip(db,t);});
  expect((await travelAction(trip.id,b.id,{action:'reconcile'},root)).data?.status).toBe('unknown');
  await expect(travelAction(trip.id,b.id,buy,root)).rejects.toThrow('cannot be retried');
 });
});

describe('Duffel Stays contract and honest availability',()=>{
 it('surfaces missing Stays access instead of returning hotel fixtures',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('Access denied',{status:403})));
  await expect(searchTravel({kind:'hotel',destination:'London',latitude:51.5,longitude:-0.14,checkIn:'2027-01-10',checkOut:'2027-01-12'},root)).rejects.toThrow('403');
 });
 it('searches rates, requotes and confirms only a provider-confirmed hotel reservation',async()=>{
  const rate={id:'rat_test',total_amount:'123.45',total_currency:'USD',payment_type:'pay_now',expires_at:new Date(Date.now()+600000).toISOString(),board_type:'room_only',cancellation_timeline:[]};
  const accommodation={name:'Test Hotel',rooms:[{name:'Double',rates:[rate]}]};
  const calls=vi.fn(async(url:string,init?:RequestInit)=>{
   if(url.endsWith('/stays/search'))return reply({results:[{id:'srr_test'}]});
   if(url.includes('fetch_all_rates'))return reply({id:'srr_test',accommodation});
   if(url.endsWith('/stays/quotes'))return reply({id:'quo_test',total_amount:'123.45',total_currency:'USD',accommodation,check_in_date:'2027-01-10',check_out_date:'2027-01-12',due_at_accommodation_amount:'20.00',due_at_accommodation_currency:'USD'});
   if(url.endsWith('/stays/bookings'))return reply({id:'bok_test',status:'confirmed',reference:'HOTEL123',live_mode:false,metadata:JSON.parse(init!.body as string).data.metadata});
   throw Error('Unexpected route');
  });vi.stubGlobal('fetch',calls);
  const trip=await makeTrip();const rows=await searchTravel({kind:'hotel',destination:'London',latitude:51.5,longitude:-0.14,checkIn:'2027-01-10',checkOut:'2027-01-12'},root);
  const b=(await proposeBooking(trip.id,rows[0].id,undefined,root)).data!;
  await decideTravelApproval((await getTrip(trip.id,root))!.approvals[0].id,{decision:'approved'},root);
  const quote=(await travelAction(trip.id,b.id,{action:'quote'},root)).data!;expect(quote.details).toContain('20.00');
  const result=await travelAction(trip.id,b.id,buy,root);expect(result.data?.status).toBe('confirmed');expect(result.data?.confirmationNumber).toBe('HOTEL123');
 });
 it('does not substitute dining results when restaurant access is missing',async()=>{
  vi.stubEnv('OPENTABLE_API_KEY','');
  await expect(searchTravel({kind:'restaurant',destination:'NYC',date:'2027-01-10',partySize:2},root)).rejects.toThrow('not connected');
 });
});

it('Ally collects a trip draft without silently creating a trip or inventing provider results',async()=>{
 vi.stubEnv('OPENROUTER_API_KEY','fixture');
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({kind:null,draft:{destination:'New York',budgetUsd:2000,preferredHotels:'Hilton',diningPreferences:'Vegetarian'},explanation:'What are your travel dates and preferred airline?'})}}]}))));
 const result=await travelAgent({query:'Plan a trip to New York; $2000 budget, Hilton, vegetarian meals'},{hermesHome:root,eaiosRoot:root,dataRoot:root});
 expect(result.draft?.startsAt).toBeUndefined();expect(result.draft?.budgetUsd).toBe(2000);expect(result.summary).toContain('dates');expect(result.results).toEqual([]);
 expect(travelStore(root,db=>db.prepare('SELECT count(*) AS n FROM trips').get())?.n).toBe(0);
});
it('expired offers and changed provider mode cannot purchase',async()=>{
 provider();const {trip,b}=await prepare();
 vi.stubGlobal('fetch',vi.fn(async()=>reply({...offer(),expires_at:'2020-01-01T00:00:00Z'})));
 await expect(travelAction(trip.id,b.id,buy,root)).rejects.toThrow('expired');
 vi.stubEnv('DUFFEL_API_KEY','duffel_live_fixture');
 await expect(travelAction(trip.id,b.id,buy,root)).rejects.toThrow('different Duffel mode');
});

it('live credentials do not activate purchasing without a separate live-booking setting',async()=>{
 vi.stubEnv('DUFFEL_API_KEY','duffel_live_fixture');vi.stubEnv('EAIOS_DUFFEL_LIVE_BOOKING','0');
 const calls=vi.fn(async(url:string)=>url.includes('offer_requests') ? reply({offers:[{...offer(),live_mode:true}]}) : reply({...offer(),live_mode:true}));vi.stubGlobal('fetch',calls);
 const {trip,b}=await prepare();
 await expect(travelAction(trip.id,b.id,buy,root)).rejects.toThrow('Live purchases are not enabled');
 expect(calls.mock.calls.some(([url])=>url.endsWith('/air/orders'))).toBe(false);
 await expect(travelAction(trip.id,b.id,{action:'record',reference:'fake',evidence:'fake'},root)).rejects.toThrow('Only an approved external plan');
});

it('normalizes lowercase and padded flight codes before contacting Duffel',async()=>{
 const calls=provider();
 await searchTravel({kind:'flight',origin:' lhr ',destination:'jfk ',departureDate:'2027-01-10'},root);
 const body=JSON.parse(calls.mock.calls[0][1]!.body as string).data;
 expect(body.slices[0]).toMatchObject({origin:'LHR',destination:'JFK'});
});
it('rejects city names locally and explains unrecognized three-letter codes',async()=>{
 const calls=vi.fn();vi.stubGlobal('fetch',calls);
 await expect(searchTravel({kind:'flight',origin:'Birmingham',destination:'JFK',departureDate:'2027-01-10'},root)).rejects.toThrow('Origin must be a three-letter airport code');
 expect(calls).not.toHaveBeenCalled();
 calls.mockResolvedValue(new Response(JSON.stringify({errors:[{code:'invalid_iata_code'}]}),{status:422}));
 await expect(searchTravel({kind:'flight',origin:'ZZZ',destination:'JFK',departureDate:'2027-01-10'},root)).rejects.toThrow('ZZZ → JFK');
});

it('selecting an option saves an approved plan but never submits a purchase',async()=>{
 const calls=provider();const {trip}=await prepare();
 const result=await proposeBooking(trip.id,'off_test',undefined,root,true);
 expect(result.data?.status).toBe('approved');
 const saved=(await getTrip(trip.id,root))!;
 expect(saved.bookings.filter(b=>b.status==='approved')).toHaveLength(1);
 expect(saved.approvals.at(-1)?.status).toBe('approved');
 expect(calls.mock.calls.some(([url])=>String(url).endsWith('/air/orders'))).toBe(false);
});
