# Hardening Brief — the final beta gate (spec §11.8, §13, §14, §15, §16)

**Written:** 2026-08-28, before build (working rule 1). **Spec source:**
`docs/reference/…Build_Planner.docx` (extracted to /tmp during session; §-refs
below are verbatim). **Note:** BUILD-PLAN-v2 cites a "§21 release checklist" —
the spec's actual release gate is **§16 Definition of Done** (+ §15 NFR);
this pass walks those.

## H1 — Accessibility (§14.4, §11.8)

- **Drawer focus management:** focus moves into the dialog on open (close
  button autofocus); Escape already closes; `role="dialog" aria-modal` ✓.
- **Resizable panels — accessible alternative (spec line item):** DragHandle
  (already `role="separator" tabIndex=0`) gains ArrowLeft/Right keyboard
  resize + Home reset.
- Already true (asserted in tests): global `:focus-visible` ring (index.css);
  status never color-alone (badges carry text); table header semantics;
  labeled controls.
- Test: `a11y.test.tsx` — accessible-name scan over interactive elements on
  key pages, drawer focus + Escape, keyboard pane resize.

## H2 — Performance (§15)

- "Virtualize or paginate": honest **pagination** (no new deps) — Show-more
  on Artifacts and Today's operating queue when > 50 rows.
- Event-rate: test proving 100 rapid runtime events collapse into ONE
  debounced refresh cycle (800ms trailing) — adapter call counts.

## H3 — Mock scenario suite S1–S10 (§13, verbatim scenarios)

`src/mocks/scenarios.ts` named fixture states + a mock-adapter fixture API
(`__loadFixture`, `__emit` — spec §13: "mocks are acceptance fixtures").
`scenarios.test.tsx` asserts each: S1 quiet morning (empty states), S2 busy
day (default fixture KPIs), S3 agent in motion (indeterminate), S4 agent lag
(stale last-activity surfaced), S5 approval backlog (sort + risk spread),
S6 connector degraded (reconnect warning), S7 cron running while on Today
(event → ledger), S8 index failure (error + retry), S9 env conflict (CAS
rejection), S10 stream lost (covered by live-reconnect.test.ts; reported).

## H4 — E2E executive journeys (§14.3, verbatim)

`e2e-journeys.test.tsx`, full AppShell renders in mock mode:
1. Morning review: Today → delegate → oldest approval approve → rail reflects.
2. Investigate lag: S4 → Staff → agent → last-event/activity inspection.
3. Schedule automation: Schedule → create recurring task → appears in overlay + rail.
4. Ground a request: Knowledge add URL → ready → Assistant ask → citation → chunk drawer.
5. Admin change: Settings → edit SOUL → save → audit toast (conflict path in S9).

## H5 — Release gate report

`docs/beta-hardening-report.md`: §16 DoD walked item-by-item with honest
status + evidence (test names), §15 NFR table, §14.4 checklist, §13/§14.3
results, remaining honest gaps (telemetry is auditEventIds only; tablet =
isNarrow collapse; S10 covered at socket level).

## Acceptance checklist

- [x] Drawer autofocus + Escape; keyboard pane resize works and is tested.
- [x] Accessible-name scan finds zero unnamed interactive controls on
  Today/Staff/Approvals/Settings/Assistant (approval rows gained an Inspect
  button in the pass).
- [x] >50-row lists paginate; 100-event burst = one refresh cycle (tested).
- [x] S1–S10 named scenarios green.
- [x] All 5 §14.3 journeys green end-to-end.
- [x] Report walks §16/§15/§14.4 with no invented checkmarks
  (docs/beta-hardening-report.md).
- [x] Full suite (154) + sidecar (8) + build green; HANDOFF updated.
