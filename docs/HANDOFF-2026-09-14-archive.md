# EAiOS — Session Handoff

**Updated:** 2026-09-14 (release update system) · **Repo:** `~/eaios` · **Branch:** `main` · **Head:** `b04d532`

## What just happened

### EAiOS release/update/rollback system (kanban t_51c5cf5e)

Don answered the open questions from `design-update-path-2026-09-14.md`:
- ✅ Shipped boxes have outbound git access.
- ✅ Updates do **not** require an EAiOS approval envelope.
- ✅ Rollback to previous known-good version is required.
- ✅ Releases follow calendar cadence: monthly minor, quarterly major.

The design doc was updated and the following shipped:

**`scripts/eaios-update.sh`** — standalone update command for shipped boxes:
- Default mode: `git pull --ff-only origin` current branch, rebuild, restart (existing behavior preserved).
- `--to v0.2.0` mode: fetches tags, checks out that specific tag/branch/commit, rebuilds.
- `--rollback` mode: queries `eaios_update_log` for the last successful update's `old_git_sha`, checks it out, rebuilds, restarts.
- All modes: run migrations, re-render systemd units, restart services, run verify-install, log to state.db.
- Rollback target is read from the `eaios_update_log` table (successful, with `old_git_sha`), fails loudly if unavailable.

**`scripts/release.sh vX.Y.Z`** — release helper:
- Validates version format, clean tree, main branch, no existing tag.
- Bumps `app/package.json`, commits, tags (`vX.Y.Z`), pushes to origin.
- Intended for monthly minor / quarterly major releases.

**`scripts/generate-version.mjs`** — updated to include:
- `gitTag`: nearest semver tag reachable from HEAD (uses `describe --tags --match "v*"`).
- `releaseChannel`: `stable` (on a tag), `rc` (≤10 commits after a tag), `dev` (otherwise).
- stderr suppressed for clean `npm run build` output.

**`/api/version`** (server/apiCore.ts → httpApi.ts) — returns `{current: BuildVersion, log: UpdateLogEntry[]}`.

**Settings page** (`src/pages/Settings.tsx`) — new Version & updates panel:
- Current version (large), Git SHA, branch, build time, release channel badge.
- Copy-to-clipboard update commands (`eaios-update.sh --to vX.Y.Z`, `eaios-update.sh --rollback`).
- Update history (last 10 entries from `eaios_update_log`).

**Adapter interface** (`src/adapters/interfaces.ts`) — `getVersionInfo(): Promise<VersionInfo>` added on both mock and live adapters.

## Current state

- **Tests:** 37 files, 284 tests pass (1 pre-existing flaky in `interactions.test.tsx`).
- **Build:** clean — `dist/assets/index-Cg08g9Gn.js` (596 kB).
- **Services:** all four EAiOS units active.

## Env configuration

- App: `~/eaios/app/.env.local` has `VITE_HERMES_LIVE=1`, token, `COMPOSIO_API_KEY`, `DUFFEL_API_KEY`.
- Sidecar: `~/eaios/sidecar/.env` holds podcast provider keys (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, plus Podcastfy defaults). The systemd start script sources this file; restart the sidecar after edits.

## What to tell the next Ally

> "Podcasts module is prod-ready: Podcastfy + Edge/ElevenLabs/OpenAI TTS, voice preview via `/podcasts/sample-tts`, and the page layout is upload/voices at top, player center, history right rail. Installer now sets up the sidecar venv from `requirements.txt`, creates `sidecar/.env` from `.env.example`, and installs Playwright best-effort. The EAiOS front-door service `eaios-server-5173.service` now uses `Restart=always` + `StartLimitIntervalSec=0` so Tailscale access via :5173 recovers automatically after any exit. Build is green; the one failing app test is the same pre-existing flaky `interactions.test.tsx` timeout."

## Open items

- Pre-existing flaky `interactions.test.tsx` dismissed-items timeout.
- Google Podcast API remains blocked by GCP entitlement; treat Podcastfy as the working provider.
