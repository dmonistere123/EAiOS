# 0.1.26 release validation

- Application suite: 912 passed, one optional Hermes integration test skipped. After final approval integration fixes, 45 targeted tests passed; the added immutable artifact-share approval test passed separately.
- Release/updater scripts: 43 passed, including annotated local update bundles, rollback, customer identity/edition preservation, and WAL-safe Planner/DCR/E-CRM backups.
- Bare Bones/Core/Complete bootstrap tests: passed with pinned tags and explicit overrides.
- Safe sidecar subset: 9 passed. No provider generation tests or paid model calls were run.
- TypeScript/Vite build and lint: passed. Existing lint advisory warnings, Vite native-config warning and >500 kB route chunk warning remain. jsdom reports unimplemented media methods in UI tests; media delivery and range handling are covered separately.

The release was assembled in an isolated worktree from public 0.1.25, incorporating the shared candidate and selected personal-runtime improvements. It retains the public per-box identity and edition behavior. Moxie implementation, routes, configuration and data are excluded. The personal-build marker/standard-updater guard is retained to avoid overwriting customized installations.

Production Planner uses the executive application's existing private deployment boundary and a server-owned local identity. Preview login and simulated delegation are excluded from production. No new public listener is introduced. Its production API test verifies persistence, journals/files, cross-origin rejection and blocked simulated commands. E-CRM links re-read the saved source note on the server.

Provider integrations were validated with fixtures, not by sending real emails, publishing social posts, uploading public artifacts or scanning a customer's accounts. This release does not activate updates on remote boxes or replace the owner's personal build.
