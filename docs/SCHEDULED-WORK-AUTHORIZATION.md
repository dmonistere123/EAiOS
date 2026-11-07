# Scheduled work authorization — November 7, 2026

The executive clarified that creating/enabling a schedule authorizes its configured work. Ordinary scheduled research, draft/report/audio generation and internal artifact delivery must not ask for a second cron authorization. Outgoing communications need the executive's approval, except scheduled Telegram output to the executive at its already configured destination. A job may explicitly request additional review, such as a proposed research task; preserve that instruction.

## Cause on the personal box

The cron authorization task t_1a081d1e already had decision=approved but was subsequently blocked by a worker over conflicting policy. The live podcast skill explicitly required a new approval for scheduled synthesis, while general governance treated all external provider execution as gated. This was an instruction conflict, not a missing executive decision. The runtime server also differs from old deployment.json metadata; do not redeploy the October checkout over the November runtime.

## Explicit policy installation

Review config/scheduled-work-policy.md, then run:

```sh
python3 scripts/update-scheduled-work-policy.py --hermes-home "$HOME/.hermes"
python3 scripts/update-scheduled-work-policy.py --hermes-home "$HOME/.hermes" --apply
```

The command preserves existing customized text and skill frontmatter, inserts an explicitly overriding policy, and backs up every changed file. It requires all four intended targets to exist before writing. Repeated application is idempotent. It is intentionally NOT called by routine installers/updaters. Other boxes must opt into this policy themselves.

On the personal box, the new rule was installed in the default SOUL, governance skill, scheduling reference and podcast skill. All 14 existing jobs were explicitly given the governance skill. Direct scheduler delivery was set to local (including applicable failure-delivery overrides) so the scheduler cannot bypass the communication gate with automatic Telegram sends. Original job prompts, schedules, enabled states and models were verified unchanged. A full job-store and online kanban backup were saved before changes. The obsolete cron-authorization task was archived with its decision and audit history preserved; it was not reexecuted.

Communication requests use existing approval and sender/publisher paths. This change does not add a universal interception layer for arbitrary agent shell commands. Policy guides the agent; existing structured mail/social approval gates remain the execution enforcement. Future schedules may deliver output to the executive at the configured Telegram destination. Communications to other recipients must go through Approvals.

## Verification

- Three temporary-directory policy-install tests: custom-text/frontmatter preservation and idempotence; dry-run/apply/backups; missing-target refusal without partial writes.
- 35 targeted application tests: governance seeding, per-box settings, approval gate, social publication.
- Live read-back: all 14 prompts/schedules/models unchanged, local delivery set, policy installation idempotent, obsolete task archived.
- No historical job replay, live paid generation, or outgoing communication was used as a test.

## Telegram clarification — November 7, 2026

The executive clarified that scheduled Telegram output to himself is authorized. Restored the eight previously configured Telegram delivery targets from the pre-change backup using field-level edits, preserving prompts, schedules and other current state. The local policy now explicitly permits that delivery and continues requiring approval for Telegram messages to anyone else. The earlier local-only delivery change described above is superseded by this clarification.
