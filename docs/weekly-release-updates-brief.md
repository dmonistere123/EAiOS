# Weekly release discovery and deliberate installation

## Scope

Boxes check published stable GitHub releases weekly, with a randomized delay. Settings offers a manual check, last attempt/success, plain-text release notes, and a separate deliberate installation action. Checks never install anything. No release, failed checks, newer installed versions, unsupported packages, and incomplete installs are distinct states.

## Data and deployment contract

New code is prepared in a detached Git worktree outside the running application. Dependencies and build output belong to that release. `EAIOS_DATA_ROOT` retains the original box directory for authored playbooks, settings, dismissals, knowledge files, podcasts and local credentials; `~/.hermes` remains shared runtime storage. `EAIOS_REPO_ROOT` points to the original repository for trusted GitHub tag fetching. Never replace persistent data with release defaults.

Install only a checked, published stable release with a data-root-compatible release manifest. Revalidate release identity, compare SemVer, check prerequisites, take consistent database backups, and refuse known active delegated/podcast work. Migrations must declare additive compatibility and retain old-code compatibility. Shared databases are never blindly restored during application rollback.

Installation runs in a separate user systemd unit so restarting dashboard processes cannot kill it. Build before activating. On activation/health failure, re-render the previous application's services and verify recovery. Preserve failure status and backups. Weekly timers never start the installer.

## Acceptance

- Weekly persistent timer and manual check use the same cache; failures retain last successful check.
- Release checks ignore drafts/prereleases, never downgrade, and never treat a GitHub/private-auth 404 as current.
- Mutating API actions require same-origin JSON; install requires the checked release identity and an unexpired successful check.
- Preparing/failing/rolling back a release preserves sentinel settings, authored playbooks, credentials, knowledge/podcast files and shared runtime records.
- Settings exposes checking, unavailable/no-release/current/update-available and installation progress/failure/recovery states with mock/live parity.
- New installers enable the weekly timer. Publication of the first stable GitHub release is a separate release operation after validation.
