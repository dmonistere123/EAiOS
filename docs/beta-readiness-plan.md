# EAiOS — Beta-Readiness Build Plan

**Written:** 2026-08-27, from Don's beta-gate review. **Revised:** 2026-08-27
(orchestrator model locked). **Companions:** BUILD-PLAN-v2 (spec baseline),
HANDOFF.md (live state), ROADMAP.md (deferrals). This plan **supersedes the
Phase 7 ordering** in BUILD-PLAN-v2 — hardening items (a11y, perf, E2E,
S1–S10) slot after these product changes, before beta.

**Decisions locked with the executive:**
- D-B1 (REVISED 2026-08-27): **Ally is the ONLY agent the user chats with in
  EAiOS.** No direct user↔specialist chat. Selecting an agent shows the
  **Ally↔agent channel** (agent-to-agent chats via bot_relay + everything
  delegated to that agent via kanban) — read-only. Rationale: one
  accountable orchestrator = legible control; governance stays one loop;
  escape hatches (Hermes Desktop profile switcher today, per-profile
  Telegram bots if configured later) cover the rare direct-access need.
  Direct multi-agent chat can be ADDED later if beta users demand it; it
  can't be removed once habits form.
- D-B2: Rail conversation history = ALL Hermes sessions for that profile
  (Telegram, CLI, EAiOS — not just EAiOS-originated).
- D-B3: Full in-app editor for user-created skills AND playbooks.
- D-B4 (deviation from spec §7): the right rail becomes **page-contextual**
  instead of one global operational rail. Recorded as an executive product
  decision; the spec doc stays as historical baseline.

---

## What exists today (relevant inventory)

- Chat: single Ally session via `session.create`/`prompt.submit`, streamed;
  stored id in localStorage (6.4a). Citation chips (6.4b). **No New-chat
  button yet** — one persistent session per browser.
- Sessions carry `profile_name` + `source` (cli/telegram/…); the activity
  ledger already maps them — per-agent session history is a filter.
- Delegation: kanban tasks with assignee + comments; approvals surface
  already. Agent channel view = filter, not new plumbing.
- `bot_relay` RPC family exists for profile-to-profile messaging
  (`methods_bot_relay.py`: deliver/reply). Usage on this box: **unprobed**.
- Right rail: global cron/approvals/activity per spec §7 (`AppShell`).
- Staff: agents carry `reportsToAgentId` (all report to Ally) + live status.
- Agent factory live (6.5): add agents (profiles.create), change models
  (profiles.configure) — INDEPENDENT of the chat model.
- Connections: Composio v3 (connected apps only; account empty).
- Knowledge sources carry `scope` + `allowedAgentIds`.
- Playbooks: versioned md on disk via `/api/playbooks-index` middleware.
- Skills: read-only (`skills.manage` RPC + `/api/skills-index` middleware).

## Probes still needed (batch into ONE session, ~15 min)

1. **bot_relay shape + usage on this box**: how Ally↔agent chats are
   stored/listed (bot chat sessions in state.db? session_key pattern?), and
   whether any exist yet. Fallback if unused/unsuitable: channel view shows
   delegation threads now, agent chats appear when they exist.
2. `session.list` fields per row (confirm `profile_name`, `title`,
   `last_activity_at` — for the rail's conversation history).
3. Composio v3 `/toolkits` on `backend.composio.dev` — the "available to
   connect" catalog shape + auth-link field.
4. `cron.manage` list job fields — is there an owner/profile/creator field
   for "who scheduled it"?

---

## Workstreams (execution order)

### W1 — Assistant: New chat + per-agent channel views (with W2 skeleton)
**Why first:** most-used page; the rail framework lands here.
- **New chat button**: fresh Ally session, replaces stored id (the missing
  piece flagged in review).
- Agent selector (header or rail): switches the CONTEXT, not the chat —
  rail + detail show the selected agent's channel: Ally↔agent messages
  (bot_relay sessions, per probe #1) + that agent's delegated work (kanban
  filter). Ally remains the only chat target (D-B1).
- Rail (per D-B2): selected profile's sessions from `session.list` (all
  sources), click → `session.resume` into the chat **for Ally's own
  sessions**; other agents' sessions open read-only in a drawer (never a
  chat target).
- Adapter: `listSessionsFor(profile)` + `getChannelFor(agentId)`
  (delegations + agent chats); mock parity.
- Files: `pages/Assistant.tsx`, `adapters/live/LiveHermesAdapter.ts`,
  `adapters/mock/MockHermesAdapter.ts`, `state/runtime.ts` (sessions
  slice), `AppShell` rail, new `tests/assistant-channel.test.tsx`.

### W2 — Contextual right-rail framework (spec §7 deviation, D-B4)
- Pages declare rail sections via a small registry keyed by route (or a
  RailContext the page sets on mount). AppShell renders declared sections;
  pages without a declaration keep today's default rail.
- Ships inside W1 (Assistant is the first consumer); Staff, Schedule,
  Artifacts adopt it in their own workstreams.

### W3 — Staff org visualization + per-agent rail
- Ally centered, staff in a radial/hierarchical layout (hand-rolled
  CSS/SVG — **no new deps**), agents glow/pulse when `status === 'working'`.
- Click agent → properties drawer (existing) + rail switches to that
  agent's channel (W1's channel view, shared).
- The flat grid stays as a "list" toggle (don't delete a working view).

### W4 — Connections: available vs connected
- Middle: connected apps (existing adapter). Rail: "available to connect"
  catalog from Composio `/toolkits` (probe #3), each with a connect action
  → Composio auth link. Honest note where linking still needs dashboard
  auth configs (F6 stays a user action; the catalog is still useful).

### W5 — Schedule rail: who scheduled what
- Rail groups cron jobs by owning agent/profile + creator (user vs
  Ally-to-Staff), from probe #4's fields. If the host has no creator field,
  show owner-only and record the gap honestly.

### W6 — Knowledge per-agent visibility
- Sources grouped/badged by which agent(s) can see them
  (`scope`/`allowedAgentIds` already on every source). Page-level grouping;
  no adapter changes expected.

### W7 — Skills & playbooks authoring (D-B3)
- Playbooks: create/edit drawer → writes md to `~/eaios/playbooks/` via an
  extended `/api/playbooks-index` middleware (PUT with slug confinement);
  version bump on edit (closes F1).
- Skills: create drawer → writes `SKILL.md` to
  `~/.hermes/skills/<category>/<slug>/` via a new middleware (slug +
  category validation, path confinement — never arbitrary paths); new
  skill appears via existing `skills.manage` list. Audited writes.

### W8 — Artifacts: agent filter in rail
- Agent filter chips live in the rail (W2); page filters the existing
  artifacts slice. Small.

---

## Token/efficiency strategy

- **One probe session** for the 4 unknowns above; results recorded in
  HANDOFF gotchas so no workstream re-probes.
- **No new architecture** — every workstream reuses existing patterns
  (vite middleware, seq-guarded slices, Drawer, mock-parity adapters).
  No new npm dependencies anywhere (viz is hand-rolled).
- **Order = dependency-aware:** W2's framework rides W1; the three small
  ones (W5/W6/W8) batch into one session; W4 and W7 are self-contained;
  W3 is pure UI.
- **Testing stays cheap:** vitest contract + mock parity per workstream;
  no reliance on preview clicks (F12). Live verification only where a host
  surface is new (W1 bot_relay read path, W4 toolkits).
- Subagents considered and rejected: context-passing cost ≈ doing the
  work inline; shared codebase context is the expensive part.

## Estimated shape

7 workstreams: W1+W2 the largest (~one session), W3/W4/W7 one session
each, W5/W6/W8 one shared session. Rough: **5 build sessions + 1 probe
session** to beta-readiness (down from 6+1 before the orchestrator-model
revision), then the hardening pass (a11y/perf/E2E/S1–S10) as the final
beta gate.

## Risks / open items

- bot_relay may be unused on this box → channel view launches with
  delegation threads; agent chats appear when they exist (probe #1
  confirms the read path either way).
- Composio auth linking may remain a dashboard action (F6); the catalog
  and connect-links ship regardless.
- Skill middleware writes into `~/.hermes/skills` — confinement +
  slug/category validation are mandatory, no free-form paths.
- Per-profile Telegram bots (Don's escape hatch) need per-profile gateway
  setup — noted as a possible Phase 8 packaging item, not beta scope.
