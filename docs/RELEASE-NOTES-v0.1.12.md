# EAiOS v0.1.12 — Scheduled work without repeat approvals

New installations on a new Hermes home receive these defaults:

- Executive-created schedules authorize research, reports, drafts, configured provider/audio generation and internal artifacts without another cron approval.
- Scheduled Telegram output to the executive at the configured destination is allowed.
- Email, Teams, social posts, public sharing and Telegram messages to other recipients still require executive approval.
- Explicit extra approval steps requested in a cron prompt are honored.

Existing-box upgrades preserve agents, skills, custom instructions, accounts, credentials and conversations. They do not silently change governance. To adopt these defaults while preserving custom text, explicitly opt in:

```sh
bash scripts/eaios-update.sh --to v0.1.12 --apply-scheduled-work-policy
```

**Upgrading from v0.1.11 or older:** the old updater does not recognize the new opt-in flag. First update normally through Settings or run `bash scripts/eaios-update.sh --to v0.1.12`, then run the helper below.

After updating through Settings, an administrator can use the installed release's helper:

```sh
python3 scripts/update-scheduled-work-policy.py --hermes-home "$HOME/.hermes" --seed-missing --apply
```

Run it from the active release directory. Omitting --apply previews the changes. Changed instruction files are backed up under the Hermes home's eaios/policy-backups directory. Missing policy files are initialized; existing custom text is retained. Existing schedules and delivery destinations are not changed by the installer or updater. Review each box's Telegram recipient locally; no personal chat IDs or tokens are shipped.

The fresh installer accepts the same --apply-scheduled-work-policy flag for an already initialized Hermes home. Ordinary updates and rollback do not opt in. The installed What's New report appears in Artifacts after successful upgrade.

Includes v0.1.11 approval-executor routing and podcast verification changes. Policy tests use temporary homes; updater tests simulate service/build operations. No outgoing messages or paid generation are performed by these tests.
