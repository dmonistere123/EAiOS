# EAiOS v0.1.7 — Approvals and Assistant reliability

## Concierge and Assistant conversations

- Concierge now uses its own inexpensive default model (Gemini 2.5 Flash-Lite through
  OpenRouter), configurable independently from Ally. Changing Ally's model or custom
  endpoint no longer disables Concierge. Existing server-side credentials are reused.
- My Assistant follows new answers, opens conversations at the latest message, and
  offers Jump to latest when you scroll back to read earlier messages.
- Selecting an Ally conversation in the right sidebar opens it in the main chat.
  Follow-ups continue its saved native context; New Session creates a separate chat.
- Viewing history is read-only. Busy-session checks and durable request receipts
  prevent automatic prompt replay during continuation or connection recovery.
- No agent, skill, credential, or instruction migration is required.

## Approval gate fix (affects v0.1.6)

- Scheduled drafts parked blocked/unassigned without a block kind now appear in
  Approvals while remaining blocked from execution.
- Approve records the human decision and releases/assigns the reviewed draft in
  one transaction. Reject and Request Changes keep it blocked/unassigned.
- Duplicate clicks do not release a draft twice. Stale drafts, missing content or
  requester, unfinished prerequisites, execution failures and closed tasks are
  guarded. Editing cannot fabricate an approval or change a decided draft.
- New app-created drafts start blocked/unassigned and are classified needs_input.
- Existing affected drafts need no data migration, automatic approval or resend.

Application updates preserve box-specific profiles, skills and credentials.
An email workflow instruction correction is available as a **separate explicit
opt-in** (`scripts/update-email-approval-instructions.py --apply`); it must not
be added to routine release installation. See APPROVAL-GATE-2026-10-06.md.

Validation includes real temporary SQLite/HTTP transactions and the installed
Hermes scheduler/claim implementation against a disposable database. No provider
send is used for those tests.

## Upgrade notes

- This is an application update. Existing profiles, agents, SOUL instructions,
  skills, credentials, conversations, trips, and other customer data remain in place.
- Concierge defaults to Gemini 2.5 Flash-Lite through OpenRouter and requires a
  server-side `OPENROUTER_API_KEY`. An independent provider/model override is
  supported; see `docs/CONCIERGE.md`. Missing credentials show an unavailable
  message rather than a simulated answer.
- Existing email workflow instructions are not changed automatically. Customers
  with customized or conflicting execution instructions may need the separately
  reviewed, explicit email-instruction update described above.
- Travel functionality is unchanged from v0.1.6. The unfinished Travel Brief export
  and live-provider access changes are not part of this release.
- Install through Settings after checking for updates, when no work is running.
  Provider connectivity and the installed Hermes version still need to be healthy.
