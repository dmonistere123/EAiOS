# W1+W2 Brief — Assistant channel views + contextual right rail

**Written:** 2026-08-28, before build (working rule 1). **Plan:** beta-readiness-plan.md
W1/W2. **Probes:** HANDOFF gotcha #17 (all four host surfaces verified live).

## Decisions honored

- **D-B1 (revised):** Ally is the ONLY chat target. The Assistant page's agent
  selector switches CONTEXT, never the chat. (Current page violates this —
  selector retargets the chat; this workstream fixes it.)
- **D-B2:** rail conversation history = ALL sessions for the selected profile
  (every source; the gateway already deny-lists `kanban`/`tool`).
- **D-B4:** right rail becomes page-contextual via declaration; undeclared
  routes keep today's default watchtower.

## Probe findings driving the design

1. Agent chats = canonical per-profile "Bot Chat" sessions. Read path:
   `session.list {profile, title:'Bot Chat', include_hidden:true}` →
   `resolved_id` → `session.history {session_id, profile}`. No Bot Chat →
   `sessions: []` → honest empty state. `bot_relay.*` is Desktop relay
   plumbing, not a read API.
2. `session.list` rows: `{id, title, preview, started_at, message_count,
   source}` (+`resolved_id` on title lookups). `params.profile` scopes to that
   profile's own state.db. `session.history` honors `profile` too.
3. (W5 later) cron ownership = `cron.manage {profile}` + `scoped` marker.
4. (W4 later) Composio catalog + `/connected_accounts/link` connect flow.

## Design

### W2 — rail framework (`state/rail.ts`, new)

- Tiny store (same useSyncExternalStore pattern as runtime): the mounted page
  holds at most one declaration — an ordered array of
  `{ key, title, count?, node }` sections.
- `usePageRail(sections)` hook: sets on mount/update, clears on unmount.
- `AppShell.RightRail`: if a declaration exists, render declared sections
  (wrapped in the existing `RailSection` chrome, now exported); otherwise
  render today's default watchtower unchanged.
- No registry keyed by route, no global sessions slice: the declaring page
  owns its data and lifecycle (deviation from the plan's "runtime sessions
  slice" — page-declared rail makes it redundant and avoids cross-page
  staleness; W3 reuses the adapter methods, not page state).

### W1 — Assistant rework

**Adapter (`HermesAdapter` + live + mock parity):**

- `listSessionsFor(profile?): Promise<AssistantSessionRef[]>` — live:
  `session.list {limit:50, profile?}` (profile omitted for Ally/default).
  `AssistantSessionRef = { id, title, preview, startedAt, messageCount, source }`.
- `getChannelFor(agentId): Promise<AgentChannel>` —
  `AgentChannel = { delegations: WorkItem[], agentChat: ChatMessage[] | null }`.
  Live: work items filtered `ownerId === agentId` + Bot Chat read path above
  (`null` when the agent has no Bot Chat — honest absence).
- `resumeAssistantSession(storedId): Promise<AuditResult>` — Ally-only path:
  live `session.resume {session_id: storedId}`; ONLY on success overwrite the
  localStorage stored id + rebind the lane (never pretend a resume worked).
- `startNewAssistantChat(): Promise<AuditResult>` — live `session.create`
  bypassing the stored id, then overwrite stored id + reset the lane. Mock:
  thread resets to the greeting.

**Page (`Assistant.tsx`):**

- Header: context selector (agents) + **New chat** button. Chat card is always
  Ally: history/subscribe/send always use the default lane.
- Right column: Ally selected → existing orchestration/context/forecast cards.
  Staff agent selected → **channel view**: that agent's delegated work
  (kanban-backed, from `getChannelFor`) + Ally↔agent chat messages, read-only,
  with honest empty states.
- Rail declaration: "Conversations — \<agent\>" listing `listSessionsFor`.
  Ally's sessions → click resumes into the chat. Other agents' sessions →
  click opens a read-only `Drawer` with the mapped history (never a chat
  target).
- Stale-picker guard already exists (picked id must exist in agents slice).

## Acceptance checklist

- [x] New chat: fresh Ally session, stored id replaced, thread resets (mock +
  live unit; live-verified on box).
- [x] Selector changes context only — input label stays "Message Ally" for
  every selection (D-B1 regression test).
- [x] Channel view shows delegations + agent chat read-only; agent with no
  Bot Chat shows the honest empty state (verified live: quill `sessions: []`).
- [x] Rail: conversations declared by Assistant; Ally click resumes (thread
  swaps); other-agent click opens read-only drawer; other routes keep the
  default watchtower.
- [x] Mock parity for all FIVE new adapter methods (listSessionsFor,
  getChannelFor, getSessionTranscript, resumeAssistantSession,
  startNewAssistantChat).
- [x] `npm test` (92) + `npm run test:sidecar` (8) green; `npm run build` clean.
- [x] Live verification on box: adapter call sequence replayed over WS
  (`scripts/verify-w1-live.mjs`): quill Bot Chat lookup → `[]`, create →
  resume → history round-trip; empty verification session reaped by the
  gateway itself (confirmed gone in state.db).
- [x] Same-commit docs: HANDOFF gotcha #18 + progress section, checklist
  boxes checked.

## Honest gaps / non-goals

- `session.list` has no `last_activity_at` in rows — rail sorts by the
  gateway's order (already last-active) and shows `started_at`.
- Resuming a Telegram/CLI Ally session into EAiOS is intended (one Ally,
  one identity); the session's source badge is shown so context is legible.
- Per-agent session lifecycle (archive/rename) is out of scope (plan W1 shrink).
