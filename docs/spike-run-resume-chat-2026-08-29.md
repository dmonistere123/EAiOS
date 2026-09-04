# Spike: continue-chat on kanban delegated-run sessions (t_95e162a0)

**Date:** 2026-08-29 · **Requester:** Don · **Verdict:** feasible, roadmap item (recommend F25)

## The ask
Assistant right rail "Delegated runs" → DelegatedRunDrawer shows a kanban
worker's real transcript read-only ("never a chat target, D-B1"). Don wants:
pull that session up and keep talking to it. How hard, what risk?

## What the code actually supports today (probed, not guessed)
- `session.resume` + `session.history` on kanban worker sessions already
  WORKS live (probed 2026-08-29, HANDOFF #28d) — that's how the drawer reads.
  The deny-list (`{"kanban","tool"}`) only filters `session.list` /
  `session.most_recent`; it does NOT block resume, history, or prompt.submit.
- `prompt.submit` has **no source check** (methods_prompt.py) — a resumed
  kanban session accepts new user turns. Profile-scoped sessions rebind
  HERMES_HOME correctly mid-turn (methods_prompt.py:1339,1472).
- Adapter machinery is ~80% built: `resumeAssistantSession` (LiveHermesAdapter:1414)
  is resume+bind; lanes/sid-filtering/stream-retry all exist from 6.4.
  A run-continue is that method + a profile param + drawer button + lane switch.

## Effort (Ally-scoped v1: assignee=default runs only)
1. Adapter: `resumeRunSession(profile, sessionId)` — thin variant of existing resume. ~30 lines.
2. Drawer: "Continue in chat" action → Assistant lane swap (existing lane machinery). ~1 component touch.
3. Guard: only `done`/archived runs get the button; in-flight runs show "steer instead" (dual-driver guard).
4. Governance: first message in a continued run re-opens or links a follow-up kanban task (else invisible work).
5. Tests: mock parity + adapter + drawer guard tests. Matches existing patterns.
**~1 build session.** No new deps, no new server endpoints, no host changes.

## Scores
- **Risk: 3/10** (Ally-scoped). Plumbing is proven; read paths already touch
  these sessions safely; sessions stay deny-listed so conversation lists are
  unaffected. Risks are semantic, not structural.
- **Complexity: 4/10** → moderate token spend (one focused session).

## If extended to specialist workers (quill/scout…)
- **Risk: 5/10, Complexity: 6/10.** Conflicts with D-B1 (Ally-only chat);
  per-profile home rebinding works but untested for interactive chat;
  interacts with the F24 gap (specialist transcripts need per-profile DB
  joins). Recommend: Ally-scoped first, specialists after F24 + a D-B1 revisit.

## Downstream impact checklist (all contained if scoped)
- ✅ Board/Approvals/Today/Activity slices: untouched (additive adapter method).
- ✅ Deny-list keeps continued runs OUT of Ally's conversation list — no clutter.
- ⚠️ In-flight runs MUST be excluded (prompt.submit queues mid-turn messages —
  user + dispatcher would drive one session = corruption vector).
- ⚠️ Governance v3: continued work must reappear on the board (re-open/link)
  or it violates the visibility rule we hardened today.
- ⚠️ Worker context carries the task prompt; agent may try to re-`complete` the
  task. Mitigate with the re-open/link rule.
- ✅ Approval gate: unaffected (profile SOULs carry it into every session).

## Recommendation
Add to ROADMAP as **F25** (post-Phase-8): "Continue a completed delegated run
in chat — Ally-owned runs first, board-linked re-open, steer-only for
in-flight, specialists deferred with F24/D-B1."
