/** Persistent trip planning; approval alone never means a purchase succeeded. */
import { duffel, duffelTestMode, DuffelError, flightDetails, flightTerms, type FlightOffer, type StaySearchResult } from './duffel.ts';
import type { TravelBooking, TravelTrip, TravelApproval, ApprovalDecision, AuditResult, TravelFlight, TravelHotel, TravelCar, TravelRestaurant } from '../src/domain/types.ts';
import type { TravelSearchParams, TravelSearchResult, CreateTripInput } from '../src/adapters/interfaces.ts';
import { travelStore, readTrip, writeTrip } from './travelStore.ts';
import { makeTravelPlan, type TravelPlanInput } from '../src/domain/travelPlan.ts';
import {searchDuffelCars, validateCarPreferences} from './travelCars.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const uid = (p: string) => `${p}-${crypto.randomUUID()}`;
let auditSeq = 3000;
const audit = <T,>(data?: T): AuditResult<T> => ({ ok: true, data, auditEventId: `aud-${auditSeq++}` });

export class TravelApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function providerStatus(): { duffel: boolean; opentable: boolean } {
  return {
    duffel: !!process.env.DUFFEL_API_KEY,
    opentable: !!process.env.OPENTABLE_API_KEY,
  };
}

function requiredEnv(name: string): string {
  const k = process.env[name] ?? '';
  if (!k) throw new TravelApiError(503, `${name} not configured`);
  return k;
}

function toApprovalTarget(provider: string): TravelApproval['targetSystem'] {
  if (provider === 'duffel' || provider === 'opentable') return provider;
  return 'other';
}

function assertParams(kind: TravelSearchParams['kind'], params: TravelSearchParams) {
  if (kind === 'flight') {
    for (const field of ['origin', 'destination'] as const) {
      if (!/^[A-Z]{3}$/.test(params[field] ?? '')) throw new TravelApiError(400, `${field === 'origin' ? 'Origin' : 'Destination'} must be a three-letter airport code, such as BHM or JFK. City names are not supported in these fields yet.`);
    }
    if (!params.departureDate) {
      throw new TravelApiError(400, 'Flight search requires origin, destination, and departureDate');
    }
  } else if (kind === 'hotel') {
    if (!params.destination || !params.checkIn || !params.checkOut) {
      throw new TravelApiError(400, 'Hotel search requires destination, checkIn, and checkOut');
    }
  } else if (kind === 'car') {
    if (!params.pickupLocation || !params.dropoffLocation || !params.departureDate || !params.returnDate) {
      throw new TravelApiError(400, 'Car search requires pickupLocation, dropoffLocation, departureDate, returnDate');
    }
  } else if (kind === 'restaurant') {
    if (!params.destination || !params.date || !params.partySize) {
      throw new TravelApiError(400, 'Restaurant search requires destination, date, and partySize');
    }
  }
}

// ---------- Duffel flight provider ----------

async function searchDuffelFlights(params: TravelSearchParams, dataRoot: string): Promise<TravelSearchResult[]> {
  const slices = [{ origin: params.origin!, destination: params.destination!, departure_date: params.departureDate! }];
  if (params.returnDate) slices.push({origin: params.destination!, destination: params.origin!, departure_date: params.returnDate});
  const response = await duffel<{offers: FlightOffer[]}>('/air/offer_requests', {cabin_class: 'economy', passengers: [{type: 'adult'}], slices});
  return response.offers.map(offer => {
    const segments = offer.slices[0].segments;
    const first = segments[0], last = segments[segments.length - 1];
    const result: TravelSearchResult = {
      id: offer.id, kind: 'flight', title: offer.owner.name, subtitle: flightDetails(offer),
      amount: offer.total_amount, currency: offer.total_currency, testMode: !offer.live_mode,
      priceUsd: offer.total_currency === 'USD' ? Number(offer.total_amount) : undefined, provider: 'duffel',
      meta: {airline: offer.owner.name, flightNumber: first.marketing_carrier_flight_number ?? '', origin: first.origin.iata_code, destination: last.destination.iata_code, departureAt: first.departing_at, arrivalAt: last.arriving_at, cabin: 'Economy', stops: String(segments.length - 1), returnDepartureAt: offer.slices[1]?.segments[0]?.departing_at ?? '', returnArrivalAt: offer.slices[1]?.segments.at(-1)?.arriving_at ?? '', details: flightTerms(offer), conditions: JSON.stringify(offer.conditions ?? {}), passengerId: offer.passengers[0].id},
    };
    cacheOffer(dataRoot, result, Date.parse(offer.expires_at));
    return result;
  });
}
export function cacheOffer(root: string, result: TravelSearchResult, expires: number) {
  travelStore(root, db => {
    db.prepare('DELETE FROM offers WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT OR REPLACE INTO offers VALUES (?, ?, ?)').run(result.id, JSON.stringify(result), Number.isFinite(expires) ? expires : Date.now());
  });
}
async function searchDuffelStays(params: TravelSearchParams, root: string): Promise<TravelSearchResult[]> {
  if (!Number.isFinite(params.latitude) || !Number.isFinite(params.longitude) || Math.abs(params.latitude!) > 90 || Math.abs(params.longitude!) > 180) throw new TravelApiError(400, 'Hotel API search needs latitude and longitude. You can also use hotel-site checkout.');
  const input = {rooms: 1, guests: [{type: 'adult'}], check_in_date: params.checkIn, check_out_date: params.checkOut, location: {radius: 5, geographic_coordinates: {latitude: params.latitude, longitude: params.longitude}}};
  const response = await duffel<{results: StaySearchResult[]}>('/stays/search', input);
  const results: TravelSearchResult[] = [];
  // Limit rate expansion to avoid an unbounded provider request fan-out.
  for (const row of response.results.slice(0, 5)) {
    const full = await duffel<StaySearchResult>(`/stays/search_results/${encodeURIComponent(row.id)}/actions/fetch_all_rates`, {});
    for (const room of full.accommodation.rooms ?? []) for (const rate of room.rates) {
      if (rate.loyalty_programme_required || rate.payment_type !== 'pay_now') continue;
      const result: TravelSearchResult = {id: rate.id, kind: 'hotel', title: full.accommodation.name, subtitle: `${room.name} · ${rate.board_type ?? 'See rate conditions'}`, provider: 'duffel', amount: rate.total_amount, currency: rate.total_currency, testMode: duffelTestMode(), priceUsd: rate.total_currency === 'USD' ? Number(rate.total_amount) : undefined,
        meta: {accommodationId: full.id, hotelName: full.accommodation.name, roomType: room.name, address: full.accommodation.location?.address?.line_one ?? params.destination!, checkIn: params.checkIn!, checkOut: params.checkOut!, conditions: JSON.stringify({cancellation: rate.cancellation_timeline, conditions: rate.conditions, dueAtProperty: rate.due_at_accommodation_amount ?? 'Unknown', dueAtPropertyCurrency: rate.due_at_accommodation_currency})}};
      cacheOffer(root, result, Date.parse(rate.expires_at ?? full.expires_at)); results.push(result);
    }
  }
  return results;
}

// ---------- OpenTable restaurant provider ----------

async function searchOpenTable(_params: TravelSearchParams): Promise<TravelSearchResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  requiredEnv('OPENTABLE_API_KEY');
  throw new TravelApiError(503, 'OpenTable partner booking integration is not yet enabled. An API key alone does not enable in-app table times or reservations.');
}

// ---------- Provider router ----------

async function fetchLiveResults(params: TravelSearchParams, dataRoot: string): Promise<TravelSearchResult[]> {
  const status = providerStatus();
  if (params.kind === 'flight') {
    if (!status.duffel) throw new TravelApiError(503, 'Flight provider not configured: configure Duffel to search flights, or use assisted checkout');
    return searchDuffelFlights(params, dataRoot);
  }
  if (params.kind === 'hotel') return searchDuffelStays(params, dataRoot);
  if (params.kind === 'car') {
    return searchDuffelCars(params, dataRoot);
  }
  if (params.kind === 'restaurant') {
    if (!status.opentable) throw new TravelApiError(503, 'Restaurant search is not connected. In-app table times and reservations require OpenTable partner approval and booking API access.');
    return searchOpenTable(params);
  }
  throw new TravelApiError(400, `Unsupported travel search kind: ${params.kind}`);
}

export async function listTrips(dataRoot: string): Promise<TravelTrip[]> {
  return travelStore(dataRoot, db => (db.prepare('SELECT body FROM trips').all() as { body: string }[]).map(row => JSON.parse(row.body) as TravelTrip).sort((a,b) => a.startsAt.localeCompare(b.startsAt)));
}
export async function getTrip(id: string, dataRoot: string): Promise<TravelTrip | null> {
  return travelStore(dataRoot, db => readTrip(db, id));
}
export async function searchTravel(params: TravelSearchParams, dataRoot: string): Promise<TravelSearchResult[]> {
  const normalized = params.kind === 'flight' ? {...params, origin: typeof params.origin === 'string' ? params.origin.trim().toUpperCase() : '', destination: typeof params.destination === 'string' ? params.destination.trim().toUpperCase() : ''} : params;
  assertParams(normalized.kind, normalized);
  try { return await fetchLiveResults(normalized, dataRoot); }
  catch (error) {
    if (error instanceof DuffelError && error.message.includes('invalid_iata_code')) throw new TravelApiError(400, `Duffel did not recognize one of these airport codes: ${normalized.origin} → ${normalized.destination}. Check both codes; use three-letter codes such as BHM or JFK, not city names.`);
    throw error;
  }
}
export async function createTrip(input: CreateTripInput, dataRoot: string): Promise<AuditResult<TravelTrip>> {
  if (typeof input.name !== 'string' || !input.name.trim() || typeof input.destination !== 'string' || !input.destination.trim() ||
      !Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.endsAt)) || Date.parse(input.endsAt) < Date.parse(input.startsAt)) {
    throw new TravelApiError(400, 'Enter a trip name, destination, and valid dates in order.');
  }
  if (input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd) || input.budgetUsd < 0)) throw new TravelApiError(400, 'Budget must be a positive amount.');
  const preferences = { originPlace: validatePlace(input.originPlace), destinationPlace: validatePlace(input.destinationPlace), needsCar: input.needsCar === true, carPreferences: validateCarPreferences(input.carPreferences), budgetUsd: input.budgetUsd, preferredAirlines: String(input.preferredAirlines ?? '').slice(0, 1000), preferredHotels: String(input.preferredHotels ?? '').slice(0, 1000), diningPreferences: String(input.diningPreferences ?? '').slice(0, 1000) };
  const trip: TravelTrip = { ...preferences, id: crypto.randomUUID(), name: input.name.trim(), destination: input.destination.trim(), startsAt: input.startsAt, endsAt: input.endsAt, status: 'planning', bookings: [], approvals: [] };
  travelStore(dataRoot, db => writeTrip(db, trip));
  return audit(trip);
}

export async function proposeBooking(tripId: string, resultId: string, note: string | undefined, dataRoot: string, selectPlan = false): Promise<AuditResult<TravelBooking>> {
  return travelStore(dataRoot, db => {
  const trip = readTrip(db, tripId);
  if (!trip) throw new TravelApiError(404, 'Trip not found');

  const stored = db.prepare('SELECT body FROM offers WHERE id=? AND expires_at>?').get(resultId, Date.now()) as { body: string } | undefined;
  const result = stored ? JSON.parse(stored.body) as TravelSearchResult : undefined;
  if (!result) {
    throw new TravelApiError(503, 'Search result expired or no live provider is configured — search again with a configured provider, or add a plan using assisted checkout');
  }

  if(selectPlan) { const existing = trip.bookings.find(b => b.offerId === result.id && b.status === 'approved'); if(existing) return audit(existing); }
  if(selectPlan && ['flight','hotel','car'].includes(result.kind)) {
    if(trip.bookings.some(b=>b.kind===result.kind && ['confirmed','recorded','unknown','submitting'].includes(b.status))) throw new TravelApiError(409,'This trip already has a reservation or pending provider outcome in this category. Review your itinerary before adding another.');
    for(const old of trip.bookings.filter(b=>b.kind===result.kind && ['proposed','approved'].includes(b.status) && !b.attemptId)) {
      old.status='cancelled';
      const approval=trip.approvals.find(a=>a.bookingId===old.id&&a.status==='pending');if(approval)approval.status='rejected';
    }
  }
  const meta = result.meta;
  let booking: TravelBooking;
  const base = {
    id: crypto.randomUUID(),
    offerId: result.id, amount: result.amount, currency: result.currency, testMode: result.testMode, details: meta.details ?? `${result.subtitle}\nReview current provider conditions before checkout.`,
    tripId,
    kind: result.kind,
    status: selectPlan ? 'approved' as const : 'proposed' as const,
    provider: result.provider,
    costUsd: result.priceUsd,
    externalUrl: result.externalUrl,
  };

  if (result.kind === 'flight') {
    booking = {
      ...base,
      kind: 'flight',
      airline: meta.airline,
      flightNumber: meta.flightNumber,
      origin: meta.origin,
      destination: meta.destination,
      departureAt: meta.departureAt,
      arrivalAt: meta.arrivalAt,
      cabin: meta.cabin,
    } as TravelFlight;
  } else if (result.kind === 'hotel') {
    booking = {
      ...base,
      kind: 'hotel',
      hotelName: meta.hotelName,
      checkIn: meta.checkIn,
      checkOut: meta.checkOut,
      roomType: meta.roomType,
      address: meta.address,
    } as TravelHotel;
  } else if (result.kind === 'car') {
    booking = {
      ...base,
      kind: 'car',
      driverAge: Number(meta.driverAge), residenceCountry: meta.residenceCountry,
      company: meta.company,
      carType: meta.carType,
      pickupLocation: meta.pickupLocation,
      dropoffLocation: meta.dropoffLocation,
      pickupAt: meta.pickupAt,
      dropoffAt: meta.dropoffAt,
    } as TravelCar;
  } else {
    booking = {
      ...base,
      kind: 'restaurant',
      restaurantName: meta.restaurantName,
      cuisine: meta.cuisine,
      reservationAt: meta.reservationAt,
      partySize: Number(meta.partySize),
      address: meta.address,
    } as TravelRestaurant;
  }

  trip.bookings.push(booking);
  const approval: TravelApproval = {
    id: uid('ta'),
    tripId,
    bookingId: booking.id,
    resultId: result.id,
    actionType: 'book',
    targetSystem: toApprovalTarget(result.provider),
    targetObject: result.title,
    risk: 'low',
    status: selectPlan ? 'approved' : 'pending',
    submittedAt: new Date().toISOString(),
    payload: `Approve this itinerary plan, then review the refreshed price and traveler details before submitting a purchase. ${note ?? result.title}`,
  };
  trip.approvals.push(approval);
  writeTrip(db, trip);
  return audit(booking);
  });
}

export async function decideTravelApproval(approvalId: string, decision: ApprovalDecision, dataRoot: string): Promise<AuditResult> {
  if (!['approved', 'rejected', 'changes_requested'].includes(decision.decision)) throw new TravelApiError(400, 'Invalid decision.');
  return travelStore(dataRoot, db => {
    const rows = db.prepare('SELECT body FROM trips').all() as { body: string }[];
    for (const row of rows) {
      const trip = JSON.parse(row.body) as TravelTrip;
      const approval = trip.approvals.find(a => a.id === approvalId);
      if (!approval) continue;
      if (approval.status !== 'pending') throw new TravelApiError(409, 'This proposal has already been decided.');
      approval.status = decision.decision;
      const booking = trip.bookings.find(b => b.id === approval.bookingId);
      if (booking) booking.status = decision.decision === 'approved' ? 'approved' : 'cancelled';
      writeTrip(db, trip);
      return audit();
    }
    throw new TravelApiError(404, 'Approval not found');
  });
}

export async function addTravelPlan(tripId: string, input: TravelPlanInput, dataRoot: string): Promise<AuditResult<TravelBooking>> {
  let booking: TravelBooking;
  try { booking = makeTravelPlan(tripId, input); } catch (error) { throw new TravelApiError(400, error instanceof Error ? error.message : 'Invalid plan'); }
  return travelStore(dataRoot, db => {
    const trip = readTrip(db, tripId);
    if (!trip) throw new TravelApiError(404, 'Trip not found');
    trip.bookings.push(booking);
    trip.approvals.push({ id: crypto.randomUUID(), tripId, bookingId: booking.id, actionType: 'book', targetSystem: 'other', targetObject: booking.title, risk: 'low', status: 'pending', submittedAt: new Date().toISOString(), payload: 'Approve this plan, then complete checkout on the provider website. No purchase is made by this approval.' });
    writeTrip(db, trip);
    return audit(booking);
  });
}

// ---------- Travel Agent (NL → structured search) ----------

const TRAVEL_AGENT_MODEL = 'deepseek/deepseek-v4-flash';

function readOpenRouterKey(hermesHome: string): string {
  try {
    const env = readFileSync(join(hermesHome, '.env'), 'utf8');
    const m = env.match(/^OPENROUTER_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {
    // fall through
  }
  // Try environment
  return process.env.OPENROUTER_API_KEY ?? '';
}

/**
 * System prompt for the travel intent parser. Instructs the LLM to output
 * a JSON object with search parameters from a natural-language query.
 */
const AGENT_SYSTEM_PROMPT = `You are a travel intent parser. Given a natural-language travel query, output a JSON object with the search parameters you can extract.

Available search kinds: "flight", "hotel", "car", "restaurant"

Return ONLY a JSON object with these fields:
{
  "kind": "flight" | "hotel" | "car" | "restaurant" | null,
  "origin": string | null,
  "destination": string | null,
  "departureDate": string | null (YYYY-MM-DD),
  "returnDate": string | null (YYYY-MM-DD),
  "checkIn": string | null (YYYY-MM-DD),
  "checkOut": string | null (YYYY-MM-DD),
  "date": string | null (YYYY-MM-DD),
  "pickupLocation": string | null,
  "dropoffLocation": string | null,
  "partySize": number | null,
  "draft": null | {"name": string, "destination": string, "startsAt": string, "endsAt": string, "budgetUsd": number, "preferredAirlines": string, "preferredHotels": string, "diningPreferences": string},
  "explanation": string (what you understood from the query in plain English, ~1 sentence)
}

Set kind to null if the query isn't about travel (e.g. "what's the weather").
For flights, map "to" → destination, "from" → origin, and dates to departureDate (with returnDate for round-trip).
For hotels, map dates to checkIn/checkOut.
For cars, map pickup location and dates.
For restaurants, map date and partySize.
Use 3-letter airport codes (BHM, BTR, LAX, etc.) for flight origins/destinations when possible.
For a request to plan a trip, set kind=null and return a draft containing ONLY information supplied by the user. Ask for missing destination, dates, budget, preferred airlines, hotels, and dining preferences in explanation. Accept explicit "no preference" or "no budget" answers. Never invent dates, prices, bookings or reservations. Maintain the draft from the conversation context; never book anything. When enough details are gathered, explain that the user can save the trip and then search providers.`;

export interface TravelAgentInput {
  query: string;
}

export interface TravelAgentOutput {
  draft?: Partial<CreateTripInput>;
  summary: string;
  kind: TravelSearchParams['kind'] | null;
  params: TravelSearchParams | null;
  results: TravelSearchResult[];
}

/**
 * Parse a natural-language travel query via LLM, execute the search,
 * and return a summary + results.
 */
export async function travelAgent(input: TravelAgentInput, ctx: { hermesHome: string; dataRoot?: string; eaiosRoot: string }): Promise<TravelAgentOutput> {
  const key = readOpenRouterKey(ctx.hermesHome);
  if (!key) {
    return {
      summary: 'No LLM provider is configured. Set OPENROUTER_API_KEY in ~/.hermes/.env to enable natural-language travel search.',
      kind: null,
      params: null,
      results: [],
    };
  }

  if (typeof input.query !== 'string' || input.query.length > 12000) throw new TravelApiError(400, 'Keep the planning conversation under 12,000 characters.');
  // Call OpenRouter to parse intent
  let parsed: {
    draft?: Partial<CreateTripInput>;
    kind?: string | null;
    origin?: string | null;
    destination?: string | null;
    departureDate?: string | null;
    returnDate?: string | null;
    checkIn?: string | null;
    checkOut?: string | null;
    date?: string | null;
    pickupLocation?: string | null;
    dropoffLocation?: string | null;
    partySize?: number | null;
    explanation?: string;
  };
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({
        model: process.env.EAIOS_TRAVEL_MODEL ?? TRAVEL_AGENT_MODEL,
        messages: [
          { role: 'system', content: `${AGENT_SYSTEM_PROMPT}\nToday's date is ${new Date().toISOString().slice(0,10)}.` },
          { role: 'user', content: input.query },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => 'unknown');
      return {
        summary: `LLM parse failed: HTTP ${res.status} — ${text.slice(0, 200)}. Try a more specific query.`,
        kind: null,
        params: null,
        results: [],
      };
    }

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content ?? '';
    // Extract JSON from response (might be wrapped in ```json ... ```)
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/) ?? content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[1] ?? jsonMatch[0] : content;
    parsed = JSON.parse(jsonStr) as typeof parsed;
  } catch (e) {
    return {
      summary: `Could not parse your travel request: ${e instanceof Error ? e.message : String(e)}. Please try a simpler query.`,
      kind: null,
      params: null,
      results: [],
    };
  }

  if (parsed.draft && typeof parsed.draft === 'object') {
    const draft: Partial<CreateTripInput> = {};
    for (const field of ['name','destination','startsAt','endsAt','preferredAirlines','preferredHotels','diningPreferences'] as const) {
      if (typeof parsed.draft[field] === 'string') draft[field] = parsed.draft[field]!.slice(0,1000);
    }
    if (typeof parsed.draft.budgetUsd === 'number' && Number.isFinite(parsed.draft.budgetUsd) && parsed.draft.budgetUsd >= 0) draft.budgetUsd = parsed.draft.budgetUsd;
    return {summary: parsed.explanation ?? 'Tell me your travel dates, budget, airline/hotel preferences and dining needs.', draft, kind: null, params: null, results: []};
  }
  if (!parsed.kind) {
    return {
      summary: parsed.explanation ?? 'I couldn\'t identify a travel search intent from your query. Try something like "flights BHM to BTR Sep 15" or "hotels in Baton Rouge Oct 10-12".',
      kind: null,
      params: null,
      results: [],
    };
  }

  const kind = parsed.kind as TravelSearchParams['kind'];
  const params: TravelSearchParams = { kind };

  // Map parsed fields onto params based on kind
  if (kind === 'flight') {
    params.origin = parsed.origin ?? undefined;
    params.destination = parsed.destination ?? undefined;
    params.departureDate = parsed.departureDate ?? undefined;
    params.returnDate = parsed.returnDate ?? undefined;
  } else if (kind === 'hotel') {
    params.destination = parsed.destination ?? undefined;
    params.checkIn = parsed.checkIn ?? undefined;
    params.checkOut = parsed.checkOut ?? undefined;
  } else if (kind === 'car') {
    params.pickupLocation = parsed.pickupLocation ?? undefined;
    params.dropoffLocation = parsed.dropoffLocation ?? undefined;
    params.departureDate = parsed.departureDate ?? undefined;
    params.returnDate = parsed.returnDate ?? undefined;
  } else if (kind === 'restaurant') {
    params.destination = parsed.destination ?? undefined;
    params.date = parsed.date ?? undefined;
    params.partySize = parsed.partySize ?? undefined;
  }

  // Execute search
  let results: TravelSearchResult[] = [];
  try {
    results = await searchTravel(params, ctx.dataRoot ?? ctx.eaiosRoot);
  } catch (e) {
    return { summary: `${parsed.explanation ?? 'Travel search'}: ${e instanceof Error ? e.message : 'Search failed'}`, kind, params, results: [] };
  }

  const explanation = parsed.explanation ?? `Searched for ${kind}s`;
  const count = results.length;
  const summary = results.length > 0
    ? `${explanation} Found ${count} result${count === 1 ? '' : 's'}.`
    : `${explanation} No results found. Try different dates or locations.`;

  return { summary, kind, params, results };
}

function validatePlace(value: CreateTripInput['originPlace']): CreateTripInput['originPlace'] {
  if(value === undefined)return undefined;
  if(!value || typeof value.name !== 'string' || typeof value.city !== 'string' || typeof value.code !== 'string' || !/^[A-Z]{3}$/.test(value.code))throw new TravelApiError(400,'Choose a city from the airport suggestions.');
  return {id:String(value.id).slice(0,100),name:value.name.slice(0,200),city:value.city.slice(0,200),country:String(value.country).slice(0,10),code:value.code,latitude:Number.isFinite(value.latitude)?value.latitude:undefined,longitude:Number.isFinite(value.longitude)?value.longitude:undefined};
}
export async function updateTravelTrip(id:string,input:CreateTripInput,root:string):Promise<AuditResult<TravelTrip>> {
  if(!input.name?.trim() || !input.destination?.trim() || !Number.isFinite(Date.parse(input.startsAt)) || !Number.isFinite(Date.parse(input.endsAt)) || Date.parse(input.endsAt)<Date.parse(input.startsAt))throw new TravelApiError(400,'Enter a destination and valid travel dates.');
  if(input.budgetUsd !== undefined && (!Number.isFinite(input.budgetUsd)||input.budgetUsd<0))throw new TravelApiError(400,'Enter a valid budget.');
  const originPlace=validatePlace(input.originPlace),destinationPlace=validatePlace(input.destinationPlace);
  return travelStore(root,db=>{
    const trip=readTrip(db,id);if(!trip)throw new TravelApiError(404,'Trip not found.');
    Object.assign(trip,{name:input.name.trim(),destination:input.destination.trim(),startsAt:input.startsAt,endsAt:input.endsAt,budgetUsd:input.budgetUsd,preferredAirlines:String(input.preferredAirlines??'').slice(0,1000),preferredHotels:String(input.preferredHotels??'').slice(0,1000),diningPreferences:String(input.diningPreferences??'').slice(0,1000),originPlace,destinationPlace,needsCar:input.needsCar===true,carPreferences:validateCarPreferences(input.carPreferences)});
    writeTrip(db,trip);return audit(trip);
  });
}
