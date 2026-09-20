import type { TravelBooking, TravelTrip, AuditResult } from '../src/domain/types.ts';
import type { TravelAction, TravelPassenger } from '../src/domain/travelPlan.ts';
import { duffel, duffelTestMode, flightTerms, type FlightOffer, type StayQuote, type DuffelOrder } from './duffel.ts';
import { travelStore, readTrip, writeTrip } from './travelStore.ts';
import {carDetails, type CarRate} from './travelCars.ts';
import { TravelApiError } from './travel.ts';

function locate(trip: TravelTrip | null, id: string): TravelBooking {
  const booking = trip?.bookings.find(b => b.id === id);
  if (!booking) throw new TravelApiError(404, 'Travel plan not found.');
  return booking;
}
function modify(root: string, tripId: string, id: string, fn: (b: TravelBooking) => void): TravelBooking {
  return travelStore(root, db => { const trip = readTrip(db, tripId); const b = locate(trip, id); fn(b); writeTrip(db, trip!); return b; });
}
function validatePassenger(p: TravelPassenger) {
  if (!p || !['given_name', 'family_name', 'born_on', 'email', 'phone_number'].every(key => typeof p[key as keyof TravelPassenger] === 'string' && p[key as keyof TravelPassenger].trim().length > 0 && p[key as keyof TravelPassenger].length <= 200) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(p.born_on) || !Number.isFinite(Date.parse(p.born_on)) || Date.parse(p.born_on) >= Date.now() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email) || !/^\+[1-9]\d{7,14}$/.test(p.phone_number) || !['m','f'].includes(p.gender) || !['mr','ms','mrs','miss','dr'].includes(p.title)) {
    throw new TravelApiError(400, 'Enter the adult traveler’s legal name, birth date, title, gender, email, and international phone number.');
  }
  if (Date.now() - Date.parse(p.born_on) < 18 * 365.25 * 86400_000) throw new TravelApiError(400, 'This booking flow currently supports one adult traveler.');
}
async function refresh(b: TravelBooking): Promise<{amount: string; currency: string; id: string; details: string; passengerId?: string}> {
  if (b.provider !== 'duffel' || !b.offerId || !['flight','hotel','car'].includes(b.kind)) throw new TravelApiError(400, 'Complete this reservation on the provider website.');
  if (b.testMode !== duffelTestMode()) throw new TravelApiError(409, 'The offer belongs to a different Duffel mode. Search again.');
  if (b.kind === 'flight') {
    const offer = await duffel<FlightOffer>(`/air/offers/${encodeURIComponent(b.offerId)}`);
    if (offer.id !== b.offerId || !Number.isFinite(Date.parse(offer.expires_at)) || Date.parse(offer.expires_at) <= Date.now() || offer.live_mode !== !b.testMode) throw new TravelApiError(409, 'This flight offer has expired or changed mode. Search again.');
    if (offer.passengers.length !== 1) throw new TravelApiError(400, 'This checkout supports one adult traveler.');
    return {amount: offer.total_amount, currency: offer.total_currency, id: offer.id, passengerId: offer.passengers[0].id, details: flightTerms(offer)};
  }
  if (b.kind === 'car') {
    const quote = await duffel<CarRate>('/cars/quotes', {rate_id:b.offerId});
    if (quote.rate_id !== b.offerId || quote.live_mode !== !b.testMode || quote.payment_type !== 'postpaid' || !quote.id || `${quote.pickup_date}T${quote.pickup_time}` !== b.pickupAt || `${quote.dropoff_date}T${quote.dropoff_time}` !== b.dropoffAt) throw new TravelApiError(409, 'Car rate changed or requires unsupported payment. Search again.');
    return {amount:quote.total_amount,currency:quote.total_currency,id:quote.id,details:carDetails(quote)};
  }
  const quote = await duffel<StayQuote>('/stays/quotes', {rate_id: b.offerId});
  const room = quote.accommodation?.rooms?.find(r => r.rates.some(rate => rate.id === b.offerId));
  const rate = room?.rates.find(r => r.id === b.offerId);
  if (!rate || rate.payment_type !== 'pay_now' || rate.loyalty_programme_required) throw new TravelApiError(409, 'This hotel rate is not supported by checkout. Use provider-site booking.');
  return {amount: quote.total_amount, currency: quote.total_currency, id: quote.id, details: [
    `${quote.accommodation?.name} — ${room?.name}`,
    `Check-in: ${quote.check_in_date}; check-out: ${quote.check_out_date}`,
    `Board: ${(rate.board_type ?? 'not specified').replaceAll('_',' ')}`,
    `Due at property: ${quote.due_at_accommodation_currency ?? ''} ${quote.due_at_accommodation_amount ?? 'unknown; confirm with property'}`,
    `Deposit: ${quote.deposit_currency ?? ''} ${quote.deposit_amount ?? 'see rate conditions'}`,
    `Cancellation: ${formatHotelRules(rate.cancellation_timeline)}`,
    `Conditions: ${formatHotelRules(rate.conditions)}`,
  ].join('\n')};
}
function acceptOrder(root: string, tripId: string, bookingId: string, order: DuffelOrder) {
  return modify(root, tripId, bookingId, b => {
    if (!order.id || typeof order.id !== 'string') throw new TravelApiError(502, 'Provider did not return an order identifier.');
    if (order.live_mode !== !b.testMode || order.metadata?.eaios_attempt !== b.attemptId || (b.kind === 'flight' && order.offer_id !== b.offerId) || (b.kind === 'car' && order.quote_id !== b.quoteId)) throw new TravelApiError(409, 'Provider result does not match this booking attempt.');
    b.providerId = order.id;
    const reference = b.kind === 'flight' ? order.booking_reference : order.reference;
    const complete = b.kind === 'flight' ? order.payment_status?.awaiting_payment === false : order.status === 'confirmed';
    if (!reference || !complete || order.cancelled_at) { b.status = 'unknown'; b.outcomeMessage = 'Provider has not confirmed a completed reservation. Check status; do not buy again.'; return; }
    if (b.kind === 'car') b.driverName = order.driver ? `${order.driver.given_name} ${order.driver.family_name}` : undefined;
    b.status = 'confirmed'; b.confirmationSource = 'provider'; b.confirmationNumber = reference; b.confirmedAt = new Date().toISOString(); b.outcomeMessage = undefined;
  });
}
export async function travelAction(tripId: string, bookingId: string, action: TravelAction, root: string): Promise<AuditResult<TravelBooking>> {
  const audit = (b: TravelBooking): AuditResult<TravelBooking> => ({ok: true, data: b, auditEventId: b.attemptId ?? b.id});
  const initial = travelStore(root, db => locate(readTrip(db, tripId), bookingId));
  if (action.action === 'record') {
    if (typeof action.reference !== 'string' || !action.reference.trim() || action.reference.length > 120 || typeof action.evidence !== 'string' || !action.evidence.trim() || action.evidence.length > 20000) throw new TravelApiError(400, 'Provide the reservation reference and confirmation text (maximum 20,000 characters).');
    return audit(modify(root, tripId, bookingId, b => {
      if (b.provider !== 'external' || b.status !== 'approved') throw new TravelApiError(409, 'Only an approved external plan can receive a manual confirmation.');
      b.status = 'recorded'; b.confirmationNumber = action.reference.trim(); b.confirmationEvidence = action.evidence.trim(); b.confirmationSource = 'manual'; b.confirmedAt = new Date().toISOString();
    }));
  }
  if (action.action === 'reconcile') {
    if (!initial.attemptId || !['submitting','unknown'].includes(initial.status)) return audit(initial);
    const path = initial.kind === 'flight' ? '/air/orders' : initial.kind === 'car' ? '/cars/bookings' : '/stays/bookings';
    if (initial.testMode !== duffelTestMode()) throw new TravelApiError(409, 'Restore the Duffel credentials used by this booking attempt before checking its status.');
    if (initial.providerId) return audit(acceptOrder(root, tripId, bookingId, await duffel<DuffelOrder>(`${path}/${encodeURIComponent(initial.providerId)}`)));
    // Flights can be located by their original offer. No POST and no retry of the purchase.
    if (initial.kind !== 'car') {
      const orders = await duffel<DuffelOrder[]>(initial.kind === 'flight' ? `${path}?offer_id=${encodeURIComponent(initial.offerId!)}&limit=200` : path);
      const matches = orders.filter(o => o.metadata?.eaios_attempt === initial.attemptId && (initial.kind !== 'flight' || o.offer_id === initial.offerId));
      if (matches.length === 1) return audit(acceptOrder(root, tripId, bookingId, matches[0]));
    }
    return audit(modify(root, tripId, bookingId, b => { if (b.status !== 'confirmed') { b.status = 'unknown'; b.outcomeMessage = `No completed booking verified. Keep attempt ${b.attemptId} and check Duffel/support before making another purchase.`; } }));
  }
  if (!['quote','book'].includes(action.action)) throw new TravelApiError(400, 'Unknown travel action.');
  if (initial.status !== 'approved') throw new TravelApiError(409, 'Approve this plan first. A submitted purchase cannot be retried.');
  const fresh = await refresh(initial);
  if (!/^\d+\.\d{2}$/.test(fresh.amount) || !/^[A-Z]{3}$/.test(fresh.currency)) throw new TravelApiError(502, 'Provider returned an invalid price.');
  if (action.action === 'quote') return audit(modify(root, tripId, bookingId, b => {
    if (b.status !== 'approved') throw new TravelApiError(409, 'Booking state changed. Refresh the trip.');
    b.amount = fresh.amount; b.currency = fresh.currency; b.details = fresh.details; b.costUsd = fresh.currency === 'USD' ? Number(fresh.amount) : undefined;
  }));
  if (!action.accepted) throw new TravelApiError(400, 'Review and accept the itinerary, fare conditions, and total before purchase.');
  validatePassenger(action.passenger);
  if (initial.kind === 'car') {
    const born = action.passenger.born_on, pickup = initial.pickupAt.slice(0,10);
    const age = Number(pickup.slice(0,4))-Number(born.slice(0,4))-(pickup.slice(5)<born.slice(5)?1:0);
    if (age !== initial.driverAge) throw new TravelApiError(409, 'Driver birth date does not match age used for the car search. Update driver age and search again.');
  }
  // A live token alone must not activate purchases on an upgraded box.
  if (!duffelTestMode() && process.env.EAIOS_DUFFEL_LIVE_BOOKING !== '1') throw new TravelApiError(403, 'Live purchases are not enabled on this box. Test-mode booking is available.');
  if (action.amount !== fresh.amount || action.currency !== fresh.currency || initial.amount !== fresh.amount || initial.currency !== fresh.currency || initial.details !== fresh.details) {
    throw new TravelApiError(409, 'Price or itinerary conditions changed. Refresh the quote and review it before approving purchase.');
  }
  const attemptId = crypto.randomUUID();
  const claimed = travelStore(root, db => {
    const trip = readTrip(db, tripId), b = locate(trip, bookingId);
    if (b.status !== 'approved') throw new TravelApiError(409, 'This purchase is already submitted or no longer approved.');
    if (b.amount !== fresh.amount || b.currency !== fresh.currency || b.details !== fresh.details) throw new TravelApiError(409, 'Quote changed in another session. Review again.');
    db.exec('CREATE TABLE IF NOT EXISTS purchase_attempts (offer_key TEXT PRIMARY KEY, attempt_id TEXT NOT NULL)');
    const key = `${b.testMode ? 'test' : 'live'}:${b.offerId}`;
    if (db.prepare('SELECT 1 FROM purchase_attempts WHERE offer_key=?').get(key)) throw new TravelApiError(409, 'This offer was already submitted. Check the original booking instead of purchasing again.');
    db.prepare('INSERT INTO purchase_attempts VALUES (?, ?)').run(key, attemptId);
    if (b.kind === 'car') b.quoteId = fresh.id;
    b.status = 'submitting'; b.attemptId = attemptId; b.outcomeMessage = 'Submission started. If interrupted, check provider status; do not submit another purchase.'; writeTrip(db, trip!); return b;
  });
  // The committed attempt survives process exit or a lost HTTP response.
  const p = action.passenger;
  const passenger = {given_name: p.given_name.trim(), family_name: p.family_name.trim(), born_on: p.born_on, title: p.title, gender: p.gender, email: p.email, phone_number: p.phone_number};
  try {
    const order = claimed.kind === 'flight'
      ? await duffel<DuffelOrder>('/air/orders', {type: 'instant', selected_offers: [fresh.id], passengers: [{...passenger, id: fresh.passengerId}], payments: [{type: 'balance', amount: fresh.amount, currency: fresh.currency}], metadata: {eaios_attempt: attemptId}}, attemptId)
      : claimed.kind === 'car' ? await duffel<DuffelOrder>('/cars/bookings', {quote_id:fresh.id,driver:{given_name:passenger.given_name,family_name:passenger.family_name,date_of_birth:p.born_on,email:p.email,phone_number:p.phone_number},metadata:{eaios_attempt:attemptId}},attemptId)
      : await duffel<DuffelOrder>('/stays/bookings', {quote_id: fresh.id, guests: [{given_name: passenger.given_name, family_name: passenger.family_name, born_on: passenger.born_on}], email: p.email, phone_number: p.phone_number, metadata: {eaios_attempt: attemptId}}, attemptId);
    return audit(acceptOrder(root, tripId, bookingId, order));
  } catch {
    // Conservatively retain the attempt even on non-2xx: an intermediary can fail after the provider commits.
    return audit(modify(root, tripId, bookingId, b => { if (b.status !== 'confirmed') { b.status = 'unknown'; b.outcomeMessage = 'The provider outcome is uncertain. Check status or contact Duffel with the attempt ID; this app will not purchase again.'; } }));
  }
}

function formatHotelRules(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'not specified; confirm with provider';
  return value.map((item: Record<string, unknown>) => item.description ? `${item.title ?? ''}: ${item.description}` : item.before ? `Refund ${item.currency ?? ''} ${item.refund_amount ?? 'not specified'} before ${item.before}` : 'See provider conditions').join('; ');
}
