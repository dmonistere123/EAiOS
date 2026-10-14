# EAiOS v0.1.10 — Clearer email approval review

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
