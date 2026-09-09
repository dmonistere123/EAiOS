# EAiOS — Session Handoff

**Updated:** 2026-09-05 · **Repo:** `~/eaios` · **Branch:** `master` · **Head:** `64f2f50`

## What just happened

This session built the **EAiOS one-command installer** (`install/install.sh`),
updated the systemd unit templates (including the new `:5173` front-door
service), added `app/.env.local.example`, created `scripts/verify-install.sh`,
and updated `docs/clean-install-guide.md` Phase 8 to use the installer. The
installer was exercised end-to-end on this box with all services passing
verification.

Previous sessions pivoted the Travel page to **roadmap status** and shipped
**voice I/O on My Assistant**.

### Travel (F31) → roadmap demo state
- Left nav label changed from **Travel** to **Travel (RM)** so Don can point out roadmap status in demos.
- Live flight search via **Duffel** is configured and verified (`DUFFEL_API_KEY` in `app/.env.local`).
- Hotels, cars, and restaurants remain **mock/demo only** until a live provider or browser-automation path is built.
- The earlier browser-automation foundation (`server/travelBrowser/`, `docs/design-browser-booking-2026-09-05.md`) is preserved but its tests are skipped; the per-site IHG/Marriott/OpenTable/Resy playbook hardening is deferred.

### My Assistant voice I/O
- New `src/hooks/useVoice.ts` wrapping the browser Web Speech API.
- Mic button in the Assistant composer: speech-to-text fills the draft and auto-sends.
- Speaker button on every Ally message: text-to-speech playback.
- Graceful fallback when the browser does not support voice.

### Other fixes
- `server/travel.ts` error messages now use `TravelApiError.message` instead of `String(e)` to avoid the literal "Error:" prefix.
- `TravelAgent` propagates 503 when no live provider is configured so the live adapter falls back to mock fixtures.

## Current state

- **Tests:** 304 passed, 10 skipped (37 test files). The 10 skipped tests are the deferred browser-automation travel vault/playbook tests.
- **Build:** clean production build in `~/eaios/app/dist`.
- **Services:** all four `eaios-*` systemd user services active:
  - `eaios-hermes-serve` :9119
  - `eaios-knowledge-sidecar` :9121
  - `eaios-server` :5200
  - `eaios-server-5173` :5173 (front-door prod instance)
- **Installer:** `install/install.sh` is the canonical one-command installer;
  `scripts/verify-install.sh` passes all checks on this box.
- **Commits:** some work is committed (`64f2f50` Travel RM label); substantial uncommitted work remains across F31, voice I/O, travel-browser foundation, and the installer.
- **No remote configured.**

## Env configuration

`~/eaios/app/.env.local` currently contains:
- `VITE_HERMES_LIVE=1`
- `VITE_HERMES_TOKEN=<redacted>`
- `COMPOSIO_API_KEY=<redacted>`
- `DUFFEL_API_KEY=<redacted>`

`~/.hermes/.env` contains `OPENROUTER_API_KEY` (used by Ask Ally travel intent parser and Hermes crons).

## What to tell the next Ally

Start the new session with:

> "Continue EAiOS from the 2026-09-05 handoff. Read `~/eaios/docs/HANDOFF.md`, `~/eaios/docs/ROADMAP.md`, and `~/eaios/docs/TRANSITION-2026-09-04.md`. Verify services with `systemctl --user status 'eaios-*'` and run `cd ~/eaios/app && npm test` before making changes."

If the next task is one of these, include it explicitly:

- **EAiOS installer is done:** `install/install.sh` and `scripts/verify-install.sh` are ready; the next step is to test on a truly fresh box (e.g. openclawserver) and set a real git remote/URL.
- **Travel live providers:** add `TRAVEL_BROWSER_USE=1` + `CHROME_BIN` and a Booking.com single-provider playbook, or integrate a T&E platform (Navan/Spotnana/TravelPerk).
- **Travel in-app credential manager:** build the UI for the encrypted vault when browser booking is revived.
- **Push commits:** add a git remote and push `master`.
- **New functional fix:** state the page and the exact behavior wanted.

## Open items for Don

- Review the EAiOS installer (`install/install.sh`) and decide the public repo
  URL / host for the one-command curl path.
- Decide whether to revive browser-automation booking or pursue a T&E platform integration.
- Decide whether to add a git remote and push.

## Historical handoffs

Older session state is preserved in `docs/HANDOFF-2026-09-05-archive.md` and `docs/TRANSITION-2026-09-04.md`.
