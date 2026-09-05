## OpenTable Playbook Hardening — Task t_db49e8c5

### Changes made

**server/travelBrowser/playbooks.ts**
- Hardened `OPENTABLE_RESTAURANTS` playbook:
  - `searchUrl` updated to `https://www.opentable.com/s/` (without trailing partial query)
  - `authSteps` — improved selectors (input#email, input#password, data-test="signin-button", button:contains("Sign in")), increased wait to 4000ms
  - `searchSteps` — added explicit `goto` step with full OpenTable search URL including `<destination>`, `<date>`, `<partySize>` params; improved extract prompt for structured result parsing; added `externalUrl` to schema
  - `bookingSteps` — added `goto` step with `<externalUrl>` (uses new result-aware substitution), improved prompt with reservation time matching from result meta, explicit stop-before-confirm language
- Preserved sibling task additions: `extract_list` step type, Marriott hardening, `resyCitySlug()` export, IHG hardening

**server/travelBrowser/runner.ts**
- Extended `substituteParams()` to accept optional `result: TravelSearchResult` parameter
- Added `<externalUrl>` substitution (from result.externalUrl)
- Added `<result.*>` pattern substitution for any meta key on the result
- `buildTaskFromPlaybook()` now passes result to substituteParams in booking mode

**server/travel.ts**
- Restaurant search now attempts browser-use first when `TRAVEL_BROWSER_USE=1` (instead of failing with "OPENTABLE_API_KEY not configured")
- Falls back to OpenTable API path when that's the only configured provider

**src/tests/travelBrowser.test.ts**
- Added `describe('OpenTable playbook')` with 6 tests:
  - Playbook existence check (id, site)
  - Search steps have explicit goto + externalUrl in schema
  - Booking steps have externalUrl goto + stop-before-confirm prompt
  - Auth steps have credential vault placeholder pairs
  - Parse results with restaurant shape (externalUrl, restaurantName, cuisine, partySize, reservationAt)
  - Search URL template includes date, partySize, destination params

### Verification
- All 31 runnable tests pass (6 OpenTable + 25 others)
- 10 tests correctly skipped (IHG/Resy tasks pending)
- Full `tsc -b && vite build` clean