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
| 6 | Usage, Assistant (live chat + citation store), Artifacts, Env files | 🔄 6.1–6.4 ✅ 2026-08-27 |
| 7 | Packaging for other CEOs' boxes (prod server, systemd, installer) | ◻ future |

## Deferred-items register

Every known "not yet", with rationale and target. Add items here the moment
they're noticed — never leave them as tribal knowledge.

| # | Item | Why deferred | Target |
|---|---|---|---|
| F1 | **Playbook create/edit/new-version UI** | Versioning model is file+git; run/history path had to land first. Today: edit md on disk, bump version. | Phase 6 polish or 7 |
| F2 | **Skill enable/disable from EAiOS** | Hermes owns skill lifecycle (`skills.disabled` config); exec-UI toggle needs a config-write path + policy check. Decision needed: read-only library vs. exec control. | Phase 6 (decision), 7 (build) |
| F3 | **Skill authoring from EAiOS** | Authoring is the agent's job (Hermes `skills.manage`). Exec path should be "request skill" → delegated WorkItem to Ally, not a markdown editor. | Phase 7 |
| F4 | **Swarm playbook end-to-end run** | Needs a real competitor target + executive consent (spawns real agent work); verified only up to graph creation. | First real use |
| F5 | **Executive calendar live** | Needs user's one-time Google OAuth consent. | User action |
| F6 | **Composio app linking (Gmail etc.)** | Needs auth configs in Composio dashboard (account currently has 0 connected apps). | User action |
| F7 | **Morning briefing cron → Ally's Portal (7am)** | Explicit user consent pending. | User action |
| F8 | ~~Answer→chunk citation store~~ **DONE 2026-08-27 (6.4b)** — decision: the persisted chat message IS the record (no separate link store); `parseCitations` renders chips on Ally's answers → shared ChunkDrawer with real chunk text; end-to-end clickable, tested | — |
| F9 | **hermes serve + sidecar as systemd services** | Dev background procs today; fine while iterating. | Phase 7 packaging |
| F10 | **Prod discovery for skills/playbooks index** | Both ride vite dev middleware; packaging needs them served by the production server (or sidecar). | Phase 7 packaging |
| F11 | **Vectors/semantic retrieval** | FTS5-first decision locked 2026-08-26; vectors slot behind the same sidecar HTTP surface. | When FTS5 recall proves insufficient |
| F12 | **Preview-pane click harness flaky** | Hermes desktop delta engine loses sync; verify via vitest interaction tests instead. | External (Hermes) |
| F13 | **Retrieval enforcement for connector sources** | KnowledgeSource type 'connector' exists but no ingestion path (Composio-linked docs). | Phase 7+ |
| F14 | **Agent factory (spin up agents w/ model choice, OpenRouter)** | New exec requirement 2026-08-26. Host RPCs verified: `model.options` (live catalog), `profiles.create` (model+provider pin, mirror_credentials). | Phase 6.5 |
| F15 | ~~Usage budget config~~ **DONE 2026-08-26 (6.2)** — no host config-write RPC, so EAiOS-owned `~/eaios/settings.local.json` (gitignored) behind `/api/eaios-settings` middleware with a server-side key allowlist (`usageBudgetUsd`); `setUsageBudget` adapter method; Usage page inline budget editor | — |
| F16 | **Usage range picker** | 6.1 ships month-to-date only (fixture contract). Range UI (week/quarter/custom) is page polish once the slice is proven live. | Phase 7 polish |
| F17 | **Artifact attach-from-UI upload** | Needs multipart middleware + `kanban attach`; 6.3 shipped list/preview/download/share. Executives can attach via chat today. | Phase 7 |
| F18 | **Per-artifact archive + versioning** | Host has only destructive `attach-rm` and keeps no version history; per-artifact archive would need an EAiOS-side state store. | Phase 7+ / host feature |
| F19 | **Post-approval share execution** | 6.3 share creates the governed approval (decision record); actually sending after approval is the agent's work and needs an executor convention. | First real share |

## Open design decisions (need the executive)

- **D-open-1 (F2):** should the CEO be able to disable an agent's skill from the dashboard, or is the library strictly read-only + request-via-delegation?
- **D-open-2:** playbook edit UI — simple create/edit drawer, or stay file+git (developers edit, CEOs just run)?

## Process rule adopted 2026-08-26

The original §-numbered product spec lived only in chat sessions; 5.5 had to
recover §8.7/§8.8 from session history. From now on every phase brief lands
in `~/eaios/docs/` BEFORE the phase starts, and this register is updated in
the same commit as the phase it affects.
