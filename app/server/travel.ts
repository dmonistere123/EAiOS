/**
 * Travel API backend (F31) — travel provider proxy.
 *
 * Design:
 * - All booking searches go through the EAiOS server so API keys never reach
 *   the browser bundle.
 * - Provider pivot (2026-09): Amadeus Self-Service API was decommissioned
 *   July 2026. The live path now prefers:
 *     - Duffel (https://duffel.com) for flights when DUFFEL_API_KEY is set.
 *     - Browser-use against consumer sites (Kayak/Booking.com/Expedia) for
 *       hotels/cars when TRAVEL_BROWSER_USE=1 and CHROME_BIN is available.
 *     - OpenTable partner API for restaurants when OPENTABLE_API_KEY is set.
 * - If no provider is configured for a search kind, the endpoint returns 503
 *   with an actionable message; the live adapter falls back to the mock fixture
 *   set (spec §2 honest degradation) and the UI shows a provider notice.
 * - Proposed bookings create a pending TravelApproval; real purchase execution
 *   is gated on the existing approvals flow (approval envelope = EXECUTE).
 */
import type { TravelBooking, TravelTrip, TravelApproval, ApprovalDecision, AuditResult, TravelFlight, TravelHotel, TravelCar, TravelRestaurant } from '../src/domain/types.ts';
import type { TravelSearchParams, TravelSearchResult, CreateTripInput } from '../src/adapters/interfaces.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBrowserStatus, searchBrowserUse as runBrowserSearch, executeBooking } from './travelBrowser/index.ts';

const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
let auditSeq = 3000;
const audit = <T,>(data?: T): AuditResult<T> => ({ ok: true, data, auditEventId: `aud-${auditSeq++}` });

export class TravelApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** In-memory trip store on the server (resets on restart). Real persistence
 * can be added once the shape stabilizes. */
const trips = new Map<string, TravelTrip>();

/** In-memory cache of live search results, keyed by result id. Required so
 * proposeBooking can look up the offer details without re-fetching. */
const searchCache = new Map<string, TravelSearchResult>();

function providerStatus(): { duffel: boolean; browserUse: boolean; opentable: boolean } {
  return {
    duffel: !!process.env.DUFFEL_API_KEY,
    browserUse: getBrowserStatus().enabled,
    opentable: !!process.env.OPENTABLE_API_KEY,
  };
}

export function browserProviderStatus() {
  return getBrowserStatus();
}

function requiredEnv(name: string): string {
  const k = process.env[name] ?? '';
  if (!k) throw new TravelApiError(503, `${name} not configured`);
  return k;
}

function toApprovalTarget(provider: string): TravelApproval['targetSystem'] {
  if (provider === 'duffel' || provider === 'browser-use-consumer' || provider === 'opentable') return provider;
  return 'other';
}

function inferParamsFromBooking(booking: TravelBooking): TravelSearchParams {
  if (booking.kind === 'hotel') {
    return {
      kind: 'hotel',
      destination: booking.hotelName,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
    };
  }
  if (booking.kind === 'car') {
    return {
      kind: 'car',
      pickupLocation: booking.pickupLocation,
      dropoffLocation: booking.dropoffLocation,
      departureDate: booking.pickupAt.slice(0, 10),
      returnDate: booking.dropoffAt.slice(0, 10),
    };
  }
  if (booking.kind === 'restaurant') {
    return {
      kind: 'restaurant',
      destination: booking.restaurantName,
      date: booking.reservationAt.slice(0, 10),
      partySize: booking.partySize,
    };
  }
  return { kind: 'hotel' };
}

function assertParams(kind: TravelSearchParams['kind'], params: TravelSearchParams) {
  if (kind === 'flight') {
    if (!params.origin || !params.destination || !params.departureDate) {
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

interface DuffelOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  owner: { name: string };
  slices: {
    segments: {
      operating_carrier?: { name: string };
      marketing_carrier?: { name: string };
      marketing_carrier_flight_number?: string;
      departing_at: string;
      arriving_at: string;
      origin: { iata_code: string };
      destination: { iata_code: string };
    }[];
  }[];
}

async function searchDuffelFlights(params: TravelSearchParams): Promise<TravelSearchResult[]> {
  const key = requiredEnv('DUFFEL_API_KEY');
  const slices: { origin: string; destination: string; departure_date: string }[] = [
    { origin: params.origin!, destination: params.destination!, departure_date: params.departureDate! },
  ];
  if (params.returnDate) {
    slices.push({ origin: params.destination!, destination: params.origin!, departure_date: params.returnDate });
  }

  const res = await fetch('https://api.duffel.com/air/offer_requests', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Duffel-Version': 'v2',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      data: {
        cabin_class: 'economy',
        passengers: [{ type: 'adult' }],
        slices,
      },
    }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { errors?: { title?: string; message?: string }[] };
    const msg = body.errors?.[0]?.message ?? body.errors?.[0]?.title ?? `Duffel HTTP ${res.status}`;
    throw new TravelApiError(res.status === 401 || res.status === 403 ? 503 : res.status, `Duffel: ${msg}`);
  }

  const json = (await res.json()) as { data?: { offers?: DuffelOffer[] } };
  const offers = json.data?.offers ?? [];

  return offers.map((offer) => {
    const slice = offer.slices[0];
    const segment = slice?.segments[0];
    const airline = segment?.operating_carrier?.name ?? segment?.marketing_carrier?.name ?? offer.owner.name ?? 'Unknown airline';
    const flightNumber = segment?.marketing_carrier_flight_number ?? offer.id.slice(0, 6).toUpperCase();
    const origin = segment?.origin.iata_code ?? params.origin!;
    const destination = segment?.destination.iata_code ?? params.destination!;
    const departureAt = segment?.departing_at ?? `${params.departureDate}T09:00:00`;
    const arrivalAt = segment?.arriving_at ?? `${params.departureDate}T11:00:00`;
    const price = Number(offer.total_amount);

    const result: TravelSearchResult = {
      id: offer.id,
      kind: 'flight',
      title: `${airline} ${flightNumber}`,
      subtitle: `${origin} → ${destination} · ${departureAt.slice(11, 16)}–${arrivalAt.slice(11, 16)} · Economy`,
      priceUsd: Number.isFinite(price) ? price : undefined,
      provider: 'duffel',
      externalUrl: `https://duffel.com/`,
      meta: {
        airline,
        flightNumber,
        origin,
        destination,
        departureAt,
        arrivalAt,
        cabin: 'Economy',
      },
    };
    searchCache.set(result.id, result);
    return result;
  });
}

// ---------- Browser-use consumer-site provider (hotels/cars) ----------

async function searchBrowserUse(_kind: 'hotel' | 'car' | 'restaurant', params: TravelSearchParams): Promise<TravelSearchResult[]> {
  const status = getBrowserStatus();
  if (!status.enabled) {
    throw new TravelApiError(503, 'Browser-use provider not configured: set TRAVEL_BROWSER_USE=1 and CHROME_BIN, or rely on mock fallback');
  }
  if (!status.vaultUnlocked) {
    throw new TravelApiError(503, 'Browser-use vault locked: set TRAVEL_BROWSER_VAULT_KEY');
  }
  try {
    const results = await runBrowserSearch({ params, chromeBin: process.env.CHROME_BIN });
    results.forEach((r) => searchCache.set(r.id, r));
    return results;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new TravelApiError(503, `Browser-use search failed: ${message}`);
  }
}

// ---------- OpenTable restaurant provider ----------

async function searchOpenTable(_params: TravelSearchParams): Promise<TravelSearchResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  requiredEnv('OPENTABLE_API_KEY');
  throw new TravelApiError(503, 'OpenTable search is not yet implemented');
}

// ---------- Provider router ----------

async function fetchLiveResults(params: TravelSearchParams): Promise<TravelSearchResult[]> {
  const status = providerStatus();
  if (params.kind === 'flight') {
    if (!status.duffel) throw new TravelApiError(503, 'Flight provider not configured: set DUFFEL_API_KEY or rely on mock fallback');
    return searchDuffelFlights(params);
  }
  if (params.kind === 'hotel' || params.kind === 'car') {
    if (!status.browserUse) {
      const need = params.kind === 'hotel' ? 'hotel' : 'car';
      throw new TravelApiError(503, `${need} provider not configured: set TRAVEL_BROWSER_USE=1 and CHROME_BIN, or rely on mock fallback`);
    }
    return searchBrowserUse(params.kind, params);
  }
  if (params.kind === 'restaurant') {
    if (status.browserUse) {
      return searchBrowserUse('restaurant', params);
    }
    if (!status.opentable) {
      throw new TravelApiError(503, 'Restaurant provider not configured: set TRAVEL_BROWSER_USE=1 and CHROME_BIN for browser-use, or set OPENTABLE_API_KEY for partner API');
    }
    return searchOpenTable(params);
  }
  throw new TravelApiError(400, `Unsupported travel search kind: ${params.kind}`);
}

export async function listTrips(): Promise<TravelTrip[]> {
  return [...trips.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function getTrip(id: string): Promise<TravelTrip | null> {
  return trips.get(id) ?? null;
}

export async function searchTravel(params: TravelSearchParams): Promise<TravelSearchResult[]> {
  assertParams(params.kind, params);
  return fetchLiveResults(params);
}

export async function createTrip(input: CreateTripInput): Promise<AuditResult<TravelTrip>> {
  const trip: TravelTrip = {
    id: uid('trip'),
    name: input.name,
    destination: input.destination,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: 'planning',
    bookings: [],
    approvals: [],
  };
  trips.set(trip.id, trip);
  return audit(trip);
}

export async function proposeBooking(tripId: string, resultId: string, note?: string): Promise<AuditResult<TravelBooking>> {
  const trip = trips.get(tripId);
  if (!trip) throw new TravelApiError(404, 'Trip not found');

  const result = searchCache.get(resultId);
  if (!result) {
    throw new TravelApiError(503, 'Search result expired or no live provider is configured — search again with a configured provider, or rely on mock fallback');
  }

  const meta = result.meta;
  let booking: TravelBooking;
  const base = {
    id: uid('bk'),
    tripId,
    kind: result.kind,
    status: 'proposed' as const,
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
    status: 'pending',
    submittedAt: new Date().toISOString(),
    payload: note ?? `Book ${result.title} (${result.subtitle})`,
  };
  trip.approvals.push(approval);
  return audit(booking);
}

export async function decideTravelApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult> {
  for (const trip of trips.values()) {
    const app = trip.approvals.find((a) => a.id === approvalId);
    if (app) {
      app.status = decision.decision === 'approved' ? 'approved' : decision.decision === 'rejected' ? 'rejected' : 'changes_requested';
      if (app.status === 'approved' && app.bookingId) {
        const booking = trip.bookings.find((b) => b.id === app.bookingId);
        if (booking) {
          if (booking.provider === 'browser-use-consumer') {
            // Execute the browser-automation booking up to the review page,
            // then confirm locally. The runner stops before final checkout.
            const result = app.resultId ? searchCache.get(app.resultId) : undefined;
            if (result) {
              const exec = await executeBooking({ params: inferParamsFromBooking(booking), result, chromeBin: process.env.CHROME_BIN });
              if (exec.ok) {
                booking.status = 'confirmed';
                if (exec.confirmationNumber) booking.confirmationNumber = exec.confirmationNumber;
                if (exec.finalUrl) booking.externalUrl = exec.finalUrl;
              } else {
                app.status = 'changes_requested';
                app.payload = `${app.payload ?? ''}\n\nBooking execution failed: ${exec.error ?? 'unknown'}`;
              }
            } else {
              app.status = 'changes_requested';
              app.payload = `${app.payload ?? ''}\n\nSearch result expired; run the search again.`;
            }
          } else {
            booking.status = 'confirmed';
            // NOTE: a production implementation would call the provider order/
            // booking endpoint here (e.g. Duffel orders) before confirming.
          }
        }
      }
      return audit();
    }
  }
  throw new TravelApiError(404, 'Approval not found');
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
  "explanation": string (what you understood from the query in plain English, ~1 sentence)
}

Set kind to null if the query isn't about travel (e.g. "what's the weather").
For flights, map "to" → destination, "from" → origin, and dates to departureDate (with returnDate for round-trip).
For hotels, map dates to checkIn/checkOut.
For cars, map pickup location and dates.
For restaurants, map date and partySize.
Use 3-letter airport codes (BHM, BTR, LAX, etc.) for flight origins/destinations when possible.`;

export interface TravelAgentInput {
  query: string;
}

export interface TravelAgentOutput {
  summary: string;
  kind: TravelSearchParams['kind'] | null;
  params: TravelSearchParams | null;
  results: TravelSearchResult[];
}

/**
 * Parse a natural-language travel query via LLM, execute the search,
 * and return a summary + results.
 */
export async function travelAgent(input: TravelAgentInput, ctx: { hermesHome: string }): Promise<TravelAgentOutput> {
  const key = readOpenRouterKey(ctx.hermesHome);
  if (!key) {
    return {
      summary: 'No LLM provider is configured. Set OPENROUTER_API_KEY in ~/.hermes/.env to enable natural-language travel search.',
      kind: null,
      params: null,
      results: [],
    };
  }

  // Call OpenRouter to parse intent
  let parsed: {
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
      body: JSON.stringify({
        model: TRAVEL_AGENT_MODEL,
        messages: [
          { role: 'system', content: AGENT_SYSTEM_PROMPT },
          { role: 'user', content: input.query },
        ],
        temperature: 0.1,
        max_tokens: 512,
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
    results = await searchTravel(params);
  } catch (e) {
    // If no live provider is configured, propagate the 503 so the live adapter
    // can fall back to mock fixtures. Other search errors return empty results
    // with an explanatory summary.
    if (e instanceof TravelApiError && e.status === 503) {
      throw e;
    }
  }

  const explanation = parsed.explanation ?? `Searched for ${kind}s`;
  const count = results.length;
  const summary = results.length > 0
    ? `${explanation} Found ${count} result${count === 1 ? '' : 's'}.`
    : `${explanation} No results found. Try different dates or locations.`;

  return { summary, kind, params, results };
}
