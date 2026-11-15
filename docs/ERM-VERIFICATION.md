# ERM verification — November 15, 2026

Validation used the isolated `codex/erm-mvp` worktree based on public v0.1.23 (`df08235`). No production service restart, publish or deployment occurred.

- Initial baseline: 715 tests passed, 1 skipped. The initial concurrent build encountered the newly introduced red-test import before its implementation was written; subsequent complete builds pass.
- ERM and navigation targeted suite: 22 tests passed (18 ERM plus 4 navigation).
- TypeScript and production build: passed. Existing Vite `__dirname`/future-native-loader warning remains.
- Lint: completes with warnings, no errors. Existing warnings plus ERM's intentional control-character validation and effect-driven selected-record reset are recorded in local logs.
- Existing installer/updater script suite: 37 tests passed. Additional SQLite online-backup test confirms ERM contact and note contents, including WAL data, are preserved.
- Full application regression: 733 passed, 1 skipped (107 passed files, 1 skipped file). The only initial regression was the old App Stack link-order expectation; it was updated for the opt-in ERM entry. After final stale-response guards, the focused UI suite and production build were rerun successfully.

Browser verification on the real isolated SQLite-backed staging API:

- Created a synthetic contact with email, phone, job title, complete postal address, preference and tags; all appear in the main record.
- Created a lengthy multi-paragraph note; opened its complete text in the wide reader, entered edit mode and saved AI exclusion. The rail reflects the exclusion.
- Uploaded synthetic CSV, inspected automatic column mapping, observed a possible duplicate warning for an existing email, selected only the new customer and imported one record.
- Reloaded the browser and confirmed both contacts and the edited note persist.
- AI unavailability is explicit and Generate/Ask controls are disabled; no fake analysis appears.
- Unit/UI checks also exercise a Pepper installation name, contact-scoped notes, optimistic edit conflicts, import retry/idempotency, rollback of invalid import selections, stale analysis evidence, interrupted job recovery, quote validation, origin checks and optional-module gating.

No live Outlook import or live model invocation was made. Provider calls use synthetic test responses; those tests do not establish real-account permissions or model output quality. Local logs and synthetic database fixtures remain ignored under `.local/`.
