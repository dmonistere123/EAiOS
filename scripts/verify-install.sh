#!/usr/bin/env bash
# EAiOS post-install verification.
# Safe to run by hand: scripts/verify-install.sh
set -euo pipefail

EAIOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

red() { echo -e "\033[1;31m$*\033[0m"; }
green() { echo -e "\033[1;32m$*\033[0m"; }
yellow() { echo -e "\033[1;33m$*\033[0m"; }

ERRORS=0
warn() { yellow "⚠ $*"; ((ERRORS++)) || true; }
fail() { red "✗ $*"; ((ERRORS++)) || true; }
ok() { green "✓ $*"; }

# Portable listener check. ss/netstat may be missing in very minimal containers.
port_is_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -tln 2>/dev/null | grep -q "127\.0\.0\.1:${port}\b"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -tln 2>/dev/null | grep -q "127\.0\.0\.1:${port}\b"
  else
    # /proc/net/tcp: hex local-address:port, 0100007F:23A3 = 127.0.0.1:9123
    local hex_port
    hex_port="$(printf '%04X' "$port")"
    grep -qi "0100007F:${hex_port}" /proc/net/tcp 2>/dev/null
  fi
}

# ---------------------------------------------------------------------------
# Service state
# ---------------------------------------------------------------------------
echo "==> systemd user units"
for unit in eaios-hermes-serve eaios-knowledge-sidecar eaios-server eaios-server-5173; do
  if systemctl --user is-active --quiet "$unit"; then
    ok "$unit is active"
  else
    fail "$unit is not active"
    systemctl --user status "$unit" --no-pager -l || true
  fi
done

for unit in eaios-hermes-serve eaios-knowledge-sidecar eaios-server eaios-server-5173; do
  if systemctl --user is-enabled --quiet "$unit" 2>/dev/null; then
    ok "$unit is enabled"
  else
    warn "$unit is not enabled"
  fi
done

# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------
echo "==> listening ports"
# Give services a few seconds to bind after a fresh restart.
for attempt in 1 2 3 4 5 6; do
  MISSING=""
  for port in 9119 9121 5200 5173; do
    if ! port_is_listening "$port"; then
      MISSING="$MISSING $port"
    fi
  done
  if [[ -z "$MISSING" ]]; then
    break
  fi
  if [[ "$attempt" -lt 6 ]]; then
    sleep 3
  fi
done
for port in 9119 9121 5200 5173; do
  if port_is_listening "$port"; then
    ok "port $port listening"
  else
    fail "port $port not listening"
  fi
done

# ---------------------------------------------------------------------------
# HTTP endpoints
# ---------------------------------------------------------------------------
echo "==> HTTP health checks"

# Knowledge sidecar
if curl -fsS http://127.0.0.1:9121/health >/dev/null 2>&1; then
  ok "knowledge sidecar /health (127.0.0.1:9121)"
else
  fail "knowledge sidecar /health unreachable"
fi

# EAiOS prod server :5200
if curl -fsS http://127.0.0.1:5200/ >/dev/null 2>&1; then
  ok "EAiOS prod server / (127.0.0.1:5200)"
else
  fail "EAiOS prod server :5200 unreachable"
fi

# EAiOS prod server :5173
if curl -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
  ok "EAiOS front-door server / (127.0.0.1:5173)"
else
  fail "EAiOS front-door server :5173 unreachable"
fi

# Hermes gateway WS (check TCP accept with the dev token)
HERMES_TOKEN="$(cat "$HOME/.hermes/.eaios-dev-token" 2>/dev/null || true)"
if [[ -n "$HERMES_TOKEN" ]] && timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/9119; echo -e \"GET /api/ws?token=${HERMES_TOKEN} HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n\" >&3; head -1 <&3" >/dev/null 2>&1; then
  ok "Hermes gateway accepts WS connections (127.0.0.1:9119)"
else
  warn "Hermes gateway connection check inconclusive (may need a token)"
fi

# ---------------------------------------------------------------------------
# Files / config
# ---------------------------------------------------------------------------
echo "==> config files"
if [[ -f "$HOME/.hermes/.eaios-dev-token" ]]; then
  ok "EAiOS dev token file exists"
else
  fail "EAiOS dev token file missing"
fi

if [[ -f "$EAIOS_ROOT/app/.env.local" ]]; then
  ok "app/.env.local exists"
else
  fail "app/.env.local missing"
fi

if [[ -f "$EAIOS_ROOT/app/dist/index.html" ]]; then
  ok "production build dist/index.html exists"
else
  fail "production build missing"
fi

if [[ -x "$EAIOS_ROOT/sidecar/.venv/bin/python" ]]; then
  ok "sidecar .venv exists"
else
  fail "sidecar .venv missing"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ "$ERRORS" -eq 0 ]]; then
  green "All checks passed."
  exit 0
else
  red "$ERRORS check(s) failed. Review output above."
  exit 1
fi
