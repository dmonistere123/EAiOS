# EAiOS — Phase 0: Hermes Integration Matrix

**Date:** 2026-08-25
**Host:** ally-landry-SER9 (Linux 7.0.0-30, Hermes Agent installed at `~/.hermes/hermes-agent`, gateway live on systemd)
**Method:** Direct inspection of the installed Hermes source (`tui_gateway/` RPC registry, `state.db` schema, CLI surface, desktop plugin SDK). Every row below was verified against the running system, not assumed.
**Verdict key:** ✅ Native = exists today, wire an adapter · 🟡 Partial = substrate exists, thin service needed · 🔴 Build-new = no Hermes equivalent · ⬜ External = third-party dependency

---

## 1. The Big Finding

Hermes exposes a **JSON-RPC 2.0 over WebSocket** server (`hermes serve`, default `127.0.0.1:9119`) — the same backend the desktop app and TUI use. The registry (`tui_gateway/methods_*.py`) defines **~90 RPC methods**, and the event layer (`event_publisher.py`, `event_replay.py`) pushes live events over the socket with replay buffers for reconnects. This is the EAiOS integration point. The UI never needs to touch Python internals — it speaks JSON-RPC, exactly the adapter-boundary the build planner mandates.

## 2. Capability Matrix (completes Section 12 of the build planner)

| Capability | EAiOS needs | Verdict | Verified mechanism |
|---|---|---|---|
| **Hosting (D2)** | 11-route React app shell | ✅ (2 options) | (a) Desktop plugin SDK: `~/.hermes/desktop-plugins/<id>/plugin.js`, hot-reload, registers full pages via `ROUTES_AREA` + sidebar nav, calls RPC via `host.request()`, subscribes via `host.onEvent('*')`, optional Python backend at `/api/plugins/<id>`. Constraint: plain ESM, no JSX build step. (b) Standalone Vite/React app → `hermes serve` WS. **Recommendation: (b) for the real build (Tailwind/TS toolchain, multi-CEO packaging), (a) as a thin launcher pane later.** |
| **Agent list (Staff roster)** | Stable id + role | 🟡 | `profiles.list/create/describe/configure` — named profiles have isolated config, sessions, skills, memory, and assets. **Profiles = Staff agents.** Ally = default profile; specialists = named profiles. `agents.list` = live background processes (session_id, command, status, uptime). Role/health/current-task mapping = thin aggregation in the adapter. |
| **Agent status** | State + last event + current work | 🟡 | Live: WS events + `session.active_list`, process registry status. Historical: `state.db sessions.last_activity_description/last_activity_at`, `async_delegations.event_json`. **No progress % exists** — use indeterminate progress (spec §5.2 already requires this). |
| **Agent config write** | Model/version/tools | ✅ | `profiles.configure`, `model.options`, `tools.configure`, `config.get`. Writes are validated by Hermes itself. |
| **Work queue** | Executive + delegated work items | 🟡→✅ | **`hermes kanban`**: durable SQLite task board, cross-profile, with `create/assign/claim/block/schedule/request-review/request-changes/complete/attach/comment/log/runs/stats/daemon`. Maps almost 1:1 onto `WorkItem` including delegation and review states. Use kanban as the WorkItem store behind `WorkService`. **D1 resolved: Today absorbs Work; kanban is the backing object, no separate nav item.** |
| **Approvals (governance)** | Gate on external write/send/execute | 🔴 core / 🟡 transport | Native `approval.pending/received/respond` RPC exists — but it gates *dangerous terminal commands*, not "send this email." The EAiOS **policy evaluator + Approval store is build-new** (spec §9), reusing Hermes' approval transport/UX patterns. Messaging side already supports `/approve` `/deny` — so Telegram approvals are feasible from day one. |
| **Cron scheduler** | List/create/update/history | ✅ | `cron.manage` RPC + full CLI (`list/create/edit/pause/resume/run/runs/notepad`). Durable execution store at `~/.hermes/cron/executions.db`. Per-profile cron stores supported. Delivery targets include Telegram — cron output lands in "Ally's Portal" automatically. |
| **Activity ledger** | Runtime/audit stream | 🟡 | Sources all exist: `state.db` messages (FTS5), sessions' last-activity fields, `async_delegations`, `delivery_obligations`, kanban `log`/events, cron `runs`, live WS events. Ledger = unified selector over these (satisfies spec §5.2 "no separate copies of state"). Stable event ids: kanban/cron have them; synthesize ids for synthesized rows. |
| **Artifacts** | Large outputs + provenance | 🟡 | Files land in workspace dirs; delivery via `MEDIA:` mechanism; kanban `attach/attachments` gives provenance linking to a task. Build-new: thin artifact registry (index over workspace dirs + kanban attachments). |
| **Usage (D7)** | Tokens/cost by agent/model | ✅ | `insights.get` RPC + `session.usage` + `state.db session_model_usage` with **both `estimated_cost_usd` and `actual_cost_usd` plus `cost_source`/`cost_status` fields** — authoritative-vs-estimated labeling is native, exactly as spec §8.10 requires. Per-profile scoping = per-agent usage. |
| **Settings / safe config** | Model defaults, policies | ✅ | `config.get/show`, `skills.manage/reload`, `plugins.list/manage`, `mcp.servers.*`. Secrets are hard-protected — verified today: agent-side writes to `~/.hermes/.env` are refused by the runtime. |
| **Environment files (.MD/.TXT)** | Allowlisted editor | 🟡 | File read/patch tools work on `.md`/`.txt`; `.env` is hard-blocked (verified). Build-new: small allowlist service (explicit file list + content hash as `expectedVersion`) over the filesystem. Straightforward. |
| **Auth / user identity** | User + workspace | ✅ | `hermes serve` requires an auth provider (password/OAuth) on any non-loopback bind (June 2026 hardening); loopback is local-trust. Profiles = workspace identity. Platform identity via `gateway_routing` (Telegram user `7161920923` verified live today). |
| **Live event transport** | Right rail updates | ✅ | JSON-RPC notifications over WS, `event_replay.py` buffers for reconnect recovery, `gateway.ready` heartbeat. Spec §7.2 "live updates paused → polling fallback" maps directly onto replay + re-fetch. |
| **Agent-to-agent comms** | Ally orchestrates Staff | ✅ | `bot_relay.roster.sync/outbox.drain/deliver/reply` RPC + `hermes peer` (bot-to-bot DMs across machines) + kanban cross-profile claiming + `delegate_task` subagents (`async_delegations` table). |
| **Telegram** | Executive talks to Ally | ✅ **DONE** | Gateway live (systemd, linger on). Allowlist fixed today: user `7161920923` + group `-1004268167166` ("Ally's Portal"). `/approve`, `/status`, `/new` etc. work in-chat. |
| **Composio** | Connections | ⬜ | Not installed. Path: Composio MCP server via `mcp.servers.add` RPC — adapter contract stays mock until Phase 4. |
| **Knowledge / RAG** | Governed sources | 🔴 | No native RAG/indexing. Memory + skills are the nearest primitives. Phase 5 build-new (or MCP-based). Keep mock. |
| **Calendar (D6)** | Schedule overlay | ⬜ | Not native. Via Composio (Google Calendar) or separate MCP. Cron overlay is ✅ native today; executive calendar stays mock until Phase 4. |

## 3. Open Decisions — Resolved

- **D1 (Work nav item):** Absorbed into Today. Kanban board = the work queue; no separate route.
- **D2 (hosting):** Standalone Vite + React + TS + Tailwind app, served locally, talking to `hermes serve` over WS/JSON-RPC. A desktop-plugin launcher can embed it in Hermes Desktop later. Rationale: full build toolchain (the plugin SDK forbids JSX/build steps), and identical packaging for other CEOs' boxes.
- **D3 (approval defaults):** Conservative external-write default (spec §9.1), enforced in the EAiOS policy engine.
- **D4 (env files):** Explicit allowlist service; `.env` permanently excluded (runtime-enforced).
- **D5 (runtime data):** Status/busy/last-event native; progress always indeterminate.
- **D6 (calendar):** Composio/Google Calendar in Phase 4; cron overlay native now.
- **D7 (cost):** Both authoritative and estimated exist natively, pre-labeled (`cost_source`, `cost_status`).

## 4. Multi-CEO Deployment Notes (recorded per project goal)

- Every CEO box = own Hermes install + own `HERMES_HOME`; EAiOS shell is box-agnostic because it only speaks JSON-RPC to `127.0.0.1:9119`.
- Branding (Allygnment tokens: `#050914`/`#071220`, cyan `#32C5FF`) lives in the UI theme layer, not in adapters.
- Per-box variance (Telegram tokens, profile names, allowlists) stays in Hermes config, which EAiOS reads — never duplicates.
- Mock adapters ship in the package: a new box can demo the full UI before any Hermes wiring is validated.

## 5. Gap Summary (what we actually have to build)

1. **EAiOS policy engine + Approval store** (the governance core — spec §9). Biggest net-new piece.
2. **Aggregation adapter** mapping profiles/processes/sessions → `Agent` objects with role/health.
3. **WorkItem adapter over kanban** (mostly a field mapping; kanban is a gift here).
4. **Activity ledger selector** over state.db + kanban + cron sources.
5. **Artifact registry** (thin index service).
6. **Env-file allowlist service** (small).
7. **Knowledge/RAG** (Phase 5, largest greenfield; keep mocked longest).

## 6. Phase 1 Entry Criteria — Met

✅ Host integration points confirmed · ✅ Auth model verified · ✅ Event/config map produced · ✅ Every "Unknown/verify" row now has a verdict and an owner. **Mock-mode build can start immediately.**
