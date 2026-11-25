# 2EP by Allygnment 0.1.26

This release brings the shared improvements into the installers and updater. Moxie remains a personal integration and is excluded.

- Daily Planner is included in Core and Full: One/Three/Five planning lanes, backlog, recurring tasks, carry-forward, private journal, task notes and attachments, time tracking and history. Today shows My Plan. E-CRM follow-ups can be added as linked plan items. Simulated preview delegation controls are excluded from production; use the existing AI/HI delegation workflow.
- E-CRM adds dated note follow-ups in Today, private note attachments, and reviewed quick emails through Approvals.
- DCR ships with manual records, source-backed scanning, deduplication and relationship editing/saving to E-CRM. It requires per-box setup; existing DCR settings and records are retained.
- Outlook approvals add original-message inspection, conversation history, reply editing and verified sender checks. Approval lists load summaries and fetch full content when inspected.
- Social Media supports verified posting accounts, scheduled approved publishing, 6 AM approval preparation, and individual/bulk deletion. Uncertain sends are not automatically retried.
- Artifacts adds approved public sharing through configured hosting, bulk deletion, audio playback and media range requests. Other playing audio pauses when a new player starts.
- Dismissed tasks remain dismissed until meaningful activity changes; hidden pages skip runtime polling.

## Installation and updates

**Bare Bones** is a separate fresh-install entry point: `install/install-bare-bones.sh` (Core, including Daily Planner). The existing `install-core.sh` remains supported. **Complete** uses `install/install-complete.sh` (Full, including the App Stack). Both preserve an existing installation's saved edition instead of resetting it.

**Existing boxes** use Settings → Updates or the separately packaged `2EP-v0.1.26-existing-box-update.zip`. The updater preserves each box's edition, enabled add-ons, assistant name, profiles, instructions, skills, credentials and persistent records. It backs up Planner, E-CRM, DCR and other application databases before activation. It does not install agent instructions or opt a box into new scanning. Personal builds require their own reconciliation and are protected from the standard updater.

DCR: run `node scripts/enable-dcr.mjs --help` for per-box setup. Configure that executive's exact dashboard origin and approved source accounts; do not copy another executive's settings. Background scans and AI processing require their own local configuration. Public artifact hosting and social publishing accounts also require configuration on each box.

Use `node scripts/build-distribution.mjs` from the clean release tag to create the separate installer assets, update archive and checksums. The archive contains application code only; it never contains a box's database, credentials or Moxie integration.
