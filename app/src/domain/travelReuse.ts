import type { CreateTripInput } from '../adapters/interfaces.ts';
import type { TravelTrip } from './types.ts';

/** A new trip draft, never a copy of reservations, approvals, conversations or dated instructions. */
export function similarTripDraft(source:TravelTrip):CreateTripInput {
  return {
    name:`${source.destination} return visit`,destination:source.destination,
    originPlace:source.originPlace?{...source.originPlace}:undefined,
    destinationPlace:source.destinationPlace?{...source.destinationPlace}:undefined,
    purpose:source.purpose,startsAt:'',endsAt:'',budgetUsd:source.budgetUsd,
    preferredAirlines:source.preferredAirlines,airlinePolicy:source.airlinePolicy,
    preferredHotels:source.preferredHotels,diningPreferences:source.diningPreferences,
    diningLocation:source.diningLocation,needsCar:source.needsCar,tripNotes:'',
    basedOnTripId:source.id,
  };
}
