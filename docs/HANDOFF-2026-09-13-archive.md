# EAiOS — Session Handoff

**Updated:** 2026-09-12 (installer + handoff pass) · **Repo:** `~/eaios` · **Branch:** `main` · **Head:** `b04d532`

## What just happened

Wrapped up the Podcasts module installer handoff (kanban t_49ea367b):

**Podcasts module state (already built in prior tasks):**
- Provider pipeline: Podcastfy + OpenRouter LLM, with TTS selectable between Edge (free), ElevenLabs, and OpenAI.
- Voice resolution: ElevenLabs short names/prefixes are resolved to voice IDs before calling Podcastfy.
- Voice sampling: `POST /podcasts/sample-tts` returns a short MP3 preview for any configured provider/voice.
- UI layout (`src/pages/Podcasts.tsx`): generate panel (upload + TTS provider + host/guest voices + preview buttons) at top, current episode player in the center, episode history in the right rail.
- Google Podcast API remains blocked for new GCP projects without Gemini Notebook Enterprise entitlement; the UI shows an honest "unavailable" footer.

**Installer / fresh-box setup changes:**
- `sidecar/requirements.txt` now lists all knowledge + podcast deps: `pymupdf python-docx python-pptx podcastfy edge-tts elevenlabs openai google-auth requests pypdf python-dotenv playwright`.
- `sidecar/.env.example` added with documented optional keys for ElevenLabs, OpenAI, Google Podcast API, and Podcastfy defaults.
- `.gitignore` now excludes `sidecar/.env` so secrets don't get committed.
- `install/install.sh` installs from `requirements.txt`, creates `sidecar/.env` from `.env.example`, installs Playwright Chromium best-effort, and prints the sidecar-restart reminder.
- `scripts/install-systemd-user.sh` error message points at `requirements.txt`.
- `scripts/verify-install.sh` now warns when `sidecar/.env` is missing.
- `docs/INSTALL.md` updated with the sidecar env step and provider-key guidance.

## Current state

- **Tests:** 37 files, 281 tests run, 280 passed, 1 pre-existing flaky failure in `interactions.test.tsx` (timeout on "show/unhide dismissed items").
- **Sidecar tests:** 11/11 pass.
- **Build:** clean — `dist/assets/index-1G7FtwQA.js` (590 kB).
- **Services:** `eaios-knowledge-sidecar` and `eaios-server` active.
- **Uncommitted:** Podcasts page/tests, adapter chain, sidecar module, and the installer/handoff files from this pass.

## Env configuration

- App: `~/eaios/app/.env.local` has `VITE_HERMES_LIVE=1`, token, `COMPOSIO_API_KEY`, `DUFFEL_API_KEY`.
- Sidecar: `~/eaios/sidecar/.env` holds podcast provider keys (`ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`, plus Podcastfy defaults). The systemd start script sources this file; restart the sidecar after edits.

## What to tell the next Ally

> "Podcasts module is prod-ready: Podcastfy + Edge/ElevenLabs/OpenAI TTS, voice preview via `/podcasts/sample-tts`, and the page layout is upload/voices at top, player center, history right rail. Installer now sets up the sidecar venv from `requirements.txt`, creates `sidecar/.env` from `.env.example`, and installs Playwright best-effort. Build is green; the one failing app test is the same pre-existing flaky `interactions.test.tsx` timeout."

## Open items

- Pre-existing flaky `interactions.test.tsx` dismissed-items timeout.
- Google Podcast API remains blocked by GCP entitlement; treat Podcastfy as the working provider.
