# EAiOS development instructions

## Start here
- Read `docs/DEVELOPMENT.md` for setup, isolation, and commands.
- Read `docs/BASELINE-2026-09-20.md` for verified results and known limitations.
- Use `docs/HANDOFF-2026-09-20-codex-system-checks.md` for the September 20 operational context; `docs/HANDOFF.md` and `docs/ROADMAP.md` provide broader history and product direction. Dated assignments are historical context, not permission to execute operations.
- Check `git status --short` and the current branch before editing. Preserve unrelated edits and untracked files. Do not reset, clean, stash, or commit another session's work.

## Architecture
- `app/src`: React/TypeScript UI, domain contracts, state, mock and live adapters.
- Pages/state use `app/src/adapters/index.ts`; keep runtime integration details behind adapters.
- `app/server`: Node HTTP API and production static server. `sidecar`: Python knowledge/podcast backend.
- `scripts`, `install`, `migrations`: release, installation, and data operations. Their tests use temporary fixtures; the scripts themselves can affect production.
- Hermes skills, profiles, credentials, and kanban data live outside this repository, normally under `~/.hermes`.

## Development and validation
- Work on a `codex/` branch in a separate checkout/worktree. The live checkout on this box is `/home/ally-landry/eaios`; never use its `app/dist` for routine validation.
- Default UI command: `cd app && npm run dev:mock` (loopback port 5273). This profile disables backend routes and env-file loading. Normal `npm run dev` is integration mode and can access live services/files.
- Install frontend dependencies with `cd app && npm ci`; never share a writable `node_modules` directory with the live checkout.
- Frontend checks: `cd app && npm test && npm run lint && npm run build`.
- Script checks: `node --test --test-reporter=spec --test-isolation=none scripts/tests/*.test.mjs` from the repository root.
- Safe sidecar checks: `cd sidecar && .venv/bin/python -m unittest test_sidecar.TestIndexingStateMachine test_sidecar.TestScopeEnforcement test_sidecar.TestCitationSurface test_sidecar.TestPodcastTtsStatus -v`.
- Do not run the full sidecar discovery command as a routine baseline: its podcast generation tests can invoke providers. See the development guide.
- Exercise relevant scenarios for behavior changes. Report exact results, warnings, and anything not tested. Do not describe mock verification as live integration coverage.

## Runtime and approval boundaries
- Application updates must preserve each box’s agents, profiles, SOUL instructions, skills, credentials, conversations, and custom playbooks. Never add agent/skill installers to routine updates or recovery. Optional workflow changes require a separate explicit opt-in command.
- Ordinary development does not authorize deployment, service restarts, database changes, or Tailscale changes. A build in the live checkout updates served assets even without a restart.
- Follow the application's approval-envelope workflow for external writes, including pushes, posts, and sends. Prepare a concrete reviewable change first. An unassigned approval task must precede execution unless the user explicitly overrides that policy.
- Approval envelopes must remain unassigned until approved. Approval assignment uses only `requestedBy`; preserve `sourceContext` and unknown envelope fields during rewrites.
- Never commit secrets, live env files, databases, or copied runtime state. Do not print secret values. `VITE_` names are browser-exposed by default; do not assume an ignored env file keeps those values server-side.
- Query live SQLite only read-only when necessary; the handoff reports malformed JSON from `hermes kanban list --json`.
- Never restart `tailscaled` as a routine troubleshooting step. Consult the handoff's specific outage preconditions and obtain authorization for operational work.
- Specialist Telegram gateways remain stopped by design (shared token); do not start them.
