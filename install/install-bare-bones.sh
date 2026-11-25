#!/usr/bin/env bash
# Separate bare-bones fresh installer. Existing installations keep their module selection.
set -euo pipefail
export EAIOS_EDITION=core
export EAIOS_BRANCH="${EAIOS_BRANCH:-v0.1.26}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [[ -f "$script_dir/install.sh" ]]; then
  exec bash "$script_dir/install.sh" "$@"
fi
# For curl-piped usage, fetch the installer from the same pinned release.
installer_file="$(mktemp)"
trap 'rm -f "$installer_file"' EXIT
curl -fsSL https://raw.githubusercontent.com/dmonistere123/EAiOS/v0.1.26/install/install.sh -o "$installer_file"
bash "$installer_file" --repo-url=https://github.com/dmonistere123/EAiOS.git "$@"
