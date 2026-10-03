# Text-only navigation Concierge

The bottom-right brain widget uses an application-owned LLM request, separate from Ally Assistant and staff. `concierge/SOUL.md` is the single versioned reference for role boundaries and all implemented routes, including Travel, Podcasts and Backup. It is supplied verbatim as the sole system message on every request. There is no separate guide, RAG, Hermes session, tool definition, tool execution loop, or version-check tool. Version questions point to Settings. Static instructions cannot establish current release or live service state.

## Provider and authentication

`app/server/concierge.ts` reads the existing service Hermes home's `config.yaml`: `model.provider` and `model.default`. A paired server-environment override, `EAIOS_CONCIERGE_PROVIDER` plus `EAIOS_CONCIERGE_MODEL`, takes precedence; specifying only one fails. The exact selected model is sent without fallback or retry. Hermes gateway launch overrides are not inherited implicitly.

Only `openrouter` and `openai` are supported, through fixed official HTTPS Chat Completions endpoints. A custom configured base URL is rejected unless an explicit supported provider/model pair overrides that configuration. HTTP redirects are rejected. No browser input can choose a provider, model, endpoint, credential, or system message.

The matching `OPENROUTER_API_KEY` or `OPENAI_API_KEY` is read from the server environment first, otherwise the existing private `$HERMES_HOME/.env`. Keys stay server-side; none are copied, written, returned, or logged by Concierge. Hermes OAuth/pool credentials are not imported. An unsupported provider or missing key disables this feature with a safe error rather than falling back to Ally.

For an affected box, the exact additional authentication step is administrator provisioning of that matching API key in the existing private server `.env` or service environment through the approved secrets process. Never put it in a `VITE_` variable, browser, repository, or chat. No profile or setup script is required. Configuration-file changes are read on each request; service-environment changes require a separately reviewed service restart.

## Request and history boundaries

`GET /api/concierge/context` returns only provider, model, and a hash of the SOUL/provider/model. It performs no provider request. Explicit Send uses `POST /api/concierge/chat`, with same-origin JSON checks. Client-supplied route and conversation are untrusted user/assistant content. Missing or changed instruction revision fails before any provider request.

Requests allow a 4,000-character question, a 128-character route, and at most six completed history pairs totaling 24,000 characters. The SOUL is capped at 24,000 characters. The HTTP body is limited to 160,000 bytes. Output is limited to 1,200 completion tokens and 8,000 characters, with a 128 KiB provider-response ceiling. The provider deadline is 45 seconds, with a 50-second client deadline. Incomplete, blank, malformed and tool-call replies fail safely. No automatic retry or alternate model is used.

Cancel aborts the HTTP request and provider fetch; a browser disconnect also aborts provider work. A provider may already have processed or billed the request. Cancel does not guarantee remote computation stopped. Concierge cannot execute operations even if the model suggests them. Plain text output is rendered as text.

Completed pairs are stored locally in this browser under `eaios.concierge.text.v1`; they are not Hermes conversations. SOUL/provider/model changes reset usable context. New clears only this browser's Concierge history. Legacy Concierge/Ally history keys are not read or changed. Opening, reloading, expanding, retrying metadata, or starting New never submits or replays a question. Closing the panel also cancels any in-flight request; minimizing leaves it running. Direct-provider requests are not added to Hermes' usage ledger by this feature.

## Release, activation and rollback

The fresh installer and Settings release installer carry the full repository, including SOUL, server/client code, and the locked `yaml` runtime dependency. No box-specific path or profile migration is needed. Deploy through the usual approved release process; custom copy lists must include the SOUL. Unsupported providers, missing keys and custom endpoints require the explicit configuration/authentication steps above. Configuration presence is not proof that a provider will accept a model or key.

Before activation, run frontend tests, lint/build and the repository script tests. After an approved deployment, inspect the metadata endpoint and widget without sending; an authorized real-provider smoke test remains a separate step. This development work does not deploy, publish, restart, change credentials or modify Hermes core.

Rollback uses the normal reviewed application rollback and preserves all personal runtime data and browser keys. An earlier direct-provider package starts with its own revision; a pre-feature package restores its previous Hermes-backed behavior, including its previous tool/session semantics. Do not copy new Concierge history into Ally or delete any experimental profile as part of rollback.

## Verification scope

Synthetic tests exercise the actual HTTP handler with mocked provider responses, exact system instructions, provider/model resolution, missing/unsupported configuration, input/output bounds, cross-origin rejection, disconnect/cancel, deadlines, and safe errors. Browser tests cover the widget through the live adapter to mocked HTTP, isolated completed-pair history, revision changes, no Hermes RPC, no implicit sends, cancellation and no retries. Existing Assistant and staff tests remain in the regression suite. Passing these tests does not claim live provider authentication or deployment verification.

Run `cd app && npm test && npm run lint && npm run build`, then from the repository root `node --test --test-reporter=spec --test-isolation=none scripts/tests/*.test.mjs`. Local HTTP/socket tests need loopback test permissions. The release fixture runs the actual LinkedIn profile-preservation test and checks that a preservation failure blocks publication. No Concierge profile-setup script remains.

Validated in the isolated checkout: full frontend suite 451/451 (55 files); after the final close/cancel UI fix, focused widget/client tests 14/14 including the new regression; repository script tests 31/31; standalone profile-preservation test 1/1. TypeScript/build and lint pass, with 23 pre-existing lint warnings and the existing bundle-size warning. A read-only configuration check found OpenRouter / `openai/gpt-5.5` and a matching credential present on this box; no provider was contacted. Live authentication and model compatibility remain unverified. The dependency install reported an existing transitive `undici` audit finding; the only dependency change here is adding locked `yaml` for configuration parsing.
