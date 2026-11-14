# 2EP by Allygnment — v0.1.23

This release brings podcast promo videos and each executive's chosen assistant name to new and existing installations.

- Retains the compact 2EP header, expandable 2EP / The App Stack / Settings navigation, and orbital Staff page from v0.1.22.
- Resolves assistant names from the current box, including Executive Insights, travel, voice, and podcast prompts. Existing names such as Pepper are preserved during installation and updates.
- Adds a Create 90-second promo video button beneath the podcast audio player. Videos use original narration, whiteboard visuals, captions, and no drawing hand by default.
- Adds prompt-based revisions for the whole video or a selected scene, version history, MP4 downloads, rendering progress, and cancellation. Earlier videos remain available after a failed revision.
- Handles missing or overlong scene subtitles, fractional drawing coordinates, and automatically replans excerpts that are too short.
- Includes local renderer dependencies in installers, backs up promo job metadata during updates, and prevents updates from interrupting active video jobs.

**DCR is excluded from this general release**, including its page, menu entry, API, and automatic scanner. It remains a separate personal pilot. No DCR data is deleted.

Both Core and Full retain their existing module boundaries; Core excludes Ticker. Updates preserve existing module choices, agents, profiles, custom instructions, credentials, conversations, approvals, human delegations, and saved preferences.

Video planning uses the existing OpenRouter connection. Transcription and rendering run locally using FFmpeg, Pillow, and faster-whisper; the speech model is downloaded on first use if not cached. See docs/PODCAST-PROMOS.md for runtime configuration and provider data flow.

Existing machines: Settings → App Settings → Check for updates → Install update.
Fresh machines: use the Core or Full v0.1.23 installer commands in docs/INSTALL.md.

This release makes updates available; it does not automatically install on other executives' machines.
