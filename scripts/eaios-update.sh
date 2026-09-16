#!/usr/bin/env bash
# EAiOS update wrapper for already-shipped CEO boxes.
#
# Modes:
#   ./scripts/eaios-update.sh              # pull current branch, rebuild, restart
#   ./scripts/eaios-update.sh --to v0.2.0  # checkout a specific tag/branch/commit
#   ./scripts/eaios-update.sh --rollback   # roll back to the previous successful version
#
# The command is deliberate: it stops on first error and reports exactly what
# changed. It does NOT auto-update on a timer.
set -euo pipefail

EAIOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EAIOS_BRANCH="${EAIOS_BRANCH:-$(cd "$EAIOS_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)}"
EAIOS_REPO_URL="${EAIOS_REPO_URL:-}"
EAIOS_STATE_DB="${EAIOS_STATE_DB:-$HOME/.hermes/state.db}"
export EAIOS_STATE_DB

ACTION="update"
ACTION_TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback)
      ACTION="rollback"
      shift
      ;;
    --to)
      ACTION="update-to"
      ACTION_TARGET="${2:-}"
      if [[ -z "$ACTION_TARGET" ]]; then
        echo "--to requires a tag/branch/commit" >&2
        exit 1
      fi
      shift 2
      ;;
    --help|-h)
      echo "Usage: $0 [--to <tag|branch|sha>] [--rollback]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
log_info() { echo -e "\033[1;34m==>\033[0m $*"; }
log_success() { echo -e "\033[1;32m✓\033[0m $*"; }
log_warn() { echo -e "\033[1;33m!\033[0m $*" >&2; }
log_error() { echo -e "\033[1;31m✗\033[0m $*" >&2; }

fail() {
  log_error "$*"
  write_log_finish 0 "$*"
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not installed."
}

LOG_ROW_ID=""

# Insert the initial log row.
write_log_start() {
  local old_sha="$1"
  local old_version="$2"
  LOG_ROW_ID="$(node - "$old_sha" "$old_version" <<'NODE'
const [oldSha, oldVersion] = process.argv.slice(2);
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.EAIOS_STATE_DB);
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS eaios_update_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      old_git_sha TEXT,
      new_git_sha TEXT,
      old_version TEXT,
      new_version TEXT,
      success INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    )
  `);
  const info = db.prepare('INSERT INTO eaios_update_log (started_at, old_git_sha, old_version) VALUES (?, ?, ?)')
    .run(Math.floor(Date.now()/1000), oldSha || null, oldVersion || null);
  console.log(info.lastInsertRowid);
} finally { db.close(); }
NODE
  )"
}

# Update the log row with the final outcome.
write_log_finish() {
  local success="$1"
  local error_message="${2:-}"
  if [[ -z "$LOG_ROW_ID" ]]; then
    return
  fi
  local new_sha new_version
  new_sha="$(cd "$EAIOS_ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  new_version="$(node -p "require('$EAIOS_ROOT/app/package.json').version" 2>/dev/null || echo 0.0.0)"
  node - "$LOG_ROW_ID" "$success" "$error_message" "$new_sha" "$new_version" <<'NODE' || true
const [rowIdRaw, successRaw, errorMessage, newSha, newVersion] = process.argv.slice(2);
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.EAIOS_STATE_DB);
try {
  db.prepare('UPDATE eaios_update_log SET finished_at=?, new_git_sha=?, new_version=?, success=?, error_message=? WHERE id=?')
    .run(Math.floor(Date.now()/1000), newSha || null, newVersion || null, Number(successRaw), errorMessage || null, Number(rowIdRaw));
} finally { db.close(); }
NODE
}

# Look up the last successful update's old_git_sha so we can roll back to it.
find_rollback_target() {
  node - <<'NODE'
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.EAIOS_STATE_DB);
try {
  const row = db.prepare(
    `SELECT old_git_sha, old_version FROM eaios_update_log
     WHERE success = 1 AND old_git_sha IS NOT NULL
     ORDER BY started_at DESC, id DESC LIMIT 1`
  ).get();
  if (!row || !row.old_git_sha) {
    console.error('No successful prior update found in eaios_update_log; cannot determine rollback target.');
    process.exit(1);
  }
  console.log(`${row.old_git_sha}\t${row.old_version || 'unknown'}`);
} finally { db.close(); }
NODE
}

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------
need_cmd git
need_cmd node
need_cmd npm

cd "$EAIOS_ROOT"

OLD_GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
OLD_VERSION="$(node -p "require('$EAIOS_ROOT/app/package.json').version" 2>/dev/null || echo 0.0.0)"

log_info "EAiOS update starting"
log_info "Mode:    $ACTION"
log_info "Branch:  $EAIOS_BRANCH"
log_info "Current: $OLD_VERSION @ $OLD_GIT_SHA"

node scripts/run-migrations.mjs || fail "migration runner failed"
write_log_start "$OLD_GIT_SHA" "$OLD_VERSION"

# ---------------------------------------------------------------------------
# Determine what to checkout
# ---------------------------------------------------------------------------
TARGET_DESC=""
if [[ "$ACTION" == "rollback" ]]; then
  log_info "Determining rollback target"
  ROLLBACK_PAIR="$(find_rollback_target)"
  ROLLBACK_SHA="${ROLLBACK_PAIR%%$'\t'*}"
  ROLLBACK_VERSION="${ROLLBACK_PAIR#*$'\t'}"
  ACTION_TARGET="$ROLLBACK_SHA"
  TARGET_DESC="rollback to $ROLLBACK_VERSION @ $ROLLBACK_SHA"
  log_info "Rollback target: $TARGET_DESC"
else
  TARGET_DESC="${ACTION_TARGET:-$EAIOS_BRANCH (pull)}"
fi

# ---------------------------------------------------------------------------
# 1. Fetch / checkout
# ---------------------------------------------------------------------------
log_info "Fetching updates"
if [[ -n "$EAIOS_REPO_URL" ]]; then
  if git remote get-url origin >/dev/null 2>&1; then
    git remote set-url origin "$EAIOS_REPO_URL"
  else
    git remote add origin "$EAIOS_REPO_URL"
  fi
fi

git fetch origin "$EAIOS_BRANCH" || fail "git fetch failed"

if [[ "$ACTION" == "rollback" || "$ACTION" == "update-to" ]]; then
  git fetch --tags origin || true
  git checkout "$ACTION_TARGET" || fail "git checkout of $ACTION_TARGET failed"
else
  git pull --ff-only origin "$EAIOS_BRANCH" || fail "git pull failed (non-fast-forward? resolve manually)"
fi

NEW_GIT_SHA_BEFORE_BUILD="$(git rev-parse --short HEAD)"
if [[ "$OLD_GIT_SHA" == "$NEW_GIT_SHA_BEFORE_BUILD" && "$ACTION" != "rollback" ]]; then
  log_info "No code change; skipping build and restart"
  write_log_finish 1 ""
  log_success "EAiOS is already on the latest commit"
  exit 0
fi

# ---------------------------------------------------------------------------
# 2. Build app
# ---------------------------------------------------------------------------
log_info "Installing / building app"
cd "$EAIOS_ROOT/app"
npm ci
npm run build
log_success "App built"

# ---------------------------------------------------------------------------
# 3. Sidecar venv
# ---------------------------------------------------------------------------
log_info "Refreshing sidecar venv"
cd "$EAIOS_ROOT/sidecar"
if [[ ! -x .venv/bin/python ]]; then
  if ! command -v uv >/dev/null 2>&1; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
  fi
  uv venv .venv --python 3.11
fi
uv pip install --python .venv/bin/python -r requirements.txt
log_success "Sidecar venv refreshed"

# ---------------------------------------------------------------------------
# 4. Migrations (re-run after pull; new ones will apply)
# ---------------------------------------------------------------------------
log_info "Running migrations"
cd "$EAIOS_ROOT"
node scripts/run-migrations.mjs || fail "migrations failed"
log_success "Migrations up-to-date"

# ---------------------------------------------------------------------------
# 5. systemd units
# ---------------------------------------------------------------------------
log_info "Re-rendering systemd units"
cd "$EAIOS_ROOT"
./scripts/install-systemd-user.sh
log_success "Units rendered"

# ---------------------------------------------------------------------------
# 6. Restart services
# ---------------------------------------------------------------------------
log_info "Restarting services"
for unit in eaios-hermes-serve eaios-knowledge-sidecar eaios-server eaios-server-5173; do
  if systemctl --user is-active --quiet "$unit" 2>/dev/null; then
    systemctl --user restart "$unit"
    log_success "$unit restarted"
  else
    log_warn "$unit was not active; enabling + starting"
    systemctl --user enable "$unit"
    systemctl --user start "$unit"
  fi
done

# ---------------------------------------------------------------------------
# 7. Verification
# ---------------------------------------------------------------------------
log_info "Running verification"
cd "$EAIOS_ROOT"
./scripts/verify-install.sh || fail "verification failed"

# ---------------------------------------------------------------------------
# 8. Persist success
# ---------------------------------------------------------------------------
write_log_finish 1 ""
log_success "EAiOS update complete: $OLD_VERSION @ $OLD_GIT_SHA → $(node -p "require('$EAIOS_ROOT/app/package.json').version") @ $(git rev-parse --short HEAD)"
