#!/usr/bin/env bash
# Render + install EAiOS user-mode systemd units (Phase 8.2/8.3).
# Templates: install/systemd/*.tpl → ~/.config/systemd/user/*.service
# Idempotent: safe to re-run.
#
# Usage:
#   scripts/install-systemd-user.sh        # render + enable only
#   scripts/install-systemd-user.sh --start  # render + enable + restart now
set -euo pipefail

EAIOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
EAIOS_DATA_ROOT="${EAIOS_DATA_ROOT:-$EAIOS_ROOT}"
EAIOS_REPO_ROOT="${EAIOS_REPO_ROOT:-$EAIOS_DATA_ROOT}"
UNIT_DIR="$HOME/.config/systemd/user"
NODE_BIN="$(command -v node || true)"

if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found on PATH — install Node >= 24 first." >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" --version | sed 's/^v//; s/\..*//')"
if (( NODE_MAJOR < 24 )); then
  echo "ERROR: node $("$NODE_BIN" --version) is below the required >= 24 (node:sqlite)." >&2
  exit 1
fi

if [[ ! -x "$EAIOS_ROOT/sidecar/.venv/bin/python" ]]; then
  echo "ERROR: sidecar .venv not found at $EAIOS_ROOT/sidecar/.venv" >&2
  echo "       Run: cd $EAIOS_ROOT/sidecar && uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt" >&2
  exit 1
fi

# Install EAiOS-managed publishing instructions and executor for this release.
if [[ -f "$EAIOS_ROOT/scripts/install-linkedin-workflow.py" ]]; then
  "$EAIOS_ROOT/sidecar/.venv/bin/python" "$EAIOS_ROOT/scripts/install-linkedin-workflow.py"
fi

mkdir -p "$UNIT_DIR"
for tpl in "$EAIOS_ROOT"/install/systemd/*.tpl; do
  name="$(basename "$tpl" .tpl)"
  if [[ -f "$UNIT_DIR/$name" ]]; then
    echo "rendering (overwrite) $UNIT_DIR/$name"
  else
    echo "rendering $UNIT_DIR/$name"
  fi
  sed -e "s|@HOME@|$HOME|g" \
      -e "s|@EAIOS_ROOT@|$EAIOS_ROOT|g" \
      -e "s|@NODE_BIN@|$NODE_BIN|g" \
      -e "s|@EAIOS_DATA_ROOT@|$EAIOS_DATA_ROOT|g" \
      -e "s|@EAIOS_REPO_ROOT@|$EAIOS_REPO_ROOT|g" \
      -e "s|@HERMES_HOME@|$HERMES_HOME|g" \
      "$tpl" > "$UNIT_DIR/$name"
done

systemctl --user daemon-reload
for tpl in "$EAIOS_ROOT"/install/systemd/*.tpl; do
  name="$(basename "$tpl" .tpl)"
  if [[ "$name" == eaios-update-check.service ]]; then continue; fi
  if [[ "$name" == *.timer ]]; then systemctl --user enable --now "$name"; else systemctl --user enable "$name"; fi
  echo "enabled $name"
done

# Boot persistence without an interactive login session.
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]]; then
  echo "NOTE: enable linger so units start at boot without an interactive login:"
  echo "      sudo loginctl enable-linger $USER"
fi

if [[ "${1:-}" == "--start" ]]; then
  for tpl in "$EAIOS_ROOT"/install/systemd/*.tpl; do
    name="$(basename "$tpl" .tpl)"
    if [[ "$name" == eaios-update-check.service || "$name" == *.timer ]]; then continue; fi
    systemctl --user restart "$name"
    echo "started $name"
  done
fi

echo "done. Check status with: systemctl --user status 'eaios-*'"
