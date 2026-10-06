# Approval execution gate — October 6, 2026

## Problem and behavior

Scheduled email review created blocked, unassigned approval envelopes without a
block kind. The UI interpreted these as execution failures and hid them. The old
client decision handler also promoted blocked tasks before branching on the
human's decision, including Reject and Request Changes.

Legacy blocked, unassigned drafts with no execution history, result or typed
blocker now appear as pending reviews without changing their task status.
Explicit capability/dependency/transient blockers and failed executions are not
silently released or relabeled. New application-created approvals start blocked,
unassigned, and are classified `needs_input` in place.

The Approve button calls a server transaction. It compares the exact reviewed
body, validates prerequisites and the requester/content, records the decision
and audit events, and makes the task ready and assigned to `requestedBy` in one
commit. Duplicate decisions are no-ops, including after a lost HTTP response.
Conflicting or stale decisions fail. Reject and Request Changes leave the task
blocked/unassigned. Parent links are preserved; unfinished prerequisites prevent
approval instead of being forcefully removed. Active and terminal tasks are not
restarted. Failure to persist any audit event rolls back the entire transaction.

Draft edits preserve source context and unknown fields and cannot forge a
decision, change routing metadata, or modify an already decided draft.
This gate does not claim that an arbitrary privileged process writing directly
to Hermes SQLite or invoking its CLI cannot bypass it. Workers must continue to
verify the recorded human decision and execution provenance.

## Tests completed

- Application suite: 48 files, 395 tests passed. The optional installed-Hermes
  integration test was skipped in that default run and run separately below.
- Installed-Hermes integration: passed against a disposable Hermes home and its
  real initialized schema. Real `create_task`, `block_task`, `recompute_ready`,
  and `claim_task` verified blocked drafts remain unclaimable, Reject and Request
  Changes remain blocked, and an approved draft can be claimed exactly once.
  Provider workers and lifecycle plugins were not started; no emails were sent.
- Atomic gate tests use real temporary SQLite and the real HTTP router. Cover
  concurrent approvals, stale content, forbidden edits, cross-origin rejection,
  missing requester/content, unfinished prerequisites, active/terminal tasks,
  and transaction rollback on an audit insert failure.
- Explicit email-instruction patch: 2 tests passed (customization preservation,
  idempotence and refusal of unrecognized layouts); check-only against the
  installed email skill passed. No live skill was changed.
- TypeScript/build passed; lint passed with warnings in existing app code.
  Vite retains its bundle-size warning. Existing React test `act` warnings remain.
- Browser: isolated page rendered blocked drafts; Approve completed through the
  new route and removed the sample from pending. User also tested the preview
  successfully. Database verification showed approved samples ready/assigned and
  rejected samples blocked/unassigned.
- Read-only projection of the three affected production IDs confirmed they will
  appear with the fix while remaining blocked/unassigned. No production rows
  were edited or decisions submitted.

## Reproduce tests

From `app`, run `npm test`, `npm run lint`, `npm run build`.
For installed-Hermes coverage, set `EAIOS_TEST_HERMES_ROOT` to the Hermes source
checkout and `EAIOS_TEST_HERMES_PYTHON` to its compatible Python interpreter, then
run `npm test -- src/tests/approval-hermes.integration.test.ts` from `app`.
The test creates and removes its own temporary state. Run the instruction patch
checks with `python3 scripts/tests/email-approval-instructions.test.py` from root.

The preview script `scripts/approval-preview.mjs` accepts a disposable fixture
root whose name starts `eaios-hermes-approval-`, and a port (default 5275).
It serves an app built with `VITE_HERMES_LIVE=1`, only the approval APIs and static
assets. All other APIs and websocket upgrades are disabled. It runs no provider,
worker, scheduler or service proxy. Approving a fixture changes its task state;
it never sends anything. `.local/approval-preview-root` records this session's
fixture directory. Production was not changed by building or serving this page.

## Deployment boundary

This branch is prepared and tested, not installed in production or pushed.
Deploy the application frontend and server together using the normal release
process with backup and rollback. The existing three drafts then become visible
without database repair, unblocking, reassignment, or approval.

After the new application gate is active, explicitly apply the narrow email
workflow update:

```sh
python3 scripts/update-email-approval-instructions.py /path/to/hermes/skills/email/eaios-email-workflow/SKILL.md
python3 scripts/update-email-approval-instructions.py /path/to/hermes/skills/email/eaios-email-workflow/SKILL.md --apply
```

The first command only checks. The second makes a timestamped backup and changes
only the gate, creation classification recipe and provenance instructions; it
refuses unfamiliar layouts. It is deliberately not attached to routine updates,
and does not replace profiles, credentials, other skills, or conversations.
Existing customized agent SOUL instructions are also untouched. The app's
new-agent governance template is updated for future agents.

The runtime skill now has conflicting legacy prohibitions on the requesting
profile ever executing. The explicit patch clarifies that the scanning run
cannot send or self-approve; a later worker may execute only after the actual
EAiOS approval decision and its audit events. Deployment should validate this
with a synthetic task before the user approves a real draft. No live-provider
send was performed as part of these tests.
