# EAiOS — Build Roadmap (living document)

**Purpose:** the single source of truth for what's built, what's deferred, and
why. HANDOFF.md carries session state and gotchas; THIS file carries scope
decisions. Update it every phase — an item that isn't here doesn't exist.

**Governance invariants (never defer these):** pages talk only to typed
adapters · mock-first per slice with live fallback · no secrets in the client
bundle · external writes gate on approvals · honest degradation over fake
success (spec §2) · tests green before commit.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Integration matrix, repo, design tokens | ✅ |
| 1 | Executive shell, 11 routes, mock adapters | ✅ |
| 2 | Live adapter (agents, cron, activity) + seq-guarded runtime | ✅ |
| 3 | Governed work loop: kanban WorkItems, approvals, policies (§9) | ✅ |
| 4 | Schedule (live cron overlay + create), Connections (Composio) | ✅ |
| 5 | Skills, Knowledge/RAG + citations, Playbooks, acceptance | ✅ 2026-08-26 |
| 6 | Usage, Assistant (live chat + citation store), Artifacts, Env files, Agent factory | ✅ 2026-08-27 |
| 7 | Packaging for other CEOs' boxes (prod server, systemd, installer) | ◻ future |

## Deferred-items register

Every known "not yet", with rationale and target. Add items here the moment
they're noticed — never leave them as tribal knowledge.

| # | Item | Why deferred | Target |
|---|---|---|---|
| F1 | ~~Playbook create/edit/new-version UI~~ **DONE 2026-08-28 (W7)** — editor drawer → confined PUT via `/api/playbooks-index` (`app/server/authoring.ts`); server-side patch bump; published edits land as new drafts. Remainder → F20 | — |
| F2 | **Skill enable/disable from EAiOS** | Hermes owns skill lifecycle (`skills.disabled` config); exec-UI toggle needs a config-write path + policy check. Decision needed: read-only library vs. exec control. | Phase 6 (decision), 7 (build) |
| F3 | ~~Skill authoring from EAiOS~~ **SUPERSEDED by D-B3 (2026-08-27) → create DONE 2026-08-28 (W7)** — D-B3 locked full in-app editing for user-created skills; W7 shipped the create drawer → confined POST `/api/skill-create` (slug/category validation, overwrite refused). Edit/delete → F21 | — |
| F4 | **Swarm playbook end-to-end run** | Needs a real competitor target + executive consent (spawns real agent work); verified only up to graph creation. | First real use |
| F5 | **Executive calendar live** | Needs user's one-time Google OAuth consent. | User action |
| F6 | **Composio app linking — NARROWED 2026-08-28 (W4)** | Managed auth configs proved API-creatable; W4's connect flow (auth config → Connect Link → hosted sign-in) ships in-app. Dashboard/custom auth config still needed only for bring-own-auth toolkits. | User action (bring-own-auth only) |
| F7 | **Morning briefing cron → Ally's Portal (7am)** | Probe 2026-08-28: the job EXISTS ("Morning Breifing", weekdays 7am, telegram deliver, last run OK, created 2026-08-26) — consent apparently given. Confirm with user; leave untouched meanwhile. | Confirm with user |
| F8 | ~~Answer→chunk citation store~~ **DONE 2026-08-27 (6.4b)** — decision: the persisted chat message IS the record (no separate link store); `parseCitations` renders chips on Ally's answers → shared ChunkDrawer with real chunk text; end-to-end clickable, tested | — |
| F9 | **hermes serve + sidecar as systemd services** | Dev background procs today; fine while iterating. | Phase 7 packaging |
| F10 | **Prod discovery for skills/playbooks index** | Both ride vite dev middleware; packaging needs them served by the production server (or sidecar). | Phase 7 packaging |
| F11 | **Vectors/semantic retrieval** | FTS5-first decision locked 2026-08-26; vectors slot behind the same sidecar HTTP surface. | When FTS5 recall proves insufficient |
| F12 | **Preview-pane click harness flaky** | Hermes desktop delta engine loses sync; verify via vitest interaction tests instead. | External (Hermes) |
| F13 | **Retrieval enforcement for connector sources** | KnowledgeSource type 'connector' exists but no ingestion path (Composio-linked docs). | Phase 7+ |
| F14 | ~~Agent factory~~ **DONE 2026-08-27 (6.5)** — model.options grouped catalog + profiles.create (mirror_credentials default) behind `createAgent`; Staff → Add Agent drawer (slug validation, optgroup picker, SOUL seed); updateAgentConfig live for model writes (catalog-validated → profiles.configure); verified live (create/configure/delete round-trip) | — |
| F15 | ~~Usage budget config~~ **DONE 2026-08-26 (6.2)** — no host config-write RPC, so EAiOS-owned `~/eaios/settings.local.json` (gitignored) behind `/api/eaios-settings` middleware with a server-side key allowlist (`usageBudgetUsd`); `setUsageBudget` adapter method; Usage page inline budget editor | — |
| F16 | **Usage range picker** | 6.1 ships month-to-date only (fixture contract). Range UI (week/quarter/custom) is page polish once the slice is proven live. | Phase 7 polish |
| F17 | **Artifact attach-from-UI upload** | Needs multipart middleware + `kanban attach`; 6.3 shipped list/preview/download/share. Executives can attach via chat today. | Phase 7 |
| F18 | **Per-artifact archive + versioning** | Host has only destructive `attach-rm` and keeps no version history; per-artifact archive would need an EAiOS-side state store. | Phase 7+ / host feature |
| F19 | **Post-approval share execution** | 6.3 share creates the governed approval (decision record); actually sending after approval is the agent's work and needs an executor convention. | First real share |
| F20 | **Playbook duplicate / archive / safe-mode Test Run** | W7 shipped create/edit/versioning; these lifecycle actions remain (rest of old F1). | Phase 7 polish |
| F21 | **Skill edit/delete in-app** | W7 scoped skills to create-only (plan); D-B3's "full editor" completes here. Needs the same confined-write pattern + skills.manage has no update RPC, so middleware-owned. | Phase 7 polish |

## Open design decisions (need the executive)

- **D-open-1 (F2):** should the CEO be able to disable an agent's skill from the dashboard, or is the library strictly read-only + request-via-delegation?
- ~~D-open-2: playbook edit UI — simple create/edit drawer, or stay file+git?~~ **RESOLVED by D-B3 (2026-08-27):** drawer, built in W7.

## Process rule adopted 2026-08-26

The original §-numbered product spec lived only in chat sessions; 5.5 had to
recover §8.7/§8.8 from session history. From now on every phase brief lands
in `~/eaios/docs/` BEFORE the phase starts, and this register is updated in
the same commit as the phase it affects.
