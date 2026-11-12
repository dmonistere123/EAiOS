# Travel conversation staging — November 12, 2026

The revised planner is available at http://127.0.0.1:5275/travel in the existing isolated Travel/HI staging service. This revision has not been deployed to production or published as an installer release.

## Experience

1. Trip name, actual stay destination, departure airport, travel purpose (Personal, Board Meeting, Customer Meeting, Internal Meeting), dates, and a free-text trip brief. Arrival airport is a separate choice. Optional structured preferences remain available in one disclosure.
2. Your Options includes a trip-specific Ally conversation. The brief is interpreted once; later messages update the same saved trip. Changed categories are refreshed while other results and selected itinerary items remain. Airline preferences distinguish preferred from required. No matches are explicitly reported, rather than silently substituting airlines.
3. Review the itinerary and use the existing artifact, email approval, and human-assistant checklist handoff. The artifact includes purpose, separate locations, trip brief, airline policy and conversation. Pending clarifying questions block handoff. Selections are still estimates; the human books and submits completion for executive sign-off.

## Implementation

- Additive JSON fields in the existing trip store; no schema migration or runtime profile changes.
- `POST /api/travel/trips/:id/conversation`: same-origin JSON, bounded input, OpenRouter interpretation into an allowlisted patch. Airport changes resolve through actual provider suggestions. A concurrent trip change rejects a stale model answer instead of overwriting it. Models cannot create bookings, approvals, or sends.
- Optional `kinds` query parameter narrows existing recommendation requests. Chat sees only bounded, cached visible options, saved preferences, recent conversation, and selection titles.
- Hotel/dining web research aims for ten matches per requested category. A second structured extraction binds venue names to retrieved source text and source indices; uncited names and unsupported exact addresses are rejected. Multiple venues can share a local-guide citation but receive distinct IDs. If evidence is insufficient, the UI reports fewer matches. No dedicated Yelp API or live hotel/restaurant inventory was added.
- An age-free rental request can be carried to the human assistant; provider car rates still require driver details.
- Chat and source research use the already configured OpenRouter provider. Staging continues to load only its explicitly provisioned credentials, capture email locally, and use Duffel test fares. Production services, personal profiles, credentials, Tailscale routing and installer pins are unchanged.

## Verification

- Full app suite: 691 passed, 1 skipped before the final source-extraction improvements.
- Final focused Travel suite: 57 passed across 7 files. Coverage includes structured trip edits, airline-only filtering, concurrent edits, clarifications, failure preservation, targeted category refreshes, source validation, shared-source venue IDs, selection persistence and the existing human handoff.
- TypeScript, normal build and staging build pass. Existing lint warnings and bundle-size warning remain.
- Live staging browser exercise: Birmingham departure, New Orleans arrival, Baton Rouge stay, Board Meeting, Southwest-only, IHG, seafood and rental request. The airline nonmatch is explicit. A selected hotel survives a dining-only conversation refresh. Live source extraction returned ten restaurant choices.

To review: open the staging Travel URL and create a trip, or reopen the clearly labeled `STAGING REVIEW · Baton Rouge board visit`. The pre-existing staging samples remain intact. Use the production deployment/preservation procedure before promoting this revision; do not replace the customized production release wholesale with this checkout.

## Reusing previous trips

The new-trip form now has a “Plan a similar trip” selector, and saved itineraries have the same action. It copies the latest structured preferences and separate airport/stay locations into a new draft. Dates, dated free-text instructions, chat history, driver age/test-location settings, reservations, approvals and HI handoffs are not copied. The executive chooses fresh dates and can edit preferences before new searches. A `basedOnTripId` reference preserves which saved trip supplied the preferences; the original trip is unchanged. This is explicit reuse, not an inferred global preference profile.

Staging labels now explicitly identify Duffel Airways as a fictional test airline. “Prefer” continues to permit alternatives, while “only” filters them out. Test-mode results do not establish real-world availability.

Reuse validation: 46 tests passed across the Travel UI, conversation, server and human-handoff suites; TypeScript and staging build passed (existing bundle-size warning remains).
