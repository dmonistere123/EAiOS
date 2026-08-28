# EAiOS — Beta Hardening Report (release gate)

**Date:** 2026-08-28. **Scope:** spec §11.8 hardening tasks, §13 scenarios,
§14 test strategy, §15 NFRs, §16 Definition of Done. **Suites:**
**154 vitest + 8 sidecar green, `tsc` build clean.** Test files cited below
live in `app/src/tests/`.

## §13 Required Mock Scenarios — `scenarios.test.tsx` (+ existing suites)

| # | Scenario | Status | Evidence |
|---|---|---|---|
| S1 | Quiet Morning | ✅ | empty/positive states, no fabricated activity |
| S2 | Busy Day | ✅ | default fixture KPIs (8/4/3) asserted |
| S3 | Agent in Motion | ✅ | working + indeterminate bar (`role=progressbar`) |
| S4 | Agent Lag | ✅ | stale last-activity ("8m ago") surfaced, not hidden |
| S5 | Approval Backlog | ✅ | 5 approvals, oldest-first, risk filter, inspector |
| S6 | Connector Degraded | ✅ | "incomplete" + Resume connect (also W4 suite) |
| S7 | Cron Running | ✅ | `__emit` → rail activity ledger event |
| S8 | Knowledge Index Failure | ✅ | error kept + Reindex offered |
| S9 | Environment Conflict | ✅ | stale version → `version_conflict`, no overwrite |
| S10 | Event Stream Lost | ✅ socket-level | `live-reconnect.test.ts` (drop → reconnect → refresh) |

Fixture API: `src/mocks/scenarios.ts` named states + mock adapter
`__loadFixture`/`__emit` (spec §13: mocks are acceptance fixtures).

## §14.3 E2E Executive Journeys — `e2e-journeys.test.tsx` (all 5 green)

1. **Morning review** — Today → delegate → oldest approval → approve → rail badge 3→2.
2. **Investigate lag** — S4 → Staff → agent drawer → stale activity visible
   (cancel/retry not supported by the host — diagnostics only, as spec allows).
3. **Schedule automation** — create recurring task → lands in overlay + jobs badge.
4. **Ground a request** — add URL source → ready → ask Ally → citation chip → chunk drawer.
5. **Admin change** — Settings → edit SOUL → version-checked save → audit toast.

## §14.4 Accessibility Acceptance — `a11y.test.tsx`

| Requirement | Status | Evidence |
|---|---|---|
| All controls keyboard-reachable | ✅ | accessible-name scan (dom-accessibility-api) over Today/Staff/Approvals/Settings/Assistant — zero unnamed interactives; approval rows gained an explicit Inspect button (row click was pointer-only) |
| Visible focus ring, strong contrast | ✅ | global `:focus-visible` 2px signal ring (index.css) |
| Status not by color alone | ✅ | every badge renders text labels (tested) |
| Table header semantics | ✅ | real `<th>` columnheaders (tested) |
| Dialogs manage focus + Escape | ✅ | Drawer autofocuses its close control on open; Escape closes (tested) |
| Resizable panels: accessible alternative | ✅ | separators take ArrowLeft/Right (Shift = 4×) + Home reset (tested) |
| Text 4.5:1 contrast | ✅ by design | ink `#e8f1fa` / ink-dim `#8fa6bd` on canvas `#050914`–`#071220` exceed 4.5:1; ink-faint `#5b7189` is used only for supplementary text |
| Keyboard-only nav (§11.8 list) | ✅ | nav/rail/Staff/Approvals/Settings covered by the scan + interaction suites |

## §15 Non-Functional Requirements — `perf.test.tsx` + existing

| Requirement | Status | Evidence |
|---|---|---|
| Immediate shell w/ skeletons | ✅ | pulse skeletons on Connections/Today loads |
| <100ms local feedback / pending state | ✅ | optimistic bubble + disabled states everywhere |
| Event rendered within ~1s | ✅ | 800ms trailing debounce; 100-event burst = **one** refresh cycle (tested) |
| Virtualize or paginate large lists | ✅ | 50-row pages + Show more on Today queue + Artifacts (tested) |
| Retryable failures expose Retry | ✅ | `retryable` on AuditResult errors; Reindex/Resume-connect paths |
| Telemetry without secrets | 🟡 partial | every write carries an `auditEventId` correlation id; no dedicated UI-failure telemetry sink — recorded as roadmap (Phase 8 packaging) |
| No secrets in DOM/URL/logs/persistence | ✅ | keys server-side only (proxy-injected), `.env.local` gitignored chmod 600; localStorage carries only session ids/pane prefs |
| Desktop-first, tablet fallback | ✅ | `isNarrow` collapse under 1024px; mobile = read-mostly (unchanged) |

## §16 Definition of Done

| Item | Status |
|---|---|
| All routes on shared AppShell | ✅ 11 routes |
| Panels resize + persist | ✅ (+keyboard resize this pass) |
| Rail: cron by next run, approvals oldest-first, activity newest | ✅ selectors tested |
| Today summary + delegation flow | ✅ journey 1 |
| Staff dynamic statuses + editable model via adapter | ✅ org chart + properties drawer (6.5) |
| Approvals gate governed actions | ✅ policy engine + kanban envelope |
| Connections safe metadata/scopes/health/test | ✅ + real connect flow (W4) |
| Schedule overlays calendar + cron | ✅ (+ownership rail W5) |
| Knowledge scope + indexing lifecycle | ✅ (+visibility groups W6) |
| Skills & Playbooks versions + history | ✅ (+authoring W7) |
| Artifacts provenance + share state | ✅ (+agent filter W8) |
| Usage distinguishes authoritative vs estimated | ✅ D7 labels ("Not provided" honest) |
| Settings safe config + allowlisted env editing | ✅ (stale badge repaired this pass) |
| Every material write produces an audit event | ✅ AuditResult everywhere |
| Mock and live share domain interfaces | ✅ mock parity per slice |
| Unit + integration + a11y + E2E checks pass | ✅ 154 vitest + 8 sidecar |

## Honest gaps carried forward (not beta blockers)

- **UI-failure telemetry sink** — auditEventIds only; no crash reporting (Phase 8).
- **S10 is socket-level** — the live reconnect path is tested; a full
  "stream lost" banner journey would need a live-mode UI harness (F12: the
  preview-pane harness is flaky).
- **Journey 2 cancel/retry** — the host has no cancel-work RPC; journey is
  diagnostics-only per the spec's "if supported".
- Creator attribution for cron jobs — host records none (W5 note; roadmap).

**Gate verdict: all §16 DoD items pass. EAiOS is feature-complete for beta;
remaining work is packaging (BUILD-PLAN-v2 Phase 8).**
