import type { TravelBooking } from './types.ts';

export interface TravelPlanInput {
  kind: 'flight' | 'hotel' | 'car' | 'restaurant';
  partySize?: number;
  title: string;
  startsAt: string;
  endsAt?: string;
  location: string;
  externalUrl?: string;
  notes?: string;
}
export function makeTravelPlan(tripId: string, input: TravelPlanInput): TravelBooking {
  const text = (value: unknown, name: string) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw new Error(`${name} is required (maximum 2000 characters).`);
    return value.trim();
  };
  if (input.partySize !== undefined && (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > 30)) throw new Error('Party size must be between 1 and 30.');
  const title = text(input.title, 'Title'), location = text(input.location, 'Location');
  const startsAt = text(input.startsAt, 'Start date');
  if (!/^\d{4}-\d{2}-\d{2}/.test(startsAt) || !Number.isFinite(Date.parse(startsAt))) throw new Error('Enter a valid start date.');
  const endsAt = input.endsAt || startsAt;
  if (!Number.isFinite(Date.parse(endsAt)) || Date.parse(endsAt) < Date.parse(startsAt)) throw new Error('End date must be on or after the start date.');
  let externalUrl: string | undefined;
  if (input.externalUrl) {
    const url = new URL(input.externalUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Booking links must use HTTPS without embedded credentials.');
    externalUrl = url.href;
  }
  const base = { id: `plan-${crypto.randomUUID()}`, tripId, title, status: 'proposed' as const, provider: 'external', externalUrl, notes: input.notes?.slice(0, 2000) };
  switch (input.kind) {
    case 'flight': return { ...base, kind: 'flight', airline: title, flightNumber: '', origin: location, destination: '', departureAt: startsAt, arrivalAt: endsAt, cabin: 'See provider' };
    case 'hotel': return { ...base, kind: 'hotel', hotelName: title, address: location, checkIn: startsAt, checkOut: endsAt, roomType: 'See provider' };
    case 'car': return { ...base, kind: 'car', company: title, carType: '', pickupLocation: location, dropoffLocation: location, pickupAt: startsAt, dropoffAt: endsAt };
    case 'restaurant': return { ...base, kind: 'restaurant', restaurantName: title, address: location, reservationAt: startsAt, partySize: input.partySize || 1 };
    default: throw new Error('Choose a valid reservation type.');
  }
}

export interface TravelPassenger {
  given_name: string;
  family_name: string;
  born_on: string;
  title: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
  gender: 'm' | 'f';
  email: string;
  phone_number: string;
}
export type TravelAction =
  | { action: 'record'; reference: string; evidence: string }
  | { action: 'book'; passenger: TravelPassenger; amount: string; currency: string; accepted: boolean }
  | { action: 'reconcile' }
  | { action: 'quote' };
