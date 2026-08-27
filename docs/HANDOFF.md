# EAiOS — Session Handoff (read this first in a new session)

**Updated:** 2026-08-26 · **Repo:** `~/eaios/app` (Vite + React 19 + TS + Tailwind v4 + react-router) · **Docs:** `~/eaios/docs/` (phase0-integration-matrix.md, phase1-brief.md, phase6-brief.md) · **Git:** **Phase 6.1–6.2 COMPLETE (Usage + Env files live, F15 closed)**, build clean, **47/47 vitest + 8/8 sidecar unittest green** (`npm test`, `npm run test:sidecar`)

## What this is

Executive AI Operating System — an executive dashboard over Hermes Agent (Allygnment branding: dark `#050914`/`#071220`, cyan `#32C5FF`). Main agent = **Ally** (the default Hermes profile). Telegram group = **Ally's Portal** (chat id `-1004268167166`; user telegram id `7161920923`, both allowlisted; gateway runs on systemd). Long-term goal: package for other CEOs' boxes — the UI only talks to typed adapters, never Hermes internals.

## Live processes (dev)

- `hermes serve` on `127.0.0.1:9119` — start via `~/eaios/scripts/start-hermes-serve.sh` (reads token from `~/.hermes/.eaios-dev-token`, chmod 600). **Must be running for live mode** (install as systemd service eventually). Note: `hermes serve --status` does NOT see it (untracked start) — check `ss -tlnp | grep 9119` instead.
- Vite dev server on `localhost:5173` (`npm run dev` in `~/eaios/app`), preview in Hermes desktop.
- Knowledge sidecar on `127.0.0.1:9121` — start via `~/eaios/scripts/start-knowledge-sidecar.sh` (Python venv in `~/eaios/sidecar/.venv`; app reaches it via vite proxy `/knowledge-api`). Down = Knowledge page silently falls back to mock.

## Architecture in one paragraph

Pages → `src/state/runtime.ts` (useSyncExternalStore store; seq-guarded per-slice refreshes; debounced event refresh) → `src/adapters/index.ts` → `HermesAdapter` interface (`adapters/interfaces.ts`) → `LiveHermesAdapter` (JSON-RPC/WS to hermes serve via vite proxy `/api/ws`, per-method **mock fallback** = graceful degradation) or `MockHermesAdapter`. Live mode enabled by `.env.local` (`VITE_HERMES_LIVE=1`, `VITE_HERMES_TOKEN`). Domain types in `src/domain/types.ts`; policy engine `src/domain/policies.ts` (spec §9).

## What's live vs mock (end of Phase 4)

| Slice | State | Mechanism |
|---|---|---|
| Staff (agents) | ✅ live | `profiles.list` RPC → Ally; status from `session.active_list`; no progress % (indeterminate by design) |
| Activity ledger | ✅ live | `session.list` RPC synthesized |
| Cron list/create/pause | ✅ live | `cron.manage` RPC (create action is **`add`**, not `create`) |
| WorkItems + delegation | ✅ live | **kanban** via `cli.exec` RPC (`kanban list/create/assign --json`); statuses map triage/ready/todo/running/review/blocked/done/archived → EAiOS states |
| Approvals | ✅ live | kanban tasks with JSON envelope in body (`{"eaios":"approval",...}`) — **kept UNASSIGNED on purpose** |
| Today summary | ✅ live | computed from kanban |
| Connections | ✅ live (empty) | `LiveComposioAdapter` → Composio REST v3 via vite proxy `/composio-api`, key injected server-side |
| Skills | ✅ live | `skills.manage` RPC (names+categories only — 81 platform-enabled) enriched by vite middleware `/api/skills-index` (frontmatter walk of `~/.hermes/skills`) |
| Playbooks | ✅ live | versioned md in `~/eaios/playbooks/` via `/api/playbooks-index` middleware; runs = `kanban create`/`swarm` with `eaios-playbook: <id>@v<ver>` body marker; history = kanban marker query; run-confirm drawer (unassigned option = no execution) |
| Knowledge | ✅ live | Python sidecar (`~/eaios/sidecar/server.py`, loopback :9121): upload/URL → extract (pymupdf/docx/pptx/html) → chunk → SQLite FTS5; app via `LiveKnowledgeAdapter` + `/knowledge-api` proxy; Add-source drawer, reindex/remove, **Try-retrieval panel + chunk drill-down drawer (5.3)**; agent path = `eaios-knowledge-retrieval` skill (curl with agent_id) |
|| Schedule | 🟡 hybrid | real cron overlay; executive calendar mock (needs Google OAuth) |
|| Usage | ✅ live | `/api/usage` vite middleware (node:sqlite, state.db `session_model_usage` read-only, 30s cache) → `LiveHermesAdapter.getUsage` → runtime `usage` slice. D7 labeling: actual>0 authoritative, else estimated>0 estimate, else "Not provided". Budget via `/api/eaios-settings` → gitignored `~/eaios/settings.local.json` (F15 done); month-to-date only (F16) |
|| Env files | ✅ live | D4 allowlist = SOUL.md per profile. Read `profiles.describe`→soul, write `profiles.configure{soul}`; FNV content-hash read-compare-write (non-atomic CAS, documented); mock fallback. Settings Model/Approval cards = honest badges, not fake saves |
|| Artifacts | ⏳ mock | Phase 6.3 |

## Hard-won gotchas (don't relearn these)

1. **Kanban dispatcher auto-executes ASSIGNED tasks** (picked up in ~12s and intelligently blocked a fake investor-email approval). Approvals stay unassigned; dispatcher pickup of delegated work may need `kanban dispatch` nudge or `hermes kanban daemon`.
2. **`api.composio.dev` is NXDOMAIN** (docs are wrong); working v3 host is `backend.composio.dev`. Key is valid; account has 0 connected apps.
3. **Secrets**: COMPOSIO_API_KEY has **no `VITE_` prefix** (would inline into browser bundle); vite proxy injects `x-api-key` from node-side `loadEnv`. `.env.local` is gitignored + chmod 600. Hermes `~/.hermes/.env` is write-protected from the agent — user edits only.
4. **Vitest**: `test.env` forces `VITE_HERMES_LIVE=0` (tests were hitting the live gateway via .env.local); live adapter connects only via explicit `connect()` from `startRuntime`.
5. **Preview-pane click harness is flaky** (delta engine loses sync) — trust vitest interaction tests, not preview clicks, for verification.
6. Terminal blocks inline `$(grep KEY …)` secret expansion — run the saved blocked-script instead.
7. React 19 + vite template: no constructor param properties (`erasableSyntaxOnly`); unused imports fail the build (TS6133).
8. **`skills.manage` RPC returns only `{category: [names]}`** — no descriptions/versions, and `verbose`/`describe`/`view` params don't exist (unknown-action 4017). Descriptions live only in SKILL.md frontmatter → `/api/skills-index` vite middleware (vite.config.ts) walks `~/.hermes/skills` (30s cache). RPC count (81) < disk count (86): `get_available_skills` filters platform-gated skills (the 5 `apple/*` are macOS-only).
9. `cli.exec` RPC runs **only** `python -m hermes_cli.main <argv>` (hermes subcommands), not arbitrary shell — and `hermes skills list` has no `--json` (fixed-width table, truncated names).
10. **Knowledge decisions locked (2026-08-26):** path A Python sidecar on loopback; **FTS5 keyword first, vectors later behind the same interface**. Scope enforcement is server-side on `/search` via `agent_id` (private withheld from agents; agent-scoped via `json_each(allowed_agent_ids)`); no agent_id = executive sees all. **Citation contract:** answers cite `eaios://chunk/<chunkId>` (resolves via `GET /chunks/<id>`); `citationEnabled=false` may inform but never be quoted. Agent path = `eaios-knowledge-retrieval` skill in ~/.hermes/skills/productivity. `uv` is NOT on background-shell PATH — use `~/.hermes/bin/uv`.
11. Sidecar notes: FTS5 `snippet()` highlight marks are `«»`; bm25 score negated for ascending=best; multipart parsing is hand-rolled stdlib (no framework); upload cap 50MB; indexing is synchronous (fine for executive-size docs — revisit if bulk imports arrive).
12. **A prior session left partial 5.4 work** (Playbook types, unused interface imports, a playbooks middleware, competitor-deep-dive.md with `title/purpose/type` frontmatter) — merged/normalized 2026-08-26 to the canonical schema: `name/description/version/status/mode/assignee/owner/skills/workers/verifier/synthesizer`. If the app behaves oddly around playbooks, check for other unmerged fragments first.
13. `kanban create --json` returns the task object directly (`{id, assignee, status, ...}`); `kanban archive <id>` prints `Archived <id>`. Unassigned create → status `ready`, dispatcher does NOT pick it up (safe for verification). Archived playbook runs remain in history as state `cancelled` (honest record — e.g. verification run t_4714271b).
14. **Usage data (6.1):** `insights.get` RPC = `{days, sessions, messages}` only (no tokens/cost); `hermes insights` CLI has no `--json`. Real source = state.db `session_model_usage` (per-session/model/task rows; `estimated_cost_usd`/`actual_cost_usd`/`cost_status`/`cost_source`; join `sessions.profile_name` — NULL = default profile). App reads it via `/api/usage` middleware (node:sqlite, **Node ≥24 built-in, no dep**, read-only open). kimi-coding reports NO pricing → costs all 0.0 → honest UI shows "Not provided". Direct WS probe: `ws://127.0.0.1:9119/api/ws?token=…` (path required; root path fails).
15. **File surface (6.2):** NO generic file read/write RPC; `profiles.get_asset/set_asset` = avatars only; no `config.yaml` write RPC. Env-file surface = `profiles.describe` (`soul` field) + `profiles.configure` (`{name, soul}` full replacement; also takes `description`, `model`+`provider` together, `disabled_skills`, `enabled_toolsets`, CAS'd `ui_meta`). Mock's ALLY.md/OPERATING_RULES.txt never existed on disk. RPC method catalog: `tui_gateway/methods_*.py` in the hermes-agent repo.

## Decisions locked

D1: Today absorbs Work (kanban-backed). D2: standalone app (not desktop plugin) for toolchain + multi-CEO packaging. D3: conservative external-write approvals. D5: no progress %, indeterminate. D7: usage cost native estimated+actual (wire Phase 6 via `insights.get` / state.db `session_model_usage`). Multi-agent model: **Hermes profiles = Staff agents**; bot_relay/peer for agent comms.

## Next: Phase 5 (discussed with user — see below)

1. ~~Skills → live~~ **DONE 2026-08-26** (81 real skills, `skills.manage` + `/api/skills-index`).
2. ~~Knowledge/RAG~~ **DONE 2026-08-26 (milestone 1)** — sidecar + FTS5 + sources CRUD + Add-source UI. Retrieval enforcement + agent-facing query path still open.
3. ~~Evidence/citation drill-down contract~~ **DONE 2026-08-26** — `/search` + `/chunks/<id>` live, scope enforcement verified (executive 3 / scout 2 / quill 1 on seeded test set), Try-retrieval UI + drill-down drawer, citation contract in `adapters/interfaces.ts`, `eaios-knowledge-retrieval` skill for agents. Remaining: answer→chunk link store once the Assistant page goes live (Phase 6).
4. ~~Playbooks~~ **DONE 2026-08-26** — 3 playbooks on disk (weekly-investor-update, monthly-expense-audit, competitor-deep-dive swarm), run via kanban create/swarm, history from marker query, run-confirm drawer + history UI. Open: swarm run never executed end-to-end (needs a real goal + executive consent); playbook edit/new-version UI not built (edit md on disk for now).
5. ~~Tests + acceptance (spec §8.7/§8.8)~~ **DONE 2026-08-26** — sidecar suite (`sidecar/test_sidecar.py`, black-box subprocess: state machine pending→ready/failed + error kept + reindex recovery; scope enforcement executive/scout/quill; citation round-trip; non-citable flag) via `npm run test:sidecar`; app suite `src/tests/acceptance-phase5.test.tsx` (cite-as URI in drawer, failed-source error display, playbook version history). Sidecar env overrides for tests: `EAIOS_KNOWLEDGE_DATA_DIR/HOST/PORT`.

## Phase 6 progress

1. ~~Usage → live~~ **DONE 2026-08-26 (6.1)** — `/api/usage` middleware (node:sqlite over state.db), D7 cost labeling, runtime usage slice, page rewired off direct-fixture import; live-verified vs SQL. Range picker F16. Details: `docs/phase6-brief.md`.
2. ~~Settings/env files → live~~ **DONE 2026-08-26 (6.2)** — SOUL.md per profile via `profiles.describe`/`profiles.configure` (no generic file RPC; mock's ALLY.md never existed); FNV-hash read-compare-write (non-atomic CAS documented); mock Model/Approval cards badged honest (fake save toasts removed); **F15 closed**: budget via `/api/eaios-settings` middleware → gitignored `~/eaios/settings.local.json` (server-side key allowlist), inline editor on Usage page; 47 vitest + 8 sidecar green.
3. Artifacts → live (6.3) — **next**.
4. Assistant → live (6.4, split chat / citation store).
5. Agent factory (6.5).

## Open items awaiting the user

- Daily 7am "Morning briefing" cron → Ally's Portal: **needs explicit consent** (script was blocked awaiting consent; user undecided). Create via `cron.manage` action `add`, `deliver: 'telegram:-1004268167166'`.
- Google Calendar: needs user's one-time OAuth (then executive calendar goes live).
- Composio app linking (Gmail etc.) needs auth configs in Composio dashboard → then Connections populates.

## To resume in a new session

"Continue EAiOS — read ~/eaios/docs/HANDOFF.md and ~/eaios/docs/BUILD-PLAN-v2.md" → verify dev servers (`curl localhost:5173/today`, `ss -tlnp | grep -E '9119|9121'`), `git log --oneline` in ~/eaios, then pick the first unchecked item in BUILD-PLAN-v2.md (next: Phase 6.3 Artifacts → live; brief in docs/phase6-brief.md). Original spec: `docs/reference/Executive_AI_Operating_System_Coding_Agent_Build_Planner.docx`. Deferred items: `docs/ROADMAP.md`.
