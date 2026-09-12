#!/usr/bin/env bash
# Start the EAiOS knowledge sidecar (loopback :9121). Deps live in .venv
# (recreate: uv venv .venv && uv pip install --python .venv/bin/python pymupdf python-docx python-pptx podcastfy)
set -euo pipefail

# Load Hermes/provider API keys (OpenRouter, etc.) as environment variables
# so Podcastfy can reach the configured LLM. `set -a` exports every assignment
# in the sourced file.
HERMES_ENV="${HERMES_HOME:-$HOME/.hermes}/.env"
if [[ -f "$HERMES_ENV" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$HERMES_ENV"
  set +a
fi

cd "$(dirname "$0")/../sidecar"
exec .venv/bin/python server.py
