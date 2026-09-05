/**
 * MockTravelAdapter — in-memory travel bookings + Duffel/browser-use/OpenTable-
 * shaped search fixtures. The live adapter swaps these for real API calls; the
 * UI works identically against either.
 */
import type { TravelTrip, TravelBooking, TravelApproval, ApprovalDecision, AuditResult, TravelAgentResult } from '../../domain/types';
import type { CreateTripInput, TravelSearchParams, TravelSearchResult, TravelVaultSite, TravelVaultSiteInput } from '../interfaces';
import { travelTrips as fixtureTrips, travelSearchResults as fixtureSearch } from '../../mocks/fixtures';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
let auditSeq = 2000;
const audit = <T,>(data?: T): AuditResult<T> => ({ ok: true, data, auditEventId: `aud-${auditSeq++}` });

export class MockTravelAdapter {
  private trips = clone(fixtureTrips);
  private searchResults = clone(fixtureSearch);

  async listTrips(): Promise<TravelTrip[]> {
    return clone(this.trips);
  }

  async getTrip(id: string): Promise<TravelTrip | null> {
    const t = this.trips.find((x: TravelTrip) => x.id === id);
    return t ? clone(t) : null;
  }

  async searchTravel(params: TravelSearchParams): Promise<TravelSearchResult[]> {
    const key = params.kind === 'flight' ? 'flights' : params.kind === 'hotel' ? 'hotels' : params.kind === 'car' ? 'cars' : 'restaurants';
    let rows = clone(this.searchResults[key] ?? []);
    if (params.destination) {
      rows = rows.filter((r: TravelSearchResult) =>
        r.subtitle.toLowerCase().includes(params.destination!.toLowerCase()) ||
        r.title.toLowerCase().includes(params.destination!.toLowerCase()),
      );
    }
    if (params.origin) {
      rows = rows.filter((r: TravelSearchResult) => r.subtitle.toLowerCase().includes(params.origin!.toLowerCase()));
    }
    return rows;
  }

  async createTrip(input: CreateTripInput): Promise<AuditResult<TravelTrip>> {
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
    this.trips.push(trip);
    return audit(trip);
  }

  async proposeBooking(tripId: string, resultId: string, note?: string): Promise<AuditResult<TravelBooking>> {
    const trip = this.trips.find((x: TravelTrip) => x.id === tripId);
    if (!trip) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Trip not found.', retryable: false } };

    const all = Object.values(this.searchResults).flat() as TravelSearchResult[];
    const result = all.find((r: TravelSearchResult) => r.id === resultId);
    if (!result) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Search result not found.', retryable: false } };

    const meta = result.meta;
    let booking: TravelBooking;
    const base = {
      id: uid('bk'),
      tripId,
      kind: result.kind,
      status: 'proposed' as const,
      provider: result.provider,
      costUsd: result.priceUsd,
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
      };
    } else if (result.kind === 'hotel') {
      booking = {
        ...base,
        kind: 'hotel',
        hotelName: meta.hotelName,
        checkIn: meta.checkIn,
        checkOut: meta.checkOut,
        roomType: meta.roomType,
        address: meta.address,
      };
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
      };
    } else {
      booking = {
        ...base,
        kind: 'restaurant',
        restaurantName: meta.restaurantName,
        cuisine: meta.cuisine,
        reservationAt: meta.reservationAt,
        partySize: Number(meta.partySize),
        address: meta.address,
      };
    }

    trip.bookings.push(booking);
    const approval: TravelApproval = {
      id: uid('ta'),
      tripId,
      bookingId: booking.id,
      resultId: result.id,
      actionType: 'book',
      targetSystem: result.provider === 'opentable' ? 'opentable' : 'other',
      targetObject: result.title,
      risk: 'low',
      status: 'pending',
      submittedAt: new Date().toISOString(),
      payload: note ?? `Book ${result.title} (${result.subtitle})`,
    };
    trip.approvals.push(approval);
    return audit(booking);
  }

  async decideTravelApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult> {
    for (const trip of this.trips) {
      const app = trip.approvals.find((a: TravelApproval) => a.id === approvalId);
      if (app) {
        app.status = decision.decision === 'approved' ? 'approved' : decision.decision === 'rejected' ? 'rejected' : 'changes_requested';
        if (app.status === 'approved' && app.bookingId) {
          const booking = trip.bookings.find((b: TravelBooking) => b.id === app.bookingId);
          if (booking) booking.status = 'confirmed';
        }
        return audit();
      }
    }
    return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Approval not found.', retryable: false } };
  }

  async getTravelBrowserStatus(): Promise<{
    enabled: boolean;
    chromeBin?: string;
    vaultUnlocked: boolean;
    configuredSites: string[];
    sessionSites: string[];
    playbooks: { id: string; site: string; kind: TravelSearchParams['kind']; displayName: string }[];
  }> {
    return {
      enabled: true,
      vaultUnlocked: true,
      configuredSites: this.vaultSites.map((s) => s.site),
      sessionSites: [],
      playbooks: [
        { id: 'kayak-hotels', site: 'kayak', kind: 'hotel', displayName: 'Kayak hotels (mock)' },
        { id: 'kayak-cars', site: 'kayak', kind: 'car', displayName: 'Kayak cars (mock)' },
        { id: 'opentable-restaurants', site: 'opentable', kind: 'restaurant', displayName: 'OpenTable (mock)' },
      ],
    };
  }

  // ---------- Vault credential manager (mock) ----------

  private vaultSites: TravelVaultSite[] = [
    { site: 'kayak', hasUsername: true, hasPassword: true, hasTotp: false, notes: 'Main travel account', updatedAt: new Date().toISOString() },
    { site: 'opentable', hasUsername: true, hasPassword: true, hasTotp: false, notes: 'Restaurant booking', updatedAt: new Date(Date.now() - 86400000).toISOString() },
    { site: 'ihg', hasUsername: true, hasPassword: false, hasTotp: false, updatedAt: new Date(Date.now() - 172800000).toISOString() },
  ];

  async listTravelVaultSites(): Promise<TravelVaultSite[]> {
    return clone(this.vaultSites);
  }

  async getTravelVaultSite(site: string): Promise<TravelVaultSite | null> {
    const s = this.vaultSites.find((v) => v.site === site);
    return s ? clone(s) : null;
  }

  async setTravelVaultSite(site: string, input: TravelVaultSiteInput): Promise<AuditResult> {
    const existing = this.vaultSites.findIndex((v) => v.site === site);
    const entry: TravelVaultSite = {
      site,
      hasUsername: !!input.username || (existing >= 0 ? this.vaultSites[existing].hasUsername : false),
      hasPassword: !!input.password || (existing >= 0 ? this.vaultSites[existing].hasPassword : false),
      hasTotp: !!input.totpSeed || (existing >= 0 ? this.vaultSites[existing].hasTotp : false),
      notes: input.notes !== undefined ? input.notes : (existing >= 0 ? this.vaultSites[existing].notes : undefined),
      updatedAt: new Date().toISOString(),
    };
    if (existing >= 0) {
      this.vaultSites[existing] = entry;
    } else {
      this.vaultSites.push(entry);
    }
    return audit();
  }

  async removeTravelVaultSite(site: string): Promise<AuditResult> {
    const before = this.vaultSites.length;
    this.vaultSites = this.vaultSites.filter((v) => v.site !== site);
    if (this.vaultSites.length === before) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Site not found.', retryable: false } };
    }
    return audit();
  }

  /**
   * Mock travelAgent — parses a query by pattern matching against fixture data.
   * Simulates what the live server does via LLM.
   */
  async travelAgent(query: string): Promise<TravelAgentResult> {
    const lower = query.toLowerCase();

    // Detect kind from keywords
    let kind: TravelSearchParams['kind'] | null = null;
    if (/\b(flight|flights|fly|plane|airline)\b/.test(lower)) kind = 'flight';
    else if (/\b(hotel|hotels|stay|room|lodging)\b/.test(lower)) kind = 'hotel';
    else if (/\b(car|cars|rental|rent|drive|pickup)\b/.test(lower)) kind = 'car';
    else if (/\b(restaurant|restaurants|dinner|lunch|eat|food|reservation|reserve)\b/.test(lower)) kind = 'restaurant';

    if (!kind) {
      // Fallback: try to guess from query structure
      if (/\b(bhm|btr|lax|jfk|sfo|ord|msy|atl)\b/.test(lower) && /\b(to|from)\b/.test(lower)) kind = 'flight';
      else if (/\b(in|at)\s/.test(lower) && /\d/.test(lower)) kind = 'hotel';
      else return {
        summary: 'I couldn\'t identify a travel search intent from your query. Try something like "flights BHM to BTR Sep 15" or "hotels in Baton Rouge"',
        kind: null, params: null, results: [],
      };
    }

    // Extract location info
    const originMatch = lower.match(/\bfrom\s+(\w+)\b/);
    const destMatch = lower.match(/\b(?:to|in|at)\s+(\w+(?:\s+\w+)?)\b/);

    const params: TravelSearchParams = { kind };
    if (kind === 'flight') {
      params.origin = originMatch?.[1]?.toUpperCase() ?? undefined;
      params.destination = destMatch?.[1]?.toUpperCase() ?? undefined;
    } else if (kind === 'hotel' || kind === 'restaurant') {
      params.destination = destMatch?.[1] ?? undefined;
    } else if (kind === 'car') {
      params.pickupLocation = originMatch?.[1] ?? destMatch?.[1] ?? undefined;
      params.dropoffLocation = destMatch?.[1] ?? undefined;
    }

    // Search with whatever params we have
    let results = await this.searchTravel(params);
    // If we got nothing and have a destination, do broader search
    if (results.length === 0 && params.destination) {
      results = clone(this.searchResults[kind === 'flight' ? 'flights' : kind === 'hotel' ? 'hotels' : kind === 'car' ? 'cars' : 'restaurants'] ?? []);
    }

    const count = results.length;
    const kindLabel = kind === 'flight' ? 'flights' : kind === 'hotel' ? 'hotels' : kind === 'car' ? 'cars' : 'restaurants';
    const summary = count > 0
      ? `Found ${count} ${kindLabel} for your query.${params.destination ? ` Destination: ${params.destination}.` : ''}`
      : `No ${kindLabel} found matching your query. Try different dates or locations.`;

    return { summary, kind, params, results };
  }
}
