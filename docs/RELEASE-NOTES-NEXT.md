# Next release — pending publication

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
