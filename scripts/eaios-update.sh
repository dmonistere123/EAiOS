#!/usr/bin/env bash
# Deliberate updates: current branch, --to <tag|branch|sha>, or --rollback.
# Rebuild and verify even at the same SHA: checkout state is not deployment state.
set -Eeuo pipefail
umask 077

# Bash and logging/migration tools must survive checkout of an older release.
# Ignore a caller-provided runtime path; only the copied script may reuse it.
if [[ -n "${EAIOS_UPDATE_RUNTIME:-}" && "$0" != "$EAIOS_UPDATE_RUNTIME/updater.sh" ]]; then
  unset EAIOS_UPDATE_RUNTIME
fi
if [[ -z "${EAIOS_UPDATE_RUNTIME:-}" ]]; then
  export EAIOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
  export EAIOS_UPDATE_RUNTIME="$(mktemp -d "${TMPDIR:-/tmp}/eaios-update.XXXXXXXX")"
  cp "$0" "$EAIOS_UPDATE_RUNTIME/updater.sh"
  cp "$EAIOS_ROOT/scripts/update-state.mjs" "$EAIOS_ROOT/scripts/run-migrations.mjs" "$EAIOS_UPDATE_RUNTIME/"
  exec bash "$EAIOS_UPDATE_RUNTIME/updater.sh" "$@"
fi

export EAIOS_STATE_DB="${EAIOS_STATE_DB:-$HOME/.hermes/state.db}"
ACTION=update
TARGET=""
STEP=preflight
LOG_ROW_ID=""
SUCCESS=0
ERROR_MESSAGE=""

version() { node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version)' "$EAIOS_ROOT/app/package.json"; }
state() { node "$EAIOS_UPDATE_RUNTIME/update-state.mjs" "$@"; }
fail() { ERROR_MESSAGE="$*"; echo "ERROR: $*" >&2; exit 1; }
finish() {
  local result=$?
  trap - EXIT ERR INT TERM
  if [[ -n "$LOG_ROW_ID" ]]; then
    local sha v
    sha="$(git -C "$EAIOS_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
    v="$(version 2>/dev/null || echo unknown)"
    state finish "$LOG_ROW_ID" "$SUCCESS" "${ERROR_MESSAGE:-}" "$sha" "$v" || {
      echo "ERROR: could not finish the update log" >&2
      result=1
    }
  fi
  # Only remove the private directory created by this invocation.
  rm -rf -- "$EAIOS_UPDATE_RUNTIME"
  exit "$result"
}
trap finish EXIT
trap 'ERROR_MESSAGE="${ERROR_MESSAGE:-Failed during $STEP (line $LINENO, exit $?) }"' ERR
trap 'ERROR_MESSAGE="Interrupted during $STEP"; exit 130' INT
trap 'ERROR_MESSAGE="Terminated during $STEP"; exit 143' TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rollback) [[ "$ACTION" == update ]] || fail 'Choose only one update mode'; ACTION=rollback; shift ;;
    --to) [[ "$ACTION" == update && -n "${2:-}" && "${2:0:1}" != - ]] || fail '--to requires a tag, branch, or SHA'; ACTION=update-to; TARGET="$2"; shift 2 ;;
    --help|-h) echo 'Usage: eaios-update.sh [--to <tag|branch|sha> | --rollback]'; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

for cmd in git node npm uv flock; do command -v "$cmd" >/dev/null || fail "$cmd is required"; done
[[ "$(node -p 'Number(process.versions.node.split(".")[0])')" -ge 24 ]] || fail 'Node >=24 is required'
cd "$EAIOS_ROOT"
# flock leaves no stale lock after an interrupted process.
exec 9>"$(git rev-parse --git-path eaios-update.lock)"
flock -n 9 || fail 'Another EAiOS update is running'
[[ -z "$(git status --porcelain)" ]] || fail 'Commit or stash local changes (including untracked files) before updating'

OLD_SHA="$(git rev-parse HEAD)"
OLD_VERSION="$(version)"
LOG_ROW_ID="$(state start "$ACTION" "$OLD_SHA" "$OLD_VERSION")"

STEP='resolve target'
if [[ "$ACTION" == rollback ]]; then
  TARGET="$(state rollback-target)"
  # Rollback uses local objects and works without network access.
  TARGET_SHA="$(git rev-parse --verify "$TARGET^{commit}")"
else
  if [[ -n "${EAIOS_REPO_URL:-}" ]]; then
    git remote set-url origin "$EAIOS_REPO_URL"
  fi
  if [[ "$ACTION" == update ]]; then
    BRANCH="${EAIOS_BRANCH:-$(git symbolic-ref --quiet --short HEAD || true)}"
    if [[ -z "$BRANCH" ]]; then
      BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD || echo origin/main)"
      BRANCH="${BRANCH#origin/}"
    fi
    git check-ref-format --branch "$BRANCH" >/dev/null
    git fetch origin "$BRANCH"
    TARGET_SHA="$(git rev-parse --verify 'FETCH_HEAD^{commit}')"
  else
    git fetch --tags origin
    # Fetch the requested ref explicitly so branches do not resolve to stale
    # local tips. Full SHA targets must also be available from origin.
    git fetch origin "$TARGET"
    TARGET_SHA="$(git rev-parse --verify 'FETCH_HEAD^{commit}')"
  fi
fi
state target "$LOG_ROW_ID" "$TARGET_SHA"

STEP=checkout
if [[ "$ACTION" == update && -n "$(git symbolic-ref --quiet HEAD || true)" ]]; then
  git merge --ff-only "$TARGET_SHA"
else
  git checkout --detach "$TARGET_SHA"
fi

STEP='app dependency installation'
cd "$EAIOS_ROOT/app"
npm ci
STEP='app build'
npm run build

STEP='sidecar dependencies'
cd "$EAIOS_ROOT/sidecar"
if [[ ! -x .venv/bin/python ]]; then uv venv .venv --python 3.11; fi
uv pip install --python .venv/bin/python -r requirements.txt

STEP=migrations
cd "$EAIOS_ROOT"
# Use the fixed runner even when rolling back to code without update tooling.
EAIOS_MIGRATIONS_DIR="$EAIOS_ROOT/migrations" node "$EAIOS_UPDATE_RUNTIME/run-migrations.mjs"
STEP='service installation'
./scripts/install-systemd-user.sh
STEP='service restart'
for unit in eaios-hermes-serve eaios-knowledge-sidecar eaios-server eaios-server-5173; do
  systemctl --user enable "$unit"
  systemctl --user restart "$unit"
done
STEP=verification
./scripts/verify-install.sh
SUCCESS=1
echo "EAiOS $ACTION complete: $OLD_VERSION @ $OLD_SHA -> $(version) @ $(git rev-parse HEAD)"
