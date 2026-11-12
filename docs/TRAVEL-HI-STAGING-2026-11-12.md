# Travel / Human Assistant staging — November 12, 2026

Implemented on `codex/travel-hi-staging`, based on v0.1.19 (`00b2be9`). This is an isolated staging preview, not a production release or installer update.

## Preview

From the worktree root, use Node 24+:

```sh
npm --prefix app run build:handoff
node scripts/stage-travel-hi.mjs
```

Executive preview: http://127.0.0.1:5275/travel

The current preview is kept running by the transient user service `eaios-travel-hi-staging.service`. Stop only this preview with `systemctl --user stop eaios-travel-hi-staging.service`. It is not enabled at boot; use the commands above after a reboot.

The assistant-only service is on loopback port 5276. Use the assignment-specific link in the reviewed email draft or create/replace it from the HI delegation. It can read the assigned itinerary and update that checklist only; executive APIs are unavailable on this service. The link expires after seven days and can be revoked. Its fragment is cleared from the address bar and held only in memory: reopening the original link restores access after a reload. Refresh task status retrieves executive feedback without leaving the view.

Both servers bind loopback and enforce expected Host headers. These URLs work on this machine, not on the assistant's remote computer. Separate authenticated executive hosting and an HTTPS assistant origin must be configured and reviewed before production promotion. No Tailscale configuration was changed.

## Workflow

1. Create a trip and select flight options in the existing Duffel search flow. Staging requires a Duffel test key. Hotel/dining suggestions use web research with source links; they are not booking availability or guaranteed rates. Cars still use the existing provider search; an unresolved rental-car request becomes a checklist item.
2. Save itinerary and prepare delegation. This creates an immutable text artifact, an idle/unassigned task, and a human email draft. Repeated requests return the same active handoff; completed trips also retain their existing handoff to prevent accidental repeat booking. Trip edits do not mutate a reviewed package. Cancel an unfinished draft to prepare a replacement.
3. Submit the exact email and required itinerary attachment for approval. In staging approval **captures files locally; it never sends email**. `/api/staging/outbox` lists captured packages; private files live under `.local/travel-hi-stage/outbox`.
4. Open the private assistant link. Check off each booking with a confirmation reference or outcome note; optional cost/currency and completion notes are retained. Save progress, then submit completion.
5. The task remains open with an `awaiting_completion` state. The executive reviews the evidence in Approvals. Approve completion archives the delegation; request changes returns it to progress with feedback. The artifact, checklist and event history remain available.

The seeded Baton Rouge trip and sample contacts are invented and clearly labeled. The staged browser walkthrough leaves its simulated completion awaiting executive review. No real reservations were made.

## Isolation and runtime configuration

- Separate worktree, dependencies, frontend build and SQLite files. No production files, profiles, credentials, services, agents or installer releases changed.
- Build output `.local/travel-hi-dist`; state `.local/travel-hi-stage` (both ignored).
- Optional ignored `.local/travel-hi-test.env` supports only `DUFFEL_API_KEY` (must start `duffel_test_`) and `OPENROUTER_API_KEY`. Never copy a production env file. Do not commit keys or runtime state.
- Staging forces `EAIOS_TRAVEL_ASSISTED=1` and `EAIOS_DUFFEL_LIVE_BOOKING=0`. Both the booking action and direct Duffel purchase transport reject booking requests. Staging mail uses an injected capture provider. Executive APIs are allowlisted to travel, artifacts and human delegation; unrelated integrations are unavailable.
- Production promotion requires matching frontend/server assisted-mode flags and a separately hosted assistant service. The default production build keeps existing booking behavior until that explicit rollout. This branch is not deployed.
- Hotel/dining research calls OpenRouter's Responses server web-search tool using destination, dates and travel preferences. Only returned, citation-supported HTTPS source URLs are accepted. Search may incur configured provider usage. Documentation: https://openrouter.ai/docs/guides/features/server-tools/web-search
- Access links authorize a single assignment, not an identified person. Treat them as private. They are hashed in the access table, but appear in the intentionally reviewed email. Rotation/revocation invalidates the old link; send a replacement through the normal reviewed workflow. Production identity-based assistant login remains a separate integration step.

## Validation

- Full application suite: 680 passed, 1 skipped, 98 passed files / 1 skipped.
- After final completion/attachment changes: 17 focused tests passed across travel handoff, human approval and human staff suites.
- Script suite: 34 passed.
- Lint passed with existing warnings; TypeScript and normal/staging builds passed. Existing bundle-size warning remains.
- Browser: saved artifact, prepared/reviewed email, captured approved email, opened assignment-scoped assistant view, saved four simulated checklist items, submitted completion, and verified the executive approval with immutable evidence. The sample approval is deliberately left open for review.
- Connected sandbox search: two Duffel flight options; three citation-supported hotels and one restaurant. Car search returned no rates. This does not validate live inventory, real booking or external email delivery.
- Automated tests cover stale revisions, incomplete checklist rejection, required itinerary attachment, duplicate handoff prevention (including completed trips), request-changes/resubmission/closure, access rotation/revocation, redaction, cross-origin denial, executive API denial on the assistant service and purchase blocking before network access.
- Sidecar tests were not run; no sidecar changes.
