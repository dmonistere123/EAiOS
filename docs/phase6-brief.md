# Phase 6 brief — remaining slices live

**Written:** 2026-08-26, before Phase 6 start (working rule 1).
**Scope:** BUILD-PLAN-v2 §3 Phase 6, items 6.1–6.5. Each lands with mock
parity + tests, smallest risk first. This brief details 6.1 (this session)
and sketches the rest; later items get detailed here when they start.

---

## 6.1 Usage → live (§8.10, D7)

### Probe results (2026-08-26, live box)

- `insights.get` RPC exists and answers, but returns only
  `{days, sessions, messages}` — no token or cost data. **Not sufficient.**
- `hermes insights` CLI has no `--json` (formatted table; parsing fixed-width
  output is the gotcha-#9 trap). **Rejected.**
- state.db `session_model_usage` is the authoritative store and is rich:
  per-(session, model, task) rows with `input_tokens`, `output_tokens`,
  `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`,
  `estimated_cost_usd`, `actual_cost_usd`, `cost_status`, `cost_source`,
  `first_seen`/`last_seen`. FK `session_id → sessions.id`; `sessions` carries
  `profile_name` for by-agent grouping.
- **This box today:** 34 rows, all `kimi-k3`/`kimi-coding`, all
  `estimated_cost_usd = actual_cost_usd = 0` with
  `cost_status ∈ {unknown, NULL}`, `cost_source ∈ {none, NULL}` — the
  provider reports no pricing. All `sessions.profile_name` are NULL (default
  profile). Honest live render: **real token totals, cost "Not provided",
  byAgent collapses to Ally.**

### Design

- **`/api/usage` vite middleware** (node-side, same pattern as
  `/api/skills-index`): `node:sqlite` `DatabaseSync` (built into Node ≥24 —
  zero new deps) opens `$HERMES_HOME/state.db` (default `~/.hermes/state.db`)
  **read-only**, aggregates `session_model_usage LEFT JOIN sessions` over the
  requested range, groups by `COALESCE(sessions.profile_name,'default')`.
  30s cache keyed by range. DB missing/locked/error → 503 → adapter falls
  back to mock (graceful degradation, spec §2). Phase 8 folds this into the
  production server with the other middleware.
- **`LiveHermesAdapter.getUsage(range)`**: fetch `/api/usage`, map to
  `UsageSummary`, fall back to mock on any failure.
- **Cost labeling (D7, never invent):**
  - `actual_cost_usd > 0` → `costUsd = actual`, `costIsAuthoritative = true`
  - else `estimated_cost_usd > 0` → `costUsd = estimated`, authoritative false
  - else → `costUsd = undefined` → UI renders "Not provided"
  - Same rule per-agent row.
- **Runtime store gains a `usage` slice** (`UsageSummary | null` + seq-guarded
  `refreshUsage()`, default range = current month-to-date). The Usage page
  currently imports the fixture directly — rewire it to the store (this was a
  Phase 0 shortcut, not an adapter test seam).
- **Budget**: no host source exists. Live summaries leave `budgetUsd`
  undefined; page renders "No budget set" instead of "Unlimited" (honesty
  fix). Budget config is deferred — registered in ROADMAP when deferred.

### Acceptance — ALL MET 2026-08-26

- [x] `curl localhost:5173/api/usage?...` returns live aggregates matching a
      direct read-only SQL query of state.db. **Verified:** Aug range →
      2,426,019 in / 214,280 out, identical to SQL; bad range → 503; default
      range (no params) → month-to-date 200.
- [x] Usage page renders store data in live mode: token totals match state.db,
      cost shows "Not provided" with the estimated/authoritative badge honest.
      **Verified in preview:** 3.18M in / 365k out (month-to-date grows live),
      agent row resolves to Ally, cost "Not provided · provider reports no
      pricing", budget "No budget set".
- [x] Middleware down/error → page still renders (mock fallback). **Tested**
      (fetch-reject unit test + 503 path).
- [x] Contract tests: mapper (authoritative / estimated / none cases),
      fallback on fetch failure, page renders from store. **8 tests in
      `src/tests/usage.test.tsx`.**
- [x] `npm test` + `npm run test:sidecar` green. **38 vitest + 8 sidecar;
      `npm run build` clean.**

---

## 6.2 Settings/env files → live (§8.11) — DETAILED 2026-08-26

**Probe results (live box):**
- No generic file read/write RPC exists. `profiles.get_asset/set_asset` =
  avatar images only. `config.get` is key-limited (provider/etc.); there is
  no `config.yaml` write RPC.
- **`profiles.describe` returns `soul`** (verified: default profile, 514
  chars) and **`profiles.configure` accepts `soul`** (full SOUL.md
  replacement). This is the native env-file surface.
- Mock fixture files (ALLY.md, OPERATING_RULES.txt) **do not exist on disk** —
  the mock invented them. Real allowlisted file on this box: `SOUL.md` per
  profile (`~/.hermes/SOUL.md` for default).

**Design:**
- **D4 allowlist (recorded here, in-repo):** `SOUL.md` of each Hermes
  profile. Ids: `soul-<profileName>`. Nothing else is listed until a host
  surface exists for it — the allowlist grows by explicit decision, never by
  globbing the filesystem.
- Read: `profiles.describe` → content + version (content hash).
  `lastModifiedAt` has no RPC source → domain type makes it **optional**
  (mock still provides it; live omits — honest absence).
- Write: adapter-side read-compare-write — fresh `profiles.describe`, hash
  compare against `expectedVersion`, then `profiles.configure {soul}`.
  **Non-atomic CAS window documented** (host has no soul precondition; the
  window is the editor's save click — acceptable at executive scale, noted
  here so nobody believes it's transactional).
- Audit: synthetic id `env-write-<id>-<ts>` (same pattern as live cron/kanban
  mutations; §10.1 AuditResult contract held).
- Mock parity: mock keeps its two fixture files; contract tests in
  interactions.test.tsx (stale-version reject, good-version accept) already
  cover the contract and stay green.
- **Honesty fix in scope:** the Settings page's "Model defaults" and
  "Approval defaults" cards are mock UI whose Save buttons toast fake
  success + fake audit events. They get honest "not live yet" badges and the
  lying toasts are removed (model default lands properly with 6.5's
  `model.options` catalog; policy editor is F2-adjacent).
- **F15 (usage budget)** lands here as a second commit: no host config-write
  RPC → EAiOS-owned `~/eaios/settings.local.json` (gitignored) behind an
  `/api/eaios-settings` middleware with a server-side key allowlist
  (`usageBudgetUsd` only). Adapter `setUsageBudget`; Usage page budget card
  becomes an editor; `getUsage` merges the stored budget.

**Acceptance — ALL MET 2026-08-26:**
- [x] Settings lists SOUL.md live; opening shows real content (514+ chars,
      not the mock text); save round-trips through the gateway and re-read
      shows the new content. **Verified:** `profiles.configure` round-trip on
      the live box (`applied:{soul:true}`, content identical after); page
      lists "SOUL.md (Ally — default profile)" live.
- [x] Stale expectedVersion → `version_conflict` error, no write (unit —
      asserts `profiles.configure` never fires).
- [x] Gateway down → mock fallback list (unit).
- [x] Model/Approval cards no longer claim fake saves (badges + disabled
      controls; test asserts the fake Save buttons are gone).
- [x] Budget: set → persists across reload → Usage page shows bar; unset →
      "No budget set". **Verified:** PUT 500 → GET 500 → on disk; bad key /
      bad value → 400; live page shows $500 with Edit. F15 closed in ROADMAP.
- [x] `npm test` + `npm run test:sidecar` + build green. **47 vitest +
      8 sidecar, build clean.**

## 6.3 Artifacts → live (§8.9) — DETAILED 2026-08-26

**Probe results (live box):**
- Kanban has a native attachment surface: `kanban attach/attachments --json/
  attach-rm`, backed by `task_attachments` in `~/.hermes/kanban.db`
  (`stored_path` under `~/.hermes/kanban/attachments/<task>/`).
- **Agents already produce them:** `weekly-metrics-2026-08-25.md` attached by
  `kanban_complete` on task `t_51cd3b69` — the design isn't speculative.
- Per-task `attachments` via `cli.exec` = one subprocess spawn per task —
  rejected for list refresh; a read-only SQL JOIN behind middleware is one
  query (6.1 pattern).

**Design:**
- **`/api/artifacts` middleware** (node:sqlite read-only on kanban.db):
  list = `task_attachments LEFT JOIN tasks` (provenance: task title,
  assignee, status). 30s cache. `/api/artifacts/<id>/raw` streams the file
  with **root confinement** (resolved path must stay under the attachments
  root — DB paths are data, not authority); `?download=1` sets
  content-disposition. DB missing/error → 503 → mock fallback.
- **Mapping:** `att-<rowid>` · agent = task assignee ?? uploaded_by ·
  workItemId = task_id · state from task status (done→ready,
  archived→archived, else draft; approved/shared have no host concept —
  never emitted) · previewAvailable = text-ish mime ≤ 1MB.
- **Adapter:** `listArtifacts` live + fallback; `getArtifactPreview(id)`
  (text fetch, capped); `shareArtifact(id)` — **governed share per §8.9 +
  working rule 6:** creates an UNASSIGNED kanban task with an approval
  envelope (`actionType 'send'`, `targetSystem 'external'`, evidence
  `eaios://artifact/<id>`) → surfaces on the Approvals page for executive
  decision. No page-level shortcut. Approving executes nothing by itself
  (execution is the agent's post-approval work — registered as a deferral).
- **Runtime/page:** artifacts slice + `refreshArtifacts()` (event-debounced
  refresh covers §8.9's insert-on-`artifact.created` within ~1s); page reads
  the store (it imported fixtures directly — same Phase 0 shortcut as
  Usage), Preview drawer (text), Download (real href), Share → approval
  request + toast, work-item link → /today.
- **Deferred (registered in ROADMAP):** attach-from-UI upload (needs
  multipart middleware + kanban attach), per-artifact archive (host has only
  attach-rm = destructive delete), post-approval share execution, artifact
  versioning (host keeps no history).

**Acceptance — ALL MET 2026-08-26:**
- [x] Live list shows the real `weekly-metrics` attachment with provenance
      (agent from task assignee, work item link, size, created time).
      **Verified in preview:** "weekly-metrics-2026-08-25.md · Ally ·
      t_51cd3b69 · 3 KB · ready".
- [x] Preview renders the markdown text; download serves the file; raw
      endpoint rejects path escape. **Verified:** raw serves real content;
      download headers correct (`text/markdown`, content-disposition,
      nosniff); 404 on unknown id; confinement proven by inserting a
      malicious row → 503 "path escapes attachments root" → row removed,
      DB back to 1 row.
- [x] Share creates a pending approval visible on the Approvals page
      (live), unassigned so the dispatcher can't execute it. **Verified
      end-to-end via CLI:** created `t_ab0c2f21` (status ready, assignee
      NULL, envelope parses) → archived after verification.
- [x] Middleware down → mock fallback list (unit).
- [x] Mock parity + contract tests; `npm test` + sidecar + build green.
      **57 vitest + 8 sidecar, build clean.**

## 6.4 Assistant → live (§8.2) — DETAILED 2026-08-26

**Probe results (live box, real turn executed):**
- `session.create {title, hidden}` → `{session_id` (runtime, in-memory),
  `stored_session_id` (durable state.db id), `messages`, `info}`. Runtime
  sids die with the gateway; `session.resume {session_id: stored}` rebinds.
  `session.delete` takes the **stored** id (runtime id → 4007).
- `prompt.submit {session_id, text}` → `{status:'streaming'}` immediately;
  mid-turn submits queue server-side. EAiOS disables Send while streaming
  anyway.
- Turn events arrive as method `event`, `params.type` ∈ `message.start`,
  `thinking.delta` (spinner), `reasoning.delta`, **`message.delta` (reply
  stream)**, `reasoning.available`, **`message.complete` (full text +
  usage)**, `session.title`, `sessions.changed` — all carrying `session_id`
  + `seq`. **Every session's events share the socket → strict sid filter.**
  NOTE: `turn.end` does NOT fire on this path (that's the compute-host
  naming); completion = `message.complete`. Adapter's mapNotification is
  unaffected (it maps turn.end defensively).
- `session.history {session_id}` → `{count, messages:[{role, text,
  timestamp, row_id, reasoning?}]}` — authoritative rehydration.
- The current page is 100% static mock: hardcoded THREAD/PLAN, dead input,
  and a "Context in scope" card that lies (fake source/app counts).

**Design (6.4a — chat):**
- Adapter chat surface on HermesAdapter: `getAssistantHistory()` →
  `ChatMessage[]`; `sendAssistantMessage(text)` → AuditResult (reply
  streams via events); `subscribeAssistant(handler)` → chat events
  (start/delta/complete/error) filtered to the EAiOS session only.
- Live: ensure-session flow — runtime sid in memory; stored id in
  **localStorage (`eaios.assistant.storedSessionId`, not a secret — pane
  prefs precedent)**; resume-or-create on load; on 4001 stale → recreate
  once and retry. `session.create {title:'EAiOS — My Assistant'}`.
- Page: hydrate from history on mount; optimistic user bubble; streaming
  Ally bubble from deltas; on `complete` re-pull history (authoritative,
  deduped by row_id). Honest side panels: orchestration plan ← **real
  in-progress work items** (kanban slice), context ← real knowledge-source
  counts; approval forecast already live. Mock parity: in-memory thread +
  canned streamed reply.
- Gateway busy/down → send returns error AuditResult; mock fallback only
  for reads (writes never pretend).

**Design (6.4b — citations, second commit):**
- Ally's knowledge-grounded answers carry `eaios://chunk/<id>` (Phase 5
  contract). 6.4b parses those refs out of complete assistant messages and
  renders citation chips → chunk drill-down drawer (existing
  `/knowledge-api/chunks/<id>` + Knowledge-page drawer pattern).
- **Decision recorded:** the message itself (persisted in session history)
  IS the answer→chunk record — no separate link store needed; the sidecar
  `getRetrievalEvidence` stub stays mock-only. F8 closes on the UI
  contract being end-to-end clickable.

**Acceptance — ALL MET 2026-08-27:**
- [x] Real conversation on the live box: full adapter sequence replayed
      against the gateway (create → submit → streamed deltas → complete →
      2-row history → resume-after-reload). Preview-pane typing can't drive
      React inputs (F12); first human Send is the final mile.
- [x] Events from OTHER sessions never render in the EAiOS thread (sid
      filter unit test, incl. `turn.error` via the `sid` key).
- [x] Stale runtime sid → recreate + retry once, no lost message (unit).
- [x] Mock mode: canned streamed reply; contract tests green.
- [x] Side panels show real data (work items, knowledge counts).
- [x] 6.4b: citation chip → chunk drawer opens with real chunk text.
      ChunkDrawer extracted to `components/ChunkDrawer.tsx` (shared with
      Knowledge); `parseCitations` + chips on completed Ally messages; mock
      reply carries `eaios://chunk/k-01-0`. F8 closed.
- [x] `npm test` + sidecar + build green. **66 vitest + 8 sidecar, three
      consecutive green runs.**
- **Test-harness gotchas found (now in HANDOFF #16):** Node 26's stub
  `localStorage` getter shadows jsdom's (setup.ts rebinds to
  `window._localStorage`); jsdom has no `Element.scrollTo` (polyfilled);
  mock assistant is a singleton whose thread persists across tests in a
  file — page tests that send must wait on adapter-level `complete`, never
  on text (streaming bubble matches early) or chip counts (old chips
  hydrate late).

## 6.5 Agent factory (§8.3 Add Agent) — sketch

Verified surface (BUILD-PLAN-v2): `model.options` RPC → provider/model
catalog; `profiles.create` RPC (`name`, `description`, `clone_from`, `soul`,
`model`/`provider` pin, `mirror_credentials` default true). UI: Staff →
Add Agent drawer → adapter `createAgent()` → card via existing
`profiles.list`. Model write validated + `config.changed` audit. "Ask Ally"
path goes through the governed work loop for free.
