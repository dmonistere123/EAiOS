# EAiOS Installer

One-command setup for a fresh CEO box that already has Hermes Agent installed.

## Prerequisites

- Linux (Ubuntu 24.04 / Debian 12 tested). macOS may work with minor path tweaks.
- Node.js >= 24
- `git`, `curl`
- `uv` (for the Python knowledge sidecar venv)
- Hermes Agent installed and on PATH (`hermes --version` works)

## Quick start

```bash
# From inside the EAiOS repo on the source box / USB / mounted drive:
./scripts/install-eaios.sh

# Or clone from a git remote:
./scripts/install-eaios.sh --git-url https://github.com/your-org/eaios.git

# Or install from a local source tree to a custom location:
./scripts/install-eaios.sh --source-dir /path/to/eaios --install-dir /opt/eaios
```

The default install directory is `~/eaios`. The installer:

1. Validates Node >= 24 and Hermes.
2. Places EAiOS source at the install directory.
3. Runs `npm ci` and `npm run build`.
4. Sets up the sidecar Python venv (`sidecar/.venv`).
5. Creates `app/.env.local` from `app/.env.local.example` if missing.
6. Renders and installs systemd user units.
7. Starts services and verifies `:5200` responds.

## After install

1. **Edit `.env.local`** with real credentials:
   ```bash
   nano ~/eaios/app/.env.local
   ```
2. **Enable boot persistence** (optional, recommended for a headless appliance):
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
| `--source-dir <path>` | Copy from a local directory instead of the script's parent. |
| `--git-url <url>` | Clone from a git remote instead of copying. |
| `--install-dir <path>` | Install location (default: `~/eaios`). |
| `--no-start` | Install units but do not start services. |
| `--skip-systemd` | Skip systemd unit installation entirely (testing only). |

## Environment template

`app/.env.local.example` is the canonical template for a fresh install. Keep it up to date when you add required environment variables.

## Distributing EAiOS

For distribution to a fresh box:

1. Add a git remote and push `master`.
2. On the fresh box, install Hermes Agent and Node.js >= 24.
3. Run:
   ```bash
   curl -fsSL https://your-org.github.io/eaios/install.sh | bash -s -- --git-url https://github.com/your-org/eaios.git
   ```

Or ship a tarball/USB containing the repo and run `./scripts/install-eaios.sh --source-dir .` from it.
