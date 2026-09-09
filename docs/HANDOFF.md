# EAiOS — Session Handoff

**Updated:** 2026-09-08 · **Repo:** `~/eaios` · **Branch:** `master` · **Head:** `cccbf50`

## What just happened

This session fixed two EAiOS **Approvals** bugs reported by Don:

1. **Approved items stayed in the Approvals list** (even after refresh).
2. **Rejecting some approvals errored with `cannot block t_xxx`**.

### Root cause

Approval-envelope kanban tasks were being created as **children** of a blocked parent task (the daily-brief parent `t_8e860243`). Kanban dependency gating kept those children in `todo` status, and the kanban `block` command only works on `running`/`ready` tasks. Additionally, the `mapTaskToApproval` mapping used only the raw kanban task status, so an approved envelope that was still `ready`/`running` while the dispatcher executed it continued to appear as `pending`.

### Fix

- `server/apiCore.ts`: `listKanbanTasks` now includes `parents` (comma-separated parent ids from `task_links`) and falls back gracefully when the link table is absent (hermetic tests / older DBs).
- `app/src/adapters/live/LiveHermesAdapter.ts`:
  - `ApprovalEnvelope` now carries an authoritative `decision`/`decidedAt`.
  - `mapTaskToApproval` uses the envelope decision as the source of truth for approval status, so decided approvals disappear from the pending list immediately.
  - `decideApproval` records the decision in the envelope first, then unlinks any parent dependencies, promotes out of `todo`/`blocked`, and finally assigns (approve) or blocks (reject/changes_requested).
- `app/src/tests/dogfood-fixes.test.tsx`: regression tests for envelope-decision mapping, parent-gated todo rejection, and already-terminal tasks.

### Verification

- `npm test`: 311 passed, 10 skipped.
- `npm run build`: clean.
- `systemctl --user restart eaios-server`; prod now serves `index-DegR3nO0.js`.

### Existing approval tasks restored

During investigation I accidentally archived/blocked three real pending approvals (`t_e1697cfa`, `t_e531380c`, `t_238eac19`). I restored all three to unassigned pending state:
- `t_e1697cfa` is now unassigned/`ready` (unlinked from parent).
- `t_e531380c` is now unassigned/`todo` (still a child of the blocked daily-brief parent; the new code will unlink on decision).
- `t_238eac19` is now unassigned/`todo` (still a child of the blocked daily-brief parent; restored via direct SQLite fix of my mistaken archive).

## Previous session state (2026-09-05)

- EAiOS one-command installer shipped (`install/install.sh`, `scripts/verify-install.sh`).
- Travel page marked roadmap (`Travel (RM)`); voice I/O on My Assistant shipped.
- Tests: 304 passed, 10 skipped; build clean; all four `eaios-*` services active.
- No git remote configured.

## Current state

- **Tests:** 311 passed, 10 skipped (37 test files).
- **Build:** clean production build in `~/eaios/app/dist`.
- **Services:** all four `eaios-*` systemd user services active.
- **Commits:** uncommitted work across installer, voice I/O, travel roadmap, and this approvals fix.
- **No remote configured.**

## Env configuration

`~/eaios/app/.env.local` contains `VITE_HERMES_LIVE=1`, `VITE_HERMES_TOKEN`, `COMPOSIO_API_KEY`, `DUFFEL_API_KEY`.
`~/.hermes/.env` contains `OPENROUTER_API_KEY`.

## What to tell the next Ally

> "Continue EAiOS from the 2026-09-08 handoff. Approvals bug (t_b5ed136e) is fixed and verified. Read `docs/HANDOFF.md`, `docs/ROADMAP.md`, and `docs/TRANSITION-2026-09-04.md`. Verify services and run `npm test` before making changes."

## Open items for Don

- Review the EAiOS installer and decide public repo URL.
- Decide whether to revive browser-automation booking or pursue a T&E platform.
- Decide whether to add a git remote and push.

## Historical handoffs

Older session state is preserved in `docs/HANDOFF-2026-09-08-archive.md`, `docs/HANDOFF-2026-09-05-archive.md`, and `docs/TRANSITION-2026-09-04.md`.
