#!/usr/bin/env bash
# EAiOS release helper.
#
# Usage:
#   ./scripts/release.sh v0.2.0
#
# What it does:
#   1. Validates the version argument.
#   2. Ensures the working tree is clean and we are on main/master.
#   3. Bumps app/package.json version.
#   4. Commits and tags the release.
#   5. Pushes commit + tag to origin.
#
# After this, shipped boxes can be updated with:
#   ./scripts/eaios-update.sh --to v0.2.0
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 v<major>.<minor>.<patch>" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be in format v<major>.<minor>.<patch> (e.g. v0.2.0)" >&2
  exit 1
fi

PLAIN_VERSION="${VERSION#v}"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$BRANCH" != "main" && "$BRANCH" != "master" ]]; then
  echo "Releases must be cut from main or master (current: $BRANCH)" >&2
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash changes first." >&2
  exit 1
fi

if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Tag $VERSION already exists." >&2
  exit 1
fi

echo "==> Releasing EAiOS $VERSION"

# Keep the lockfile consistent and validate before publishing a release.
cd "$REPO_ROOT/app"
npm test
npm version "$PLAIN_VERSION" --no-git-tag-version
npm run build
cd "$REPO_ROOT"
git add app/package.json app/package-lock.json
git commit -m "release: $VERSION"
git tag -a "$VERSION" -m "EAiOS $VERSION"
git push --atomic origin "$BRANCH" "$VERSION"

echo "==> Released $VERSION. Update boxes with: ./scripts/eaios-update.sh --to $VERSION"
