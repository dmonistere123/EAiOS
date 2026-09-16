# EAiOS migrations

Numbered SQL migrations run against `~/.hermes/state.db` during deliberate updates.

## Rules

1. Name files `NNN-descriptive-name.sql`, with a unique three-digit sequence.
2. Commit migrations with the code that needs them. Never edit an applied migration; its SHA-256 is checked before new work begins.
3. Use forward-compatible, additive changes. Old application releases must continue working after a code rollback. Do not drop or overwrite user data.
4. Each script and its ledger entry run in one transaction. Do not include transaction-control statements, `VACUUM`, `ATTACH`, or journal-mode changes in a migration.
5. SQL comments, triggers and quoted semicolons are supported. SQLite executes the whole script, rather than a hand-written statement splitter.
6. Prefer idempotent statements where SQLite supports them. SQLite does **not** support `ALTER TABLE ADD COLUMN IF NOT EXISTS`; the migration ledger normally prevents repeat execution.
7. Do not insert secrets or make network calls.

## Execution and backups

```bash
node scripts/run-migrations.mjs
```

Progress is recorded in `_eaios_migrations` in the target database. Before pending migrations, the runner uses SQLite's online backup API so committed WAL records are included. Backup directories have mode 0700; backup files have mode 0600.

By default backups are stored next to the database in `eaios-migration-backups/`. Override paths with `EAIOS_STATE_DB`, `EAIOS_MIGRATIONS_DIR`, and `EAIOS_MIGRATION_BACKUP_DIR`.

Backups are retained for supervised recovery. Code rollback deliberately does not overwrite the shared Hermes database: restoring it blindly could discard newer chat, work, and other runtime records. Stop all writers and review data changes before restoring a backup. Retention/cleanup is manual for now.

## Verification

```bash
node --test --test-isolation=none scripts/tests/updater.test.mjs
```

The tests use local Git repositories, stubbed install/service commands, and temporary databases. They do not update the real application or call providers.
