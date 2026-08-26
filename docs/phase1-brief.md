# Phase 1 Build Brief — EAiOS Executive Shell (Mock Mode)

You are the coding agent building **Phase 1 (Foundation)** of the Executive AI Operating System (EAiOS): a complete, reactive, executive-grade UI shell running entirely on mock adapters. No live Hermes wiring in this phase.

## Where you work

`/home/ally-landry/eaios/app` — Vite + React 19 + TypeScript + Tailwind CSS v4 (via `@tailwindcss/vite`) + react-router-dom. All dependencies are installed. Do NOT add new dependencies without strong reason.

## Already written for you (the contract — DO NOT change these files' public shapes)

- `src/index.css` — Allygnment theme tokens (`@theme`): colors `canvas` `#050914`, `canvas-raised` `#071220`, `canvas-overlay`, `edge`, `signal` `#32C5FF`, `ink`, `ink-dim`, `ink-faint`, `ok`, `warn`, `risk`, `secondary`. Use them as Tailwind classes: `bg-canvas`, `text-ink-dim`, `border-edge`, `text-signal`, `bg-signal`, etc.
- `src/domain/types.ts` — full domain model (Agent, WorkItem, Approval, CronJob, ActivityEvent, Artifact, UsageSummary, KnowledgeSource, RuntimeEvent, PolicyResult, AuditResult, EnvironmentFile…).
- `src/adapters/interfaces.ts` — HermesAdapter + ComposioAdapter + KnowledgeAdapter + CalendarAdapter contracts.
- `src/mocks/fixtures.ts` — deterministic fixtures: Ally + 4 staff agents (Scout, Quill, Ledger, Sentinel), 12 work items, 3 pending approvals, 4 cron jobs, activity, artifacts, usage, connections, calendar events, skills/playbooks.
- `src/adapters/mock/MockHermesAdapter.ts` — working mock adapter (simulated latency, live event simulation via `subscribeEvents`, delegation flow, approval decisions, env-file version conflicts). Import the singleton as `import { hermes } from './adapters/mock/MockHermesAdapter'`.

## Governing rules (from the product spec — violations will be rejected)

1. **Pages never import adapters other than through `src/adapters/interfaces.ts` types** and the `hermes` mock singleton. No direct SDK imports.
2. **Staff means AI agents**, never human users.
3. **Never fabricate numeric progress** — agents without a real `progress` value get indeterminate progress treatment (animated bar).
4. **Right rail sorting is contractual**: cron jobs `nextRunAt` ascending · pending approvals `submittedAt` ascending (oldest first) · activity `occurredAt` descending (newest first).
5. **No secrets anywhere** — nothing resembling a token/key may render.
6. **Summary first, diagnostics second.** Executive-grade scanability. Dark Allygnment language: spacious cards, restrained color, crisp hierarchy. NOT a terminal/console aesthetic.
7. Accessibility: keyboard-reachable controls, visible `:focus-visible` ring (already in CSS), status never conveyed by color alone (always pair icon/label).

## What to build

### 1. AppShell (`src/app/AppShell.tsx`)
Three-region layout used by ALL routes:
- **Left pane** (default 264px, min 208, max 360): workspace identity block ("Executive AI Operating System", Allygnment wordmark style — text only, `EAiOS` mark in cyan) + primary nav for the 11 routes below + collapse-to-icon-rail.
- **Center**: `<Outlet/>` with a `PageHeader` (route title + one-line executive summary).
- **Right rail** (default 340px, min 280, max 440): three sections in this exact order — **Next Cron Jobs**, **Awaiting Approval**, **Activity Ledger** — each rendering from shared selector hooks (same data stores as the full pages; no separate state copies).
- **Drag-resize both panes** with continuous update, no text selection (add `.eaios-dragging` to `document.body` during drag — CSS exists), double-click handle resets to default, widths + collapse persisted to `localStorage` under `eaios.panes.v1`. On viewports < 1024px ignore stored widths, hide right rail behind a toggle.
- **Top shell strip**: global search input (visual only), notifications bell with unread dot, profile chip "D.M. — CEO".

### 2. Routes (`src/app/routes.tsx`, react-router)
| Path | Page | Content (mock data via `hermes.*`) |
|---|---|---|
| `/` → redirect `/today` | | |
| `/today` | Today | `getTodaySummary()` greeting/date/headline; 4 KPI cards (executive priorities, delegatable, approvals waiting, next meeting); operating queue table (title, owner chip, priority badge, state badge, due, next action button); "Recommended to delegate" row group with Delegate buttons opening the delegation dialog (choose agent → confirm → `hermes.delegateWork` → item moves, agent queued); empty state component for zero items. |
| `/assistant` | My Assistant | Ally conversation panel (static 4-message mock thread), right side: current orchestration plan (3 steps with assigned agent + state), context summary, approval forecast list. Chat visible but NOT the whole page. |
| `/staff` | Staff | Agent cards grid: name, role, status indicator (colored dot + text label), model, last activity relative time, current task title, indeterminate progress bar when `working`; filters (all/active/waiting/failed-offline/idle); click card → right-side **AgentPropertiesDrawer**: model selector (from `availableModels`), tools list, save via `hermes.updateAgentConfig` with error handling (revert + toast on rejection). |
| `/connections` | Connections | Connection cards from fixtures: app, state badge, account, scope chips (write scopes flagged), last verified, dependent cron count, Test Connection button (spinner → result). |
| `/approvals` | Approvals | Table sorted oldest first; risk badge, agent, target, age; click → inspector panel with evidence list, proposed diff (mono block), rollback plan, policy note; Approve / Reject / Request changes → `hermes.decideApproval` → row leaves pending list, toast confirms. |
| `/schedule` | Schedule | Week strip (7 day columns) rendering calendar events from fixtures, color/dot distinguished by source (executive/agent/cron), legend + source toggle checkboxes, click cron event → detail popover. |
| `/knowledge` | Knowledge | Source table: name, type icon, scope badge, indexing status badge (pending/processing/ready/failed/stale), freshness, citations on/off; upload button (visual only). |
| `/skills` | Skills & Playbooks | Tabs (Skills / Playbooks), cards with name, purpose, version, owner, last run, status badge. |
| `/artifacts` | Artifacts | Searchable list: type icon, name, creating agent, size, created, state badge, provenance (work item id). |
| `/usage` | Usage | Period totals card (tokens, cost with "Estimated" label — `costIsAuthoritative: false`), budget bar (cost vs budgetUsd), per-agent table, freshness note. |
| `/settings` | Settings | Sections: Model defaults (visual), Approval defaults (visual toggles), Layout (reset pane prefs button — clears `eaios.panes.v1` + reload), Environment Files: list from `hermes.listEditableEnvironmentFiles()` → editor textarea with diff-before-save (simple line diff view) → `writeEnvironmentFile` with version-conflict error path. |

### 3. Shared components (`src/components/`)
`StatusBadge` (all enums above), `PriorityBadge`, `RiskBadge`, `AgentDot`, `KpiCard`, `DataTable`, `EmptyState`, `Drawer`, `ConfirmDialog`, `Toast` (tiny in-house toast context), `IndeterminateBar`, `RelativeTime`.

### 4. Live right rail
`src/state/runtime.ts`: a tiny store (React context or plain subscribe/getSnapshot + `useSyncExternalStore`) holding agents/approvals/cron/activity. On mount: initial fetches; then `hermes.subscribeEvents` updates stores on `agent.*`, `approval.*`, `cron.*`, `config.changed` events. Right rail and pages read from this store — that's what makes the mock feel alive.

### 5. Entry
Wire `main.tsx` → `RouterProvider` with the route map; delete default Vite boilerplate (`App.tsx` counter, assets). Title: "EAiOS — Executive AI Operating System".

## Acceptance criteria (Phase 1 subset, from spec §16)
- All 11 routes render under shared AppShell with active nav state.
- Panes resize smoothly, persist across reload, double-click resets; no text selection during drag.
- Right rail sorts exactly per contract and updates live (mock events fire every ~7s).
- Delegation flow: Today → delegate → item leaves executive queue → Staff card shows agent queued → working, ledger records it.
- Approvals: decide → leaves pending list → ledger event → toast.
- Agent model change rejected → revert + visible reason (use `updateAgentConfig` with an unlisted model path handled).
- `npm run build` passes with zero TypeScript errors.

## Working agreement
- `npm run dev` to iterate; verify `npm run build` at the end — it MUST pass clean.
- Keep components small and readable; no giant files.
- When done, report: files changed, how to run, acceptance criteria pass/fail, anything deferred.
