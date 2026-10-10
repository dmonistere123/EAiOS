# API key settings

Settings → API keys & services edits individual allowlisted keys on the current machine. Saved values are never returned to the browser, even partially. Blank inputs leave existing credentials untouched. Saving is not provider verification, does not enable live purchases, and does not restart services.

## Sections and persistence

- **Application:** Duffel, Composio, OpenTable. Writes `<EAIOS_DATA_ROOT>/app/.env.local` (falls back to the EAiOS root when no data root is configured). The next API request or Composio proxy request reads the saved key. Within an API request, credentials are held consistent across asynchronous provider calls.
- **Assistant & tools:** OpenRouter, OpenAI, Anthropic, Gemini, Kimi, Kimi China, Composio MCP, Tavily, Firecrawl, ElevenLabs, Telegram. Writes `<HERMES_HOME>/.env`. Concierge and the travel planner read their model key per request. Existing Hermes processes may cache credentials; restart Hermes through the normal operational procedure before relying on changed keys in agents or schedules. Profile-specific overrides are not edited. Provider/model/tool selection remains a separate setting.
- **Podcasts:** OpenRouter, OpenAI, ElevenLabs. Writes `<EAIOS_DATA_ROOT>/sidecar/.env`. The podcast launcher reads this persistent location on restart. An explicit value here overrides a shared Hermes value, including an explicit blank left by an existing installation. Restart the podcast service after saving.

OAuth sign-ins remain in Connections. Agent-specific Telegram tokens remain in Agents. Google service-account files and internal dashboard authentication tokens are not plain provider API keys and are not editable here.

## Safety and compatibility

Writes preserve other dotenv entries, use a private mode-0600 temporary file and atomic rename, and check the file revision under a per-file exclusive lock. Stale writes and concurrent writers receive conflict responses. Complex multiline values for the selected key require manual editing; they are never guessed at. Shell characters are rejected because some existing service launchers source these files. Symlink credential files and parent paths escaping the configured root are refused. A crashed write may leave an `.eaios-lock` file; an administrator should verify no writer is running before removing that lock.

The API uses the dashboard's existing trusted-machine/Tailscale access boundary and same-origin JSON write checks. It does not add public Internet access or a new authentication system. Do not expose the dashboard publicly without access control. Responses are no-store; logs record only provider key name, section and save time. Keys are stored as local plaintext with owner-only file permissions, not encrypted in a vault. No secrets are placed in frontend code, localStorage or version control.

Application keys saved through Settings take precedence over a stale process environment. Concierge prefers the shared Hermes file over an older environment value. Existing environment values remain fallbacks when a nonempty file key is absent. Other services use their existing environment precedence, so custom service-level overrides may require administrator attention after saving. Routine releases preserve these persistent files. Deployments must retain a stable EAIOS_DATA_ROOT rather than using each release checkout as the data directory.

## Validation

Tests exercise real temporary credential files and local HTTP endpoints: permissions, preservation, stale revisions, duplicate entries, shell-injection rejection, symlink rejection, size limits, cross-origin requests, credential isolation, and responses without secrets. The Duffel transport test stubs only the external network; it verifies which stored key is passed to the next request. UI tests cover hidden values, save failures, clearing successful submissions and discarding drafts when switching sections. No live provider requests, purchases, credentials or service restarts are involved.
