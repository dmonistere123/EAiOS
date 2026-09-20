/** Server-only Duffel transport. Never retry order creation automatically. */
export class DuffelError extends Error {
  status: number;
  requestId: string | null;
  constructor(status: number, message: string, requestId: string | null = null) { super(message); this.status = status; this.requestId = requestId; }
}
export function duffelTestMode(): boolean {
  const key = process.env.DUFFEL_API_KEY;
  if (!key) throw new DuffelError(503, 'Duffel is not configured. Use provider-site checkout.');
  return key.startsWith('duffel_test_');
}
export async function duffel<T>(path: string, data?: unknown, correlationId?: string): Promise<T> {
  duffelTestMode();
  const response = await fetch(`https://api.duffel.com${path}`, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${process.env.DUFFEL_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json', 'Duffel-Version': 'v2', ...(correlationId ? {'x-client-correlation-id': correlationId} : {}) },
    body: data === undefined ? undefined : JSON.stringify({data}),
    signal: AbortSignal.timeout(60_000),
  });
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
  if (response.status === 403 && raw.includes('This feature is not enabled for your account')) throw new DuffelError(403, `Duffel ${path.startsWith('/stays/') ? 'Stays' : path.startsWith('/cars/') ? 'Cars' : 'feature'} is not enabled for this account. Request access from Duffel.`, response.headers.get('x-request-id'));
  const json = parsed as {data?: T; errors?: {code?: string}[]} | null;
  if (!response.ok) throw new DuffelError(response.status, `Duffel request failed (HTTP ${response.status}${json?.errors?.[0]?.code ? `, ${json.errors[0].code}` : ''}).`, response.headers.get('x-request-id'));
  if (!json || !('data' in json)) throw new DuffelError(502, 'Duffel returned an incomplete response.');
  return json.data as T;
}
export interface DuffelSegment {
  operating_carrier: {name: string}; marketing_carrier?: {name: string}; marketing_carrier_flight_number?: string;
  origin: {iata_code: string}; destination: {iata_code: string}; departing_at: string; arriving_at: string;
}
export interface FlightOffer {
  id: string; expires_at: string; live_mode: boolean; total_amount: string; total_currency: string;
  owner: {name: string}; passengers: {id: string}[]; slices: {segments: DuffelSegment[]}[];
  conditions?: unknown;
}
export interface DuffelOrder {
  id: string; booking_reference?: string; reference?: string; status?: string; live_mode: boolean;
  quote_id?: string; confirmed_at?: string; driver?: {given_name: string; family_name: string};
  offer_id?: string; metadata?: {eaios_attempt?: string}; cancelled_at?: string;
  payment_status?: {awaiting_payment?: boolean}; slices?: FlightOffer['slices'];
}
export interface StayQuote {
  id: string; total_amount: string; total_currency: string; expires_at?: string;
  accommodation?: StaySearchResult['accommodation']; check_in_date?: string; check_out_date?: string; due_at_accommodation_amount?: string; due_at_accommodation_currency?: string; deposit_amount?: string; deposit_currency?: string;
}
export interface StaySearchResult {
  id: string; expires_at: string; cheapest_rate_total_amount: string; cheapest_rate_currency: string;
  accommodation: {name: string; location?: {address?: {line_one?: string; city_name?: string}}; rooms?: {name: string; rates: {id: string; total_amount: string; total_currency: string; board_type?: string; expires_at?: string; conditions?: unknown; payment_type?: string; loyalty_programme_required?: boolean; due_at_accommodation_amount?: string; due_at_accommodation_currency?: string; cancellation_timeline?: unknown}[]}[]};
}
export function flightDetails(offer: FlightOffer): string {
  return offer.slices.map((slice, i) => `Journey ${i + 1}: ` + slice.segments.map(s => `${s.operating_carrier?.name ?? s.marketing_carrier?.name ?? offer.owner.name} ${s.marketing_carrier_flight_number ?? ''}: ${s.origin.iata_code} ${s.departing_at} → ${s.destination.iata_code} ${s.arriving_at}`).join('\n')).join('\n');
}

export function flightTerms(offer: FlightOffer): string {
  const conditions = offer.conditions as Record<string, {allowed?: boolean; penalty_amount?: string; penalty_currency?: string} | null> | undefined;
  return [flightDetails(offer), ...(['change_before_departure','refund_before_departure'] as const).map(key => {
    const rule = conditions?.[key], label = key === 'change_before_departure' ? 'Changes before departure' : 'Refund before departure';
    return `${label}: ${!rule ? 'not specified by provider' : rule.allowed ? `allowed${rule.penalty_amount ? `; penalty ${rule.penalty_currency} ${rule.penalty_amount}` : '; check fare rules for fees'}` : 'not allowed'}`;
  })].join('\n');
}
