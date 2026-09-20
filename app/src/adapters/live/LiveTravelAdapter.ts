import type { TravelPlace, TravelShortlist } from '../../domain/travelGuide';
/** Live travel never substitutes demonstration data after a failure. */
import type { TravelTrip, TravelBooking, ApprovalDecision, AuditResult, TravelAgentResult } from '../../domain/types';
import type { CreateTripInput, TravelSearchParams, TravelSearchResult } from '../interfaces';
import type { TravelPlanInput, TravelAction } from '../../domain/travelPlan';
export class LiveTravelAdapter {
  private async api<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api/travel${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const response = await res.json().catch(() => ({}));
      throw new Error(response.error ?? `Travel service unavailable (HTTP ${res.status}). Try again.`);
    }
    return res.json() as Promise<T>;
  }
  private async mutation<T>(path: string, body: unknown): Promise<AuditResult<T>> {
    try { return await this.api<AuditResult<T>>(path, body); }
    catch (error) { return { ok: false, auditEventId: '', error: { code: 'travel_error', safeMessage: error instanceof Error ? error.message : 'Travel request failed.', retryable: false } }; }
  }
  chooseTravelOption(tripId: string,resultId: string): Promise<AuditResult<TravelBooking>> { return this.mutation(`/trips/${encodeURIComponent(tripId)}/choices`,{resultId}); }
  async travelPlaces(query: string): Promise<TravelPlace[]> { return (await this.api<{places:TravelPlace[]}>(`/places?query=${encodeURIComponent(query)}`)).places; }
  async travelRecommendations(tripId: string): Promise<TravelShortlist[]> { return (await this.api<{shortlists:TravelShortlist[]}>(`/trips/${encodeURIComponent(tripId)}/recommendations`)).shortlists; }
  updateTravelTrip(tripId: string,input:CreateTripInput): Promise<AuditResult<TravelTrip>> { return this.mutation(`/trips/${encodeURIComponent(tripId)}/details`,input); }
  async listTrips(): Promise<TravelTrip[]> { return (await this.api<{trips: TravelTrip[]}>('/trips')).trips; }
  async getTrip(id: string): Promise<TravelTrip | null> { return (await this.api<{trip: TravelTrip | null}>(`/trips/${encodeURIComponent(id)}`)).trip; }
  async searchTravel(params: TravelSearchParams): Promise<TravelSearchResult[]> {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') qs.set(key, String(value));
    return (await this.api<{results: TravelSearchResult[]}>(`/search?${qs}`)).results;
  }
  createTrip(input: CreateTripInput): Promise<AuditResult<TravelTrip>> { return this.mutation('/trips', input); }
  proposeBooking(tripId: string, resultId: string, note?: string): Promise<AuditResult<TravelBooking>> { return this.mutation(`/trips/${encodeURIComponent(tripId)}/proposals`, {resultId, note}); }
  decideTravelApproval(id: string, decision: ApprovalDecision): Promise<AuditResult> { return this.mutation(`/approvals/${encodeURIComponent(id)}`, decision); }
  travelAgent(query: string): Promise<TravelAgentResult> { return this.api('/agent', {query}); }
  addTravelPlan(tripId: string, input: TravelPlanInput): Promise<AuditResult<TravelBooking>> { return this.mutation(`/trips/${encodeURIComponent(tripId)}/plans`, input); }
  travelAction(tripId: string, bookingId: string, action: TravelAction): Promise<AuditResult<TravelBooking>> { return this.mutation(`/trips/${encodeURIComponent(tripId)}/bookings/${encodeURIComponent(bookingId)}/action`, action); }
}
export const liveTravel = new LiveTravelAdapter();
