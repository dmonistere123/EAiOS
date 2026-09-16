# EAiOS Migrations

Numbered SQL migrations run once per shipped box by `scripts/eaios-update.sh`.

## Rules

1. **Name format:** `NNN-descriptive-name.sql` (zero-padded, sorted lexically).
2. **Idempotent:** every migration must be safe to run twice. Use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS` (SQLite ≥3.35), or `INSERT OR REPLACE` where appropriate.
3. **No secrets:** migrations must not insert credentials, tokens, or keys.
4. **No destructive drops:** avoid `DROP TABLE` on existing user data. If a schema change requires it, split into a migration that creates the new table + copies data, then a later migration that drops the old one after code no longer reads it.
5. **Checksum integrity:** `scripts/run-migrations.mjs` records a SHA-256 of each applied migration. Editing an already-applied migration causes the runner to fail loudly.

## How they run

```bash
# During an update:
node scripts/run-migrations.mjs
```

The runner stores progress in `_eaios_migrations` inside `~/.hermes/state.db`.

## Adding a migration

1. Pick the next sequence number.
2. Write the SQL file in this directory.
3. Commit it with the code change that depends on it.
4. The next box update will apply it automatically.
