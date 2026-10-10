# EAiOS v0.1.8 — Schedule instruction visibility hotfix

## What changed

- Schedule → Inspect now displays the complete saved text in **What the job does (prompt)**, including long, multiline instructions.
- Hermes versions that return only a shortened `prompt_preview` are supported. EAiOS reads the full prompt from the receiving machine's own schedule store, with separate agent/profile scoping.
- When full instructions cannot be loaded, Inspect explains the problem and disables content saving. It never treats a shortened preview as the complete editable prompt. Close and reopen Inspect to retry.
- A genuinely empty saved prompt is distinguished from an unavailable prompt.

## Customer data and installation

This is an application-only hotfix. It does not rewrite schedules, change run times, execute jobs, or install agent/skill instructions. Existing agents, credentials, conversations, and customer configuration remain in place.

Install through **Settings → Check for updates** while the machine is idle. After installation, refresh EAiOS, open Schedule, and inspect an existing job. Verify the complete instructions are visible. There is no need to recreate the job or save it again.

A local Markdown update report is saved automatically in Artifacts after the installer records success.

## Regression protection

Committed tests cover the Hermes preview-only response, full multiline prompts, profile isolation, real temporary schedule files, the read-only HTTP endpoint, unavailable data, and the inspector's edit protection. These tests run in the normal application test suite required by the release script.

The v0.1.7 release did not change the schedule mapping. That mapping expected `prompt`, whereas current Hermes list responses expose `prompt_preview`. This hotfix is included in the main release history so future versions inherit it.
