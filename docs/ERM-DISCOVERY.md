# ERM discovery — November 15, 2026

## Authorized product and boundary

The executive approved building the revised, customer-specific AI-first CRM after reviewing the mockup. This supersedes the original Outlook-first directory and large DCR-like attention backlog. First release: independently owned full contact records; manual entry; selected CSV/Outlook import; timestamped notes with a wide read/edit dialog; customer-scoped, cited AI review/conversation. Contact details appear in the main record, not in the compact search list. Notes are the initial evidence source. Automatic email/calendar monitoring, company-wide analysis, task/delegation and outbound approvals are later phases. ERM has no DCR dependency. No deployment, external sends, pushes, permission expansion or subscription changes are authorized in this build.

## Checkout and baseline

- Worktree: `eaios-erm-mvp`, branch `codex/erm-mvp`, base `df08235` (v0.1.23); clean at creation.
- Read root AGENTS.md, DEVELOPMENT.md, HANDOFF.md. AGENTS references September 20 baseline/handoff files that are absent from this release; no substitute historical result is claimed.
- Independent `npm ci` from the lockfile, no new dependency. Baseline application tests/build are being recorded in local logs; final results go in ERM-VERIFICATION.md.
- Live checkout and private DCR worktrees are not edited. Integration uses disposable roots, loopback-only isolated middleware and no copied credentials.

## Reuse and limitations

- `ApiContext` supplies persistent `dataRoot` and `hermesHome`. App access is a single-executive installation behind its existing loopback/Tailscale perimeter, not an authenticated multi-tenant system. ERM's server-resolved owner is the local executive; no caller-supplied owner. Same-origin JSON checks, no-store responses and scoped IDs protect the module within that boundary. Sharing is not supported.
- `mailRouting.ts`: `mailboxChoices`, `verifyMailbox`, `mailComposioRequest` support account verification and read-only Graph proxy requests. Calendar reads already use this path. ERM does not infer Contacts.Read permission from a connected mailbox.
- Microsoft Graph official list-contacts and contact resource documentation verified November 15: GET `/me/contacts`, paginated responses, Contacts.Read; default contacts folder only. Contact IDs remain account-scoped. No mail/calendar ingestion or contact writeback is included in the revised first release.
- `conciergeConfig` resolves an existing server-side OpenRouter/OpenAI configuration and credentials; no new model selection or subscriptions. Default in that existing configuration is `google/gemini-2.5-flash-lite`. ERM supplies its own bounded, tool-free, structured evidence prompt. Staging has no credentials and displays model unavailable; provider contracts are tested with synthetic responses, not claimed as live execution.
- `approvalGate.ts` requires blocked/unassigned prepared actions and executive decision/executor provenance. ERM first release does not create tasks or send drafts, so it does not bypass or partially reproduce that workflow.
- `WorkspaceNavigation`, `usePageRail`, existing theme tokens and `AGENT_NAME` supply navigation, right-hand history and per-box identity.
- `travelStore` and `humanDelegation` establish private SQLite patterns. ERM uses stable `<dataRoot>/erm-data/erm.db`, transactions, foreign keys, owner scope, optimistic versions, import receipts and persistent analysis job leases. Installer online backup gains this DB; disabling the optional module retains data.
- ERM is explicitly opted into via module addons; it is not silently included in Core or existing Full installs.

## Verification boundary

No real mailbox identities, contacts or private notes have been copied into this checkout. Live connection permissions and real model output remain unverified until an authorized integration run with configured accounts. Missing access must remain an actionable unavailable state, never synthetic success. Use the local persisted staging UI and synthetic tests first.

Sources: https://learn.microsoft.com/en-us/graph/api/user-list-contacts?view=graph-rest-1.0 and https://learn.microsoft.com/en-us/graph/api/resources/contact?view=graph-rest-1.0
