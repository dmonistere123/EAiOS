import type { TravelTrip } from './types.ts';
import type { TravelShortlist } from './travelGuide.ts';

export const travelPurposes = ['Personal', 'Board Meeting', 'Customer Meeting', 'Internal Meeting'] as const;
export type TravelPurpose = typeof travelPurposes[number];
export interface TripMessage { role: 'user' | 'assistant'; text: string; at: string }
export interface TripPlanningFields {
  purpose?: TravelPurpose;
  tripNotes?: string;
  airlinePolicy?: 'prefer' | 'only';
  diningLocation?: string;
}
export interface TripConversationResult {
  trip: TravelTrip;
  reply: string;
  changed: string[];
  refreshKinds: TravelShortlist['kind'][];
  needsClarification: boolean;
}
