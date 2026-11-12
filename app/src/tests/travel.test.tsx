import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Travel from '../pages/Travel';
import {tripConversation} from '../adapters/travelConversation';
import {hermes} from '../adapters';

vi.mock('../adapters/travelConversation',()=>({tripConversation:{send:vi.fn(),recommendations:vi.fn()}}));
vi.mock('../adapters',()=>({travelMode:'live',hermes:{listTrips:vi.fn(),getTrip:vi.fn(),travelPlaces:vi.fn(),travelRecommendations:vi.fn(),createTrip:vi.fn(),updateTravelTrip:vi.fn(),chooseTravelOption:vi.fn()}}));
const origin={id:'bhm',name:'Birmingham-Shuttlesworth International',city:'Birmingham',country:'US',code:'BHM'};
const destination={id:'btr',name:'Baton Rouge Metropolitan',city:'Baton Rouge',country:'US',code:'BTR'};
const trip={id:'trip-guide',name:'Baton Rouge visit',destination:'Baton Rouge',startsAt:'2027-01-10',endsAt:'2027-01-12',status:'planning' as const,bookings:[],approvals:[],preferredHotels:'IHG',preferredAirlines:'Southwest',diningPreferences:'Seafood',budgetUsd:1000,needsCar:false};
const option={id:'off_test',kind:'flight' as const,title:'Example flight',subtitle:'Outbound and return itinerary',provider:'duffel',amount:'200.00',currency:'USD',testMode:true,meta:{},reason:'Selected from available offers.'};
beforeEach(()=>{
 vi.clearAllMocks();
 vi.mocked(hermes.listTrips).mockResolvedValue([trip]);
 vi.mocked(hermes.travelPlaces).mockImplementation(async q=>q.toLowerCase().includes('birmingham')?[origin]:[destination]);
 vi.mocked(hermes.createTrip).mockImplementation(async input=>({ok:true,data:{...trip,...input},auditEventId:'a'}));
 vi.mocked(hermes.updateTravelTrip).mockImplementation(async(_,input)=>({ok:true,data:{...trip,...input},auditEventId:'a'}));
 vi.mocked(hermes.travelRecommendations).mockResolvedValue([{kind:'flight',options:[option]},{kind:'hotel',options:[],notice:'Hotel access is not connected.'},{kind:'restaurant',options:[],notice:'Restaurant access is not connected.'}]);
});
async function details(){
 await userEvent.type(screen.getByLabelText('Trip name'),'Board visit');
 await userEvent.type(screen.getByLabelText('Where are you going?'),'Baton Rouge');
 await userEvent.type(screen.getByLabelText('Where are you leaving from?'),'Birmingham');
 await userEvent.click(await screen.findByRole('button',{name:/Birmingham, US/}));
 await userEvent.type(screen.getByLabelText('Which airport will you fly into?'),'Baton Rouge');
 await userEvent.click(await screen.findByRole('button',{name:/Baton Rouge, US/}));
 fireEvent.change(screen.getByLabelText('Departure date'),{target:{value:'2027-01-10'}});
 fireEvent.change(screen.getByLabelText('Return date'),{target:{value:'2027-01-12'}});

}
describe('guided Travel',()=>{
 it('starts with city names and clickable calendar inputs, not provider codes or approvals',()=>{
  render(<Travel/>);
  expect(screen.getByRole('heading',{name:'Tell Ally about your trip'})).toBeInTheDocument();
  expect(screen.getByLabelText('Departure date')).toHaveAttribute('type','date');
  expect(screen.queryByText('Origin airport code')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Approve'})).not.toBeInTheDocument();
 });
 it('requires a city choice instead of guessing an airport from typed text',async()=>{
  render(<Travel/>);
  await userEvent.click(screen.getByRole('button',{name:'Find my options →'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a trip name');
  expect(hermes.createTrip).not.toHaveBeenCalled();
 });
 it('carries cities, dates, preferences and car choice into one search',async()=>{
  render(<Travel/>);await details();
  await userEvent.type(screen.getByLabelText('Total trip budget (USD)'),'1000');
  await userEvent.type(screen.getByLabelText('Preferred airlines'),'Southwest');
  await userEvent.click(screen.getByLabelText('Yes, include a car'));
  await userEvent.type(screen.getByLabelText('Driver’s age at pickup (optional for human booking)'),'30');
  await userEvent.click(screen.getByRole('button',{name:'Find my options →'}));
  expect(await screen.findByText('Example flight')).toBeInTheDocument();
  expect(hermes.createTrip).toHaveBeenCalledWith(expect.objectContaining({originPlace:origin,destinationPlace:destination,startsAt:'2027-01-10',endsAt:'2027-01-12',budgetUsd:1000,needsCar:true}));
  expect(hermes.travelRecommendations).toHaveBeenCalledWith(trip.id);
  expect(screen.getByText('Hotel access is not connected.')).toBeInTheDocument();
  expect(within(screen.getByRole('region',{name:'Hotels'})).queryByRole('button',{name:'Choose this option'})).not.toBeInTheDocument();
 });
 it('opens saved trips into a single itinerary and pre-fills existing dates and preferences',async()=>{
  render(<Travel/>);await userEvent.click(await screen.findByRole('button',{name:/Baton Rouge visit/}));
  expect(screen.getByRole('heading',{name:'Baton Rouge visit'})).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Find options for this trip'}));
  expect(screen.getByLabelText('Departure date')).toHaveValue('2027-01-10');
  expect(screen.getByLabelText('Where are you going?')).toHaveValue('Baton Rouge');
 });
 it('saves a choice without sending a purchase or opening an approvals tab',async()=>{
  const booking={id:'b',tripId:trip.id,kind:'flight' as const,status:'approved' as const,provider:'duffel',offerId:option.id,airline:'Example flight',flightNumber:'',origin:'BHM',destination:'BTR',departureAt:trip.startsAt,arrivalAt:trip.startsAt,cabin:'Economy'};
  vi.mocked(hermes.chooseTravelOption).mockResolvedValue({ok:true,data:booking,auditEventId:'a'});
  vi.mocked(hermes.getTrip).mockResolvedValue({...trip,bookings:[booking]});
  render(<Travel/>);await details();await userEvent.click(screen.getByRole('button',{name:'Find my options →'}));
  await userEvent.click(await screen.findByRole('button',{name:'Choose this option'}));
  expect(await screen.findByRole('button',{name:'Selected'})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:'Finalize my itinerary →'}));
  expect(screen.getByText('Selected · not booked')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Approve'})).not.toBeInTheDocument();
 });
});

it('opens a visible in-page calendar and applies a clicked date',async()=>{
 render(<Travel/>);
 await userEvent.click(screen.getByRole('button',{name:'Open departure date calendar'}));
 const dialog=screen.getByRole('dialog',{name:'Choose departure date'});
 const now=new Date();const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-15`;
 await userEvent.click(within(dialog).getByRole('button',{name:date}));
 expect(screen.getByLabelText('Departure date')).toHaveValue(date);
 expect(screen.queryByRole('dialog',{name:'Choose departure date'})).not.toBeInTheDocument();
});

it('interprets the trip brief then refreshes only hotels after a conversational refinement',async()=>{
 const planned={...trip,name:'Board visit',destination:'Baton Rouge',originPlace:origin,destinationPlace:destination,tripNotes:'IHG hotels please',interpretedNotes:'IHG hotels please',conversation:[{role:'assistant' as const,text:'I will find IHG hotels.',at:'now'}]};
 vi.mocked(tripConversation.send).mockResolvedValueOnce({trip:planned,reply:'I will find IHG hotels.',changed:[],refreshKinds:['hotel'],needsClarification:false});
 render(<Travel/>);await details();
 await userEvent.type(screen.getByLabelText('Tell Ally about the trip'),'IHG hotels please');
 await userEvent.click(screen.getByRole('button',{name:'Find my options →'}));
 await screen.findByText('Example flight');
 expect(tripConversation.send).toHaveBeenCalledWith(trip.id,'IHG hotels please',true);
 vi.mocked(tripConversation.send).mockResolvedValueOnce({trip:{...planned,preferredHotels:'Hilton',conversation:[...planned.conversation,{role:'assistant',text:'I will find Hilton hotels.',at:'now'}]},reply:'I will find Hilton hotels.',changed:['Hotel preferences'],refreshKinds:['hotel'],needsClarification:false});
 vi.mocked(tripConversation.recommendations).mockResolvedValue([{kind:'hotel',options:[],notice:'No hotels returned.'}]);
 await userEvent.type(screen.getByLabelText('Message Ally'),'Try Hilton instead.');
 await userEvent.click(screen.getByRole('button',{name:'Send to Ally'}));
 await screen.findByText('No hotels returned.');
 expect(tripConversation.recommendations).toHaveBeenCalledWith(trip.id,['hotel']);
 expect(hermes.travelRecommendations).toHaveBeenCalledTimes(1);
 expect(screen.getByText('Example flight')).toBeInTheDocument();
 expect(screen.getByLabelText('Message Ally')).toHaveValue('');
});

it('starts a separate trip from saved preferences and requires new dates',async()=>{
 const previous={...trip,originPlace:origin,destinationPlace:destination,airlinePolicy:'only' as const,purpose:'Board Meeting' as const,tripNotes:'Meet on January 10',conversation:[{role:'user' as const,text:'Old trip instructions',at:'old'}]};
 vi.mocked(hermes.listTrips).mockResolvedValue([previous]);
 render(<Travel/>);
 await userEvent.selectOptions(await screen.findByLabelText('Plan a similar trip'),trip.id);
 expect(screen.getByLabelText('Where are you going?')).toHaveValue('Baton Rouge');
 expect(screen.getByLabelText('Preferred airlines')).toHaveValue('Southwest');
 expect(screen.getByLabelText('Airline requirement')).toHaveValue('only');
 expect(screen.getByLabelText('Preferred hotels')).toHaveValue('IHG');
 expect(screen.getByLabelText('Reason for travel')).toHaveValue('Board Meeting');
 expect(screen.getByLabelText('Departure date')).toHaveValue('');
 expect(screen.getByLabelText('Return date')).toHaveValue('');
 expect(screen.getByLabelText('Tell Ally about the trip')).toHaveValue('');
 await userEvent.click(screen.getByRole('button',{name:'Find my options →'}));
 expect(hermes.createTrip).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Departure date'),{target:{value:'2027-03-10'}});
 fireEvent.change(screen.getByLabelText('Return date'),{target:{value:'2027-03-12'}});
 await userEvent.click(screen.getByRole('button',{name:'Find my options →'}));
 await screen.findByText('Example flight');
 expect(hermes.createTrip).toHaveBeenCalledWith(expect.objectContaining({basedOnTripId:trip.id,startsAt:'2027-03-10',endsAt:'2027-03-12',preferredAirlines:'Southwest',airlinePolicy:'only'}));
 expect(hermes.updateTravelTrip).not.toHaveBeenCalled();
 expect(vi.mocked(hermes.createTrip).mock.calls[0][0]).not.toHaveProperty('bookings');
});
