/** Travel (F31) — executive travel hub.
 * Top cards for Flights / Hotels & Cars / Restaurants open search drawers.
 * Upcoming trips listed below; each trip has tabs for Itinerary /
 * Confirmations / Approvals. Live bookings gate on approval envelopes. */
import { useEffect, useMemo, useState } from 'react';
import { hermes } from '../adapters';
import { toast } from '../state/runtime';
import { usePageRail } from '../state/rail';
import type { RailSectionDef } from '../state/rail';
import type { TravelTrip, TravelBooking, TravelApproval, TravelAgentResult } from '../domain/types';
import { AGENT_NAME } from '../config';
import type { TravelSearchParams, TravelSearchResult, TravelVaultSite, TravelVaultSiteInput } from '../adapters/interfaces.ts';
import { Card, Drawer, EmptyState, SectionTitle, StateBadge, RiskBadge } from '../components/ui';

type SearchKind = 'flight' | 'hotel' | 'car' | 'restaurant';

const KIND_META: Record<SearchKind, { label: string; headline: string; icon: string; fields: ('origin' | 'destination' | 'checkIn' | 'checkOut' | 'departureDate' | 'returnDate' | 'date' | 'pickupLocation' | 'dropoffLocation' | 'partySize')[] }> = {
  flight: { label: 'Flights', headline: 'Search flights', icon: '✈', fields: ['origin', 'destination', 'departureDate', 'returnDate'] },
  hotel: { label: 'Hotels & Cars', headline: 'Search hotels', icon: '🏨', fields: ['destination', 'checkIn', 'checkOut'] },
  car: { label: 'Hotels & Cars', headline: 'Search rental cars', icon: '🚗', fields: ['pickupLocation', 'dropoffLocation', 'departureDate', 'returnDate'] },
  restaurant: { label: 'Restaurants', headline: 'Find restaurants', icon: '🍽', fields: ['destination', 'date', 'partySize'] },
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function BookingRow({ booking, trip, onRefresh }: { booking: TravelBooking; trip: TravelTrip; onRefresh: () => void }) {
  const [busy, setBusy] = useState(false);

  const cancelProposal = async () => {
    setBusy(true);
    const approval = trip.approvals.find((a) => a.bookingId === booking.id && a.status === 'pending');
    if (approval) {
      const res = await hermes.decideTravelApproval(approval.id, { decision: 'rejected', note: 'Cancelled by executive in Travel UI' });
      if (res.ok) {
        toast('ok', `Cancelled ${bookingTitle(booking)} proposal.`);
        onRefresh();
      } else {
        toast('error', res.error?.safeMessage ?? 'Cancel failed.');
      }
    }
    setBusy(false);
  };

  return (
    <div className="rounded-lg border border-edge bg-canvas p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookingIcon kind={booking.kind} />
            <span className="truncate text-sm font-medium text-ink">{bookingTitle(booking)}</span>
          </div>
          <div className="mt-1 text-xs text-ink-dim">{bookingSubtitle(booking)}</div>
          {booking.costUsd !== undefined && (
            <div className="mt-1 text-xs text-ink-faint">{booking.costUsd === 0 ? 'No prepaid cost' : `~$${booking.costUsd}`}</div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <StateBadge label={booking.status} tone={booking.status === 'confirmed' ? 'ok' : booking.status === 'proposed' ? 'warn' : 'neutral'} />
          {booking.status === 'proposed' && (
            <button onClick={() => void cancelProposal()} disabled={busy} className="text-[10px] font-medium text-risk hover:underline disabled:opacity-50">
              {busy ? 'Cancelling…' : 'Cancel proposal'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function BookingIcon({ kind }: { kind: TravelBooking['kind'] }) {
  const icon = kind === 'flight' ? '✈' : kind === 'hotel' ? '🏨' : kind === 'car' ? '🚗' : '🍽';
  return <span className="text-sm" aria-hidden>{icon}</span>;
}

function BrowserStatusBanner({ status, onManageCredentials }: { status: Awaited<ReturnType<typeof hermes.getTravelBrowserStatus>> | null; onManageCredentials?: () => void }) {
  if (!status) return null;
  if (!status.enabled) {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-xs text-warn">
        <strong>Browser booking disabled.</strong> Set <code className="rounded bg-warn/20 px-1">TRAVEL_BROWSER_USE=1</code> and <code className="rounded bg-warn/20 px-1">CHROME_BIN</code> to enable live hotel/car/restaurant searches. Demo data is shown until then.
      </div>
    );
  }
  if (!status.vaultUnlocked) {
    return (
      <div className="rounded-lg border border-warn/30 bg-warn/10 px-4 py-3 text-xs text-warn">
        <strong>Browser booking locked.</strong> Set <code className="rounded bg-warn/20 px-1">TRAVEL_BROWSER_VAULT_KEY</code> so credentials and sessions can be stored encrypted. Demo data is shown until the vault is unlocked.
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-ok/30 bg-ok/10 px-4 py-3 text-xs text-ok">
      <strong>Browser booking ready.</strong> {status.playbooks.length} playbook{status.playbooks.length === 1 ? '' : 's'} registered.
      {status.configuredSites.length > 0 && <> Authenticated sites: {status.configuredSites.join(', ')}.</>}
      <> Searches stop at the review page and require your approval before any purchase.</>
      {onManageCredentials && (
        <button onClick={onManageCredentials} className="ml-3 rounded border border-ok/40 px-2 py-0.5 text-[10px] font-medium text-ok hover:bg-ok/10">
          Manage credentials
        </button>
      )}
    </div>
  );
}

function bookingTitle(b: TravelBooking) {
  if (b.kind === 'flight') return `${b.airline} ${b.flightNumber}`;
  if (b.kind === 'hotel') return b.hotelName;
  if (b.kind === 'car') return `${b.company} ${b.carType}`;
  return b.restaurantName;
}

function bookingSubtitle(b: TravelBooking) {
  if (b.kind === 'flight') return `${b.origin} → ${b.destination} · ${formatDate(b.departureAt)} ${formatTime(b.departureAt)} – ${formatTime(b.arrivalAt)} · ${b.cabin}`;
  if (b.kind === 'hotel') return `${formatDate(b.checkIn)} – ${formatDate(b.checkOut)} · ${b.roomType}${b.address ? ` · ${b.address}` : ''}`;
  if (b.kind === 'car') return `${formatDate(b.pickupAt)} ${formatTime(b.pickupAt)} – ${formatDate(b.dropoffAt)} ${formatTime(b.dropoffAt)} · ${b.pickupLocation}`;
  return `${formatDate(b.reservationAt)} ${formatTime(b.reservationAt)} · Party of ${b.partySize}${b.cuisine ? ` · ${b.cuisine}` : ''}`;
}

function SearchDrawer({ kind, onClose, tripId }: { kind: SearchKind; onClose: () => void; tripId?: string }) {
  const meta = KIND_META[kind];
  const [params, setParams] = useState<Partial<TravelSearchParams>>({ kind });
  const [results, setResults] = useState<TravelSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposing, setProposing] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    const res = await hermes.searchTravel(params as TravelSearchParams);
    setResults(res);
    setBusy(false);
  };

  const propose = async (result: TravelSearchResult) => {
    if (!tripId) {
      toast('error', 'Select a trip first or create a new one.');
      return;
    }
    setProposing(result.id);
    const res = await hermes.proposeBooking(tripId, result.id);
    setProposing(null);
    if (res.ok) {
      toast('ok', `Proposed ${result.title} — approval created.`);
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Could not create proposal.');
    }
  };

  const field = (key: keyof TravelSearchParams, label: string, type = 'text') => (
    <div>
      <label className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">{label}</label>
      <input
        type={type}
        value={(params[key] as string | number | undefined) ?? ''}
        onChange={(e) => setParams((p: Partial<TravelSearchParams>) => ({ ...p, [key]: type === 'number' ? Number(e.target.value) : e.target.value }))}
        className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"
      />
    </div>
  );

  return (
    <Drawer title={meta.headline} onClose={onClose} width={460}>
      <div className="space-y-4">
        <div className="grid gap-3">
          {meta.fields.includes('origin') && field('origin', 'Origin (airport/city)')}
          {meta.fields.includes('destination') && field('destination', 'Destination (airport/city)')}
          {meta.fields.includes('checkIn') && field('checkIn', 'Check-in', 'date')}
          {meta.fields.includes('checkOut') && field('checkOut', 'Check-out', 'date')}
          {meta.fields.includes('departureDate') && field('departureDate', 'Pickup / departure', 'date')}
          {meta.fields.includes('returnDate') && field('returnDate', 'Dropoff / return', 'date')}
          {meta.fields.includes('date') && field('date', 'Date', 'date')}
          {meta.fields.includes('pickupLocation') && field('pickupLocation', 'Pickup location')}
          {meta.fields.includes('dropoffLocation') && field('dropoffLocation', 'Dropoff location')}
          {meta.fields.includes('partySize') && field('partySize', 'Party size', 'number')}
        </div>
        <button onClick={() => void search()} disabled={busy} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Searching…' : 'Search'}
        </button>
        {results && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Results</div>
            {results.length === 0 ? (
              <p className="text-xs text-ink-faint">No results for this search.</p>
            ) : (
              results.map((r) => (
                <div key={r.id} className="rounded-lg border border-edge bg-canvas p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{r.title}</div>
                      <div className="text-xs text-ink-dim">{r.subtitle}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      {r.priceUsd !== undefined && <div className="text-sm font-semibold text-ink">{r.priceUsd === 0 ? 'Free' : `$${r.priceUsd}`}</div>}
                      <button
                        onClick={() => void propose(r)}
                        disabled={proposing === r.id || !tripId}
                        className="mt-1 rounded border border-signal/40 px-2 py-1 text-[10px] font-medium text-signal hover:bg-signal/10 disabled:opacity-50"
                      >
                        {proposing === r.id ? '…' : 'Propose'}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
        {!tripId && <p className="text-xs text-warn">Open this search from a trip card so the proposal lands on the right trip.</p>}
      </div>
    </Drawer>
  );
}

function TripDrawer({ trip: initialTrip, onClose, onRefresh }: { trip: TravelTrip; onClose: () => void; onRefresh: () => void }) {
  const [tab, setTab] = useState<'itinerary' | 'confirmations' | 'approvals'>('itinerary');
  const [searchKind, setSearchKind] = useState<SearchKind | null>(null);
  const [busyApproval, setBusyApproval] = useState<string | null>(null);
  const [trip, setTrip] = useState(initialTrip);

  const refreshTrip = async () => {
    const fresh = await hermes.getTrip(trip.id);
    if (fresh) setTrip(fresh);
  };

  useEffect(() => {
    void refreshTrip();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (approval: TravelApproval, decision: 'approved' | 'rejected') => {
    setBusyApproval(approval.id);
    const res = await hermes.decideTravelApproval(approval.id, { decision });
    setBusyApproval(null);
    if (res.ok) {
      toast('ok', `${decision === 'approved' ? 'Approved' : 'Rejected'} ${approval.targetObject ?? 'booking'}.`);
      await refreshTrip();
      onRefresh();
    } else {
      toast('error', res.error?.safeMessage ?? 'Decision failed.');
    }
  };

  const confirmed = trip.bookings.filter((b) => b.status === 'confirmed');
  const pendingApprovals = trip.approvals.filter((a) => a.status === 'pending');

  return (
    <Drawer title={trip.name} onClose={onClose} width={560}>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-ink-dim">{trip.destination} · {formatDate(trip.startsAt)} – {formatDate(trip.endsAt)}</div>
        <StateBadge label={trip.status} tone={trip.status === 'upcoming' ? 'signal' : trip.status === 'active' ? 'ok' : 'neutral'} />
      </div>

      <div className="mb-4 flex border-b border-edge">
        {(['itinerary', 'confirmations', 'approvals'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-xs font-medium capitalize ${tab === t ? 'border-b-2 border-signal text-signal' : 'text-ink-dim hover:text-ink'}`}
          >
            {t} {t === 'confirmations' ? `(${confirmed.length})` : t === 'approvals' ? `(${pendingApprovals.length})` : `(${trip.bookings.length})`}
          </button>
        ))}
      </div>

      {tab === 'itinerary' && (
        <div className="space-y-3">
          {trip.bookings.length === 0 ? (
            <EmptyState title="No bookings yet" hint="Use the top cards on the Travel page to search and propose bookings." />
          ) : (
            trip.bookings.map((b) => <BookingRow key={b.id} booking={b} trip={trip} onRefresh={onRefresh} />)
          )}
          <div className="flex gap-2 pt-2">
            <button onClick={() => setSearchKind('flight')} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-dim hover:bg-canvas-overlay">＋ Flight</button>
            <button onClick={() => setSearchKind('hotel')} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-dim hover:bg-canvas-overlay">＋ Hotel</button>
            <button onClick={() => setSearchKind('car')} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-dim hover:bg-canvas-overlay">＋ Car</button>
            <button onClick={() => setSearchKind('restaurant')} className="rounded-lg border border-edge px-3 py-2 text-xs text-ink-dim hover:bg-canvas-overlay">＋ Restaurant</button>
          </div>
        </div>
      )}

      {tab === 'confirmations' && (
        <div className="space-y-3">
          {confirmed.length === 0 ? (
            <EmptyState title="No confirmed bookings" hint="Confirmed bookings appear here once you approve a proposal." />
          ) : (
            confirmed.map((b) => <BookingRow key={b.id} booking={b} trip={trip} onRefresh={onRefresh} />)
          )}
        </div>
      )}

      {tab === 'approvals' && (
        <div className="space-y-3">
          {pendingApprovals.length === 0 ? (
            <EmptyState title="No pending approvals" hint="Booking proposals create approvals that appear here." />
          ) : (
            pendingApprovals.map((a) => (
              <div key={a.id} className="rounded-lg border border-edge bg-canvas p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{a.targetObject ?? 'Travel booking'}</div>
                    <div className="mt-0.5 text-xs text-ink-dim">{a.targetSystem} · <RiskBadge risk={a.risk} /></div>
                    {a.payload && <p className="mt-2 whitespace-pre-wrap text-xs text-ink-faint">{a.payload}</p>}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => void decide(a, 'approved')}
                    disabled={busyApproval === a.id}
                    className="rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
                  >
                    {busyApproval === a.id ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={() => void decide(a, 'rejected')}
                    disabled={busyApproval === a.id}
                    className="rounded-lg border border-risk/40 px-3 py-1.5 text-xs font-medium text-risk hover:bg-risk/10 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {searchKind && <SearchDrawer kind={searchKind} tripId={trip.id} onClose={() => setSearchKind(null)} />}
    </Drawer>
  );
}

export default function Travel() {
  const [trips, setTrips] = useState<TravelTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [openTrip, setOpenTrip] = useState<TravelTrip | null>(null);
  const [searchKind, setSearchKind] = useState<SearchKind | null>(null);
  const [newTripOpen, setNewTripOpen] = useState(false);
  const [agentResult, setAgentResult] = useState<TravelAgentResult | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentQuery, setAgentQuery] = useState('');
  const [agentProposing, setAgentProposing] = useState<string | null>(null);
  const [browserStatus, setBrowserStatus] = useState<Awaited<ReturnType<typeof hermes.getTravelBrowserStatus>> | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const [rows, status] = await Promise.all([hermes.listTrips(), hermes.getTravelBrowserStatus()]);
    setTrips(rows);
    setBrowserStatus(status);
    setOpenTrip((current) => (current ? rows.find((t) => t.id === current.id) ?? null : null));
    setLoading(false);
  };

  const runAgent = async () => {
    const q = agentQuery.trim();
    if (!q) return;
    setAgentBusy(true);
    setAgentResult(null);
    const res = await hermes.travelAgent(q);
    setAgentResult(res);
    setAgentBusy(false);
  };

  const proposeAgentResult = async (result: TravelSearchResult) => {
    const firstTrip = upcoming[0];
    if (!firstTrip) {
      toast('error', 'Create a trip first before proposing bookings.');
      return;
    }
    setAgentProposing(result.id);
    const res = await hermes.proposeBooking(firstTrip.id, result.id);
    setAgentProposing(null);
    if (res.ok) {
      toast('ok', `Proposed ${result.title} on "${firstTrip.name}".`);
      await load();
    } else {
      toast('error', res.error?.safeMessage ?? 'Could not create proposal.');
    }
  };

  const handleAgentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void runAgent();
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const upcoming = useMemo(() => trips.filter((t) => ['planning', 'upcoming', 'active'].includes(t.status)).sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [trips]);
  const pendingApprovals = useMemo(() => trips.flatMap((t) => t.approvals.filter((a) => a.status === 'pending')), [trips]);

  const railSections = useMemo<RailSectionDef[]>(
    () => [
      {
        key: 'travel-upcoming',
        title: 'Upcoming trips',
        count: upcoming.length,
        node: (
          <ul className="space-y-1.5">
            {upcoming.length === 0 ? (
              <li className="px-2 text-xs text-ink-faint">No upcoming trips.</li>
            ) : (
              upcoming.map((t) => (
                <li key={t.id}>
                  <button onClick={() => setOpenTrip(t)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas-overlay">
                    <div className="truncate text-xs font-medium text-ink">{t.name}</div>
                    <div className="text-[11px] text-ink-faint">{formatDate(t.startsAt)} · {t.bookings.filter((b) => b.status === 'confirmed').length}/{t.bookings.length} confirmed</div>
                  </button>
                </li>
              ))
            )}
          </ul>
        ),
      },
      {
        key: 'travel-approvals',
        title: 'Pending approvals',
        count: pendingApprovals.length,
        node: (
          <ul className="space-y-1.5">
            {pendingApprovals.length === 0 ? (
              <li className="px-2 text-xs text-ok">No pending travel approvals.</li>
            ) : (
              pendingApprovals.map((a) => (
                <li key={a.id}>
                  <button onClick={() => {
                    const trip = trips.find((t) => t.id === a.tripId);
                    if (trip) setOpenTrip(trip);
                  }} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas-overlay">
                    <div className="truncate text-xs font-medium text-ink">{a.targetObject ?? 'Travel booking'}</div>
                    <div className="text-[11px] text-ink-faint">{a.targetSystem} · <span className="text-warn">{a.risk} risk</span></div>
                  </button>
                </li>
              ))
            )}
          </ul>
        ),
      },
    ],
    [upcoming, pendingApprovals, trips],
  );
  usePageRail(railSections);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Travel</h1>
        <p className="mt-1 text-sm text-ink-dim">Flights, hotels, cars, and restaurants for upcoming trips. Proposed bookings become approvals before any purchase.</p>
      </header>

      {/* Ask Ally natural-language travel search */}
      <div className="rounded-xl border border-signal/20 bg-signal/[0.04] p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm" aria-hidden>🤖</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-signal">Ask {AGENT_NAME}</span>
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={agentQuery}
            onChange={(e) => setAgentQuery(e.target.value)}
            onKeyDown={handleAgentKeyDown}
            placeholder='Try "flights BHM to BTR Sep 15–17" or "restaurants in New York on Friday for 4"'
            className="min-w-0 flex-1 rounded-lg border border-edge bg-canvas px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint"
            disabled={agentBusy}
          />
          <button
            onClick={() => void runAgent()}
            disabled={agentBusy || !agentQuery.trim()}
            className="shrink-0 rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
          >
            {agentBusy ? 'Searching…' : 'Search'}
          </button>
        </div>
        {agentResult && (
          <div className="mt-3 space-y-2">
            <div className="flex items-start gap-2">
              {agentResult.kind ? (
                <span className="text-xs text-ink-dim">{agentResult.summary}</span>
              ) : (
                <span className="text-xs text-warn">{agentResult.summary}</span>
              )}
            </div>
            {agentResult.results.length > 0 && (
              <div className="space-y-1.5">
                {agentResult.results.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-canvas px-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">{r.title}</div>
                      <div className="text-xs text-ink-dim">{r.subtitle}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.priceUsd !== undefined && (
                        <span className="text-sm font-semibold text-ink">{r.priceUsd === 0 ? 'Free' : `$${r.priceUsd}`}</span>
                      )}
                      <button
                        onClick={() => void proposeAgentResult(r)}
                        disabled={agentProposing === r.id}
                        className="rounded border border-signal/40 px-2 py-1 text-[10px] font-medium text-signal hover:bg-signal/10 disabled:opacity-50"
                      >
                        {agentProposing === r.id ? '…' : 'Propose'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {agentResult.kind && agentResult.results.length === 0 && !agentBusy && (
              <p className="text-xs text-ink-faint">Use the search cards below or try a different query.</p>
            )}
          </div>
        )}
      </div>

      <BrowserStatusBanner status={browserStatus} onManageCredentials={() => setVaultOpen(true)} />

      <div className="grid gap-4 md:grid-cols-3">
        <button onClick={() => setSearchKind('flight')} className="rounded-xl border border-edge bg-canvas-raised p-5 text-left hover:border-signal/40 hover:bg-canvas-overlay">
          <div className="text-2xl" aria-hidden>✈</div>
          <div className="mt-2 text-sm font-semibold">Flights</div>
          <div className="text-xs text-ink-dim">Search and propose flight itineraries.</div>
        </button>
        <button onClick={() => setSearchKind('hotel')} className="rounded-xl border border-edge bg-canvas-raised p-5 text-left hover:border-signal/40 hover:bg-canvas-overlay">
          <div className="text-2xl" aria-hidden>🏨</div>
          <div className="mt-2 text-sm font-semibold">Hotels & Cars</div>
          <div className="text-xs text-ink-dim">Search hotels and rental cars.</div>
        </button>
        <button onClick={() => setSearchKind('restaurant')} className="rounded-xl border border-edge bg-canvas-raised p-5 text-left hover:border-signal/40 hover:bg-canvas-overlay">
          <div className="text-2xl" aria-hidden>🍽</div>
          <div className="mt-2 text-sm font-semibold">Restaurants</div>
          <div className="text-xs text-ink-dim">Find and reserve restaurants.</div>
        </button>
      </div>

      <Card className="p-5">
        <SectionTitle right={
          <button onClick={() => setNewTripOpen(true)} className="rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-signal/90">New trip</button>
        }>Upcoming trips</SectionTitle>
        {loading ? (
          <p className="text-xs text-ink-faint">Loading trips…</p>
        ) : upcoming.length === 0 ? (
          <EmptyState title="No trips yet" hint="Create a trip, then search flights, hotels, cars, and restaurants." />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2">
            {upcoming.map((t) => (
              <li key={t.id}>
                <button onClick={() => setOpenTrip(t)} className="w-full rounded-lg border border-edge bg-canvas p-4 text-left hover:border-signal/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{t.name}</span>
                    <StateBadge label={t.status} tone={t.status === 'active' ? 'ok' : t.status === 'upcoming' ? 'signal' : 'neutral'} />
                  </div>
                  <div className="mt-1 text-xs text-ink-dim">{t.destination}</div>
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-faint">
                    <span>{formatDate(t.startsAt)} – {formatDate(t.endsAt)}</span>
                    <span>{t.bookings.filter((b) => b.status === 'confirmed').length} confirmed</span>
                    {t.approvals.filter((a) => a.status === 'pending').length > 0 && (
                      <span className="text-warn">{t.approvals.filter((a) => a.status === 'pending').length} pending</span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {searchKind && <SearchDrawer kind={searchKind} onClose={() => setSearchKind(null)} />}
      {openTrip && <TripDrawer trip={openTrip} onClose={() => setOpenTrip(null)} onRefresh={() => void load()} />}
      {newTripOpen && <NewTripDrawer onClose={() => setNewTripOpen(false)} onCreated={() => void load()} />}
      {vaultOpen && <VaultDrawer onClose={() => { setVaultOpen(false); void load(); }} />}
    </div>
  );
}

function VaultDrawer({ onClose }: { onClose: () => void }) {
  const [sites, setSites] = useState<TravelVaultSite[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSite, setEditingSite] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editTotp, setEditTotp] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [addNew, setAddNew] = useState(false);
  const [newSite, setNewSite] = useState('');

  const loadSites = async () => {
    setLoading(true);
    const rows = await hermes.listTravelVaultSites();
    setSites(rows);
    setLoading(false);
  };

  useEffect(() => { void loadSites(); }, []);

  const startEdit = (site: TravelVaultSite) => {
    setEditingSite(site.site);
    setEditUsername('');
    setEditPassword('');
    setEditTotp('');
    setEditNotes(site.notes ?? '');
  };

  const saveEdit = async () => {
    if (!editingSite) return;
    setBusy(true);
    const input: TravelVaultSiteInput = {};
    if (editUsername) input.username = editUsername;
    if (editPassword) input.password = editPassword;
    if (editTotp) input.totpSeed = editTotp;
    if (editNotes !== undefined) input.notes = editNotes;
    const res = await hermes.setTravelVaultSite(editingSite, input);
    setBusy(false);
    if (res.ok) {
      toast('ok', `Updated credentials for ${editingSite}.`);
      setEditingSite(null);
      await loadSites();
    } else {
      toast('error', res.error?.safeMessage ?? 'Save failed.');
    }
  };

  const addSite = async () => {
    const site = newSite.trim().toLowerCase();
    if (!site) { toast('error', 'Site name is required.'); return; }
    setBusy(true);
    const input: TravelVaultSiteInput = {};
    if (editUsername) input.username = editUsername;
    if (editPassword) input.password = editPassword;
    if (editTotp) input.totpSeed = editTotp;
    if (editNotes !== undefined) input.notes = editNotes;
    const res = await hermes.setTravelVaultSite(site, input);
    setBusy(false);
    if (res.ok) {
      toast('ok', `Added credentials for ${site}.`);
      setAddNew(false);
      setNewSite('');
      setEditUsername('');
      setEditPassword('');
      setEditTotp('');
      setEditNotes('');
      await loadSites();
    } else {
      toast('error', res.error?.safeMessage ?? 'Add failed.');
    }
  };

  const removeSite = async (site: string) => {
    setBusy(true);
    const res = await hermes.removeTravelVaultSite(site);
    setBusy(false);
    if (res.ok) {
      toast('ok', `Removed credentials for ${site}.`);
      if (editingSite === site) setEditingSite(null);
      await loadSites();
    } else {
      toast('error', res.error?.safeMessage ?? 'Remove failed.');
    }
  };

  return (
    <Drawer title="Credential vault" onClose={onClose} width={500}>
      <div className="space-y-4">
        <p className="text-xs text-ink-dim">
          Stored credentials for browser-automation sites. Passwords are encrypted and never displayed — only the presence of a credential is shown.
        </p>

        {loading ? (
          <p className="text-xs text-ink-faint">Loading vault sites…</p>
        ) : sites.length === 0 && !addNew ? (
          <EmptyState title="No credentials stored" hint="Add credentials below so browser-use can log into booking sites automatically." />
        ) : (
          <div className="space-y-2">
            {sites.map((s) => (
              <div key={s.site} className="rounded-lg border border-edge bg-canvas p-3">
                {editingSite === s.site ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-ink">{s.site}</span>
                      <button onClick={() => setEditingSite(null)} className="text-xs text-ink-dim hover:text-ink">Cancel</button>
                    </div>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Username</label>
                      <input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} placeholder={s.hasUsername ? 'Replace existing' : 'Add username'} className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Password</label>
                      <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder={s.hasPassword ? 'Replace existing' : 'Add password'} className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">TOTP seed</label>
                      <input type="password" value={editTotp} onChange={(e) => setEditTotp(e.target.value)} placeholder={s.hasTotp ? 'Replace existing' : 'Add TOTP'} className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
                    </div>
                    <div>
                      <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Notes</label>
                      <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Optional notes" className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => void saveEdit()} disabled={busy} className="rounded bg-signal px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-ink">{s.site}</span>
                        {s.hasPassword ? <span className="rounded bg-ok/10 px-1.5 py-0.5 text-[10px] text-ok">Password stored</span> : null}
                        {s.hasUsername ? <span className="rounded bg-signal/10 px-1.5 py-0.5 text-[10px] text-signal">Username saved</span> : null}
                        {s.hasTotp ? <span className="rounded bg-warn/10 px-1.5 py-0.5 text-[10px] text-warn">TOTP set</span> : null}
                      </div>
                      {s.notes && <p className="mt-1 text-xs text-ink-dim">{s.notes}</p>}
                      <div className="mt-0.5 text-[10px] text-ink-faint">Updated {new Date(s.updatedAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <button onClick={() => startEdit(s)} disabled={busy} className="rounded border border-edge px-2 py-1 text-[10px] font-medium text-ink-dim hover:bg-canvas-overlay disabled:opacity-50">
                        Edit
                      </button>
                      <button onClick={() => void removeSite(s.site)} disabled={busy} className="rounded border border-risk/30 px-2 py-1 text-[10px] font-medium text-risk hover:bg-risk/10 disabled:opacity-50">
                        Remove
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {addNew ? (
          <div className="space-y-3 rounded-lg border border-edge bg-canvas-raised p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Add site</span>
              <button onClick={() => { setAddNew(false); setNewSite(''); }} className="text-xs text-ink-dim hover:text-ink">Cancel</button>
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Site name</label>
              <input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="kayak, opentable, ihg, marriott…" className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Username</label>
              <input value={editUsername} onChange={(e) => setEditUsername(e.target.value)} className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Password</label>
              <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">TOTP seed</label>
              <input type="password" value={editTotp} onChange={(e) => setEditTotp(e.target.value)} className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
            </div>
            <div>
              <label className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">Notes</label>
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} className="mt-1 w-full rounded border border-edge bg-canvas px-2 py-1.5 text-sm text-ink" />
            </div>
            <button onClick={() => void addSite()} disabled={busy} className="w-full rounded bg-signal px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
              {busy ? 'Adding…' : 'Add site'}
            </button>
          </div>
        ) : (
          <button onClick={() => { setAddNew(true); setEditingSite(null); }} className="w-full rounded-lg border border-dashed border-edge px-4 py-2.5 text-xs font-medium text-ink-dim hover:border-signal/40 hover:text-signal">
            + Add credentials
          </button>
        )}
      </div>
    </Drawer>
  );
}

function NewTripDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || !destination.trim() || !startsAt || !endsAt) {
      toast('error', 'All fields are required.');
      return;
    }
    setBusy(true);
    const res = await hermes.createTrip({ name: name.trim(), destination: destination.trim(), startsAt, endsAt });
    setBusy(false);
    if (res.ok) {
      toast('ok', `Created trip "${name.trim()}".`);
      onCreated();
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Could not create trip.');
    }
  };

  return (
    <Drawer title="New trip" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label htmlFor="trip-name" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Trip name</label>
          <input id="trip-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink" placeholder="Q4 board trip" />
        </div>
        <div>
          <label htmlFor="trip-destination" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Destination</label>
          <input id="trip-destination" value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink" placeholder="Baton Rouge, LA" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="trip-starts" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Starts</label>
            <input id="trip-starts" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink" />
          </div>
          <div>
            <label htmlFor="trip-ends" className="text-[11px] font-medium uppercase tracking-wider text-ink-faint">Ends</label>
            <input id="trip-ends" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink" />
          </div>
        </div>
        <button onClick={() => void submit()} disabled={busy} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create trip'}
        </button>
      </div>
    </Drawer>
  );
}
