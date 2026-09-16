# EAiOS Installer

One-command setup for a fresh CEO box.

## Prerequisites

- Linux (Ubuntu 24.04 / Debian 12 tested). macOS may work with minor path tweaks.
- `git`, `curl`, `sudo`
- Internet access to pull Node.js, Hermes, and the EAiOS repo

## Quick start

```bash
# Fresh box with nothing installed:
curl -fsSL https://raw.githubusercontent.com/dmonistere123/EAiOS/main/install/install.sh | bash -s -- \
  --repo-url git@github.com:dmonistere123/EAiOS.git

# Or from a USB/local copy of the repo:
./install/install.sh

# Non-interactive (use defaults):
./install/install.sh --non-interactive --agent-name "Ally"
```

The installer:

1. Checks OS and basic tools.
2. Ensures Node.js >= 24 is installed.
3. Ensures Hermes Agent is installed.
4. Clones or uses the EAiOS repo.
5. Runs `npm ci` and `npm run build`.
6. Sets up the sidecar Python venv (`sidecar/.venv`) with knowledge + podcast dependencies from `sidecar/requirements.txt`.
7. Generates a dev token and creates `app/.env.local` from the template.
8. Creates `sidecar/.env` from `sidecar/.env.example` for optional Podcast TTS/provider keys.
9. Renders and installs systemd user units.
10. Starts services and runs verification probes.

## Agent name

During install you will be prompted:

```
Name your orchestration agent [Ally]:
```

Whatever you enter becomes the display name throughout the EAiOS UI (chat header, placeholders, travel assistant, cron prompts, etc.). It is written to `app/.env.local` as `VITE_AGENT_NAME`.

To skip the prompt in automation:

```bash
./install/install.sh --non-interactive --agent-name "Jarvis"
```

## After install

1. **Edit `.env.local`** with real credentials:
   ```bash
   nano ~/eaios/app/.env.local
   ```
2. **Edit `sidecar/.env`** with optional podcast/TTS provider keys:
   ```bash
   nano ~/eaios/sidecar/.env
   systemctl --user restart eaios-knowledge-sidecar
   ```
   Keys: `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLOUD_PROJECT` + `GOOGLE_APPLICATION_CREDENTIALS`. Edge TTS works without a key.
3. **Enable boot persistence** (optional, recommended for a headless appliance):
   ```bash
   sudo loginctl enable-linger $USER
   ```
3. **Check services**:
   ```bash
   systemctl --user status 'eaios-*'
   ```
4. **Open the app**:
   ```bash
   xdg-open http://127.0.0.1:5200
   ```

## Options

| Flag | Description |
|------|-------------|
| `--repo-url <url>` | Git URL to clone (required when curl-piped). |
| `--branch <name>` | Branch to checkout (default: master). |
| `--root <path>` | Install location (default: `~/eaios`). |
| `--agent-name <name>` | Display name for the orchestration agent. |
| `--non-interactive` | Never prompt; use defaults or flags. |
| `--skip-node` | Skip Node installation check. |
| `--skip-hermes` | Skip Hermes installation check. |
| `--run-tests` | Run `npm test` after build. |

## Environment template

`app/.env.local.example` is the canonical template for a fresh install, and `sidecar/.env.example` is the canonical template for sidecar provider keys. Keep both up to date when you add required environment variables.

## Distributing EAiOS

For distribution to a fresh box:

1. Push updates to the GitHub repo.
2. On the fresh box, run:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/dmonistere123/EAiOS/main/install/install.sh | bash -s -- \
     --repo-url git@github.com:dmonistere123/EAiOS.git
   ```

Or ship a tarball/USB containing the repo and run `./install/install.sh` from it.

## Updating a shipped box

Already-installed CEO boxes can be updated deliberately (not automatically) via:

```bash
cd ~/eaios
./scripts/eaios-update.sh
```

The update wrapper:
1. Records the current version/git SHA.
2. Pulls the latest code from the configured branch.
3. Rebuilds the app (regenerates `version.json`).
4. Refreshes the sidecar Python venv.
5. Runs any new migrations in `migrations/`.
6. Re-renders systemd units if templates changed.
7. Restarts the eaios-* services.
8. Verifies the install (ports, endpoints, config files).
9. Records the outcome in the `eaios_update_log` table in `~/.hermes/state.db`.

**Why not automatic (OTA)?** EAiOS follows the approval-gate culture — state-changing actions are deliberate, never silent background updates. The Settings page shows the current build version and update history so you know what each box is running. If OTA is needed later, the update script exists and a systemd timer can wrap it, but the design doc (docs/design-update-path-2026-09-14.md) recommends staying with deliberate updates.

You can check the running version from within the EAiOS Settings page or via the API:
```bash
curl http://127.0.0.1:5200/api/version
```
