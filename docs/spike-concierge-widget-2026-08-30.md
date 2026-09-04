# Spike: floating navigation-concierge chat widget (t_7e4db940)

**Date:** 2026-08-30 · **Requester:** Don · **Verdict:** build it — risk 2/10, complexity 4/10

## The ask
Floating button bottom-right on every page (the Staff-page brain icon),
click → overlay panel docked right, minimizable. Purpose: help NEW users
navigate EAiOS ("how do I…?", "where is…?").

## What the code already gives us (probed, not guessed)
- **BrainGlyph** (`components/OrgChart.tsx:42`) — hand-rolled inline SVG, no
  assets/deps. Extract to a shared component; OrgChart imports it. Trivial,
  props untouched (ground rule #3 holds).
- **The whole chat stack from 6.4 is lane-generic**: `assistantLane(key)`,
  `assistantSidToAgent` delta routing, `sendAssistantMessage(text, key)`,
  stored-id resume, strict sid filtering. A "concierge" lane is a thin variant
  keyed differently — its own persistent session per browser (no session
  litter), zero cross-talk with the main Assistant chat (proven pattern).
- **D-B1 untouched** — the chat target is still Ally, just a second lane.
- **No new deps** — FAB/panel/minimize are hand-rolled CSS per convention.

## Design options
- **A. Static nav brief (recommended v1):** concierge lane + a compact
  "EAiOS navigation guide" string prepended to the session's first message +
  current page name from the router ("user is on Schedule"). Cheap, accurate,
  versioned with the repo.
- **B. Knowledge-grounded (v2):** seed the sidecar with an EAiOS user guide;
  concierge retrieves + cites chunks (citation infra exists). +1 complexity.
- **C. Scripted FAQ:** deterministic but a second system to maintain; not
  "ask anything". Not recommended.

## Scores (option A)
- **Risk: 2/10.** Additive AppShell mount; all plumbing proven in 6.4; worst
  realistic bug is VISUAL (z-index overlap with right-side Drawers), not data.
- **Complexity: 4/10 → ~1 build session.** UI is the bulk (FAB, panel,
  minimize, reduced-motion-safe animation, tests); adapter lane variant is
  thin; mock parity + vitest on established patterns.

## Watch items (all minor, all planned-for)
1. **Stacking:** concierge panel shares the right edge with Drawers —
   discipline: drawers win (panel auto-minimizes or renders beneath).
2. **Narrow layout** (<1024px): FAB must not cover content — CSS-only fix.
3. **prefers-reduced-motion** contract (enforced by test) applies to panel
   animation.
4. **Token cost:** tiny — short answers, one compact brief, per-browser
   persistent session (no per-page session spam).
5. Approval gate untouched (read-only Q&A; Ally SOUL applies everywhere).

## Recommendation
Roadmap item **F26** — v1 = option A (~1 session), v2 = option B when the
user-guide doc exists. Good beta-readiness multiplier: new-CEO onboarding is
exactly the Phase 8 audience.
