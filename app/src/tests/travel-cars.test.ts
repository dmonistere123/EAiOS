// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTrip,getTrip,proposeBooking,searchTravel} from '../../server/travel.ts';
import {travelAction} from '../../server/travelBooking.ts';
import {travelRecommendations} from '../../server/travelGuide.ts';
import {duffel} from '../../server/duffel.ts';
let root:string;
const prefs={driverAge:30,residenceCountry:'US',pickupTime:'12:00',dropoffTime:'12:00'};
const search={kind:'car' as const,pickupLocation:'BTR',dropoffLocation:'BTR',departureDate:'2027-01-10',returnDate:'2027-01-12',latitude:30.5,longitude:-91.1,carPreferences:prefs};
const location={name:'Airport desk',address:{city_name:'Baton Rouge',country_code:'US'}};
const rate={id:'rae_fixture',total_amount:'100.00',total_currency:'USD',payment_type:'postpaid',supplier:{name:'Example Rentals'},car:{name:'Compact',transmission:'automatic',max_passengers:5},pickup_location:location,dropoff_location:location};
const quote={...rate,id:'qut_fixture',rate_id:rate.id,live_mode:false,pickup_date:search.departureDate,pickup_time:'12:00',dropoff_date:search.returnDate,dropoff_time:'12:00',conditions:[{title:'Cancellation',text:'Free before pickup.'}]};
const passenger={given_name:'Test',family_name:'Traveler',born_on:'1996-05-01',title:'mr' as const,gender:'m' as const,email:'test@example.com',phone_number:'+12025550123'};
const reply=(data:unknown)=>new Response(JSON.stringify({data}));
beforeEach(()=>{root=mkdtempSync(join(tmpdir(),'eaios-cars-'));vi.stubEnv('DUFFEL_API_KEY','duffel_test_fixture');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});});
function provider(outcome='confirmed') {
 const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
  if(url.endsWith('/cars/search'))return reply({live_mode:false,rates:[rate,{...rate,id:'card',payment_type:'guarantee'}]});
  if(url.endsWith('/cars/quotes'))return reply(quote);
  if(url.endsWith('/cars/bookings')){
   if(outcome==='lost')throw Error('Lost response');
   const data=JSON.parse(init!.body as string).data;
   return reply({id:'boo_fixture',quote_id:data.quote_id,live_mode:false,metadata:data.metadata,status:outcome,reference:'CAR123',driver:data.driver});
  }
  throw Error('Unexpected request');
 });vi.stubGlobal('fetch',fetcher);return fetcher;
}
async function prepare() {
 const trip=(await createTrip({name:'Car test',destination:'Baton Rouge',startsAt:search.departureDate,endsAt:search.returnDate,needsCar:true,carPreferences:prefs},root)).data!;
 const rows=await searchTravel(search,root);
 const b=(await proposeBooking(trip.id,rows[0].id,undefined,root,true)).data!;
 await travelAction(trip.id,b.id,{action:'quote'},root);
 return {trip,b,rows};
}
const buy={action:'book' as const,passenger,amount:'100.00',currency:'USD',accepted:true};
it('searches actual requested coordinates and filters unsupported card guarantees',async()=>{
 const f=provider();const {rows,b}=await prepare();
 expect(rows).toHaveLength(1);expect(b.status).toBe('approved');
 const payload=JSON.parse(f.mock.calls[0][1]!.body as string).data;
 expect(payload.pickup_location.geographic_coordinates.latitude).toBe(30.5);
 expect(payload.driver).toEqual({age:30,residence_country_code:'US'});
 expect(f.mock.calls.some(([u])=>u.endsWith('/cars/bookings'))).toBe(false);
});
it('confirms one postpaid booking and rejects duplicate submission',async()=>{
 const f=provider();const {trip,b}=await prepare();
 const result=await travelAction(trip.id,b.id,buy,root);
 expect(result.data).toMatchObject({status:'confirmed',confirmationNumber:'CAR123',driverName:'Test Traveler'});
 await expect(travelAction(trip.id,b.id,buy,root)).rejects.toThrow('cannot be retried');
 expect(f.mock.calls.filter(([u])=>u.endsWith('/cars/bookings'))).toHaveLength(1);
});
it('retains an uncertain submission without inventing a cars list endpoint or purchasing again',async()=>{
 const f=provider('lost');const {trip,b}=await prepare();
 expect((await travelAction(trip.id,b.id,buy,root)).data?.status).toBe('unknown');
 const count=f.mock.calls.length;
 await travelAction(trip.id,b.id,{action:'reconcile'},root);
 expect(f.mock.calls).toHaveLength(count);
 expect((await getTrip(trip.id,root))?.bookings[0].outcomeMessage).toContain('check Duffel/support');
});
it('requires matching driver age before submitting a car reservation',async()=>{
 const f=provider();const {trip,b}=await prepare();
 await expect(travelAction(trip.id,b.id,{...buy,passenger:{...passenger,born_on:'1970-01-01'}},root)).rejects.toThrow('age used');
 expect(f.mock.calls.some(([u])=>u.endsWith('/cars/bookings'))).toBe(false);
});
it('blocks test-location substitution with live credentials',async()=>{
 const f=provider();vi.stubEnv('DUFFEL_API_KEY','duffel_live_fixture');
 await expect(searchTravel({...search,carPreferences:{...prefs,useTestLocation:true}},root)).rejects.toThrow('only with test');
 expect(f).not.toHaveBeenCalled();
});
it('reports Duffel feature access without reflecting arbitrary non-JSON response text',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('This feature is not enabled for your account. secret-untrusted-text',{status:403})));
 await expect(duffel('/stays/search',{})).rejects.toThrow('Stays is not enabled');
 await expect(duffel('/stays/search',{})).rejects.not.toThrow('secret-untrusted-text');
});
it('hotel access failure does not discard car results and cars are searched only when requested',async()=>{
 const f=provider();const trip=(await createTrip({name:'Guided',destination:'Baton Rouge',startsAt:search.departureDate,endsAt:search.returnDate,originPlace:{id:'1',name:'BHM',city:'Birmingham',country:'US',code:'BHM'},destinationPlace:{id:'2',name:'BTR',city:'Baton Rouge',country:'US',code:'BTR',latitude:30.5,longitude:-91.1},needsCar:true,carPreferences:prefs},root)).data!;
 const groups=await travelRecommendations(trip.id,root);
 expect(groups.find(g=>g.kind==='car')?.options).toHaveLength(1);
 expect(groups.find(g=>g.kind==='hotel')?.options).toHaveLength(0);
 expect(f.mock.calls.filter(([u])=>u.endsWith('/cars/search'))).toHaveLength(1);
});

it('reconciles a pending car booking by its known ID using GET only',async()=>{
 const f=provider('pending');const {trip,b}=await prepare();
 const pending=(await travelAction(trip.id,b.id,buy,root)).data!;
 expect(pending.status).toBe('unknown');expect(pending.providerId).toBe('boo_fixture');
 f.mockImplementation(async(url,init)=>{
  expect(url).toBe('https://api.duffel.com/cars/bookings/boo_fixture');expect(init?.method).toBe('GET');
  return reply({id:'boo_fixture',quote_id:'qut_fixture',status:'confirmed',reference:'CAR123',live_mode:false,metadata:{eaios_attempt:pending.attemptId}});
 });
 expect((await travelAction(trip.id,b.id,{action:'reconcile'},root)).data?.status).toBe('confirmed');
});
