# EAiOS Settings — Review & Recommendations

**Date:** 2026-08-30 · **Author:** Ally (kanban t_0e583b16) · **Status:** recommendation, no code changed
**Sources reviewed:** `app/src/pages/Settings.tsx`, `app/server/apiCore.ts` (`/api/eaios-settings`), `app/src/domain/policies.ts`, original spec §8.11, `docs/ROADMAP.md` (F-register + D-open-1), `docs/BUILD-PLAN-v2.md`, HANDOFF.md gotchas, live `~/eaios/settings.local.json`.

---

## 1. What Settings controls today

The Settings page is currently the **thinnest page in the app** — four cards, only two of which actually change anything:

| Card | State | What it really does |
|---|---|---|
| Environment files | **LIVE** (6.2) | Edits allowlisted SOUL.md per profile via `profiles.describe`/`profiles.configure`, FNV version-checked save + audit toast. Secrets files never listed. This is the strongest card on the page. |
| Layout | **WORKS** | Resets pane width/collapse prefs (localStorage). Trivial but real. |
| Model defaults | **DISABLED — informational** | Greyed-out select. Per-agent model writes live in Staff → agent properties (6.5); a persisted default-for-new-agents doesn't exist. |
| Approval defaults | **HONEST MOCK** (badged) | Four disabled checkboxes reflecting hard-coded defaults in `domain/policies.ts`. No persistence, no save — correctly labeled as not live. |

Two more settings exist **but live outside the Settings page**:
- **Usage budget** (`usageBudgetUsd`, currently 500) — editable inline on the Usage page, persisted to `~/eaios/settings.local.json` via `/api/eaios-settings`. The server-side write allowlist contains **only** `usageBudgetUsd`.
- **Telegram bot token binding** per agent — lives in the Staff properties drawer (`/api/profile-env`, single allowlisted key).

One **shadow setting** exists: `telegramHomeChatId` in `settings.local.json` is *read* by `scripts/notify-completions.py` (completion-digest delivery target) but is **not in the write allowlist and has no UI anywhere** — it can only be set by hand-editing the JSON file.

## 2. Gaps vs spec §8.11 and the roadmap

Spec §8.11 requires: model defaults + allowed model list, approval defaults + policy switches, pane/layout prefs, agent/team settings, env-file editor with diff/validation/rollback, and **masked "configured" status for secrets**. Measured against that:

1. **Approval policy is not a setting.** `WorkspacePolicy` (`preApproved`, `userIsAdmin`) is a code constant (`DEFAULT_WORKSPACE_POLICY`). Don cannot tune the governance posture — e.g. pre-approve a specific recurring send — without a code edit. This is the biggest gap: the policy engine exists, the Settings surface for it doesn't.
2. **Model defaults missing.** No persisted default-for-new-agents; Add Agent drawer starts from a hard-coded choice.
3. **Secrets masked-status pattern absent.** Spec wants "configured / not configured" badges (Composio key, Hermes token, per-agent telegram tokens). Today that state is scattered across Staff drawers and `.env.local`.
4. **Env editor has no real diff or rollback.** The "diff" is a naive changed-lines dump; no version history (spec says "rollback/history if Hermes supports it" — Hermes doesn't, so EAiOS would own snapshots).
5. **Notification settings have no home.** Delivery target (shadow `telegramHomeChatId`), completion-digest cadence, morning-briefing consent/time (F7) are all unmanaged.
6. **F2 / D-open-1 (skill enable/disable) is an open executive decision** that lands in Settings either way.
7. **Phase 7/8 packaging needs install-scoped settings** (company name, executive identity, branding) — the installer must own host config (HANDOFF #23); a Settings "Workspace" category is where that surfaces.

## 3. Proposed Settings surface

Organized by category, priority P0 (host surface already exists — honest to ship now) → P2 (needs host features or decisions).

### P0 — ship first (everything writeable rides the existing `settings.local.json` + allowlist pattern)

**A. Notifications & delivery** *(new category)*
- Telegram home chat ID — promote `telegramHomeChatId` into the allowlist + UI (the notify script already reads it).
- Completion digest: on/off + cadence (drives the notify-completions cron).
- Morning briefing: enable/disable + time (closes F7's consent question in the UI instead of chat).

**B. Budgets & usage**
- Move/mirror the budget editor here (stay on Usage too) — one allowlisted key, trivial.
- Budget alert threshold (% of budget that triggers a warning badge/telegram).

**C. Approval policy** *(converts the mock card to real)*
- Persist `workspacePolicy` in `settings.local.json`; `evaluateAction` reads it instead of the constant.
- UI: the four existing toggles become real, plus a **pre-approved automations list** (connector + action type + target system) — this is how Don says "the Monday investor email may send unattended" without weakening the global gate. Keeps D3 conservative defaults as the shipping preset.

**D. Model defaults**
- `defaultModel` in settings.local.json, consumed by the Add Agent drawer; validated against the live `model.options` catalog like 6.5 does.

### P1 — next (needs small server work or an executive decision)

**E. Secrets status** — read-only "configured ✓ / not set" badges: Composio key, Hermes token, per-agent telegram tokens (existence-only reads already exist in `/api/profile-env`). Spec-required, never shows values.

**F. Env-file history** — server keeps last N snapshots of each allowlisted file on save; rollback = restore snapshot through the same version-checked write path.

**G. Agents & team** — aggregate the scattered per-agent config: telegram bot binding (link out to Staff), per-agent model (already live), skill enable/disable **pending D-open-1 — needs Don's decision**: exec-controlled toggles vs read-only library + request-via-delegation.

### P2 — later (host features / packaging)

**H. System health** — read-only diagnostics card: eaios-* systemd units, hermes serve, knowledge sidecar, degraded slices. Pure read; very useful for dogfooding.
**I. Workspace identity (Phase 7/8 packaging)** — company name, executive name, branding tokens; the installer writes them, Settings displays/edits them. Required for multi-CEO packaging (D2).
**J. Layout** — keep the reset; theme/density only if ever requested.

### Explicitly NOT recommended
- **Generic Hermes config.yaml editing.** No config-write RPC exists (HANDOFF #15); hand-rolled YAML writes would violate "never fake, never bypass the host." Only surfaces with a real write path get a control.
- **Raw approval-envelope authoring in Settings.** Approvals belong in the governed loop, not a config page.

## 4. Suggested sequencing

1. **P0-A/B/D** — pure allowlist additions + small UI; one focused task, low risk (est. risk 2-3, complexity 3).
2. **P0-C (policy persistence)** — touches the governance engine; do it alone with policy tests green (risk 4, complexity 4). Highest executive value: makes the approval gate tunable without code edits.
3. **D-open-1 decision from Don** gates P1-G.
4. P1-E/F and P2 batch with Phase 7 polish / Phase 8 packaging respectively.
