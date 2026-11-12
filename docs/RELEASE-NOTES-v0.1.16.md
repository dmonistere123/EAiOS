# EAiOS v0.1.16 — Executive navigation and orbital Staff

- The sidebar now expands into EAiOS, The App Stack, and Settings. Opening a group
  preserves the current page; bookmarked pages reveal their navigation group.
- EAiOS contains Today, Staff, AI Assistant, HI Assistant, Approvals, Schedule,
  and Artifacts. Installed optional apps appear in The App Stack. App Settings
  retains provider configuration and release-update controls.
- Staff opens with the orbital AI team, then the primary AI assistant card, then
  a distinct gold human-assistant card. Agent status comes from the runtime.
  Selection retains properties and agent-channel details. Motion pauses for
  interaction and respects reduced-motion preferences; narrow layouts use a grid.
- HI Assistant opens the existing human contact and delegation tools. Human
  assistants remain the delegation backstop. Separate human logins and a shared
  assistant inbox are future capabilities.
- Both Core and Full installers include this layout. Ticker remains Full-only;
  existing module selections and saved ticker preferences are preserved.

Existing agents, instructions, skills, credentials, contacts, conversations,
playbooks, schedules, and persistent application data stay in place. This update
adds no specialist profiles, sends no delegation emails, and replays no approvals.

For new installations, use the v0.1.16 Core or Full commands in
[the installation guide](INSTALL.md#v0116-edition-contents). Existing installations
can use Settings → App Settings → Release updates once the matching stable
GitHub Release is published. Refresh the browser after updating.
