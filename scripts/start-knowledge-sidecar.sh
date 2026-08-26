#!/usr/bin/env bash
# Start the EAiOS knowledge sidecar (loopback :9121). Deps live in .venv
# (recreate: uv venv .venv && uv pip install --python .venv/bin/python pymupdf python-docx python-pptx)
set -euo pipefail
cd "$(dirname "$0")/../sidecar"
exec .venv/bin/python server.py
