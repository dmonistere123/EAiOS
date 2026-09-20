import {beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Travel from '../pages/Travel';
import {hermes} from '../adapters';

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
 await userEvent.type(screen.getByLabelText('Leaving from'),'Birmingham');
 await userEvent.click(await screen.findByRole('button',{name:/Birmingham, US/}));
 await userEvent.type(screen.getByLabelText('Going to'),'Baton Rouge');
 await userEvent.click(await screen.findByRole('button',{name:/Baton Rouge, US/}));
 fireEvent.change(screen.getByLabelText('Departure date'),{target:{value:'2027-01-10'}});
 fireEvent.change(screen.getByLabelText('Return date'),{target:{value:'2027-01-12'}});
 await userEvent.click(screen.getByRole('button',{name:'Continue to preferences →'}));
}
describe('guided Travel',()=>{
 it('starts with city names and clickable calendar inputs, not provider codes or approvals',()=>{
  render(<Travel/>);
  expect(screen.getByRole('heading',{name:'Where are we going?'})).toBeInTheDocument();
  expect(screen.getByLabelText('Departure date')).toHaveAttribute('type','date');
  expect(screen.queryByText('Origin airport code')).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Approve'})).not.toBeInTheDocument();
 });
 it('requires a city choice instead of guessing an airport from typed text',async()=>{
  render(<Travel/>);
  await userEvent.click(screen.getByRole('button',{name:'Continue to preferences →'}));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose your departure');
  expect(hermes.createTrip).not.toHaveBeenCalled();
 });
 it('carries cities, dates, preferences and car choice into one search',async()=>{
  render(<Travel/>);await details();
  await userEvent.type(screen.getByLabelText('Total trip budget (USD)'),'1000');
  await userEvent.type(screen.getByLabelText('Preferred airlines'),'Southwest');
  await userEvent.click(screen.getByLabelText('Yes, include a car'));
  await userEvent.type(screen.getByLabelText('Driver’s age at pickup'),'30');
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
  expect(screen.getByText(/Your saved destination is Baton Rouge/)).toBeInTheDocument();
 });
 it('saves a choice without sending a purchase or opening an approvals tab',async()=>{
  const booking={id:'b',tripId:trip.id,kind:'flight' as const,status:'approved' as const,provider:'duffel',offerId:option.id,airline:'Example flight',flightNumber:'',origin:'BHM',destination:'BTR',departureAt:trip.startsAt,arrivalAt:trip.startsAt,cabin:'Economy'};
  vi.mocked(hermes.chooseTravelOption).mockResolvedValue({ok:true,data:booking,auditEventId:'a'});
  vi.mocked(hermes.getTrip).mockResolvedValue({...trip,bookings:[booking]});
  render(<Travel/>);await details();await userEvent.click(screen.getByRole('button',{name:'Find my options →'}));
  await userEvent.click(await screen.findByRole('button',{name:'Choose this option'}));
  expect(await screen.findByRole('button',{name:'Selected'})).toBeDisabled();
  await userEvent.click(screen.getByRole('button',{name:'Review my itinerary →'}));
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
