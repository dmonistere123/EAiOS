# 2EP by Allygnment reskin

The executive application now uses the approved Signature header identity:

- **2EP by Allygnment**
- *Enhanced Executive Performance*
- *An Executive AI Operating System*

The shared header, Today brand statement, executive navigation group, browser title and favicon carry this identity. The existing navy/cyan palette, expandable navigation, orbital Staff page, Ally identity, operational rail and module selection remain in place. The two supporting lines sit to the right of “2EP by Allygnment,” separated by a subtle divider, to keep the desktop header compact. Header tools reflow at tablet/mobile widths.

Application help, voice copy, new conversation titles, new assistant-workspace labels and installer-facing messages use 2EP. The repository-owned concierge and new-agent instruction templates have naming changes only; no live agent instructions are rewritten. Existing release reports retain their historical download names and contents. Newly generated reports use 2EP.

## Compatibility and installation

This is a presentation change, with no migration. Existing `eaios` API routes, environment variable names, local-storage keys, service filenames, installation/data directories, approval envelope fields, database tables and GitHub repository URLs stay unchanged. Existing module choices and Core exclusions stay unchanged. Both installer editions build the shared application sources.

Installer banners, service descriptions, verification output and updater/release messages are updated in source. The published Core bootstrap remains pinned to the current released tag until the next release is published; it must be repinned as part of that release. This branch does not claim to publish a new installer.

## Preview and release boundary

Worktree: `eaios-2ep-reskin`, branch: `codex/2ep-reskin`, based on the existing DCR staging branch. Start the isolated full-app preview with `cd app && npm run dev:mock -- --port 5278`, then open `http://127.0.0.1:5278/today`. Preview uses sample data and disabled backend endpoints.

The branding commit can be cherry-picked independently of the preceding DCR staging work. Promoting this change must not implicitly ship DCR. Production assets, services, private agent homes and live databases were not modified during development. Publishing and production activation remain separate release operations.

## Verification

- TypeScript and production build passed; existing Vite configuration and bundle-size warnings remain.
- Lint passed with the existing 26 warnings.
- Installer preservation test passed; installer/update shell syntax checked.
- Desktop Today/Staff navigation and 390px/320px header layout verified in the browser.
- Full application suite passed: 101 files, 716 tests; one file/test skipped. jsdom reports its existing unimplemented media-play warning.
- Release/updater/installer suite passed: 34 tests.
- Final authoring and release-artifact checks passed: 14 tests, including preservation of historical EAiOS release reports.
