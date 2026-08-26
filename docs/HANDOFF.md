# EAiOS — Session Handoff (read this first in a new session)

**Updated:** 2026-08-26 · **Repo:** `~/eaios/app` (Vite + React 19 + TS + Tailwind v4 + react-router) · **Docs:** `~/eaios/docs/` (phase0-integration-matrix.md, phase1-brief.md) · **Git:** phases 1–4 committed, build clean, **19/19 vitest green** (`npm test`)

## What this is

Executive AI Operating System — an executive dashboard over Hermes Agent (Allygnment branding: dark `#050914`/`#071220`, cyan `#32C5FF`). Main agent = **Ally** (the default Hermes profile). Telegram group = **Ally's Portal** (chat id `-1004268167166`; user telegram id `7161920923`, both allowlisted; gateway runs on systemd). Long-term goal: package for other CEOs' boxes — the UI only talks to typed adapters, never Hermes internals.

## Live processes (dev)

- `hermes serve` on `127.0.0.1:9119` — start via `~/eaios/scripts/start-hermes-serve.sh` (reads token from `~/.hermes/.eaios-dev-token`, chmod 600). **Must be running for live mode** (install as systemd service eventually). Note: `hermes serve --status` does NOT see it (untracked start) — check `ss -tlnp | grep 9119` instead.
- Vite dev server on `localhost:5173` (`npm run dev` in `~/eaios/app`), preview in Hermes desktop.

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
| Skills | ✅ live | `skills.manage` RPC (names+categories only — 81 platform-enabled) enriched by vite middleware `/api/skills-index` (frontmatter walk of `~/.hermes/skills`); playbooks still mock |
| Schedule | 🟡 hybrid | real cron overlay; executive calendar mock (needs Google OAuth) |
| Usage, Artifacts, Env files, Knowledge, Playbooks | ⏳ mock | Phases 5–6 |

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

## Decisions locked

D1: Today absorbs Work (kanban-backed). D2: standalone app (not desktop plugin) for toolchain + multi-CEO packaging. D3: conservative external-write approvals. D5: no progress %, indeterminate. D7: usage cost native estimated+actual (wire Phase 6 via `insights.get` / state.db `session_model_usage`). Multi-agent model: **Hermes profiles = Staff agents**; bot_relay/peer for agent comms.

## Next: Phase 5 (discussed with user — see below)

1. ~~Skills → live~~ **DONE 2026-08-26** (81 real skills, `skills.manage` + `/api/skills-index`).
2. **Knowledge/RAG** — biggest piece. Recommended path A: Python sidecar (loopback) — upload/URL → extract → chunk → SQLite FTS5, governed scope/freshness/citations; `KnowledgeAdapter` interface already defined; vectors later. **User hadn't picked path (A/B/C) or sidecar-vs-plugin yet — ASK.**
3. Evidence/citation drill-down contract.
4. Playbooks: versioned md workflows; run via kanban (incl. `kanban swarm`); history from kanban runs.
5. Tests + acceptance (spec §8.7/§8.8).

## Open items awaiting the user

- Daily 7am "Morning briefing" cron → Ally's Portal: **needs explicit consent** (script was blocked awaiting consent; user undecided). Create via `cron.manage` action `add`, `deliver: 'telegram:-1004268167166'`.
- Google Calendar: needs user's one-time OAuth (then executive calendar goes live).
- Composio app linking (Gmail etc.) needs auth configs in Composio dashboard → then Connections populates.

## To resume in a new session

"Continue EAiOS — read ~/eaios/docs/HANDOFF.md, project is EAiOS" → verify dev servers (`curl localhost:5173/today`, `hermes serve --status`), `git log --oneline` in ~/eaios/app, keep going per "Next" above.
