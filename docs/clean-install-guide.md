# EAiOS Clean-Box Install Guide — v1 (manual)

**Purpose:** take a wiped machine from bare Ubuntu to a running AI Office —
Hermes + your named main agent + 4 specialists (research, dev, writing,
social) + Telegram — exactly as a new customer would. **Time every phase**;
the totals price the install fee. Where you stumble, write it down — stumbles
are guide bugs.

**Audience:** the installer (you, playing customer). No prior Hermes knowledge
assumed. Every command is copy-paste exact.

**The box:** fresh Ubuntu 24.04 LTS, 8+ GB RAM, 40+ GB disk, internet access.
(Verified target: openclawserver, 100.112.177.101.)

**You will need before starting:**
- [ ] The machine rebuilt with Ubuntu 24.04 and a sudo user
- [ ] Your Telegram account (phone in hand)
- [ ] A model provider: **Nous Portal subscription** (recommended — bundles
      model + tools in one OAuth sign-in) **or** an OpenRouter API key
- [ ] Names picked: one pet name for your main agent (anything — "Rosie",
      "Max", "Alfred") + 4 specialist names (defaults below: research, dev,
      writing, social)
- [ ] A stopwatch

---

## Phase 1 — Tailscale (target: 10 min)

Tailscale is how you (and Ally) reach the box securely from anywhere.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

- Follow the login URL it prints; sign in with your tailnet account.
- Verify: `tailscale status` — the box appears with a 100.x address.
- **Enable Tailscale SSH** (so Ally can help on this box later):
  `sudo tailscale up --ssh` (or `tailscale set --ssh`).
- ✅ CHECKPOINT: note the time and the box's 100.x address.

## Phase 2 — Hermes install (target: 10 min)

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

- Open a NEW shell (or `source ~/.bashrc`) so `hermes` is on PATH.
- Verify: `hermes --version` then `hermes doctor` — resolve anything red.
- ✅ CHECKPOINT: note the time.

## Phase 3 — Model provider (target: 5 min)

**Option A — Nous Portal (recommended):**

```bash
hermes auth add nous
```

- Follow the device-code login in your browser. This bundles the model and
  tool providers in one step.

**Option B — OpenRouter API key:**

```bash
hermes config env-path        # shows the .env path (usually ~/.hermes/.env)
echo 'OPENROUTER_API_KEY=sk-or-...your key...' >> ~/.hermes/.env
chmod 600 ~/.hermes/.env
```

Then pick the default model:

```bash
hermes model                  # interactive picker — choose provider + model
```

- Test the brain: `hermes chat -q "Reply with exactly: SYSTEMS ONLINE"`
- ✅ CHECKPOINT: note the time + which model you chose.

## Phase 4 — Name your main agent (target: 5 min)

Your main agent's identity lives in `~/.hermes/SOUL.md`. Replace its contents
with (adjust the name and flavor — this is the pet-name moment):

```markdown
# SOUL — <YourAgentName>

You are <YourAgentName>, the executive's chief of staff and the orchestrator
of a small AI staff. You are direct, warm, and honest. You delegate
specialist work to your staff agents and you never bypass the approval gate
for external actions.
```

```bash
nano ~/.hermes/SOUL.md      # paste, save (Ctrl+O, Enter, Ctrl+X)
hermes chat -q "What is your name and role?"
```

- The agent should answer with its new name. If it doesn't, check for typos.
- ✅ CHECKPOINT: note the time + your agent's name.

## Phase 5 — Telegram: main agent bot (target: 15 min)

**In Telegram (phone or desktop):**

1. Open **@BotFather** → send `/newbot`
2. Display name: your agent's pet name (e.g. `Rosie`)
3. Username: must be unique and end in `bot` (e.g. `rosie_eaios_bot`)
4. **Copy the API token** BotFather replies with — treat it like a password.
5. Optional but nice: `/setuserpic`, `/setdescription`, `/setabouttext`.
6. Get YOUR numeric user id: message **@userinfobot** — it replies instantly.

**On the box:**

```bash
hermes gateway setup
```

- Choose **Telegram**, paste the bot token, enter your user id from
  @userinfobot as an allowed user. Let it write config.

Then install the gateway as a background service and start it:

```bash
hermes gateway install
hermes gateway start
hermes gateway status
```

**Test:** send your bot a Telegram DM: *"Who are you?"* — it should answer
with its pet name and role.

**Recommended: your Portal group** (a group chat with you + the bot — this is
how execs use it day to day):
1. In Telegram: New Group → name it (e.g. "Rosie's Portal") → add your bot.
2. In the group, send `/sethome` — the bot adopts it as home channel.
3. If the bot doesn't respond in-group: @BotFather → `/mybots` → your bot →
   Bot Settings → Group Privacy → **Turn off**, then remove + re-add the bot
   to the group (Telegram caches the old setting).
- ✅ CHECKPOINT: note the time + bot username + group name.

## Phase 6 — The four specialists (target: 20 min)

Repeat per specialist: **research**, **dev**, **writing**, **social**
(rename freely — these become the staff in your AI Office).

**Per agent, on the box** (example: research):

```bash
hermes profile create research --clone --description "Research analyst on the executive AI staff — finds, verifies, and cites information."
```

`--clone` copies the main agent's config, credentials, SOUL.md and skills so
the specialist can infer out of the box (we overwrite identity + bot token
next). `--description` matters: the kanban decomposer routes delegated tasks
by role, so make it one clear sentence about what the agent is good at.

```bash
nano ~/.hermes/profiles/research/SOUL.md
```

SOUL seed for each (adjust name/role):

```markdown
# SOUL — <Name>

You are <Name>, the <research analyst | software developer | writer |
social-media manager> on the executive's AI staff. You take direction from
the chief-of-staff orchestrator. You log non-trivial work to the kanban
board, you never perform external writes without an approved task, and you
deliver results as kanban artifacts plus a Telegram message.
```

**Per agent, in Telegram:** @BotFather → `/newbot` → display name (e.g.
"Research — AI Office") → username (e.g. `aioffice_research_bot`) → copy
the token. Suggested usernames: `*_research_bot`, `*_dev_bot`,
`*_writing_bot`, `*_social_bot` — whatever reads well next to your pet name.

**Bind each bot to its profile** (write the token into the profile's .env —
never echo it into chat/logs). ⚠️ **Required, not optional:** `--clone`
copied the MAIN agent's .env, including its bot token — if you skip this,
two gateways will fight over the same bot.

```bash
nano ~/.hermes/profiles/research/.env
# find the TELEGRAM_BOT_TOKEN line and REPLACE it with this profile's own bot token
chmod 600 ~/.hermes/profiles/research/.env
hermes -p research gateway install
hermes -p research gateway start
hermes -p research gateway status
```

**Test each:** DM each specialist bot — it should answer in character.
Add all four to your Portal group if you want the full "AI office floor"
effect (same Group Privacy note as Phase 5).

- ✅ CHECKPOINT: note the time. Record all 5 bot usernames somewhere safe.

## Phase 7 — Acceptance checklist

- [ ] `hermes doctor` clean
- [ ] Main agent answers on Telegram with its pet name
- [ ] All 4 specialists answer on Telegram in character
- [ ] Portal group works: every bot responds there
- [ ] `hermes profile list` shows default + 4 profiles
- [ ] Services survive reboot: `sudo reboot`, then
      `hermes gateway status` and `hermes -p research gateway status` (etc.)

## Phase 8 — EAiOS dashboard (one-command installer)

The EAiOS executive dashboard is installed with the automated installer in the
`eaios` repo. It handles Node.js, Hermes setup, repo clone, dependency install,
production build, systemd user units, first-run config, and service startup.

### From a fresh box that already has Hermes and a model provider

If you followed phases 1–7, you already have Hermes. Add the EAiOS repo and run
the installer:

```bash
# One-command (replace with the real EAiOS repo URL):
curl -fsSL https://<your-host>/eaios/install/install.sh | bash -s -- \
  --repo-url=https://github.com/<org>/eaios.git
```

### Local usage (e.g. Ally developing on this box)

```bash
cd ~/eaios
./install/install.sh
```

The installer is idempotent — safe to re-run after pulling updates. It will not
overwrite an existing `app/.env.local`.

### After install

- Services run as systemd user units: `eaios-hermes-serve` (:9119),
  `eaios-knowledge-sidecar` (:9121), `eaios-server` (:5200), and
  `eaios-server-5173` (:5173).
- Verify anytime: `~/eaios/scripts/verify-install.sh`
- Add live API keys to `~/eaios/app/.env.local` if you want live providers
  (Composio, Duffel, etc.).
- For boot persistence without an interactive login:
  `sudo loginctl enable-linger $USER`

---

## When you're done

Send Ally (Telegram or EAiOS chat):
1. Your **per-phase timings** and total
2. Every **stumble point** verbatim (command + what happened)
3. The 5 bot usernames + agent names

These feed the install-fee pricing and turn this guide into the automated
installer (`eaios-install`) — the manual steps you just walked ARE the
installer's specification.

*Guide v1, 2026-08-29 — commands verified against hermes-agent docs
(install.sh, gateway setup/install, profile create, BotFather flow). EAiOS
section pending Phase 8.1/8.2.*

## First deployed box: release checks

Before shipment, publish the tested version as a GitHub Release, confirm Settings shows a successful manual check and the expected current build, and verify eaios-update-check.timer is enabled and active. A version tag without a published Release is insufficient. Check user lingering and reboot persistence. Weekly checks never install; installation requires the separate Settings confirmation. See INSTALL.md for persistent paths and recovery.
