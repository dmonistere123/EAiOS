# EAiOS session handoff

Updated September 16, 2026. Repository: `/home/ally-landry/eaios`, main. Builds on updater hardening commit 2613be9.

## Weekly release management

Settings now displays cached GitHub release status, last successful check, release notes, manual Check for updates, and a separate confirmed Install update action. Only published stable semantic-version GitHub Releases qualify; a pushed tag alone does not. Weekly checks use a persistent systemd timer with up to twelve hours of fixed per-box staggering. Checks never install code.

The installer runs in an independent systemd unit so dashboard restarts do not interrupt it. It validates a fresh candidate and release manifest, stages a detached tagged worktree with independent application and sidecar dependencies, backs up SQLite databases online including WAL, applies additive migrations, then activates and verifies both dashboard build identities. Failures after activation attempt to restore and verify the previous service configuration. Shared databases are never restored backwards automatically. Active delegated or podcast work blocks installation. Interrupted installations report failure and require inspection before retry.

## Persistent locations

EAIOS_DATA_ROOT remains the original checkout and EAIOS_REPO_ROOT remains its Git repository. Settings, dismissals, notifications, playbooks, and sidecar data stay there. HERMES_HOME retains chats, tasks, profiles, credentials, and artifacts. Explicit absolute EAIOS_KNOWLEDGE_DATA_DIR overrides are honored for activity checks and backups. Credentials remain in the original env files, linked into each staged release. Releases live under ~/.local/share/eaios/releases. Cached checks, deployment metadata, install status, locks, and private backups live under HERMES_HOME/eaios.

## Release contract

release-manifest.json declares schema version, matching package version, Node minimum, persistent data support, and additive migration policy. scripts/release.sh gates application tests and build, synchronizes versions, then atomically pushes the commit and tag. It supports publishing the current package version for the first release. A publisher must subsequently create the matching GitHub Release. Public discovery needs no token; an optional read-only token belongs in EAIOS_GITHUB_TOKEN or HERMES_HOME/eaios/github-token, never the browser.

At implementation time GitHub contained no published releases. The first stable release must be pushed and published before shipping. Local tests exercise real staged Git worktrees and SQLite preservation with fake network/build/service commands; an upgrade against a published GitHub release remains a deployment smoke test.

## Validation

299 application tests, 29 updater/release/migration tests, and nine safe sidecar tests pass. Production build passes. Corrected an obsolete JSON chat mock to the existing SSE contract and dismissal tests to await persisted adapter state. No paid provider calls were used. Existing bundle size and Vite configuration warnings remain.

## Operations and remaining work

See INSTALL.md for checking the timer, publication, and recovery. Keep release and backup retention manual for now. Central fleet inventory, remote rollout controls, Hermes runtime upgrades, and travel integrations remain future work. The legacy branch updater is a support tool; Settings uses the staged release installer. Do not rerun the original checkout bootstrap to update a box already running a staged release: that would overwrite its active service paths.
