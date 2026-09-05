/**
 * LiveTravelAdapter — EAiOS travel search + trip state via the dev/prod server
 * at /api/travel/*. Falls back to the mock adapter when the server returns a
 * 503/404 or when no live travel provider is available (spec §2 honest
 * degradation). Note: Amadeus Self-Service was decommissioned July 2026.
 */
import type { TravelTrip, TravelBooking, ApprovalDecision, AuditResult, TravelAgentResult } from '../../domain/types';
import type { CreateTripInput, TravelSearchParams, TravelSearchResult, TravelVaultSite, TravelVaultSiteInput } from '../interfaces';
import { hermes as mock } from '../mock/MockHermesAdapter';

class LiveTravelAdapter {
  private useMock = false;

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/api/travel${path}`, init);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `travel HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  }

  private async call<T>(fn: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (this.useMock) return fallback();
    try {
      return await fn();
    } catch {
      this.useMock = true;
      return fallback();
    }
  }

  listTrips(): Promise<TravelTrip[]> {
    return this.call(
      async () => (await this.api<{ trips: TravelTrip[] }>('/trips')).trips,
      () => mock.listTrips(),
    );
  }

  getTrip(id: string): Promise<TravelTrip | null> {
    return this.call(
      async () => (await this.api<{ trip: TravelTrip | null }>(`/trips/${encodeURIComponent(id)}`)).trip,
      () => mock.getTrip(id),
    );
  }

  searchTravel(params: TravelSearchParams): Promise<TravelSearchResult[]> {
    return this.call(
      async () => {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
        }
        return (await this.api<{ results: TravelSearchResult[] }>(`/search?${qs.toString()}`)).results;
      },
      () => mock.searchTravel(params),
    );
  }

  createTrip(input: CreateTripInput): Promise<AuditResult<TravelTrip>> {
    return this.call(
      async () =>
        this.api<AuditResult<TravelTrip>>('/trips', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      () => mock.createTrip(input),
    );
  }

  proposeBooking(tripId: string, resultId: string, note?: string): Promise<AuditResult<TravelBooking>> {
    return this.call(
      async () =>
        this.api<AuditResult<TravelBooking>>(`/trips/${encodeURIComponent(tripId)}/proposals`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resultId, note }),
        }),
      () => mock.proposeBooking(tripId, resultId, note),
    );
  }

  decideTravelApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult> {
    return this.call(
      async () =>
        this.api<AuditResult>(`/approvals/${encodeURIComponent(approvalId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(decision),
        }),
      () => mock.decideTravelApproval(approvalId, decision),
    );
  }

  /**
   * Live travelAgent — POST the NL query to /api/travel/agent.
   * The server parses intent via LLM and executes the search.
   */
  travelAgent(query: string): Promise<TravelAgentResult> {
    return this.call(
      async () =>
        this.api<TravelAgentResult>('/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
        }),
      () => mock.travelAgent(query),
    );
  }

  getTravelBrowserStatus(): Promise<{
    enabled: boolean;
    chromeBin?: string;
    vaultUnlocked: boolean;
    configuredSites: string[];
    sessionSites: string[];
    playbooks: { id: string; site: string; kind: TravelSearchParams['kind']; displayName: string }[];
  }> {
    return this.call(
      async () => this.api('/browser-status'),
      () => mock.getTravelBrowserStatus(),
    );
  }

  // ---------- Vault credential manager ----------

  listTravelVaultSites(): Promise<TravelVaultSite[]> {
    return this.call(
      async () => {
        const r = await this.api<{ sites: TravelVaultSite[] }>('/browser-vault/sites');
        return r.sites;
      },
      () => (mock as unknown as { travel?: { listTravelVaultSites: () => Promise<TravelVaultSite[]> } }).travel?.listTravelVaultSites?.() ?? Promise.resolve([]),
    );
  }

  getTravelVaultSite(site: string): Promise<TravelVaultSite | null> {
    return this.call(
      async () => {
        const r = await this.api<TravelVaultSite>(`/browser-vault/sites/${encodeURIComponent(site)}`);
        return r;
      },
      () => (mock as unknown as { travel?: { getTravelVaultSite: (s: string) => Promise<TravelVaultSite | null> } }).travel?.getTravelVaultSite(site) ?? Promise.resolve(null),
    );
  }

  setTravelVaultSite(site: string, input: TravelVaultSiteInput): Promise<AuditResult> {
    return this.call(
      async () =>
        this.api<AuditResult>(`/browser-vault/sites/${encodeURIComponent(site)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        }),
      () => (mock as unknown as { travel?: { setTravelVaultSite: (s: string, i: TravelVaultSiteInput) => Promise<AuditResult> } }).travel?.setTravelVaultSite(site, input) ?? Promise.resolve(auditFail()),
    );
  }

  removeTravelVaultSite(site: string): Promise<AuditResult> {
    return this.call(
      async () =>
        this.api<AuditResult>(`/browser-vault/sites/${encodeURIComponent(site)}`, {
          method: 'DELETE',
        }),
      () => (mock as unknown as { travel?: { removeTravelVaultSite: (s: string) => Promise<AuditResult> } }).travel?.removeTravelVaultSite(site) ?? Promise.resolve(auditFail()),
    );
  }
}

const auditFail = (): AuditResult => ({ ok: false, auditEventId: 'aud-live-fallback', error: { code: 'fallback', safeMessage: 'Live unavailable, mock fallback also failed.', retryable: false } });

export const liveTravel = new LiveTravelAdapter();
