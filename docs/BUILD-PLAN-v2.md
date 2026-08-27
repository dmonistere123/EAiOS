# EAiOS — Build Plan v2 (post-Phase-5 baseline)

**Supersedes:** session-held phase notes. **Upstream contract:** the original
build planner, now committed at `docs/reference/Executive_AI_Operating_System_Coding_Agent_Build_Planner.docx`
(§-references below point there). **Companions:** `HANDOFF.md` (live state +
gotchas), `ROADMAP.md` (deferred-items register F1–F13 — kept current in
code commits). **Written:** 2026-08-26, after Phase 5 completion.

How to use this file: start work at the first unchecked phase item. When you
defer anything, add it to ROADMAP.md's register in the same commit. Do not
re-open locked decisions without the executive.

---

## 1. Where we actually are (honest audit vs. spec §8)

| Spec § | Feature | State | Gap to spec |
|---|---|---|---|
| 8.1 | Today | ✅ live (kanban summary, queue, delegation) | "Dismiss recommendation" action unverified; empty-state variants not scenario-tested |
| 8.2 | My Assistant | ⏳ mock | **Biggest remaining build.** Live chat, orchestration plan panel, approval forecast, evidence links — all pending |
| 8.3 | Staff | 🟡 live read (profiles + active sessions) | Config writes fall back to mock (`profiles.configure` not wired); stale/offline threshold untested |
| 8.4 | Connections | ✅ live (Composio v3; account empty) | User action: link apps in Composio dashboard (F6) |
| 8.5 | Approvals | ✅ live (kanban envelope; inspector w/ evidence/diff/rollback) | Decision history view; expiry handling (§8.5 edge cases) |
| 8.6 | Schedule | 🟡 hybrid (cron live, calendar mock) | Google OAuth (F5); timezone/DST tests (§8.6 acceptance) |
| 8.7 | Knowledge | ✅ live + retrieval/citations/scope enforcement | **Deviation:** indexing is synchronous (spec wants async) — fine at executive scale, revisit on bulk import. Connector-type ingestion missing (F13) |
| 8.8 | Skills & Playbooks | 🟡 live core | Playbook detail view (ordered steps, approval checkpoints), safe-mode Test Run, Publish/Duplicate/Archive (F1); skill enable/disable decision (F2) |
| 8.9 | Artifacts | ⏳ mock | Whole slice: provenance, preview, governed share |
| 8.10 | Usage | ⏳ mock | Whole slice; D7 locked (estimated + actual via `insights.get` / state.db) |
| 8.11 | Settings | 🟡 env-file editor exists (mock, optimistic concurrency tested) | Live read/write path + allowlist (D4) not wired; models/policy sections mock |

**Infra already at or beyond spec:** right rail (§7) live · policy evaluator (§9)
with tests · event-driven refresh (§4.4) via gateway notifications ·
AuditResult contract (§10.1) everywhere · no-secrets rules (§2, §15) held
(proxy-injected keys, gitignored env, chmod 600).

**Test coverage vs §14:** unit + integration ✅ (30 vitest + 8 sidecar) ·
mock scenario suite S1–S10 (§13) partial — fixtures exist, named scenarios
not built · **E2E journeys §14.3 ❌** · **accessibility suite §14.4 ❌**
(roles/labels present, no systematic pass).

## 2. Locked decisions (carried from HANDOFF)

D1 Today absorbs Work · D2 standalone app (not desktop plugin) ·
D3 conservative external-write approvals · D5 no fabricated progress % ·
D7 usage = estimated + actual, labeled · Staff model: Hermes profiles =
agents · Approvals stay UNASSIGNED in kanban · Knowledge: sidecar + FTS5,
vectors later · Citation contract: `eaios://chunk/<id>`.
Open: F2 (skill enable/disable), playbook edit UI shape — see ROADMAP.md.

## 3. Phase plan v2

### Phase 6 — remaining slices live (spec §11.7 + strays)
Order: smallest risk-first; each lands with mock parity + tests.

1. **6.1 Usage → live** (§8.10, §8.11 partial): `insights.get` RPC probe →
   state.db `session_model_usage` fallback; totals, by-agent, freshness
   label, estimate-vs-authoritative labeling. No new services. **Start here.**
2. **6.2 Settings/env files → live** (§8.11): allowlisted .MD/.TXT via
   gateway (D4 allowlist recorded in repo); expectedVersion concurrency
   already specified by mock tests. Config writes audited.
3. **6.3 Artifacts → live** (§8.9): provenance (agent + work item), list,
   preview/download; candidate backing: kanban attachments + artifact
   envelope. Governed share (approval route) per §8.9.
4. **6.4 Assistant → live** (§8.2): live chat with Ally via gateway, plan
   panel, approval forecast; **answer→chunk citation store** completing
   §8.7 end-to-end (F8). Largest item — consider splitting 6.4a chat /
   6.4b citations.
5. **6.5 Agent factory — "spin up new agents on any model"** (§8.3 Add
   Agent; exec request 2026-08-26). Verified host surface:
   - `model.options` RPC → live provider/model catalog (OpenRouter is a
     first-class routable provider — one key, many models).
   - `profiles.create` RPC → `name`, `description`, `clone_from`, `soul`
     (SOUL.md seed), `model` + `provider` pin, `mirror_credentials`
     (default true — the new agent can infer out of the box).
   - UI: Staff → Add Agent drawer (name/role/model picker from
     `model.options`, grouped by provider) → adapter `createAgent()` →
     card appears via existing `profiles.list`. Model write validation +
     audit event per §8.3 acceptance.
   - "Ask Ally" path: a WorkItem instructing Ally to create a profile via
     `hermes profiles` CLI — goes through the governed loop (audit trail
     free). Register the policy rule: profile creation = config write,
     `config.changed` audit; no approval gate by default (D3 covers
     external writes, not internal config) unless the exec wants one.

### Phase 7 — hardening + release candidate (spec §11.8, §14.3–14.4, §21)
- Accessibility pass (§14.4): keyboard nav, focus rings, table semantics,
  Escape handling — plus tests.
- Performance (§15): list virtualization for activity/artifacts; 100+ row
  event-rate profile.
- E2E executive journeys (§14.3): morning review, investigate lag, schedule
  automation, ground-a-request, admin change — headless where possible.
- Mock scenario suite S1–S10 (§13) as named fixture scenarios.
- Editing surfaces from the register: F1 playbook edit UI, F2/F3 skill
  controls (decision-dependent).
- Release-readiness checklist §21 walked item by item.

### Phase 8 — packaging for other CEOs (new; user's strategic goal)
- Production server replacing vite dev middleware (F10: skills-index,
  playbooks-index, /api/ws, /knowledge-api, /composio-api in one process).
- systemd units for hermes serve + knowledge sidecar (F9).
- Installer/bootstrap: profile seed (ALLY.md), token + key bootstrap,
  first-run OAuth checklist (Google, Composio).
- Update path: git pull + migrations; per-CEO workspace isolation.

## 4. Working rules (ratified from spec §18 + ROADMAP process rule)

1. Phase brief lands in `docs/` BEFORE the phase starts.
2. Deferrals register in ROADMAP.md in the same commit that creates them.
3. Mock parity: every live adapter method has mock behavior + contract test.
4. Never fabricate host capability; document the gap and stop that slice.
5. No secrets in DOM, URLs, logs, git, or client persistence.
6. External writes gate on the approval evaluator — no page-level shortcuts.
7. Verify against the live box before claiming "live" (probe RPC shapes
   first — they drift from docs).
8. `npm test` + `npm run test:sidecar` green before every commit.

## 5. Blocked-on-user (unchanged)

- Morning briefing cron → Ally's Portal 7am: **consent pending** (F7).
- Google Calendar OAuth: one-time consent (F5).
- Composio app linking: auth configs in dashboard (F6).

---

*To resume in a new session: "Continue EAiOS — read ~/eaios/docs/HANDOFF.md
and ~/eaios/docs/BUILD-PLAN-v2.md" — HANDOFF has live-process state and
gotchas; this file has scope and order.*
