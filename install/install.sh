#!/usr/bin/env bash
# EAiOS one-command installer for a fresh CEO box (Ubuntu/Debian first).
#
# What it does:
#   1. Checks OS and basic tools (git, curl, sudo).
#   2. Ensures Node.js >= 24 is installed.
#   3. Ensures Hermes Agent is installed.
#   4. Clones or updates the EAiOS repo.
#   5. Installs app npm dependencies and builds the production bundle.
#   6. Creates the Python sidecar venv and installs its deps.
#   7. Renders and enables systemd user units.
#   8. Creates ~/.hermes/.eaios-dev-token and app/.env.local on first run.
#   9. Starts the eaios-* services.
#  10. Runs verification probes.
#
# One-command usage (after setting a real repo URL):
#   curl -fsSL https://<your-host>/eaios/install/install.sh | bash -s -- \
#     --repo-url=https://github.com/<you>/eaios.git
#
# Local usage from inside the repo:
#   ./install/install.sh
#
# Environment variables:
#   EAIOS_REPO_URL      Git URL to clone (required when curl-piped; optional
#                       when the script is already inside the repo).
#   EAIOS_BRANCH        Branch to checkout (default: master).
#   EAIOS_ROOT          Where to clone/install EAiOS (default: $HOME/eaios).
#   NODE_MIN_VERSION    Minimum Node major version (default: 24).
#   HERMES_INSTALL_URL  Hermes installer URL (default: official Nous script).
#   SKIP_NODE           Set to 1 to skip Node installation check.
#   SKIP_HERMES         Set to 1 to skip Hermes installation check.
#   SKIP_TESTS          Set to 1 to skip the optional npm test run.
#   NONINTERACTIVE      Set to 1 to never prompt (default: 0).
#   EAIOS_AGENT_NAME    Display name for the orchestration agent (default: Ally).
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
HERMES_INSTALL_URL="${HERMES_INSTALL_URL:-https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh}"
NONINTERACTIVE="${NONINTERACTIVE:-0}"
EAIOS_AGENT_NAME="${EAIOS_AGENT_NAME:-}"
SKIP_NODE="${SKIP_NODE:-0}"
SKIP_HERMES="${SKIP_HERMES:-0}"
SKIP_TESTS="${SKIP_TESTS:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info() { echo -e "\033[1;34m==>\033[0m $*"; }
log_success() { echo -e "\033[1;32m✓\033[0m $*"; }
log_warn() { echo -e "\033[1;33m!\033[0m $*" >&2; }
log_error() { echo -e "\033[1;31m✗\033[0m $*" >&2; }

fail() {
  log_error "$*"
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed."
}

version_major() {
  # v26.7.0 -> 26
  sed 's/^v//; s/\..*//' <<< "$1"
}

is_ubuntu_or_debian() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
    [[ "$ID" == "ubuntu" || "$ID" == "debian" || "$ID_LIKE" == *"debian"* || "$ID_LIKE" == *"ubuntu"* ]]
  else
    return 1
  fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo-url)
      EAIOS_REPO_URL="$2"
      shift 2
      ;;
    --branch)
      EAIOS_BRANCH="$2"
      shift 2
      ;;
    --root)
      EAIOS_ROOT="$2"
      shift 2
      ;;
    --skip-node)
      SKIP_NODE=1
      shift
      ;;
    --skip-hermes)
      SKIP_HERMES=1
      shift
      ;;
    --run-tests)
      SKIP_TESTS=0
      shift
      ;;
    --non-interactive)
      NONINTERACTIVE=1
      shift
      ;;
    --agent-name)
      EAIOS_AGENT_NAME="$2"
      shift 2
      ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      fail "Unknown argument: $1"
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Detect local vs remote mode
# ---------------------------------------------------------------------------
# If the script lives inside an EAiOS repo, use that repo root and skip clone.
if [[ -f "$SCRIPT_DIR/../app/package.json" && -d "$SCRIPT_DIR/../.git" ]]; then
  EAIOS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
  LOCAL_MODE=1
  log_info "Detected local repo mode: $EAIOS_ROOT"
else
  LOCAL_MODE=0
  if [[ -z "${EAIOS_REPO_URL:-}" ]]; then
    fail "EAIOS_REPO_URL is required when the installer is curl-piped.\n       Example: bash -s -- --repo-url=https://github.com/<you>/eaios.git"
  fi
fi

log_info "EAiOS installer starting"
log_info "Target root: $EAIOS_ROOT"
log_info "Branch:      $EAIOS_BRANCH"

# ---------------------------------------------------------------------------
# 1. OS / base-tool checks
# ---------------------------------------------------------------------------
log_info "Checking base tools"
need_cmd git
need_cmd curl

if ! is_ubuntu_or_debian; then
  log_warn "This installer is tested on Ubuntu/Debian. Continuing on a best-effort basis."
fi

# ---------------------------------------------------------------------------
# 2. Node >= 24
# ---------------------------------------------------------------------------
ensure_node() {
  local node_bin
  node_bin="$(command -v node || true)"
  if [[ -n "$node_bin" ]]; then
    local version major
    version="$("$node_bin" --version)"
    major="$(version_major "$version")"
    if (( major >= NODE_MIN_VERSION )); then
      log_success "Node $version found at $node_bin"
      return 0
    fi
    log_warn "Node $version is below required >= $NODE_MIN_VERSION; will install newer."
  fi

  log_info "Installing Node.js (>= $NODE_MIN_VERSION)"
  need_cmd sudo
  if is_ubuntu_or_debian; then
    # Prefer NodeSource apt repository for clean updates.
    local nodesetup="https://deb.nodesource.com/setup_${NODE_MIN_VERSION}.x"
    log_info "Using NodeSource: $nodesetup"
    curl -fsSL "$nodesetup" | sudo -E bash -
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
  else
    # Best-effort binary install for non-Debian systems.
    local node_ver
    node_ver="${NODE_MIN_VERSION}.0.0"
    local install_dir="$HOME/.local"
    log_info "Installing Node v$node_ver binary to $install_dir"
    mkdir -p "$install_dir"
    curl -fsSL "https://nodejs.org/dist/v${node_ver}/node-v${node_ver}-linux-x64.tar.xz" \
      | tar -xJf - -C "$install_dir" --strip-components=1
  fi

  # Re-verify
  node_bin="$(command -v node || true)"
  if [[ -z "$node_bin" ]]; then
    if [[ -x "$HOME/.local/bin/node" ]]; then
      export PATH="$HOME/.local/bin:$PATH"
      node_bin="$HOME/.local/bin/node"
    else
      fail "Node installation failed: node still not on PATH."
    fi
  fi
  local version major
  version="$("$node_bin" --version)"
  major="$(version_major "$version")"
  if (( major < NODE_MIN_VERSION )); then
    fail "Node $version is still below required >= $NODE_MIN_VERSION."
  fi
  log_success "Node $version installed at $node_bin"
}

if [[ "$SKIP_NODE" == "1" ]]; then
  log_info "SKIP_NODE=1 — skipping Node installation check"
else
  ensure_node
fi

# Ensure npm/node are findable by systemd units later.
export PATH="$HOME/.local/bin:$PATH"

# ---------------------------------------------------------------------------
# 3. Hermes Agent
# ---------------------------------------------------------------------------
ensure_hermes() {
  if command -v hermes >/dev/null 2>&1; then
    local ver
    ver="$(hermes --version 2>/dev/null | head -1 || true)"
    log_success "Hermes found: $ver"
    return 0
  fi

  log_info "Installing Hermes Agent from $HERMES_INSTALL_URL"
  if [[ "$NONINTERACTIVE" == "1" ]]; then
    curl -fsSL "$HERMES_INSTALL_URL" | bash -s -- --non-interactive
  else
    curl -fsSL "$HERMES_INSTALL_URL" | bash
  fi

  if ! command -v hermes >/dev/null 2>&1; then
    if [[ -x "$HOME/.local/bin/hermes" ]]; then
      export PATH="$HOME/.local/bin:$PATH"
    else
      fail "Hermes installation completed but hermes command not on PATH."
    fi
  fi
  log_success "Hermes installed: $(hermes --version | head -1)"
}

if [[ "$SKIP_HERMES" == "1" ]]; then
  log_info "SKIP_HERMES=1 — skipping Hermes installation check"
else
  ensure_hermes
fi

# ---------------------------------------------------------------------------
# 4. Clone or update EAiOS repo
# ---------------------------------------------------------------------------
if [[ "$LOCAL_MODE" == "1" ]]; then
  log_info "Local mode — using existing repo at $EAIOS_ROOT"
  cd "$EAIOS_ROOT"
  if [[ -n "${EAIOS_REPO_URL:-}" ]]; then
    # Optionally pull if a remote exists and matches.
    if git remote get-url origin >/dev/null 2>&1; then
      log_info "Pulling latest changes"
      git pull origin "$(git rev-parse --abbrev-ref HEAD)"
    fi
  fi
else
  if [[ -d "$EAIOS_ROOT/.git" ]]; then
    log_info "EAiOS repo already exists at $EAIOS_ROOT; pulling"
    cd "$EAIOS_ROOT"
    git fetch origin
    git checkout "$EAIOS_BRANCH"
    git pull origin "$EAIOS_BRANCH"
  else
    log_info "Cloning EAiOS from $EAIOS_REPO_URL"
    git clone --branch "$EAIOS_BRANCH" "$EAIOS_REPO_URL" "$EAIOS_ROOT"
    cd "$EAIOS_ROOT"
  fi
fi

log_success "EAiOS repo ready at $EAIOS_ROOT"

# ---------------------------------------------------------------------------
# 5. App npm dependencies + build
# ---------------------------------------------------------------------------
log_info "Installing app dependencies"
cd "$EAIOS_ROOT/app"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ "$SKIP_TESTS" == "0" ]]; then
  log_info "Running test suite (SKIP_TESTS=0)"
  npm test
else
  log_info "Skipping npm test (set --run-tests to enable)"
fi

log_info "Building production bundle"
npm run build
log_success "App built"

# ---------------------------------------------------------------------------
# 6. Knowledge sidecar venv
# ---------------------------------------------------------------------------
log_info "Setting up knowledge sidecar"
cd "$EAIOS_ROOT/sidecar"
if [[ ! -x .venv/bin/python ]]; then
  if ! command -v uv >/dev/null 2>&1; then
    # uv should have been installed by Hermes; fall back to bootstrapping it.
    log_info "uv not found; installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi
  uv venv .venv --python 3.11
fi
uv pip install --python .venv/bin/python pymupdf python-docx python-pptx
log_success "Sidecar venv ready"

# ---------------------------------------------------------------------------
# 7. Hermes dev token for EAiOS
# ---------------------------------------------------------------------------
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
TOKEN_FILE="$HERMES_HOME/.eaios-dev-token"
if [[ ! -f "$TOKEN_FILE" ]]; then
  log_info "Generating EAiOS dev token"
  mkdir -p "$HERMES_HOME"
  openssl rand -base64 32 | tr -d '\n' > "$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE"
  log_success "Token written to $TOKEN_FILE"
else
  log_info "Reusing existing EAiOS dev token"
fi
DEV_TOKEN="$(cat "$TOKEN_FILE")"

# ---------------------------------------------------------------------------
# 8. app/.env.local template
# ---------------------------------------------------------------------------
ENV_LOCAL="$EAIOS_ROOT/app/.env.local"
if [[ -f "$ENV_LOCAL" ]]; then
  log_info "Keeping existing $ENV_LOCAL (not overwritten)"
else
  if [[ -z "$EAIOS_AGENT_NAME" && "$NONINTERACTIVE" != "1" ]]; then
    echo -n "Name your orchestration agent [Ally]: "
    read -r EAIOS_AGENT_NAME
  fi
  EAIOS_AGENT_NAME="${EAIOS_AGENT_NAME:-Ally}"
  log_info "Creating $ENV_LOCAL from template (agent name: $EAIOS_AGENT_NAME)"
  if [[ -f "$EAIOS_ROOT/app/.env.local.example" ]]; then
    sed -e "s|^VITE_HERMES_TOKEN=.*|VITE_HERMES_TOKEN=$DEV_TOKEN|" \
        -e "s|^VITE_AGENT_NAME=.*|VITE_AGENT_NAME=$EAIOS_AGENT_NAME|" \
        "$EAIOS_ROOT/app/.env.local.example" > "$ENV_LOCAL"
  else
    cat > "$ENV_LOCAL" <<EOF
# EAiOS app environment. Fill in live provider keys as needed.
VITE_HERMES_LIVE=1
VITE_HERMES_TOKEN=$DEV_TOKEN
VITE_AGENT_NAME=$EAIOS_AGENT_NAME
COMPOSIO_API_KEY=
DUFFEL_API_KEY=
OPENTABLE_API_KEY=
EOF
  fi
  chmod 600 "$ENV_LOCAL"
  log_success "$ENV_LOCAL created"
fi

# ---------------------------------------------------------------------------
# 9. systemd user units
# ---------------------------------------------------------------------------
log_info "Installing systemd user units"
cd "$EAIOS_ROOT"
./scripts/install-systemd-user.sh --start

# ---------------------------------------------------------------------------
# 10. linger (boot persistence)
# ---------------------------------------------------------------------------
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
  log_warn "systemd linger is not enabled. Services won't start at boot until you run:"
  log_warn "  sudo loginctl enable-linger $USER"
fi

# ---------------------------------------------------------------------------
# 11. Verification
# ---------------------------------------------------------------------------
log_info "Running verification"
"$EAIOS_ROOT/scripts/verify-install.sh"

log_success "EAiOS installation complete"
echo ""
echo "Services:"
echo "  eaios-hermes-serve      :9119  (Hermes gateway)"
echo "  eaios-knowledge-sidecar :9121  (RAG sidecar)"
echo "  eaios-server            :5200  (production app)"
echo "  eaios-server-5173       :5173  (front-door prod app)"
echo ""
echo "Next steps:"
echo "  1. Add live API keys to $ENV_LOCAL if you want live providers."
echo "  2. Run 'hermes setup --portal' to link Nous Portal / models."
echo "  3. Open http://127.0.0.1:5200 or http://127.0.0.1:5173 in a browser."
