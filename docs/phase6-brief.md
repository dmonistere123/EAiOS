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

## 6.3 Artifacts → live (§8.9) — sketch

Provenance (agent + work item), list, preview/download. Candidate backing:
kanban attachments + artifact envelope in task body (like approvals).
Governed share routes through the approval evaluator per §8.9 — no
page-level shortcuts (working rule 6).

## 6.4 Assistant → live (§8.2) — sketch

Largest item; split 6.4a live chat with Ally via gateway / 6.4b answer→chunk
citation store completing §8.2's evidence links (F8). Orchestration plan
panel + approval forecast ride the chat session's kanban/approvals slices.

## 6.5 Agent factory (§8.3 Add Agent) — sketch

Verified surface (BUILD-PLAN-v2): `model.options` RPC → provider/model
catalog; `profiles.create` RPC (`name`, `description`, `clone_from`, `soul`,
`model`/`provider` pin, `mirror_credentials` default true). UI: Staff →
Add Agent drawer → adapter `createAgent()` → card via existing
`profiles.list`. Model write validated + `config.changed` audit. "Ask Ally"
path goes through the governed work loop for free.
