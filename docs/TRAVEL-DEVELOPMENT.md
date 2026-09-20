# Travel planning and provider checkout

Travel now uses a per-box SQLite database at `EAIOS_DATA_ROOT/travel-data/travel.db` (repository root fallback). Both web services use the same root. Release backups include this database, and upgrades retain it in place. Agent definitions, skills, Hermes instructions, credentials, and conversation databases are not part of this change.

Before deploying over the old in-memory module, export any existing `/api/travel/trips` response while the old process is still running. Old in-memory trips cannot be recovered after restart; they are not silently migrated. Review any old “confirmed” state because older approval code did not submit provider bookings.

## Workflow

The guided planner has four steps: **Trip details → Your preferences → Your options → Your itinerary**. Type departure/destination city names and select a named airport suggestion; no airport codes are required. Click the date fields or calendar buttons to choose dates. Enter the USD budget, preferred airlines/hotels, dining preferences, and whether a rental car is needed, then choose **Find my options**.

The server searches connected providers and returns at most three distinct options per category, ranked by matching preferences and price. This ranking is deterministic; it is not an autonomous AI travel concierge. Fewer results and provider failures are shown explicitly without demo replacements. Choosing an option saves it to the itinerary as **Selected · not booked**, without purchasing or requiring a separate approval tab. Saved trips reopen directly to their itinerary; **Find options** restores their preferences for editing. Existing trips without selected places need city selection once. When a car is requested, the form also gathers driver age at pickup, country of residence, and local pickup/return times. Duffel Cars returns up to three pay-at-counter rates near the destination airport; selected rates use the same itinerary and explicit checkout flow. Card-guarantee and prepaid rates are excluded. In the isolated preview, an explicit test-location checkbox enables Duffel’s documented test scenarios; no location substitution happens automatically, and live credentials reject it.

The natural-language draft API remains available using the existing server-side OpenRouter integration (`EAIOS_TRAVEL_MODEL` optionally overrides its model), but the guided screen uses structured fields. Preferences are search context, not guarantees or enforced spending limits.
Open the trip to add itinerary plans with HTTPS checkout links. Provider-site checkout is independent of EAiOS pricing. After checkout, paste or import a plain-text confirmation (20 KB maximum) and enter its reference. This is labeled **Confirmation recorded**, not provider-verified Booked. PDF and mailbox import are not implemented.

Selected Duffel options can be reviewed for checkout from the itinerary. One adult traveler and economy flights are currently supported. Review every journey segment and conditions, refresh the quote, enter traveler information, and explicitly approve the displayed total. Sandbox confirmations are labeled TEST; they are not real reservations.

Approval alone does not spend money or create a confirmed booking. The purchase endpoint refreshes availability/price/conditions, rejects changes for review, then commits a durable attempt before making one provider POST. A unique offer key prevents a second submission for the same offer across trips/processes. This is local duplicate prevention, not a claim that Duffel supports an idempotency header.

Lost responses, incomplete/unpaid provider confirmations, and interrupted submissions stay uncertain. **Check provider status** performs GET requests and matches attempt metadata (and flight offer ID). It never repeats the purchase. If no matching completed booking is found, retain the attempt ID and resolve with Duffel/support before any separate purchase. The server intentionally offers no automatic retry/reset of uncertain attempts.

A real confirmation requires a matching provider response, reference, mode, and completed payment/booking state. Credentials never go to the browser. Live flight or hotel purchases also require `EAIOS_DUFFEL_LIVE_BOOKING=1`; merely configuring a live key cannot activate spending on an updated box. This implementation has been exercised with a test token, not real purchases; keep live activation disabled until account, funding, traveler requirements, and operational support are reviewed.

## Hotels and dining

Duffel Stays implements search → room rates → quote → booking using the same durable purchase guard. The initial search supports one adult, one room, and an explicit latitude/longitude area; only pay-now rates that do not require loyalty membership are offered. Quote review includes cancellation conditions and any additional amount due at the property. The guided search uses the selected destination airport coordinates, so it may not cover the city center. Loyalty redemption, children, and multiple rooms are not implemented.

This account's flights and cars test searches work. Stays search returns HTTP 403 with the explicit non-JSON response that this feature is not enabled for the account. Hotel contracts have fixture tests, but actual hotel search/booking cannot yet be verified. Request/check Duffel Stays access and retry before treating hotels as operational.

No OpenTable credential was found in the application's configuration. The requested restaurant experience is in-app table times and booking, pending OpenTable partner access. Restaurant API booking remains unavailable; provider-site links and recorded confirmations work. A future partner integration needs its approved API contract and credentials, not just a consumer OpenTable login.

## Isolated preview

From the development worktree:

```sh
cd app
npm run dev:travel
```

Open http://127.0.0.1:5274/travel. This requires `.local/duffel-test.env` at the repository root containing `DUFFEL_API_KEY=duffel_test_...`. The local setup copies only the already-authorized test key, not the production env file. The file is ignored and permission 0600. No key value belongs in Git or chat.

The preview refuses non-test credentials, disables live purchases, exposes only travel API routes, uses `.local/travel-sandbox` as its data and Hermes root, and blocks all other backend routes. Other application modules are demo fixtures, so the global shell still says MOCK. The Travel banner describes its separate provider connection. On this box, the existing OpenRouter key was deliberately provisioned as the only variable in the ignored, permission-0600 `.local/travel-sandbox/.env` so the natural-language draft API also works in the preview. Other boxes need their own credential; the structured planner works without it. No running production services or Tailscale routes are changed.

## Verification on this box

Final checks: 42 application test files / 337 tests pass (`--maxWorkers=2`); the full script suite passed 29 tests, and all 12 release tests passed again after adding travel-backup assertions. TypeScript and production build pass. Lint passes with existing warnings; Vite still warns about bundle size. One earlier parallel run hit an intermittent Assistant test timeout; the final full run passed with reduced worker concurrency.

- Actual configured language provider: extracted the supplied London dates, USD 2000 budget, airline/hotel choices and vegetarian preferences into a draft. A truncated response discovered during this check was fixed by enabling JSON output and increasing the response limit.
- Guided browser check: selected Birmingham and Baton Rouge by name, clicked departure/return dates, saved preferences, retrieved two actual Duffel sandbox flight options, and selected one into the itinerary without purchasing. Hotels and dining displayed unavailable notices.
- Actual Duffel sandbox: searched 199 offers, refreshed a Duffel Airways offer, submitted one test order, received a completed booking reference. No live order was submitted.
- Automated integration tests use actual temporary SQLite files and a separate Node process for restart persistence. Provider HTTP responses are controlled fixtures for failure cases; they are not live-provider tests.
- Covered duplicate submissions, already-submitted offers, changed/expired prices, credential-mode changes, unpaid confirmations, lost responses, reconciliation, manual evidence, currency labeling, Stays contracts/access failure, missing dining access, and live-adapter recovery without demo fallback.
- Chromium exercised the isolated HTTP API through the UI: create trip/preferences, add a hotel plan, approve, record confirmation, reload, verify persistence; unrelated API route returned 503, no page errors. Preview fixture explicitly states it is not a real reservation.
- Release tests use actual scripts, temporary repositories and SQLite, with build/service operations simulated. They verify travel data remains intact and its online SQLite backup contains the itinerary.

Local evidence is in `.local/travel-*.log`, `.local/travel-preview.png`, and `.local/duffel-verification.json`. The last file contains sandbox identifiers and stays ignored. This branch is not deployed, published, or merged with the separately pending agent-preservation work.

## Car verification and remaining access

Actual Duffel sandbox search returned four supported postpaid car scenarios at its documented test coordinates. The application refreshed a quote, submitted exactly one successful postpaid test booking, and saved the provider reference. A normal Baton Rouge test search returned zero rates; it is not replaced with sample rates. The guided preview makes the test-location choice explicit.

Cars reconcile by provider booking ID when one was returned. If the submission response was lost before an ID was saved, the app preserves the uncertain attempt and directs the user to Duffel/support; it does not invent an unsupported list endpoint or retry the booking. Driver birth date must match the age used for pricing.

See [TRAVEL-PROVIDER-ACCESS.md](TRAVEL-PROVIDER-ACCESS.md) for the precise hotel and restaurant blockers and ready-to-use access request text. Neither access request was sent by this task. Production remains unchanged.

Expanded workflow checks: full application suite passed 43 files / 344 tests; two additional regressions for car reconciliation and distinct hotel choices subsequently passed in the focused suite (11 tests). The final UI/car focused suite passed 13 tests. TypeScript and production build passed; lint passed with existing warnings and no new Travel warnings. Browser verification showed three actual provider test-car options, persisted driver preferences, selection without purchase, and successful quote refresh.
