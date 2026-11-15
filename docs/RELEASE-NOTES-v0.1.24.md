# 2EP by Allygnment — v0.1.24

ERM (Executive Relationship Management) adds a customer-focused workspace under The App Stack.

- Create and edit full contact records independently of Outlook, including multiple emails, labeled phone numbers and complete postal addresses.
- Import selected contacts from CSV or a connected Outlook account, with preview, field mapping, duplicate warnings and repeat-import protection.
- Capture timestamped notes in the right-hand history. Open lengthy notes in a wide reader and edit them there.
- Ask your box's named AI assistant for a customer review or recommended next steps, grounded in included notes with quoted source links. You control whether each note informs AI reviews.
- Preserve contact and note data in private SQLite storage, backed up during Settings updates. Active ERM reviews defer installation until their provider request finishes.

**Full includes ERM; Core does not include it by default.** Existing Full installations, including older boxes without an edition file, receive ERM when the executive installs this update. Existing Core selections and per-box assistant names are preserved. Updates do not run automatically.

DCR remains excluded from this general release. Personal DCR installations require a separate deployment that preserves their pilot; this release does not delete DCR data.

Customer AI reviews use the existing server-side application provider configuration. No model call occurs until you request one. Only the selected customer's included notes inform this first release; automatic email/calendar enrichment and autonomous sends are not included. Outlook imports require contact-read permission on the account you select; email access alone may not provide it.

Existing machines: Settings → App Settings → Check for updates → Install update.
Fresh machines: choose the v0.1.24 Core or Full installer documented in `docs/INSTALL.md`.

The current Core/Full split provides the foundation for future Bare Bones/Complete installer packages; this release does not change other Core module contents.
