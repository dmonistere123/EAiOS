# EAiOS — Phase 8 Brief: Packaging + Autoinstaller

**Written:** 2026-08-29, before Phase 8 starts (process rule 2026-08-26).
**Supersedes:** BUILD-PLAN-v2 §3 "Phase 8" sketch (this is the full plan).
**Companions:** HANDOFF.md (live state + gotchas), ROADMAP.md (F9/F10 target
here), this file's decisions register in ROADMAP.md on completion.

**Goal (Don, 2026-08-29):** a CEO has stock Hermes running on their box, on
whatever model/provider they want. They copy the EAiOS installer files over,
run one command, and get the full system we've built — prod server, systemd,
governance SOULs, knowledge sidecar, Telegram binding — with **their chosen
name for the main agent** as a first-class input ("pet name" is a selling
point). Proven end-to-end on a real second box.

---

## 1. Target machine (recon 2026-08-29)

**openclawserver** — tailnet `100.112.177.101`, root SSH via Tailscale SSH
(one-time tailnet-owner web check done; policy allows root only → installs
run under a created regular user, customers don't run as root).

| Fact | Value | Consequence |
|---|---|---|
| OS | Ubuntu 24.04.4 LTS, 8 cores, 15Gi RAM, 412G free | systemd path OK |
| Python | 3.12.3 | sidecar OK (≥3.11) |
| Node | **v22.23.2** | ⚠️ BELOW our ≥24 bar (`node:sqlite` unflagged). **Installer must provision Node ≥24** (NodeSource) or refuse with instructions — decided: provision with consent |
| Hermes | absent | full customer journey testable |
| Other | no openclaw binary in PATH; only tailscaled relevant | effectively clean |

## 2. Architecture: script does mechanics, agent does concierge

Two layers, strictly separated:

1. **`eaios-install` — deterministic, idempotent bash/python installer.**
   Anything the agent improvises can't be tested and drifts between installs.
   Every mutation is scripted, logged, and re-runnable (re-run = upgrade).
2. **`install-plan.md` — agent concierge.** Installed alongside; the
   customer's main agent reads it and walks the CEO through the *consent*
   steps in conversation (Telegram bot tokens, Google OAuth, Composio
   sign-in). This is the "show the Hermes agent the install plan" moment —
   the product introduces itself by name.

## 3. Prerequisites (customer box — becomes `PREREQUISITES.md`)

1. Linux with systemd (Ubuntu 24.04 verified target).
2. **Hermes installed and running** on the customer's chosen
   model/provider (Nous OpenRouter or their own keys). Installer NEVER
   touches model config.
3. Python ≥ 3.11 (knowledge sidecar).
4. Node ≥ 24 — installer provisions via NodeSource if missing/old (with
   consent) or exits with exact instructions (`--no-node-upgrade` to refuse).
5. Optional, gathered during concierge: Telegram bot tokens (one per agent
   the CEO wants on Telegram; names free-form), Composio API key, Google
   OAuth consent.
6. Tailscale optional (tailnet-only exposure pattern from this box).

## 4. Workstreams

### 8.1 Production server (closes F10)
One Node process replacing all vite dev middleware, zero new npm deps
(node:http + node:sqlite):
- static `dist/` serving + SPA fallback
- `/api/ws` → hermes serve WS proxy (token server-side)
- `/api/skills-index`, `/api/playbooks-index` (+PUT), `/api/skill-create`,
  `/api/usage`, `/api/artifacts`, `/api/eaios-settings`, `/api/profile-env`
  — lifted from vite.config.ts into shared `app/server/` modules (several
  already are: authoring.ts, profileEnv.ts)
- `/knowledge-api` → sidecar proxy, `/composio-api` → Composio (key
  server-side)
**Dogfood decision (recommended to Don): this box flips to the prod server
too** — we run what customers run. vite dev stays for frontend iteration.

### 8.2 systemd (closes F9)
User-mode units where possible: `hermes serve`, `knowledge-sidecar`,
`eaios-server`. Boot-enabled, restart-on-failure. Replaces dev background
procs + the vite-dev manual-restart pain.

### 8.3 The installer (`install/eaios-install`)
Idempotent; every step prints and logs. Steps:
1. **Detect** — Hermes present/running? version? profiles? (fail with exact
   fix instructions, never guess)
2. **Provision** — Node ≥24 check/upgrade; python venv for sidecar
   (pymupdf etc.)
3. **Name** — `--name "Rosie"` (or prompted): seeds the main agent's
   SOUL.md identity + display naming everywhere EAiOS derives it
   (verify where "Ally" display name comes from — profiles.list /
   description — before writing this step)
4. **Host config ownership** (gotchas #23–25): Composio MCP registration
   (tool_router session pattern, `auth_configs` per toolkit), governance
   SOUL block (`app/src/domain/governance.ts` is source of truth) into
   every profile, Telegram binding per profile `.env` (TELEGRAM_BOT_TOKEN,
   chmod 600, never echoed)
5. **Layout** — repo copy at `~/eaios` (or `--prefix`), playbooks/,
   knowledge sidecar + data dir, settings.local.json bootstrap,
   `.eaios-dev-token` equivalent (chmod 600)
6. **systemd** — install + enable + start units (8.2)
7. **Verify** — self-check: ports answer, WS auth works, sidecar indexes a
   smoke doc, `eaios://chunk/<id>` resolves; print PASS/FAIL per check
8. **Handoff** — write `install-plan.md` summary + first-run consent
   checklist; print exactly what to say to the agent ("Read
   ~/eaios/install-plan.md and walk me through the rest")

### 8.4 Docs
`PREREQUISITES.md` (from §3, verified against the clean box),
`INSTALL.md` (one command + flags), `install-plan.md` (agent concierge
script), `UPGRADE.md` (re-run semantics).

### 8.5 Clean-install proof (the gate)
On openclawserver, from stock Ubuntu + documented Hermes install:
1. Install Hermes per public docs (every command logged → feeds
   PREREQUISITES.md), configure Nous OpenRouter (**needs a key from Don —
   never copy this box's**), create regular user `eaios`.
2. Run `eaios-install --name <Don picks>` end-to-end.
3. Acceptance: app reachable (tailnet URL), chat with the renamed main
   agent works, delegation + approval loop executes, knowledge sidecar
   answers with citations, all self-checks PASS.

## 5. Explicitly NOT in Phase 8

- F16/F17/F20/F21 polish (range picker, artifact upload, playbook/skill
  lifecycle UI) — register unchanged.
- Multi-CEO isolation / update migrations beyond "re-run installer".
- Per-profile Telegram bot ACTIVATION automation beyond documented steps
  (bot activation is still `hermes -p <slug> gateway install && start` —
  installer documents/detects, doesn't daemon-manage gateways yet).

## 6. Order + testing

8.1 → 8.2 (dogfood on this box) → 8.3/8.4 → 8.5 gate. Rule 8 holds:
`npm test` + `npm run test:sidecar` green before every commit. Prod server
gets vitest node-env suites like the other `app/server/` modules. Every
Hermes-install command on the clean box is logged verbatim into docs.
