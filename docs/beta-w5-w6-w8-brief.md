# W5+W6+W8 Brief — Schedule ownership rail, Knowledge visibility, Artifacts filter

**Written:** 2026-08-28, before build (working rule 1). **Plan:** beta-readiness-plan.md
— the three small workstreams batched per its token strategy. **Probes:**
HANDOFF #17 (cron profile scoping) + `get_profile_dir('default')` verified —
uniform per-agent cron scoping works.

## W5 — Schedule rail: who scheduled what

- `listCronJobs(profile?: string)` (both adapters): live →
  `cron.manage {action:'list', include_disabled:true, profile}` (response's
  `scoped` marker proves scope); mapped jobs get `ownerAgentId = profile`.
  Mock → fixture filter on `ownerAgentId`. Runtime's unscoped call is
  unchanged (default profile = Ally).
- Schedule declares a rail section "Schedules by agent": per-agent groups
  (name, next run, deliver target), agents with zero jobs omitted.
- **Honest gap (locked in probe #4):** the host records NO creator field —
  `jobs.json origin` is delivery routing, not attribution. Rail shows
  owner-only + a one-line note that creator isn't tracked. Recorded here
  and in HANDOFF.

## W6 — Knowledge per-agent visibility

- No adapter changes (`scope`/`allowedAgentIds` already on every source).
- The sources table groups into three cards: **Executive only** (private),
  **All staff agents** (workspace), **Specific agents** (agent-scoped, with
  agent NAMES from the runtime, not raw ids).

## W8 — Artifacts: agent filter in rail

- Rail section "Filter by agent": chips (All + each agent with artifacts,
  with counts); selection filters the existing rows (composes with the
  search box). Page-local state, rail declared via W2 framework.

## Acceptance checklist

- [x] Schedule rail groups live cron by owning agent (mock: ally/scout/
  ledger/sentinel fixtures); creator-gap note visible; watchtower replaced.
- [x] Knowledge renders three visibility groups with agent names resolved
  (live-checked: private spec docx under "Executive only").
- [x] Artifacts rail chips filter rows; "All" restores; counts correct.
- [x] `listCronJobs(profile)` live-scoped (verified: `scoped` marker),
  mock parity.
- [x] vitest (126) + sidecar (8) green, build clean.
- [x] Live visual check; HANDOFF progress + pointer; boxes checked.
