# EAiOS v0.1.10 — Clearer email approval review

## Refreshed v0.1.10 package — artifact deletion

- Artifacts now shows a Delete button for task attachments, with a separate permanent-deletion confirmation. Tasks and conversations are retained; files referenced by another attachment are kept. Release-note reports are protected.
- The Artifacts page shows the total listed file size. No automatic deletion or archival is enabled.
- This package replaces the earlier v0.1.10 tag without changing the version number. Boxes already on v0.1.10 must explicitly reinstall; the existing updater compares version numbers and will not offer this as a newer version.

For an administrator reinstall on an idle box, run from its existing EAiOS repository (normally `~/eaios`):

```sh
git fetch origin +refs/tags/v0.1.10:refs/tags/v0.1.10
bash scripts/eaios-update.sh --to v0.1.10
```

This deliberately refreshes only the v0.1.10 tag before using the existing backup/update workflow. Review any prerequisite or local-change errors rather than resetting customer work.

## What changed

- Email approvals load connected sending accounts automatically when opened. Refresh accounts retries the lookup if needed.
- Verified replies display **Send To** as a read-only recipient and **Send From** as the editable sending account.
- Verified replies retain the original inbox and message identifiers without asking you to select them again.
- Approvals missing those identifiers show a separate **Verify source email** section. Confirm the original inbox and message once before saving for review. The app does not guess the recipient or send an unverified reply.
- Saving changes prepares a new review; it does not send email. Existing approval and duplicate-send protections remain in place.

## Update

On each box, use **Settings → Release updates → Check for updates**, then install **v0.1.10** while idle and refresh the application. This update includes v0.1.9's Human EA and verified mailbox approval features.

The installer preserves local agents, instructions, skills, credentials, conversations, contacts, sender settings and persistent application data. No account credentials or sample approvals are bundled. Agent/skill installation remains a separate explicit option.

After installation, **EAiOS-v0.1.10-Whats-New.md** appears in Artifacts. Older approvals that did not retain their email source still require one-time verification.

## Validation

Targeted UI and mail-reply tests cover automatic account loading, recipient display, retained source identifiers and blocking of unidentified replies. Production verification confirmed automatic loading of connected accounts. No email was sent as part of this layout verification.
