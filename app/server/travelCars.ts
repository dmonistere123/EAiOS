import {duffel, duffelTestMode} from './duffel.ts';
import {cacheOffer, TravelApiError} from './travel.ts';
import type {TravelSearchParams, TravelSearchResult} from '../src/adapters/interfaces.ts';
import type {CarPreferences} from '../src/domain/travelGuide.ts';

interface Location {
  name: string;
  address?: {line_one?: string; city_name?: string; country_code?: string};
  phone_number?: string;
  additional_information?: {title?: string; text?: string}[];
  opening_hours?: {from: string; to: string}[];
}
export interface CarRate {
  id: string; rate_id?: string; live_mode?: boolean;
  total_amount: string; total_currency: string; payment_type: string;
  supplier: {name: string};
  car: {name: string; category?: string; transmission?: string; max_passengers?: number; baggage?: {small?: number; large?: number}; fuel?: string; air_conditioning?: boolean};
  pickup_location: Location; dropoff_location: Location;
  pickup_date?: string; pickup_time?: string; dropoff_date?: string; dropoff_time?: string;
  conditions?: {title?: string; text?: string}[];
  privacy_policies?: {title?: string; text?: string}[];
  charges?: {description?: string; currency?: string; amount?: string}[];
  mileage?: Record<string, unknown>;
}
export function validateCarPreferences(value: CarPreferences | undefined): CarPreferences | undefined {
  if (value === undefined) return;
  if (!value || !Number.isInteger(value.driverAge) || value.driverAge < 18 || value.driverAge > 100 ||
      !/^[A-Z]{2}$/.test(value.residenceCountry) || ![value.pickupTime, value.dropoffTime].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
    throw new TravelApiError(400, 'Enter the driver’s age at pickup (18–100), country of residence, and pickup/return times.');
  }
  return {driverAge:value.driverAge, residenceCountry:value.residenceCountry, pickupTime:value.pickupTime, dropoffTime:value.dropoffTime, useTestLocation:value.useTestLocation === true};
}
export const carLocation = (p: Location) => [p.name,p.address?.line_one,p.address?.city_name,p.address?.country_code].filter(Boolean).join(', ');
export function carDetails(rate: CarRate): string {
  const rules = (rows?: {title?: string; text?: string}[]) => (rows ?? []).map(r=>`${r.title ?? ''}: ${r.text ?? ''}`).join('\n') || 'Not supplied';
  const location = (p: Location) => `${carLocation(p)}${p.phone_number ? `; phone ${p.phone_number}` : ''}\n${rules(p.additional_information)}\nOpening hours: ${(p.opening_hours ?? []).map(h=>`${h.from}–${h.to}`).join(', ') || 'Check with supplier'}`;
  return [
    `${rate.supplier.name} — ${rate.car.name} (or similar)`,
    `${rate.car.category ?? ''}; ${rate.car.transmission ?? ''}; seats ${rate.car.max_passengers ?? 'not supplied'}; fuel ${rate.car.fuel ?? 'not supplied'}; A/C ${rate.car.air_conditioning === undefined ? 'not supplied' : rate.car.air_conditioning ? 'yes' : 'no'}`,
    `Bags: ${rate.car.baggage?.large ?? '?'} large / ${rate.car.baggage?.small ?? '?'} small`,
    `Pickup: ${rate.pickup_date ?? ''} ${rate.pickup_time ?? ''}\n${location(rate.pickup_location)}`,
    `Return: ${rate.dropoff_date ?? ''} ${rate.dropoff_time ?? ''}\n${location(rate.dropoff_location)}`,
    'Times are local to the rental location. Pay at the counter; no online charge. Supplier deposit and eligibility conditions still apply.',
    `Mileage: ${JSON.stringify(rate.mileage ?? 'Not supplied')}`,
    `Included charges: ${(rate.charges ?? []).map(c=>`${c.description}: ${c.currency} ${c.amount}`).join('; ') || 'See supplier conditions'}`,
    `Rental conditions:\n${rules(rate.conditions)}`,
    `Privacy policies:\n${rules(rate.privacy_policies)}`,
  ].join('\n');
}
export async function searchDuffelCars(params: TravelSearchParams, root: string): Promise<TravelSearchResult[]> {
  const pref = validateCarPreferences(params.carPreferences);
  if (!pref) throw new TravelApiError(400, 'Add driver age, country of residence, and pickup/return times to search cars.');
  if (pref.useTestLocation && !duffelTestMode()) throw new TravelApiError(400, 'The Duffel test location is available only with test credentials.');
  const latitude = pref.useTestLocation ? -24.38 : params.latitude, longitude = pref.useTestLocation ? -128.32 : params.longitude;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude!) > 90 || Math.abs(longitude!) > 180) throw new TravelApiError(400, 'Choose a destination airport with a rental search location.');
  if (`${params.returnDate}T${pref.dropoffTime}` <= `${params.departureDate}T${pref.pickupTime}`) throw new TravelApiError(400, 'Car return must be after pickup.');
  const location = {radius:5, geographic_coordinates:{latitude,longitude}};
  const response = await duffel<{live_mode:boolean; rates:CarRate[]}>('/cars/search', {
    pickup_date:params.departureDate, pickup_time:pref.pickupTime, dropoff_date:params.returnDate, dropoff_time:pref.dropoffTime,
    pickup_location:location, dropoff_location:location, driver:{age:pref.driverAge,residence_country_code:pref.residenceCountry},
  });
  if (response.live_mode !== !duffelTestMode()) throw new TravelApiError(502, 'Car search returned a different provider mode.');
  // Card guarantees and prepaid card charges require a separate payment integration.
  return response.rates.filter(r=>r.payment_type === 'postpaid').map(rate=>{
    const result: TravelSearchResult = {id:rate.id,kind:'car',provider:'duffel',title:`${rate.supplier.name} — ${rate.car.name}`,
      subtitle:`${rate.car.category ?? 'Car'} · ${rate.car.transmission ?? 'See transmission'} · ${rate.car.max_passengers ?? '?'} seats · pay at counter`,
      amount:rate.total_amount,currency:rate.total_currency,testMode:!response.live_mode,
      priceUsd:rate.total_currency === 'USD' ? Number(rate.total_amount) : undefined,
      meta:{company:rate.supplier.name,carType:rate.car.name,pickupLocation:carLocation(rate.pickup_location),dropoffLocation:carLocation(rate.dropoff_location),
        pickupAt:`${params.departureDate}T${pref.pickupTime}`,dropoffAt:`${params.returnDate}T${pref.dropoffTime}`,
        driverAge:String(pref.driverAge),residenceCountry:pref.residenceCountry,
        details:carDetails({...rate,pickup_date:params.departureDate,pickup_time:pref.pickupTime,dropoff_date:params.returnDate,dropoff_time:pref.dropoffTime})},
    };
    cacheOffer(root,result,Date.now()+15*60_000);
    return result;
  });
}
