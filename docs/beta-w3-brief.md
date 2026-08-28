# W3 Brief — Staff org visualization + per-agent rail

**Written:** 2026-08-28, before build (working rule 1). **Plan:** beta-readiness-plan.md
W3. **Depends on:** W1+W2 (channel view, rail framework) — DONE.

## Scope (from the plan)

1. **Org visualization:** Ally centered, staff radial, hand-rolled CSS/SVG —
   **no new deps**. Agents glow/pulse when `status === 'working'`.
2. **Click agent** → existing properties drawer + rail switches to that
   agent's channel (W1's `AgentChannel` data path, shared).
3. **Flat grid stays** as a "List" toggle — a working view is never deleted.

## Design

- **`components/OrgChart.tsx` (new):** relative container; Ally hub at
  center, staff nodes on an ellipse (angles computed from index/count —
  flat `reportsToAgentId: ally` data, radial is the honest shape). SVG
  underlay (`viewBox 0 0 100 100`, `preserveAspectRatio="none"`) draws the
  connectors. Nodes are real `<button>`s with accessible names
  (`name, status`); working agents get a `animate-ping` ring + signal glow
  (Tailwind built-ins); selected node gets a signal ring. Filter tabs apply
  to the staff nodes; Ally always renders (the hub).
- **View toggle:** Org (default) | List, `role="tablist"`. The existing
  grid/card markup moves under List unchanged.
- **`useAgentChannel(agentId)` hook** extracted from `AgentChannel.tsx` so
  the Staff rail reuses the exact W1 data path (mock-parity `getChannelFor`).
- **Rail (D-B4 framework from W2):** on selection the page declares two
  sections — `Delegated to <name>` (compact list + state badges) and
  `Ally ↔ <name>` (chat, honest empty state). No selection → `null`
  declaration → default watchtower. Ally is not special-cased: his channel
  = work he owns + his own Bot Chat (which exists on this box).
- **`usePageRail` signature widened** to `RailSectionDef[] | null` (null =
  no declaration).

## Acceptance checklist

- [x] Org view default; Ally hub + staff nodes + connectors render; working
  agents visibly pulse (ally + scout in mock).
- [x] List toggle restores the exact pre-W3 grid.
- [x] Click node (either view) → properties drawer + rail channel sections;
  no selection → default watchtower.
- [x] Agent with no Bot Chat → honest empty in rail; Ally selectable like
  any node.
- [x] No new npm dependencies.
- [x] `npm test` (98) + sidecar (8) green, build clean; existing
  Staff/agent-factory tests untouched and green.
- [x] Live check on box: org chart with real profiles (Ally hub + Quill),
  node click → properties drawer with Quill's real model + live catalog;
  same-commit docs (HANDOFF progress, boxes checked).

## Honest gaps

- Pulse/glow is decorative status only — status semantics stay with
  `AgentStatusBadge` (D5: no fabricated state).
- Radial layout is flat-hierarchy-only; if `reportsToAgentId` ever deepens,
  layout needs a tree pass (not beta scope).
- 10+ agents will crowd the ellipse — fine at executive scale; revisit with
  a second ring if a beta user staffs up.
