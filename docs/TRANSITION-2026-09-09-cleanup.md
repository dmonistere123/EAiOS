# EAiOS → Cleanup Session Transition

**Date:** 2026-09-09 · **Repo:** `https://github.com/dmonistere123/EAiOS` · **Branch:** `main` · **Head:** `96298b6`

## Current state

- **Git:** clean working tree, `main` fully synced with GitHub
- **Tests:** 311 passed, 10 skipped
- **Build:** clean
- **Services:** all four `eaios-*` units active, `:5200` responding
- **Latest commit:** `96298b6` — approval decision persistence + kanban parent ids

## What has been done

### 1. Deferred browser-automation booking code — DONE
- `app/server/travelBrowser/` moved to `archive/server-travelBrowser-2026-09-09/travelBrowser/`
- `app/src/tests/travelBrowser.test.ts` and `app/src/tests/travel-vault.test.tsx` moved to `archive/tests-2026-09-09/`
- `docs/design-browser-booking-2026-09-05.md` and `docs/deliverable-opentable-harden-2026-09-05.md` moved to `docs/archive/`
- All code references removed from adapters, server, Travel UI, fixtures, and domain types
- 266 tests pass (no skips, no failures); build green

### 2. Travel page scope
- Travel is currently `Travel (RM)` — roadmap demo with mock hotels/cars/restaurants and live Duffel flights only.
- Decide whether beta keeps this demo state or removes the Travel nav item entirely.

**Recommendation:** Keep `Travel (RM)` for beta demos, but ensure the page clearly states what is live vs. mock.

### 3. Agent-name rollout
- `VITE_AGENT_NAME` is configurable and the installer prompts for it.
- Verify no user-facing "Ally" strings remain outside comments/fixtures.

### 4. Documentation consolidation
- `docs/HANDOFF.md` — keep as the running session handoff
- `docs/HANDOFF-2026-09-05-archive.md` — archive of older handoff
- `docs/HANDOFF-2026-09-08-archive.md` — archive of older handoff
- `docs/TRANSITION-2026-09-04.md` — older transition doc
- `docs/TRANSITION-2026-09-05-beta.md` — beta readiness doc
- `docs/INSTALL.md` — installer docs

**Cleanup:** Decide which archive docs can be deleted or moved to an `archive/` folder.

### 5. Environment / secrets for beta box
- `app/.env.local` is gitignored and must be recreated on the beta box.
- Confirm the beta box will have:
  - `VITE_HERMES_TOKEN`
  - `COMPOSIO_API_KEY`
  - `DUFFEL_API_KEY`
  - `VITE_AGENT_NAME`
  - `OPENROUTER_API_KEY` in `~/.hermes/.env`

### 6. Installer hardening
- `install/install.sh` has not been run end-to-end on a truly fresh box from curl.
- Test the curl path and the SSH-key / GitHub-auth flow.

### 7. Final smoke test
- Verify `:5200`, `/travel`, `/assistant`, `/schedule`, `/today`, `/staff`, `/knowledge` all load.
- Verify voice I/O in Assistant (browser dependent).
- Verify Ask Ally flight search returns results if `DUFFEL_API_KEY` is set.

## Exact command for the next session

> "Continue EAiOS cleanup from the 2026-09-09 transition. Read `~/eaios/docs/TRANSITION-2026-09-09-cleanup.md`, `~/eaios/docs/HANDOFF.md`, and `~/eaios/docs/TRANSITION-2026-09-05-beta.md`. Verify services with `systemctl --user status 'eaios-*'`, run `cd ~/eaios/app && npm test`, and start with the deferred browser-automation code: decide whether to archive it, remove it, or flag it for post-beta."

## Suggested first cleanup task

Create a kanban task: **"Archive or remove deferred browser-automation travel booking code"** — body should include the file list above and the go/no-go criteria for beta.
