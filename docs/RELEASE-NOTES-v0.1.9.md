# EAiOS v0.1.9 — Human assistants and verified email approvals

## Human assistants

- Add an AI or human agent from Staff. Human contacts collect contact details, role, timezone and working preferences, and appear around the orchestrator in the organization view.
- Prepare human delegations from new or existing idle, unassigned tasks. Review the recipient, sender, instructions and selected attachments before requesting approval.
- Approval sends the reviewed package through the selected verified mailbox. Duplicate decisions cannot send again. Uncertain outcomes are retained without automatically resending.
- View and update human acceptance, progress, blocked and completed states in Staff. Status changes are currently executive-managed; automatic inbox monitoring and external acceptance links are not included.

## Email accounts and approvals

- Connect multiple Outlook or Gmail accounts without replacing an existing connection.
- Configure separate ordinary and Human EA sender defaults in Settings. Each box must choose its own authorized mailboxes.
- Replies start with the verified original inbox. Explicitly changing the sender in Approvals requires saving and reviewing a new approval version. Sending through a different account creates a new email to the verified reply recipient rather than reusing a foreign mailbox's thread.
- Older email approvals without a verified source require choosing the original inbox and message before approval. Email approval no longer hands a send to an AI worker to choose an account.
- Outlook confirmation checks briefly retry read-only receipt lookups after sending; they never repeat the send.

## Also included since v0.1.8

- Centralized API key settings with server-side storage, hidden existing values and service categories.
- Social Media content planning, concise platform-specific drafts, generated images when a configured provider supports them, and per-box posting destinations including Instagram. Unfinished automatic social publishing is excluded; account authorization and platform permissions still apply.
- Existing schedule prompt visibility fixes are retained.

## Install and preserve customer data

Use **Settings → Release updates → Check for updates**, then review and install **v0.1.9** while the box is idle. Updates are discovered weekly but are never installed automatically. Node 24+ and the existing runtime dependencies are required.

The installer stages application code separately, backs up persistent databases including the Human EA database, and preserves existing agents, profiles, SOUL instructions, skills, credentials, conversations, schedules, trips and social drafts. Agent/skill installation remains a separate explicit option. No customer-specific human contacts, sender defaults, API tokens or test approvals are bundled.

After successful installation, **EAiOS-v0.1.9-Whats-New.md** appears in Artifacts. Refresh the application and configure the Human EA sender before creating a delegation. Existing email approvals may need source verification as described above.

## Validation

The deployed application candidate passed 566 tests (one skipped), build and lint checks. Two explicitly approved Outlook emails received provider sent-message confirmation on the development box. Installer tests use temporary real databases and simulated service/build operations, including preservation across successful updates and failures; they do not send customer email or claim provider verification on other boxes.
