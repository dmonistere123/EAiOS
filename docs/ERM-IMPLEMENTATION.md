# E-CRM first release

E-CRM is an optional customer CRM in The App Stack. It does not depend on DCR or Outlook.

## Executive workflow

1. Add a contact or import selected contacts from CSV or a connected Outlook account.
2. Select a name in the compact directory. The main record shows full contact details and preferences.
3. Add a timestamped customer note. Decide whether the note may be included in AI reviews.
4. Click a note in the history rail to read the complete text in a wide, scrollable dialog and edit it.
5. Generate a customer review or ask a question. The central panel shows AI interpretations and suggestions with links to quoted notes. It does not send messages or create commitments.

Contacts support multiple emails, labeled phone numbers, labeled postal addresses, company, title, category, website, preferences and tags. Archive/restore is reversible. Search covers name, company, email and tags. Directory and note history paginate in pages of 50.

CSV imports support up to 500 rows and 1 MB, a full-name column, editable field mapping, row validation, explicit selection and duplicate warnings. Identical previously imported rows are skipped; changed rows are reviewed as new candidates. Exact email matches warn but never automatically merge records. Outlook imports read the selected account's default Contacts folder in pages of 100; they do not import private Outlook notes or write back. Namesakes remain separate records.

## Local staging

From `app`, run `npm run dev:erm`, then open `http://127.0.0.1:5298/erm`.
This dedicated profile binds loopback and disables env-file loading, all non-E-CRM APIs, provider calls and live Hermes integration. Contacts and notes genuinely persist under `.local/erm-stage/erm-data/erm.db`.
The rest of the application shell uses mock data and displays the Mock badge. E-CRM itself displays a separate staging notice. The demonstration records created during browser verification are explicitly labeled DEMO; they are not source-controlled or copied to production.

## Enabling later in an authorized installation

Starting with v0.1.24, Full installations include E-CRM automatically, including existing Full boxes and legacy boxes without a module file. Core excludes E-CRM by default; an explicitly selected `erm` addon can enable it on Core. Updates preserve the existing module file byte for byte and never convert Core to Full. Edition changes retain customer records. This release policy supersedes the initial opt-in-only staging build.

Production uses the existing server-side application AI configuration resolved by `conciergeConfig`, with no new dependency, model fallback, subscription or client-exposed key. Each review is one bounded tool-free JSON completion. The current configuration's model name is returned in status/results. Included notes are transmitted only when the user requests analysis. At most the newest 20 eligible notes fitting the 80,000-character input budget are included; the result shows coverage. No automatic email/calendar enrichment is implemented in this slice.

Outlook reuses existing verified account selection and Graph proxy transport. Email/calendar access alone does not establish contact-read permission. A missing scope, expired connection or throttling produces an error; there is no synthetic-success fallback.

## Data and analysis lifecycle

The stable database is `<EAIOS_DATA_ROOT>/erm-data/erm.db`, private directory mode 0700 and file mode 0600. It has additive schema creation, transactional writes, optimistic record versions, request receipts, import provenance, minimal event audit and analysis job leases. Release backups now include the E-CRM database using SQLite's online backup API.

The installation is single-executive within the application's existing local/Tailscale access perimeter. A server-owned executive identifier scopes all records. This does not implement multi-user authorization or workspace sharing.

AI jobs coalesce identical pending requests, limit the pending queue, and lease one provider request at a time. Interrupted requests fail without automatic billing retries. Queued work is checked against current notes/configuration immediately before the provider call. Results require valid included note IDs, versions and exact quote substrings. Changed notes invalidate results; this is citation validation, not proof that an AI interpretation is semantically correct. Editing a note cannot retract data already sent to a provider by an earlier requested review.

Neither viewing a customer nor loading a review initiates a new AI request. Customer reviews persist; individual question results remain visible for the current page session. Questions are independently grounded in the selected customer's included notes, not a persistent multi-turn chat transcript.

## Remaining integration checks before production

- Verify real Outlook Contacts.Read access and pagination with an intentionally selected account.
- Run a live review using the installation's configured model and permitted customer evidence; verify provider JSON-format support and response quality.
- Confirm deployment packaging and explicit addon selection on the target installation.
- Production service, credentials, profile instructions, agents, DCR and customer databases were not changed by this build.
