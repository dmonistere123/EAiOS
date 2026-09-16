# EAiOS Update Path — Options for Shipped Boxes

**Date:** 2026-09-14  
**Context:** Boxes installed last week do not have this week's code changes. The EAiOS installer is idempotent but there is no dedicated update/rollback/migration path.  
**Kanban:** t_8e9b8def

## Current state

- `install/install.sh` is idempotent: re-running it pulls the repo, runs `npm ci`, builds, refreshes the sidecar venv, and restarts services.
- `app/package.json` version is `0.0.0`; there is no release/version manifest.
- No migration runner exists. Schema/data changes (e.g. new SQLite tables, new settings keys, new env vars) rely on the installer or code being backward-compatible.
- Three categories of state are **not** in the repo and must be preserved across updates:
  1. `app/.env.local` and `sidecar/.env` (secrets, provider keys, agent name).
  2. `~/.hermes/` profile config, credentials, SOUL.md, kanban DB, cron DB, state DB.
  3. Runtime data: `settings.local.json`, sidecar SQLite, generated artifacts, attached files.

## Options

### Option A — Document the re-run installer path (do nothing to code)

Shipped boxes run `./install/install.sh` (local repo) or re-run the curl-pipe command when you announce an update.

- **Pros:** Works today. Preserves `.env.local` and `.env`. Pulls latest code, rebuilds, restarts.
- **Cons:** Manual per box. No rollback. No migration runner. No visibility into what version each box is on. Breakage only surfaces after services restart.
- **Risk:** 4/10 — installer is already idempotent, but schema drift or new required env vars can silently break a box.
- **Complexity:** 1/10 — documentation only.
- **Estimate:** 30 min.

### Option B — Add a dedicated `eaios-update.sh` script

A wrapper in `scripts/eaios-update.sh` that:

1. `git fetch`/`git pull` from the configured remote/branch.
2. `npm ci` + `npm run build`.
3. `uv pip install` sidecar deps.
4. Run any repo-provided migrations in `migrations/` (numbered SQL/JS files, tracked in a local `_eaios_migrations` table).
5. Re-render systemd units if templates changed.
6. Restart services.
7. Run `scripts/verify-install.sh`.
8. Write a `~/eaios/.update-log` entry with old→new git SHA, timestamp, result.

- **Pros:** One command. Can be run by cron or by a support agent. Creates an audit trail. Migration hook exists for schema changes.
- **Cons:** Still no automatic rollback. Requires SSH/admin access to the box. Does not show version in the EAiOS UI.
- **Risk:** 3/10 — script can stop and report failure before restarting services; migrations must be idempotent.
- **Complexity:** 4/10 — mostly wiring existing steps plus a small migration runner.
- **Estimate:** 1 session.

### Option C — Version-aware updater with in-app status

Build on Option B and add:

- A `version.json` generated at build time (git SHA + build timestamp + semver).
- `GET /api/version` returns the running build.
- A Settings page panel shows current version, latest available from the remote, and update history.
- A cron job (or manual "Check for updates" button) can run `eaios-update.sh` and report success/failure.

- **Pros:** CEOs can see version status without SSH. Support calls become "what version are you on?" instead of guessing.
- **Cons:** More UI work. The "update available" check needs network access to the repo/branch.
- **Risk:** 4/10 — UI is read-only; the actual update still runs a privileged script.
- **Complexity:** 6/10 — build-time version file, API, UI panel, history store.
- **Estimate:** 2 sessions.

### Option D — Fully automatic OTA updates

A systemd timer or cron runs `eaios-update.sh` nightly, pulling the configured branch and restarting services if changed.

- **Pros:** Zero touch for shipped boxes.
- **Cons:** High blast radius if a bad commit ships. No scheduled maintenance window. Harder to debug failures remotely. Goes against the EAiOS approval-gate culture for external/state-changing actions.
- **Risk:** 8/10 — automatic restart of the exec's dashboard without approval is risky.
- **Complexity:** 5/10 — mostly Option B plus a timer and failure alerting.
- **Estimate:** 1–2 sessions.

## Recommendation

**Start with Option B** (`scripts/eaios-update.sh` + migration hook), then add Option C's version API/Settings panel as a fast follow.

Rationale:

- Option B gives you a repeatable, auditable command you can run yourself or ask a customer to run.
- The migration hook future-proofs schema/data changes as EAiOS moves from demo boxes to production CEO deployments.
- It preserves the approval-gate culture: an update is a deliberate action, not a silent background change.
- Option C's UI visibility makes support scalable without adding the risk of Option D.

## What would ship

1. `scripts/eaios-update.sh` — the update wrapper.
2. `migrations/` directory with a `README.md` and one sample idempotent migration.
3. A small `scripts/run-migrations.mjs` runner using Node `node:sqlite`.
4. `scripts/generate-version.mjs` — build-time version manifest generator.
5. `app/public/version.json` — generated build manifest (git SHA, version, branch, tag, release channel, timestamp).
6. `server/apiCore.ts` `GET /api/version` endpoint + `readBuildVersion` + `readUpdateLog`.
7. `server/httpApi.ts` — routed `/api/version`.
8. `server/vite.config.ts` — deferred to shared router in dev.
9. Settings page "Version & updates" panel (current build info + update history tail).
10. Adapter interfaces + live + mock implementations of `getVersionInfo()`.
11. App version bumped to `0.1.0`.
12. Update docs in `docs/INSTALL.md` and `docs/clean-install-guide.md`.

### Status (2026-09-14)

All of the above is **implemented and tested**. The prod-server test suite (16 tests) passes including the new `/api/version` endpoint test. Migrations run idempotently against `~/.hermes/state.db`. The Settings page shows the version panel in both live and mock modes.

## Executive decisions (2026-09-14)

1. ✅ Shipped boxes have outbound git access.
2. ✅ Updates do **not** require an EAiOS approval envelope.
3. ✅ Rollback to a previous release is required.
4. ✅ Releases follow a calendar cadence: **monthly minor releases, quarterly major releases**. The underlying Hermes desktop/runtime will also be updated and must remain functional. The deployed fleet's current version must be visible so updates can be targeted.

---

# Refined design: EAiOS release + update system

## Release model

- **SemVer tags** in the EAiOS repo: `v{major}.{minor}.{patch}`.
  - **Major** bumps quarterly (Jan/Apr/Jul/Oct).
  - **Minor** bumps monthly.
  - **Patch** is reserved for hotfixes between releases.
- A Git tag is the source of truth for what ships. `master`/`main` stays the integration branch; only tagged commits are considered "releases" the updater will pull.
- `app/package.json` version is bumped to the tag version at release time by a `scripts/release.sh` helper.

## Version manifest

At build time, generate `app/public/version.json`:

```json
{
  "version": "1.2.3",
  "gitSha": "b04d532",
  "gitBranch": "main",
  "tag": "v1.2.3",
  "builtAt": "2026-09-14T18:00:00Z",
  "hermesDesktopMin": "0.21.0"
}
```

This file is served statically and read by:
- `GET /api/version` (returns the manifest + running service status).
- The EAiOS Settings page.
- A future "Fleet" view or support script.

## Update architecture

### `scripts/eaios-update.sh`

The canonical update command on every box. It is safe to re-run and can be invoked manually, by a cron job, or remotely via SSH.

Flow:

1. Read current version from `~/eaios/app/public/version.json`.
2. `git fetch --tags`.
3. Determine target version:
   - If run as `eaios-update.sh`: update to latest tag matching the current major line (e.g. `v1.x.x`).
   - If run as `eaios-update.sh --to v1.3.0`: update to that exact tag.
   - If run as `eaios-update.sh --major`: allow crossing major boundaries.
4. If already on target, exit 0 with "already up to date".
5. Capture pre-update snapshot:
   - Current git SHA/tag.
   - Database backups: `~/.hermes/kanban.db`, sidecar SQLite, `settings.local.json`.
   - Migration undo log (for migrations that support rollback).
6. `git checkout <tag>`.
7. Run `npm ci` and `npm run build`.
8. Refresh sidecar venv: `uv pip install -r requirements.txt`.
9. Run forward migrations up to the target version via `scripts/run-migrations.mjs`.
10. Re-render systemd units with `scripts/install-systemd-user.sh`.
11. Restart services (`systemctl --user restart eaios-*`).
12. Run `scripts/verify-install.sh`.
13. If verify fails, **automatically roll back** to the pre-update snapshot (see Rollback below).
14. Append result to `~/eaios/.update-log.jsonl`.

### `scripts/eaios-rollback.sh`

Rolls the box back to the release it was on before the last update.

Flow:

1. Read last update entry from `.update-log.jsonl`.
2. Stop EAiOS services.
3. `git checkout <previousTag>`.
4. `npm ci` + `npm run build` at that tag.
5. Run reverse migrations (only for migrations that provide a `down.sql`/`down.mjs`).
6. Restore backed-up databases/settings if the update mutated them.
7. Re-render units and restart.
8. Verify.

> **Limitation:** Rollback is best-effort for DB schema changes. The safest rollback is restoring the pre-update DB backups; reverse migrations are a bonus for simple additive changes.

## Migration system

- Migrations live in `migrations/` as numbered files:
  - `0001-create-podcast-episodes-table.up.sql`
  - `0001-create-podcast-episodes-table.down.sql`
  - `0002-add-settings-key.mjs` (for non-SQL changes)
- A small Node runner (`scripts/run-migrations.mjs`) tracks applied migrations in `~/eaios/.migrations.db` (or a table in the sidecar SQLite).
- Migrations are applied idempotently and tagged with the release they ship in.
- Each migration must declare whether it is reversible; irreversible migrations trigger a stronger pre-update backup warning.

## Hermes desktop/runtime update

Hermes desktop is updated separately from EAiOS, but the two are coupled:

- `scripts/eaios-update.sh` reads `hermesDesktopMin` from the target `version.json`.
- If the installed Hermes version is below the minimum, the script runs `hermes update` before rebuilding EAiOS.
- `hermes update` is idempotent and pulls the latest Hermes Agent; if Hermes later supports channel/pinned updates, we can pass a matching version.
- After Hermes update, the gateway service (`eaios-hermes-serve`) is restarted so the new runtime is loaded.

## Fleet visibility

Two complementary views:

### 1. Per-box `/api/version`

Any EAiOS box exposes:

```json
{
  "version": "1.2.3",
  "tag": "v1.2.3",
  "gitSha": "b04d532",
  "builtAt": "2026-09-14T18:00:00Z",
  "services": {
    "eaios-hermes-serve": "active",
    "eaios-knowledge-sidecar": "active",
    "eaios-server": "active",
    "eaios-server-5173": "active"
  },
  "hermesVersion": "0.21.0",
  "latestAvailableTag": "v1.3.0",
  "updateAvailable": true
}
```

The endpoint optionally checks the upstream repo for the latest tag (cached for 5 minutes) so the box can tell you if it's behind.

### 2. Don's EAiOS "Fleet" page (Phase 8 follow-on)

A new page (`/fleet` or a section in Settings) where Don registers deployed boxes by tailnet address or hostname. EAiOS polls each box's `/api/version` and shows:

- Box name / tailnet address
- Current EAiOS version
- Current Hermes version
- Last seen
- Update available?
- One-click "Update this box" (SSH-based or a future agent command)

For now, the first building block is `/api/version`; the Fleet page can be added once the update script is proven.

## Release helper

`scripts/release.sh v1.3.0`:

1. Validate the working tree is clean and on the release branch.
2. Bump `app/package.json` version to `1.3.0`.
3. Commit with message `release: v1.3.0`.
4. Tag `v1.3.0`.
5. Push commit + tag.
6. Optionally trigger a CI build (future).

## Implementation plan

| Step | Deliverable | Risk | Complexity | Estimate |
|---|---|---|---|---|
| 1 | `scripts/release.sh` + `version.json` build injection | 2/10 | 3/10 | 2 hrs |
| 2 | `scripts/eaios-update.sh` (checkout tag, build, verify) | 3/10 | 4/10 | 1 session |
| 3 | Migration runner + sample migration | 3/10 | 4/10 | 1 session |
| 4 | Pre-update snapshot + `scripts/eaios-rollback.sh` | 4/10 | 5/10 | 1 session |
| 5 | Hermes update integration in `eaios-update.sh` | 3/10 | 2/10 | 2 hrs |
| 6 | `GET /api/version` endpoint | 2/10 | 2/10 | 2 hrs |
| 7 | Settings page version/update panel | 2/10 | 3/10 | 1 session |
| 8 | Docs + installer integration (`install/install.sh` seeds update tooling) | 1/10 | 2/10 | 2 hrs |
| **Total** | | | | **~5 sessions** |

## Suggested first slice

Build steps 1–3 first (release script, update script, migration runner). That gives you:
- A repeatable monthly minor release process.
- A one-command update for any shipped box.
- A safety net for schema changes.

Then add rollback (step 4) and visibility (steps 6–7) before the first major release.

## Shipped (2026-09-14)

- `scripts/release.sh` — release helper that bumps `app/package.json`, commits, tags, and pushes.
- `scripts/generate-version.mjs` — build-time `app/public/version.json` generator (version, git SHA/branch/tag, release channel, built-at).
- `scripts/eaios-update.sh` — supports default branch pull, `--to <tag|branch|sha>`, and `--rollback`.
- `scripts/eaios-rollback.sh` — thin wrapper around `eaios-update.sh --rollback`.
- `scripts/run-migrations.mjs` + `migrations/001-init-version-tracking.sql` + `migrations/README.md`.
- `server/apiCore.ts` `readBuildVersion()` / `readUpdateLog()` + `server/httpApi.ts` `GET /api/version`.
- `src/pages/Settings.tsx` "Version & updates" panel (current version, release channel, update history, copyable update/rollback commands).
- `src/adapters/mock/MockHermesAdapter.ts` and `src/adapters/live/LiveHermesAdapter.ts` `getVersionInfo()` implementations.
- Settings test coverage for the version panel.
- Updated `docs/HANDOFF.md` and this design doc.

## Remaining gaps

- Fleet page for multi-box visibility (Phase 8 follow-on; depends on proving the update script on real boxes).
- Pre-update snapshot/DB backup and automatic rollback on verification failure (currently the script stops on error and the log records the outcome).
- Hermes desktop minimum-version enforcement inside `eaios-update.sh`.

## What to commit

- `scripts/release.sh`
- `scripts/eaios-update.sh`
- `scripts/eaios-rollback.sh`
- `scripts/run-migrations.mjs`
- `scripts/generate-version.mjs`
- `migrations/001-init-version-tracking.sql` + `migrations/README.md`
- Build-time `version.json` generation in `app/package.json`
- `server/apiCore.ts` `/api/version` support
- Settings UI panel
- Updated docs


## Hardening follow-up (2026-09-16)

The implementation now preserves the shipped default branch behavior while fixing same-SHA retry, no-op rollback history, failed-attempt rollback targeting, incomplete error logging, detached checkout handling, offline rollback, and rollback into releases without update tooling. The audit helper extends older log schemas in place with `action` and `target_git_sha`; existing API history fields remain compatible.

Migration execution now uses whole SQL scripts and a transaction per migration plus ledger entry. It rejects checksum changes and duplicate IDs, and takes a private online SQLite backup before pending migrations. Version reporting no longer substitutes mock data for live failures, startup manifests identify the running production process, and dirty/non-release tags cannot label a build stable. The Settings update command no longer names an unpublished release.

This is still a deliberate updater, not full automatic recovery. Default latest-tag selection, fleet visibility, Hermes minimum-version enforcement, and automatic deployment/database restoration remain separate design work. Database restoration needs coordination with all writers to the shared Hermes state database; silently restoring a snapshot can destroy activity since the snapshot. The current migration contract therefore requires forward compatibility for code rollback.
