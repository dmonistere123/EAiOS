# EAiOS — Session Handoff

**Updated:** 2026-09-12 · **Repo:** `~/eaios` · **Branch:** `main`

## What just happened

Shipped the **Podcasts module** to prod-ready state and updated the installer/verifier.

### Podcasts feature (`src/pages/Podcasts.tsx`, `sidecar/`)

- **Upload + generate**: top-of-page card accepts PDF, DOCX, PPTX, TXT, MD.
- **Voice configuration**: TTS provider dropdown (Edge / ElevenLabs / OpenAI) plus host/guest voice inputs.
- **Voice preview**: play buttons next to each voice input call `/podcasts/sample-tts` and play the returned MP3.
- **Current episode**: main player card with play/pause, seek, speed control, download MP3, view transcript.
- **Episode history**: right-rail list; click any item to reload it in the main player.
- **Backend**: sidecar runs Podcastfy with configurable TTS. ElevenLabs voice names are resolved to voice IDs automatically. Google Podcast API integration remains wired but is not surfaced in the UI (it returned 404 for this GCP project and requires Gemini Notebook Enterprise).

### Installer updates (`install/install.sh`)

- Sidecar deps now installed from `sidecar/requirements.txt`.
- Added `sidecar/requirements.txt` containing `podcastfy`, `edge-tts`, `elevenlabs`, `openai`, `playwright`, plus document extraction packages.
- Installer now installs Playwright Chromium browser for Podcastfy URL extraction.
- Installer creates `sidecar/.env` template with optional `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, and commented Google credentials.

### Verification updates (`scripts/verify-install.sh`)

- Added health checks for `/podcasts` and `/podcasts/tts-status` sidecar endpoints.

## Current state

- **App tests:** 36 files, 276 tests run, 275 passed, 1 pre-existing flaky timeout in `src/tests/interactions.test.tsx` (dismissed-items test).
- **Sidecar tests:** `sidecar/test_sidecar.py` passes 11/11.
- **Build:** clean production bundle.
- **Services:** `eaios-knowledge-sidecar` (:9121) and `eaios-server` (:5200 / :5173) active.
- **Uncommitted work:** `src/pages/Podcasts.tsx`, `sidecar/podcasts.py`, `sidecar/server.py`, `sidecar/requirements.txt`, `install/install.sh`, `scripts/verify-install.sh`, `docs/HANDOFF.md`, `sidecar/.env`.

## Env configuration

- App: `~/eaios/app/.env.local` with `VITE_HERMES_LIVE=1`, dev token, and optional provider keys.
- Sidecar: `~/eaios/sidecar/.env` with optional `ELEVENLABS_API_KEY` and `OPENAI_API_KEY`. The `start-knowledge-sidecar.sh` script sources this file on startup.
- OpenRouter key for Podcastfy LLM generation lives in `~/.hermes/.env` as `OPENROUTER_API_KEY`.

## What to tell the next Ally

> "Podcasts module is prod-ready. The page has upload + voice selection at the top, current episode in the main player, and history in the right rail. Voice preview works for all three TTS providers. Installer and verify script were updated to set up Podcastfy, Edge/ElevenLabs/OpenAI TTS deps, Playwright Chromium, and the sidecar .env template. Build green, one pre-existing flaky test."

## Open items

- Commit the uncommitted files before the next build.
- Pre-existing flaky `interactions.test.tsx` failure is unrelated to Podcasts.
