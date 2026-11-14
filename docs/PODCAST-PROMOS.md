# Podcast promo videos

The Podcast player includes a 90-second whiteboard promo creator. The assistant plans an excerpt and scenes from the episode's original audio and transcript. Videos render locally as 1280×720 MP4 with English captions and no drawing hand by default. Short recordings produce shorter videos.

The executive can download the video, review individual scenes, and enter revision instructions for the entire video or a selected scene. Revisions preserve the audio excerpt and create a separate version. Earlier versions remain available during rendering or after failure. Creation can be cancelled; interrupted jobs report a retryable failure after application restart. A shared SQLite queue prevents duplicate concurrent work across the two application processes.

## Runtime and installation

New installers install FFmpeg, DejaVu fonts, Pillow, and faster-whisper through the standard sidecar requirements. The worker uses `sidecar/.venv/bin/python` by default; `EAIOS_PODCAST_PYTHON` can select an existing compatible environment. The first transcription downloads the faster-whisper `base` model if it is not cached. Rendering and speech alignment run locally.

Planning and prompt-based revisions use the existing OpenRouter key in Connections. `EAIOS_PODCAST_PROMO_MODEL` optionally overrides the default `google/gemini-2.5-flash` model. Transcript text and timing, the previous storyboard, and the revision request are sent to this provider; audio is not uploaded by this feature. The response is validated as data and never executed as code. Layouts currently support flows, people, comparisons, cycles, warnings, and checklists; revisions are constrained to these layouts, supported accent colors, and original audio.

Jobs and media are stored in `EAIOS_DATA_ROOT/podcast-promos` (or the configured application data root). Updates retain that directory and include `jobs.db` in the online database backup. Media should be included in whole-machine backups. Names in the interface and planner follow the installation's assistant identity.

## Verification

The isolated integration profile is `app/vite.podcast-integration.config.ts`: it uses mock episode data and a local promo API on port 5294, and blocks unrelated live API routes. It is a development fixture, not a production launch profile. The normal production server owns the queue and API; no separate daemon is needed.
