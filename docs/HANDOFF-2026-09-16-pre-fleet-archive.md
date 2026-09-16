# EAiOS — session handoff

**Updated:** 2026-09-16 (CDT) · **Repo:** `~/eaios` · **Branch:** `main` · **Base commit:** `d02b408`

## Updater hardening

Fixed the defects found in the September 16 review:

- Every attempt rebuilds/restarts/verifies, including the same commit. Failed or interrupted deployments can be retried.
- A flock lock prevents concurrent updates; dirty tracked and untracked work is refused.
- Targets are recorded separately from the final checkout. Rollback excludes no-op and rollback attempts and uses the pre-update SHA of the latest code-changing attempt, including a failed attempt.
- Rollback works offline. The running Bash script, audit helper, and migration runner are copied outside the checkout, so old releases without updater files still finish logging.
- Stage failures, SIGINT, and SIGTERM finish the audit record with an error and timestamp. Logs use full SHAs for new attempts; legacy schemas are extended with action and target SHA columns.
- SQL migrations execute as whole scripts inside transactions with their ledger entry; comments, triggers, and quoted semicolons work. Duplicate IDs and checksum changes fail before pending work.
- SQLite online backups include committed WAL records and are kept privately beside the database in `eaios-migration-backups/` before pending migrations.
- Missing version manifests and failed/malformed live version requests report unavailable, not mock versions. Production captures the configured distribution manifest at startup so a still-running process cannot claim a newly rebuilt version.
- Stable build labels require a matching stable SemVer tag and a clean tree. Dirty builds are labeled dev with a Local changes badge. Removed the unpublished hardcoded Settings target.
- Releases reject untracked files, gate on application tests/build, synchronize package and lockfile versions, and push the release commit and tag atomically.

## Validation

- 17 isolated updater/migration/release tests pass, including all install/build/service/verification failure stages, retries, rollback selection, offline rollback, rollback without old tooling, interrupts/locking, and release metadata/publication guards.
- 46 focused application tests pass across Settings, production server, and dogfood fixes.
- Isolated production build and Bash syntax checks pass. The existing bundle-size/config-loader warnings remain.
- The earlier full application run had two failures: the dismissed-items timeout and an outdated Assistant bridge mock. The bridge failure was reproduced with the committed adapter before these changes; neither is part of this updater slice. Releases correctly stop if application tests are failing.
- No real updater/migrations/provider calls or service restarts were performed against this box during validation.

## Operating contract and remaining design work

A failed attempt does not automatically restore code or services. Inspect the error, retry the updater, or deliberately invoke rollback. Rollback rebuilds the earlier code and retains current shared Hermes data. Migrations must remain forward-compatible; blindly restoring shared state can discard work/chat written by other processes since the backup. Database recovery requires stopping all writers and reviewing intervening activity.

Default branch updates are preserved. Latest-tag/major-boundary selection, Hermes minimum-version enforcement, fleet visibility, and coordinated automatic deployment/data restoration remain separate roadmap work. Backups currently have manual retention.

## Files

Updater and helpers are in `scripts/`; regression tests are `scripts/tests/updater.test.mjs`. Migration rules and backup handling are documented in `migrations/README.md`; operational guidance is in `docs/INSTALL.md`. The September 14 design document has a hardening follow-up that distinguishes implemented behavior from future design work.
