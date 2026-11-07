# Executive Insights — first implementation

Branch: codex/executive-insights. Production has not been changed.
Preview: http://127.0.0.1:5288/insights (Vite process; restart with the explicit environment below).

The left navigation includes Executive Insights below Today. The page offers 7-, 30-, and 90-day analysis, top ten workflow categories, chat channel counts, scheduled attempts and failures, tasks created, skill tool calls, current schedule inventory, and recently modified skills. Recommendations are generated only on click, saved in a right-side history, and have copyable implementation briefs. A mobile selector also provides saved-review access.

## Data semantics

Read-only SQLite: main and profile state.db user messages, excluding hidden/archived conversations, hidden/interim display rows, and compressed summaries. Web, desktop, tui and cli are grouped because recorded provenance does not always distinguish EAiOS from Desktop. Telegram remains separate. Each stored user message counts as one request; compression/import histories can affect interpretation. Each indexed execution ledger entry counts as a scheduled run attempt, including failures. Cron-origin chat prompts are excluded to avoid counting a scheduled attempt twice. Tasks and skill tool calls are separate totals, not added to top-use counts.

Category assignment is a local heuristic over message text, conversation title and schedule description, with explicit Other requests. It does not prove intent, ROI, time saved, or business value. Background upkeep is removed from the executive ranking. Runs whose job has disappeared from current inventory remain in run totals but are not assigned an invented category. Profiles with duplicate database paths are deduplicated. Missing/unsupported sources and bounded scans show warnings. Skills are file modification records, not attributed proof of autonomous creation; profile paths distinguish copies. No conversation, schedule, skill, credential, or task is modified by a read.

## Recommendations

OpenRouter uses the existing app or Hermes key, with an inexpensive default model, google/gemini-2.5-flash-lite. EAIOS_INSIGHTS_MODEL overrides the model. Only static module capabilities, inferred category names and aggregate counts are sent. No raw chat, email, skill content, schedule names, or credentials are sent in prompts. Provider response JSON must reference observed category IDs and valid existing module names (or mark a new module proposal). Generated suggestions are proposals, not verified existing UI instructions. No execution tools or automatic installation are available.

Bounded response, timeout, single in-flight request and 30-second generation cooldown; no automatic retries. Reports persist as mode-0600 JSON under ~/.hermes/eaios/executive-insights, retaining ten reports across periods. API usage is billed by the configured provider; this feature does not claim authoritative cost tracking in EAiOS Usage.

## Preview isolation

Run from app:

```bash
EAIOS_INSIGHTS_PREVIEW_HOME=/home/ally-landry/.hermes \
EAIOS_INSIGHTS_PREVIEW_DATA_ROOT=/home/ally-landry/eaios \
node node_modules/vite/bin/vite.js --config vite.insights-preview.config.ts
```

Only Insights endpoints are enabled. Other modules use mock data and other backend routes return 503. Preview reads live history and existing keys; it does not copy credentials. Generation is opt-in on the page and writes reports only to the worktree's .local/insights-preview directory. No production reports or services were changed.

## Verification

Nine targeted tests passed: visible message/run counts, read-only DB preservation, missing-source warnings, aggregate-only model input, strict evidence validation, persisted recommendations, explicit generation, period selection, and UI failure handling. TypeScript/production build passed; lint has warnings and no errors. Browser checked the real 30-day snapshot, desktop recommendation-history rail, narrow layout, and a successful live OpenRouter generation saved in isolated preview storage. The first live pass exposed module/category confusion; module-name validation and more precise proposal instructions were added, and a second live pass passed. No scheduled or external communication was executed.

Release/deployment must merge this feature into the personalized production runtime alongside the prior history, voice and orchestrator-approval changes; never replace production wholesale with this base checkout. Do not package preview configuration or .local records as customer data.


## Executive coaching direction

Executive Insights is a core module, included in both the existing full installer/updater and the planned base installer. Coach effective use of EAiOS, not leadership competence. Recommendations pair observed activity with an executive habit, an EAiOS improvement and a proposed success measure. Existing reports remain readable with explicit coaching fallbacks. The Executive Leverage Score remains “building your baseline”; no numeric score is inferred from activity volume.

Discuss with Ally opens an editable unsent prompt in a new assistant conversation. It does not authorize implementation, save preferences or submit provider work automatically. Copy implementation brief remains available. In the isolated preview the destination Assistant uses mock data, not live Ally.

Rollout order requested: finish and validate core coaching experience; update this box and current full installer/updater preserving all box state; then produce a separate base installer. Base modules: Today, My Assistant, Staff, Connections, Approvals, Schedule, Travel, Knowledge, Skills & Playbooks, Artifacts, Executive Insights, Backup, Settings; Usage inclusion remains undecided. Social Media, Podcasts and other specialist modules are optional/custom packages, not silently removed on existing boxes. Release integration must also preserve the deployed chat history, voice and approval-orchestrator changes from their separate worktrees.
