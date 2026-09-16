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
5. Backs up the shared state database with SQLite before any pending migrations, then runs new migrations in `migrations/`.
6. Re-renders systemd units if templates changed.
7. Restarts the eaios-* services.
8. Verifies the install (ports, endpoints, config files).
9. Records the outcome in the `eaios_update_log` table in `~/.hermes/state.db`.

**Why not automatic (OTA)?** EAiOS follows the approval-gate culture — state-changing actions are deliberate, never silent background updates. The Settings page shows the current build version and update history so you know what each box is running. If OTA is needed later, the update script exists and a systemd timer can wrap it, but the design doc (docs/design-update-path-2026-09-14.md) recommends staying with deliberate updates.

You can check the running version from within the EAiOS Settings page or via the API:
```bash
curl http://127.0.0.1:5200/api/version
```


### Update and rollback safeguards (2026-09-16)

- Commit or stash all tracked and untracked work before updating. The updater refuses a dirty repository and uses a process lock to prevent concurrent attempts.
- `git`, Node >=24, `npm`, `uv`, and `flock` must be available. The updater does not download tools through an unchecked installer pipeline.
- Every invocation rebuilds, restarts, and verifies, including an unchanged commit. This allows retrying an interrupted or failed deployment.
- Default updates preserve the shipped branch-update behavior. On a detached checkout, `EAIOS_BRANCH` or the remote default branch is used (falling back to `main`). Use `--to <published-tag>` to deploy a specific release. This is not a latest-tag or major-version selector.
- Rollback uses local Git objects, works offline, and returns to the pre-update revision of the latest code-changing update attempt. No-op updates and previous rollback operations cannot overwrite that rollback point.
- Logging and migration tools are copied outside the checkout for the duration of an attempt, so rolling back to an older release without those tools still finishes the audit log.
- Failures and interrupts record the failing stage and a completion timestamp. A failure does not automatically restore the checkout, services, or shared databases; inspect the history, then retry or run `./scripts/eaios-update.sh --rollback` deliberately.
- SQL migrations and their ledger entries are transactional. Pre-migration backups are retained in `~/.hermes/eaios-migration-backups/` (or beside an overridden `EAIOS_STATE_DB`). Code rollback retains the current shared database to avoid losing newer runtime records; migrations must remain compatible with older releases.
- Production version reporting is captured from the configured distribution directory at process startup. A rebuild does not change the version an existing process reports. Missing manifests and failed live requests show as unavailable. Only clean commits with a matching stable SemVer tag are labeled stable.
- Release creation rejects untracked work, runs application tests and a build, and updates both package metadata and the lockfile before tagging/pushing. Existing failing application tests must be fixed before a release can pass that gate.

## Weekly releases and safe updates

Settings includes **Check for updates** and a separate confirmed **Install update** action. The weekly background check only discovers published stable GitHub Releases. It never installs automatically. A pushed version tag must also be published as a GitHub Release to become discoverable.

First-box release preparation: commit the complete application, run the release helper for the chosen version (the existing 0.1.0 is supported for the first release), and publish the matching GitHub Release with notes. Confirm Settings can check GitHub successfully before shipping. Public repositories need no release-check token. Private repositories need a server-side read-only token in `EAIOS_GITHUB_TOKEN` or `$HERMES_HOME/eaios/github-token`; use mode 600 for the token file.

```bash
systemctl --user is-enabled eaios-update-check.timer
systemctl --user is-active eaios-update-check.timer
systemctl --user list-timers eaios-update-check.timer
journalctl --user -u eaios-update-check.service --no-pager -n 30
```

The timer checks weekly, remembers missed checks across reboots, and staggers boxes by up to twelve hours. Enable user lingering so checks and application services work without an interactive login.

Release installs stage independent code and dependencies under `~/.local/share/eaios/releases`. `EAIOS_DATA_ROOT` and `EAIOS_REPO_ROOT` keep pointing at the original installation; `HERMES_HOME` and any explicit absolute `EAIOS_KNOWLEDGE_DATA_DIR` retain their existing values. Box-specific files and shared databases remain in place. Online backups and installation status are private under `$HERMES_HOME/eaios`. Migrations must be additive and compatible with the previous release. Installation waits for an idle box and checks both dashboard build identities after activation.

After a failed installation, read Settings and the `eaios-release-install` journal. Preparation failures leave the running application untouched; activation failures attempt to restore and verify the previous services. An interrupted or unrecovered installation requires administrator inspection of deployment metadata and service paths before retry. Never restore shared database backups while writers are running or without reviewing work created since the backup. Retain releases and backups manually until a retention policy is implemented.

Once a box runs a staged release, use Settings for application updates. Rerunning bootstrap or the original checkout service installer can overwrite the active release paths. The older branch updater remains available for administrator support and is not the Settings installation mechanism.
