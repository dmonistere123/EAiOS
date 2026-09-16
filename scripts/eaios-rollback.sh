#!/usr/bin/env bash
# EAiOS rollback helper — thin wrapper around eaios-update.sh --rollback.
#
# Usage:
#   ./scripts/eaios-rollback.sh
#
# This rolls the local EAiOS install back to the version it was on before the
# last successful update. The target is read from the eaios_update_log table
# in ~/.hermes/state.db.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"
exec ./scripts/eaios-update.sh --rollback
