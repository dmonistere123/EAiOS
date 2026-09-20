# Isolated EAiOS development

## Checkouts on this box

- Live checkout: `/home/ally-landry/eaios`, branch `main`.
- Prepared development worktree: `/home/ally-landry/Documents/ChatGPT/EAIOS Application/eaios-dev`, branch `codex/development-setup`, based on `be7819e`.
- Open the development worktree as your Codex project. Read `AGENTS.md` at the start of a new task.
- Live uncommitted marketing work in `app/server/prod.ts`, `www/`, `screenshots/`, and `scripts/capture-screenshots.mjs` was intentionally not copied into the branch. The dated handoff was copied into the development worktree so it can be versioned with these instructions. Its original remains untouched.

A worktree isolates source files, not services, ports, environment variables, databases, or remote accounts. Each active task should use its own branch/worktree and explicit runtime configuration.

## Requirements and dependencies

The release manifest requires Node 24 or newer. This baseline used Node 26.7.0, npm 11.19.0, and the installed sidecar Python environment (see the baseline report). Use the committed npm lockfile:

```sh
cd app
npm ci
```

Do not symlink `node_modules` to production. For this initial offline setup, the existing installed `node_modules` and sidecar `.venv` were copied into the development checkout as independent directories. No production env files or credentials were copied. This validates the installed dependency set, not a fresh registry install. Python virtual environments are generally not portable; this same-host copy is temporary bootstrap convenience, not an installation recipe.

For a fresh sidecar environment, from the repository root:

```sh
python3 -m venv sidecar/.venv
sidecar/.venv/bin/python -m pip install -r sidecar/requirements.txt
```

The Python requirements are currently unpinned; locking them is follow-up work. Provider SDKs are imported by the server even for non-generation tests.

## Default: mock UI development

```sh
cd app
npm run dev:mock
```

Open `http://127.0.0.1:5273`. Stop it with Ctrl+C. Port 5273 is strict: an occupied port causes startup to fail. Do not use production ports 5173, 5200, 9119, or 9121.

`vite.mock.config.ts` is independent of the integration config. It:

- Disables env-file loading and automatic `VITE_` environment exposure.
- Forces the mock Hermes/knowledge/podcast adapters and an empty Hermes token.
- Installs no Hermes filesystem middleware and no backend proxies.
- Returns JSON 503 for `/api`, `/composio-api`, `/knowledge-api`, and `/podcasts-api` paths for all HTTP methods. The Composio adapter and direct page fetches therefore fall back or show unavailable status without contacting a backend.
- Binds only to loopback, leaving the Tailscale front door unchanged.

Mock data/state is for development. Some backend-dependent panels will be unavailable. Mock preview is not proof of live integration behavior. Browser-local state may persist between sessions; use a fresh browser profile/context for repeatable checks. This config is a development convenience, not a security sandbox for arbitrary future code or external links.

Do not copy `app/.env.local` or `sidecar/.env` from production. The existing env example is for integration setup; despite its comment, `VITE_` values may be exposed to browser code by normal Vite configuration.

## Integration development: separate preparation required

Normal `npm run dev` uses `vite.config.ts`, which accesses Hermes files and proxies to live loopback endpoints. Changing its port alone does not make it isolated. Before using it, provision a disposable Hermes home and databases, separate backend processes/ports, test-only credentials, and update every proxy target to those isolated services. Set `HERMES_HOME`, `EAIOS_DATA_ROOT`, `EAIOS_REPO_ROOT`, and `EAIOS_KNOWLEDGE_DATA_DIR` deliberately where applicable. Do not point development services at the live roots. No isolated live Hermes stack was provisioned in this task.

## Validation commands

Run these from `app` in the development checkout:

```sh
npm test
npm run lint
npm run build
```

The frontend suite forces `VITE_HERMES_LIVE=0`. Its server tests bind ephemeral loopback ports and use temporary roots. A socket-restricted agent sandbox needs permission to run these tests with local socket access; `listen EPERM` is an environment failure, not an application regression.

Run release/updater/migration tests from the repository root:

```sh
node --test --test-reporter=spec --test-isolation=none scripts/tests/*.test.mjs
```

These create temporary repositories, use local fixture remotes, and mock service/build operations. They do not deploy the real application.

Run the safe sidecar subset from `sidecar`:

```sh
.venv/bin/python -m unittest \
  test_sidecar.TestIndexingStateMachine \
  test_sidecar.TestScopeEnforcement \
  test_sidecar.TestCitationSurface \
  test_sidecar.TestPodcastTtsStatus -v
```

The tests use ephemeral ports and temporary data directories. Do not use `npm run test:sidecar` or full unittest discovery for the routine baseline: `TestPodcastGenerationTtsConfig` submits generation requests and can invoke external providers. Those two tests need mocked providers or explicit integration authorization before running.

Build writes `app/dist` and `app/public/version.json` in the current checkout. On the live checkout, that can immediately change served assets. Build only in development for validation.

## Runtime map and release boundary

The September 20 handoff identifies user services `eaios-server` (5200), `eaios-server-5173` (5173), `eaios-hermes-serve` (9119), and `eaios-knowledge-sidecar` (9121). Hermes tasks/approvals are in `~/.hermes/kanban.db`; skills and profiles also live under Hermes home. The Tailscale URL routes to the existing front door.

Keep source development separate from service management. Do not run installation, release, updater, rollback, migrations, or watchdog scripts merely to test a feature. For an authorized deployment, use the existing procedures in `docs/INSTALL.md` and `docs/HANDOFF.md`, verify current persistent-data locations, and establish backups and rollback first. Do not copy a live SQLite file casually: the existing release workflow uses online SQLite backups to include WAL state. Existing external-write approval rules cover pushes and publication.

## Suggested task format

State the user-visible outcome, reproduction/example, acceptance criteria, and deployment boundary. For example: “Show originating email context in approval rows and the inspector; preserve older envelopes; add regression coverage; validate in the development worktree; leave services unchanged.” Finish each task with changed files, verification results, limitations, and any remaining deployment steps.

Travel planning and the dedicated Duffel test preview are documented in [TRAVEL-DEVELOPMENT.md](TRAVEL-DEVELOPMENT.md).
