#!/usr/bin/env bash
# EAiOS one-command installer for a fresh CEO box (Ubuntu/Debian first).
#
# What it does:
#   1. Checks OS and installs system prerequisites (build-essential, xz-utils, python3).
#   2. Ensures Node.js >= 24 is installed (via NodeSource or binary tarball).
#   3. Ensures Hermes Agent (CLI) is installed.
#   4. Optionally installs Hermes Desktop (Electron app for the GUI agent).
#   5. Clones or updates the EAiOS repo.
#   6. Installs app npm dependencies and builds the production bundle.
#   7. Creates the Python sidecar venv and installs knowledge + podcast deps.
#   8. Creates ~/.hermes/.eaios-dev-token and app/.env.local on first run.
#   9. Creates sidecar/.env with all provider key placeholders.
#  10. Renders and enables systemd user units.
#  11. Enables systemd linger for boot persistence.
#  12. Starts the eaios-* services.
#  13. Runs verification probes.
#
# One-command usage (after setting a real repo URL):
#   curl -fsSL https://<your-host>/eaios/install/install.sh | bash -s -- \
#     --repo-url=https://github.com/<you>/eaios.git
#
# Local usage from inside the repo:
#   ./install/install.sh
#
# Environment variables:
#   EAIOS_REPO_URL       Git URL to clone (required when curl-piped; optional
#                        when the script is already inside the repo).
#   EAIOS_BRANCH         Branch to checkout (default: master).
#   EAIOS_ROOT           Where to clone/install EAiOS (default: $HOME/eaios).
#   NODE_MIN_VERSION     Minimum Node major version (default: 24).
#   HERMES_INSTALL_URL   Hermes installer URL (default: official Nous script).
#   SKIP_NODE            Set to 1 to skip Node installation check.
#   SKIP_HERMES          Set to 1 to skip Hermes installation check.
#   SKIP_TESTS           Set to 1 to skip the optional npm test run.
#   SKIP_DESKTOP         Set to 1 to skip Hermes Desktop installation prompt.
#   NONINTERACTIVE       Set to 1 to never prompt (default: 0).
#   EAIOS_AGENT_NAME     Display name for the orchestration agent (default: Ally).
#
# The script is idempotent: re-running it pulls the repo, rebuilds, and
# restarts services without clobbering an existing .env.local.
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
EAIOS_BRANCH="${EAIOS_BRANCH:-master}"
EAIOS_ROOT="${EAIOS_ROOT:-$HOME/eaios}"
NODE_MIN_VERSION="${NODE_MIN_VERSION:-24}"
HERMES_INSTALL_URL="${HERMES_INSTALL_URL:-https://hermes-agent.nousresearch.com/install.sh}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
SKIP_NODE="${SKIP_NODE:-0}"
SKIP_HERMES="${SKIP_HERMES:-0}"
SKIP_TESTS="${SKIP_TESTS:-1}"
SKIP_DESKTOP="${SKIP_DESKTOP:-0}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info()  { echo -e "\033[1;34m==>\033[0m $*"; }
log_success() { echo -e "\033[1;32m✓\033[0m $*"; }
log_warn()  { echo -e "\033[1;33m!\033[0m $*" >&2; }
log_error() { echo -e "\033[1;31m✗\033[0m $*" >&2; }

fail() { log_error "$*"; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed."; }

version_major() { sed 's/^v//; s/\..*//' <<< "$1"; }

is_ubuntu_or_debian() {
  if [[ -f /etc/os-release ]]; then
    source /etc/os-release
    [[ "$ID" == "ubuntu" || "$ID" == "debian" || "$ID_LIKE" == *"debian"* || "$ID_LIKE" == *"ubuntu"* ]]
  else
    return 1
  fi
}

has_sudo() { command -v sudo >/dev/null 2>&1; }

prompt_yes_no() {
  local prompt="$1" default="${2:-y}"
  [[ "$NONINTERACTIVE" == "1" ]] && { [[ "$default" == "y" ]]; return $?; }
  local yn
  while true; do
    echo -n "$prompt [$default]: "; read -r yn; yn="${yn:-$default}"
    case "$yn" in [Yy]*) return 0 ;; [Nn]*) return 1 ;; *) echo "Yes or no." ;; esac
  done
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)     EAIOS_REPO_URL="$2"; shift 2 ;;
    --branch)       EAIOS_BRANCH="$2"; shift 2 ;;
    --root)         EAIOS_ROOT="$2"; shift 2 ;;
    --skip-node)    SKIP_NODE=1; shift ;;
    --skip-hermes)  SKIP_HERMES=1; shift ;;
    --run-tests)    SKIP_TESTS=0; shift ;;
    --skip-desktop) SKIP_DESKTOP=1; shift ;;
    --non-interactive) NONINTERACTIVE=1; shift ;;
    --agent-name)   EAIOS_AGENT_NAME="$2"; shift 2 ;;
    -h|--help)     sed -n '2,45p' "$0"; exit 0 ;;
    *)             fail "Unknown argument: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
# Detect local vs remote mode
# ---------------------------------------------------------------------------
if [[ -f "$SCRIPT_DIR/../app/package.json" && -d "$SCRIPT_DIR/../.git" ]]; then
  EAIOS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  LOCAL_MODE=1
  log_info "Detected local repo mode: $EAIOS_ROOT"
else
  LOCAL_MODE=0
  [[ -z "${EAIOS_REPO_URL:-}" ]] && fail "EAIOS_REPO_URL is required when curl-piped."
fi

log_info "EAiOS installer starting"
log_info "Target root: $EAIOS_ROOT"
log_info "Branch:      $EAIOS_BRANCH"

# ---------------------------------------------------------------------------
# 0. System prerequisites (Ubuntu/Debian: build-essential, xz-utils, python3)
# ---------------------------------------------------------------------------
log_info "Checking system prerequisites"
need_cmd git; need_cmd curl

if is_ubuntu_or_debian; then
  PREREQ_PKGS=""
  for pkg in build-essential xz-utils python3; do
    ! dpkg -s "$pkg" >/dev/null 2>&1 && PREREQ_PKGS="$PREREQ_PKGS $pkg"
  done
  if [[ -n "$PREREQ_PKGS" ]]; then
    if [[ "$NONINTERACTIVE" == "1" ]] || prompt_yes_no "Install system prerequisites ($PREREQ_PKGS)?" "y"; then
      if has_sudo; then
        sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
        sudo DEBIAN_FRONTEND=noninteractive apt-get install -y $PREREQ_PKGS
        log_success "System prerequisites installed"
      else
        log_warn "No sudo; install manually: sudo apt-get install $PREREQ_PKGS"
      fi
    else
      log_warn "Skipping system prerequisites - native module compilation may fail"
    fi
  fi
else
  command -v g++ >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 || \
    log_warn "No C++ compiler - Hermes Desktop/native modules may not compile"
  log_info "Non-Debian OS - skipping apt-based prerequisite install"
fi

# ---------------------------------------------------------------------------
# 1. Node >= 24
# ---------------------------------------------------------------------------
ensure_node() {
  local node_bin="$(command -v node || true)"
  if [[ -n "$node_bin" ]]; then
    local version="$(node --version)" major="$(version_major "$version")"
    (( major >= NODE_MIN_VERSION )) && { log_success "Node $version found"; return 0; }
    log_warn "Node $version < required >= $NODE_MIN_VERSION"
  fi
  log_info "Installing Node.js (>= $NODE_MIN_VERSION)"
  need_cmd sudo
  if is_ubuntu_or_debian; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MIN_VERSION}.x" | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  else
    local install_dir="$HOME/.local"; mkdir -p "$install_dir"
    curl -fsSL "https://nodejs.org/dist/v${NODE_MIN_VERSION}.0.0/node-v${NODE_MIN_VERSION}.0.0-linux-x64.tar.xz" \
      | tar -xJf - -C "$install_dir" --strip-components=1
    export PATH="$HOME/.local/bin:$PATH"
  fi
  node_bin="$(command -v node || true)"
  [[ -z "$node_bin" ]] && [[ -x "$HOME/.local/bin/node" ]] && node_bin="$HOME/.local/bin/node" && export PATH="$HOME/.local/bin:$PATH"
  [[ -z "$node_bin" ]] && fail "Node install failed: not on PATH"
  local major="$(version_major "$(node --version)")"
  (( major >= NODE_MIN_VERSION )) || fail "Node still below $NODE_MIN_VERSION"
  log_success "Node $(node --version) installed at $node_bin"
}

[[ "$SKIP_NODE" == "1" ]] && log_info "SKIP_NODE=1" || ensure_node
export PATH="$HOME/.local/bin:$PATH"

# ---------------------------------------------------------------------------
# 2. Hermes Agent (CLI)
# ---------------------------------------------------------------------------
ensure_hermes() {
  if command -v hermes >/dev/null 2>&1; then
    log_success "Hermes found: $(hermes --version | head -1)"
    return 0
  fi
  log_info "Installing Hermes Agent"
  local flag=""; [[ "$NONINTERACTIVE" == "1" ]] && flag="--non-interactive"
  curl -fsSL "$HERMES_INSTALL_URL" | bash -s -- $flag
  if ! command -v hermes >/dev/null 2>&1; then
    [[ -x "$HOME/.local/bin/hermes" ]] && export PATH="$HOME/.local/bin:$PATH" \
      || fail "Hermes installed but not on PATH"
  fi
  log_success "Hermes installed: $(hermes --version | head -1)"
}

[[ "$SKIP_HERMES" == "1" ]] && log_info "SKIP_HERMES=1" || ensure_hermes

# ---------------------------------------------------------------------------
# 2b. Hermes Desktop (optional)
# ---------------------------------------------------------------------------
if [[ "$SKIP_HERMES" != "1" ]]; then
  log_info "Checking Hermes Desktop"
  if [[ -x "$HOME/.hermes/hermes-agent/node_modules/.bin/electron" ]] || \
     [[ -f "$HOME/.local/share/hermes-agent/desktop/package.json" ]]; then
    log_success "Hermes Desktop already installed"
  elif [[ "$SKIP_DESKTOP" != "1" && "$NONINTERACTIVE" != "1" ]]; then
    if prompt_yes_no "Install Hermes Desktop (Electron GUI)?" "y"; then
      log_info "Installing Hermes Desktop (compiles native modules)"
      hermes desktop --build-only || log_warn "Desktop build incomplete; continuing"
      log_success "Hermes Desktop installed"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 3. Clone or update EAiOS repo
# ---------------------------------------------------------------------------
if [[ "$LOCAL_MODE" == "1" ]]; then
  log_info "Local mode - $EAIOS_ROOT"
  cd "$EAIOS_ROOT"
  [[ -n "${EAIOS_REPO_URL:-}" ]] && git remote get-url origin >/dev/null 2>&1 && git pull origin "$(git rev-parse --abbrev-ref HEAD)"
elif [[ -d "$EAIOS_ROOT/.git" ]]; then
  cd "$EAIOS_ROOT"; git fetch origin; git checkout "$EAIOS_BRANCH"; git pull origin "$EAIOS_BRANCH"
else
  git clone --branch "$EAIOS_BRANCH" "$EAIOS_REPO_URL" "$EAIOS_ROOT"; cd "$EAIOS_ROOT"
fi
log_success "EAiOS repo ready at $EAIOS_ROOT"

# ---------------------------------------------------------------------------
# 4. App npm dependencies + build
# ---------------------------------------------------------------------------
log_info "Installing app dependencies"
cd "$EAIOS_ROOT/app"
[[ -f package-lock.json ]] && npm ci || npm install
[[ "$SKIP_TESTS" == "0" ]] && log_info "Running tests" && npm test
log_info "Building production bundle"
npm run build
log_success "App built"

# ---------------------------------------------------------------------------
# 5. Knowledge sidecar venv
# ---------------------------------------------------------------------------
log_info "Setting up knowledge sidecar"
cd "$EAIOS_ROOT/sidecar"
if [[ ! -x .venv/bin/python ]]; then
  if ! command -v uv >/dev/null 2>&1; then
    log_info "Installing uv"; curl -LsSf https://astral.sh/uv/install.sh | sh; export PATH="$HOME/.local/bin:$PATH"
  fi
  uv venv .venv --python 3.11
fi
uv pip install --python .venv/bin/python -r requirements.txt
log_success "Sidecar venv ready"

if command -v "$EAIOS_ROOT/sidecar/.venv/bin/playwright" >/dev/null 2>&1; then
  log_info "Installing Playwright Chromium"
  "$EAIOS_ROOT/sidecar/.venv/bin/playwright" install chromium && log_success "Chromium ready" || \
    log_warn "Chromium install skipped (PDF-only podcasts still work)"
else
  log_warn "playwright CLI not found; skipping browser install"
fi

# ---------------------------------------------------------------------------
# 6. Hermes dev token
# ---------------------------------------------------------------------------
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
TOKEN_FILE="$HERMES_HOME/.eaios-dev-token"
if [[ ! -f "$TOKEN_FILE" ]]; then
  mkdir -p "$HERMES_HOME"; openssl rand -base64 32 | tr -d '\n' > "$TOKEN_FILE"; chmod 600 "$TOKEN_FILE"
  log_success "Dev token created"
else
  log_info "Reusing existing dev token"
fi
DEV_TOKEN="$(cat "$TOKEN_FILE")"

# ---------------------------------------------------------------------------
# 7. app/.env.local template (all key placeholders)
# ---------------------------------------------------------------------------
ENV_LOCAL="$EAIOS_ROOT/app/.env.local"
if [[ -f "$ENV_LOCAL" ]]; then
  log_info "Keeping existing $ENV_LOCAL"
else
  [[ -z "${EAIOS_AGENT_NAME:-}" && "$NONINTERACTIVE" != "1" ]] && { echo -n "Agent name [Ally]: "; read -r EAIOS_AGENT_NAME; }
  EAIOS_AGENT_NAME="${EAIOS_AGENT_NAME:-Ally}"
  log_info "Creating $ENV_LOCAL with all provider key placeholders"

  cat > "$ENV_LOCAL" << ENVEOF
# EAiOS runtime environment
# Fill in live provider keys below. This file is gitignored.
#
# ===== REQUIRED (must be set for EAiOS to operate) =====
# Hermes integration - required
VITE_HERMES_LIVE=1
VITE_HERMES_TOKEN=$DEV_TOKEN
VITE_AGENT_NAME=$EAIOS_AGENT_NAME

# Composio connector key - required for Connections/Composio integrations
COMPOSIO_API_KEY=

# ===== LLM PROVIDER (at least one) =====
# OpenRouter - recommended (covers 300+ models)
OPENROUTER_API_KEY=

# OpenAI - optional fallback
OPENAI_API_KEY=

# ===== MESSAGING / NOTIFICATIONS =====
# Telegram bot token - create at https://t.me/BotFather
TELEGRAM_BOT_TOKEN=

# Telegram allowed user/group IDs (comma-separated)
TELEGRAM_ALLOWED_USERS=

# ===== TRAVEL (optional) =====
# Duffel flight search - https://www.duffel.com/
DUFFEL_API_KEY=

# ===== THIRD-PARTY CONNECTIONS =====
# Tavily web search - https://tavily.com/
TAVILY_API_KEY=

# ElevenLabs TTS - https://elevenlabs.io/
ELEVENLABS_API_KEY=

# ===== GOOGLE CLOUD (optional - Podcast API) =====
GOOGLE_CLOUD_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=
ENVEOF
  chmod 600 "$ENV_LOCAL"
  log_success "$ENV_LOCAL created"
  log_warn "Edit $ENV_LOCAL and fill in your API keys"
fi

# ---------------------------------------------------------------------------
# 8. sidecar/.env template
# ---------------------------------------------------------------------------
SIDECAR_ENV="$EAIOS_ROOT/sidecar/.env"
if [[ -f "$SIDECAR_ENV" ]]; then
  log_info "Keeping existing $SIDECAR_ENV"
else
  cat > "$SIDECAR_ENV" << SIDEOF
# EAiOS sidecar environment
# Fill in provider keys below. Changes require restart:
#   systemctl --user restart eaios-knowledge-sidecar

OPENROUTER_API_KEY=
ELEVENLABS_API_KEY=
OPENAI_API_KEY=
GOOGLE_CLOUD_PROJECT=
GOOGLE_APPLICATION_CREDENTIALS=
SIDEOF
  chmod 600 "$SIDECAR_ENV"
  log_success "$SIDECAR_ENV created"
fi

# ---------------------------------------------------------------------------
# 9. systemd user units
# ---------------------------------------------------------------------------
log_info "Installing systemd user units"
cd "$EAIOS_ROOT"
./scripts/install-systemd-user.sh --start

# ---------------------------------------------------------------------------
# 10. systemd linger (boot persistence)
# ---------------------------------------------------------------------------
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
  if has_sudo && ([[ "$NONINTERACTIVE" == "1" ]] || prompt_yes_no "Enable linger (boot-start)?" "y"); then
    sudo loginctl enable-linger "$USER"
    log_success "Linger enabled"
  else
    log_warn "Linger not enabled. To enable: sudo loginctl enable-linger $USER"
  fi
else
  log_success "Linger already enabled"
fi

# ---------------------------------------------------------------------------
# 11. Recommend hermes setup
# ---------------------------------------------------------------------------
if ! hermes config get OPENROUTER_API_KEY >/dev/null 2>&1 && \
   ! grep -q "default_model:" "$HOME/.hermes/config.yaml" 2>/dev/null; then
  echo ""
  log_warn "No LLM provider configured for Hermes."
  echo "  Fastest: hermes setup --portal"
  echo "  Manual:  hermes model"
  echo ""
  if [[ "$NONINTERACTIVE" != "1" ]] && prompt_yes_no "Run 'hermes setup --portal' now?" "y"; then
    hermes setup --portal
  fi
fi

# ---------------------------------------------------------------------------
# 12. Verification
# ---------------------------------------------------------------------------
log_info "Running verification"
"$EAIOS_ROOT/scripts/verify-install.sh"

# ---------------------------------------------------------------------------
# 13. Summary
# ---------------------------------------------------------------------------
log_success "EAiOS installation complete"
echo ""
echo "Services:"
echo "  eaios-hermes-serve      :9119  (Hermes gateway)"
echo "  eaios-knowledge-sidecar :9121  (RAG sidecar + podcasts)"
echo "  eaios-server            :5200  (production app)"
echo "  eaios-server-5173       :5173  (front-door prod app)"
echo ""
echo "=== NEXT STEPS ==="
echo ""
echo "  1. Fill in API keys in:"
echo "     $ENV_LOCAL"
echo "     $SIDECAR_ENV"
echo "     Then: systemctl --user restart eaios-knowledge-sidecar"
echo ""
echo "  2. Configure Hermes: hermes setup --portal"
echo ""
echo "  3. Open http://127.0.0.1:5200 or http://127.0.0.1:5173"
echo ""
echo "  4. Update with: $EAIOS_ROOT/scripts/eaios-update.sh"