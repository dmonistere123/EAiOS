# Assistant request recovery

## Scope and invariants

Each Send creates a new request ID and a fresh Hermes session. No previous prompt,
transcript, recovered response, or handoff is automatically injected. An explicitly
attached handoff.md is included only in that submission. The configured Hermes
profile, skills, and persistent memory are unchanged.

A receipt is saved in the browser before transmission, and durably accepted by
EAiOS before work starts. Recovery uses GET and session.activate on the original runtime session ID;
it never calls session.resume or repeats prompt.submit. Installed Hermes cold
resume can auto-continue a prompt, so it is deliberately excluded. Same ID/same input is idempotent;
same ID/different input is rejected. An ambiguous crash between submission and
acknowledgement is reconciled, never replayed. A crash before a recoverable session
identity was recorded is shown as interrupted and requires a deliberate new request.

## Runtime

- POST /api/assistant/requests accepts `{id,text,attachments}` and returns HTTP 202.
- GET /api/assistant/requests returns recent 20 receipts plus all active requests.
- GET /api/assistant/requests/:id returns a durable snapshot.
- GET /api/assistant/requests/:id/events emits complete versioned SSE snapshots.
  Reconnect receives current state even if event IDs were missed. Heartbeat/close
  cleanup does not cancel execution. The UI uses bounded two-second status polling
  so it does not depend on a long-lived browser stream.
- POST /api/assistant/requests/:id/cancel requests session.interrupt on that exact
  session. Cancellation remains pending until terminal evidence or acknowledged
  interruption plus stopped state. Completed records cannot be reopened by cancel.
  Cancellation does not undo tools already executed or automatically cancel separate
  delegated tasks; their explicit task IDs and outputs remain visible.

Private data is in EAIOS_DATA_ROOT/assistant-requests/requests.sqlite (directory
0700, database 0600, WAL). It contains prompts, responses, state, revisions, input
fingerprints, and session IDs; it contains no gateway credentials. Inline attachment
content is removed from this receipt store before dispatch after session identity
is saved; Hermes retains its own submitted context. There is no automatic retention
cleanup. Include this SQLite database in future online backup/retention planning.

Both dashboard ports use the same store. A 12-second lease, renewed every four
seconds, fences stale writers; only the inserting process may submit the first
prompt. A surviving/restarted dashboard resumes after lease expiry, normally before
Hermes' documented 20-second default orphan-reap grace. Actual Hermes policies
and process downtime can still interrupt a turn. Missing-runtime and transient 4007 responses receive at most three attach attempts.
If attachment cannot be established, EAiOS reads bounded saved evidence through
read-only SQLite and marks the request interrupted without recreating a runtime.
A missing running/status field is never interpreted as running or complete.

Recovered saved text is labeled `recovered`, rather than claiming a successful
terminal event when Hermes history does not carry that proof. Progress includes
safe tool names/status messages and generic thinking indicators; raw reasoning,
tool arguments, and tool results are not surfaced. Retained Hermes inflight errors become interrupted requests with preserved partial text,
not endless thinking indicators. Pending input/approval points
the user to the named session in Hermes Desktop. This change does not add a second
approval or clarification response surface.

Artifacts are linked using tasks.session_id and a single proven compression continuation chain, then
task_attachments. Branch, reset, delegate, and tool children are excluded. There is no timestamp/filename
matching. Late attachments continue to appear on terminal request cards. Artifacts
without origin-session provenance remain available in the existing Artifacts page,
without being guessed into a request. Requests created before this feature are not
retroactively linked or replayed.

The legacy /api/chat-ally and /api/chat-ally/stream endpoints remain for compatibility;
the new UI does not use them. Existing browser tabs need a reload after activation.
Their old timeout architecture is not silently presented as the new lifecycle.
The legacy stream's heartbeat scope/cleanup is repaired. The shared gateway client
now sends RFC-compliant masked pong frames echoing the ping payload, and preserves
RPC error codes for authoritative missing-session handling.

## Bounds and offline recovery

Accepted browser receipts remain cached across refresh, including prompt and partial
output. Hydration labels them stale; versioned merging prevents an older server
snapshot from overwriting newer cached output. Local display previews are bounded
(4,096 prompt characters, 8,192 response characters, 20 artifacts), visibly labeled,
and refreshed from the authoritative server. Up to 32 active IDs are retained;
only terminal display copies are evicted. Cache admission fails before submission
if active receipts would exceed the 1.5 MB budget. Unconfirmed prompts retain their
full text. Recovery performs at most four additional ID lookups per poll.

New server admission is bounded at 500 receipts, 16 active requests and a 64 MiB
serialized record budget with response capacity reserved for active work. Capacity
returns 429; existing production records are never automatically deleted. New
responses cap at 65,536 characters with a visible limit flag; existing oversized
records remain stored. Progress writes coalesce over 250 ms; terminal evidence
flushes immediately. Gateway frames over 8 MiB fail safely. Artifact queries cap
at 200 tasks/attachments and 32 compression steps, with visible limit flags and a
10-second, 128-entry cache. These are application bounds; SQLite/WAL overhead is
additional and the WAL size setting is a checkpoint hint, not a hard disk quota.

## Isolated validation

Development branch: codex/assistant-request-recovery.
Base: main 1daaf6c5; snapshot ca67950 preserves the relevant existing live changes
and development instructions. Dependencies were copied independently from the
live checkout, without env files, credentials, databases, runtime state, or dist.
No installer changes from the separate reconciliation checkout were imported.

Tests use fake Hermes RPC, temporary SQLite roots, fake timers and temporary
loopback HTTP/WebSocket servers. They cover long turns past 150 seconds, browser
refresh/offline recovery, lost acceptance acknowledgements, body-delivery timeouts,
backend restart, expired ownership, duplicate IDs, cancellation, missing sessions,
concurrent isolation, explicit handoff context, late artifacts, and SSE reconnect.
These are synthetic checks, not end-to-end verification against live Ally.

Initial candidate validation on October 3, 2026 (before independent review):

- Full suite: 391 tests passed across 50 files (148 seconds).
- After final ownership/UI preservation changes: 62 focused tests passed across
  seven files (18.5 seconds).
- TypeScript project build: passed. Oxlint: zero errors, 23 warnings.
- Production Vite build: passed; existing native-config and bundle-size warnings.
- Initial sandbox socket failures were rerun successfully with loopback permission.
- The jsdom suite reports its known unimplemented HTMLMediaElement.play warning;
  actual audible playback and live Hermes integration were not exercised.
- Local evidence: .local/full-tests.log, .local/focused-tests.log, .local/lint.log,
  and .local/build.log (ignored, not committed).

Independent-review revision additionally verifies installed-Hermes contracts using
`app/src/tests/fixtures/hermes-request-contract.json`. The capture script extracts
selected function ASTs from the installed source and executes them with in-memory
stubs, without importing Hermes or contacting its gateway. The fixture records
source paths, lines and SHA-256 hashes. It demonstrates enabled cold continuation,
the incomplete lazy-resume reply, exact transient 4007 error, and safe activate
payload. Tests deliberately make any accidental cold resume schedule continuation.

Full review suite: 402 tests passed across 52 files (145 seconds). After the final
partial-output and lineage-limit refinements, 30 focused tests passed across four
files. TypeScript passed. Oxlint passed with zero errors and 23 existing warnings.
Final complete-suite and build evidence is recorded in `.local/review-full-tests.log`,
`.local/review-focused-tests.log`, `.local/review-lint.log`, and
`.local/review-build.log`. These checks use synthetic fixtures only; live activation
and real-provider validation remain a separate review decision.

Commands (from app, existing Node 26 and installed dependencies):

```sh
HERMES_HOME=/tmp/eaios-recovery-fixture-home EAIOS_HERMES_TOKEN= node node_modules/vitest/vitest.mjs run
node node_modules/oxlint/bin/oxlint
node node_modules/typescript/bin/tsc -b
VITE_HERMES_LIVE=1 VITE_HERMES_TOKEN= node node_modules/vite/bin/vite.js build
```

Loopback fixture tests need local socket permission; sandbox listen EPERM is an
environment restriction, not evidence that a running app failed. No sidecar/provider
integration tests, package installs, real prompts, publications, or live service
changes are part of these checks.

## Proposed deployment and rollback — not executed

1. Review the snapshot and implementation commits separately. Reconfirm that the
   live working tree has not changed and no developer is editing it. Confirm live
   active requests/tasks are idle; do not interrupt existing work to deploy.
2. Preserve the current source changes and built assets, record both dashboard
   service definitions/start commands and build identities, and take approved online
   SQLite backups where needed. Do not copy a live WAL database as a plain file.
3. Stage this reviewed application in a separate versioned directory using existing
   dependencies. Build there with the current nonsecret per-box UI settings and
   VITE_HERMES_LIVE=1. This isolated build used the default identity, not the user's
   private env file. Preserve the existing untracked www/ marketing assets in the stage
   as well: the marketing route resolves them relative to the server source. Keep
   existing credential-file references available to the staged runtime without copying
   credential values into source control. Keep EAIOS_DATA_ROOT, HERMES_HOME, existing credentials and sidecar
   paths unchanged; both dashboards must share the same request store. Do not use
   or unlock the unfinished commercial installer.
4. Obtain the separately agreed activation review before changing either dashboard
   service. Only those dashboard services need the new Node code/assets; do not
   restart Hermes, the sidecar, Tailscale, or install workflow/agent customizations.
5. After authorized activation, check both /api/version identities, reload the user's
   browser, and separately authorize a bounded real-agent smoke test. Verify receipt,
   visible progress, refresh recovery, one execution, completion, fresh second-session
   identity and explicit handoff. Synthetic tests do not establish these live outcomes.
6. If rollback is needed, first inventory active new requests and allow them to settle
   or deliberately cancel with user awareness. Restore the previous dashboard service
   paths/assets and reload the browser. Preserve the new request database and all
   Hermes/task/artifact state; never restore shared databases backwards. The previous
   frontend cannot monitor the new lifecycle, so leave recovered session IDs available
   for manual inspection. No Git reset/clean, installer activation, or remote release
   is required by this proposal.
