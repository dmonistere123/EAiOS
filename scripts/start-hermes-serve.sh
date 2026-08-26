#!/usr/bin/env bash
# Start hermes serve for EAiOS live mode. Token is read from the file, never inlined.
set -euo pipefail
export HERMES_DASHBOARD_SESSION_TOKEN="$(cat "$HOME/.hermes/.eaios-dev-token")"
exec hermes serve --host 127.0.0.1 --port 9119
