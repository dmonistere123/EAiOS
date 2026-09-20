import type { TravelSearchResult } from '../adapters/interfaces.ts';
export interface TravelPlace {
  id: string;
  name: string;
  city: string;
  country: string;
  code: string;
  latitude?: number;
  longitude?: number;
}
export interface TravelShortlist {
  kind: 'flight' | 'hotel' | 'restaurant' | 'car';
  options: (TravelSearchResult & {reason: string})[];
  notice?: string;
}
/** Keep the shortlist grounded in actual returned offers, including when AI is unavailable. */
export function shortlist(rows: TravelSearchResult[], preference = '', budgetUsd?: number): TravelShortlist['options'] {
  const prefs = preference.toLowerCase().split(/[,;]/).map(s => s.trim()).filter(s => s && s !== 'no preference');
  const matches = (r: TravelSearchResult) => prefs.some(p => `${r.title} ${r.subtitle}`.toLowerCase().includes(p));
  const sorted = [...rows].sort((a,b) => Number(matches(b))-Number(matches(a)) || (a.currency === b.currency ? Number(a.amount ?? a.priceUsd ?? Infinity)-Number(b.amount ?? b.priceUsd ?? Infinity) : 0));
  const seen = new Set<string>();
  return sorted.filter(row => {
    const key = row.kind === 'hotel' ? row.meta.accommodationId ?? row.title : `${row.title}|${row.subtitle}`;
    if(seen.has(key))return false;
    seen.add(key);return true;
  }).slice(0,3).map(row => ({...row, reason: [matches(row) ? 'Matches your stated preference.' : 'Selected from the available provider results.', row.currency === 'USD' && budgetUsd !== undefined && Number(row.amount) > budgetUsd ? 'This option alone exceeds your total trip budget.' : ''].filter(Boolean).join(' ')}));
}

export interface CarPreferences {
  driverAge: number;
  residenceCountry: string;
  pickupTime: string;
  dropoffTime: string;
  useTestLocation?: boolean;
}
