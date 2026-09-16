#!/usr/bin/env node
/**
 * EAiOS migration runner.
 *
 * Applies numbered migrations from `migrations/` against the EAiOS state
 * database (default ~/.hermes/state.db). Each migration runs once; progress
 * is tracked in the `_eaios_migrations` table.
 *
 * Usage:
 *   node scripts/run-migrations.mjs
 *   EAIOS_STATE_DB=/path/to/state.db node scripts/run-migrations.mjs
 *
 * Exit code 0 = all migrations applied (or none pending). Exit code 1 = error.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');
const STATE_DB = process.env.EAIOS_STATE_DB || join(homedir(), '.hermes', 'state.db');

function logInfo(msg) { console.log(`[migrations] ${msg}`); }
function logError(msg) { console.error(`[migrations] ✗ ${msg}`); }

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _eaios_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL,
      checksum TEXT NOT NULL
    )
  `);
}

function listMigrations() {
  if (!statSync(MIGRATIONS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{3}-/.test(f))
    .sort();
  return files.map((filename) => {
    const path = join(MIGRATIONS_DIR, filename);
    const content = readFileSync(path, 'utf8');
    return { id: filename.split('-')[0], filename, path, content };
  });
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function main() {
  const migrations = listMigrations();
  if (migrations.length === 0) {
    logInfo('no migrations found');
    return;
  }

  const db = new DatabaseSync(STATE_DB);
  try {
    ensureMigrationsTable(db);
    const applied = new Map(
      db.prepare('SELECT id, checksum FROM _eaios_migrations').all().map((r) => [r.id, r.checksum]),
    );

    let ran = 0;
    for (const m of migrations) {
      const checksum = sha256(m.content);
      const existing = applied.get(m.id);
      if (existing) {
        if (existing !== checksum) {
          throw new Error(`migration ${m.id} (${m.filename}) changed after it was applied`);
        }
        logInfo(`skipped ${m.filename} (already applied)`);
        continue;
      }

      logInfo(`applying ${m.filename}`);
      const statements = m.content
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith('--'));
      for (const stmt of statements) {
        db.exec(stmt + ';');
      }
      db.prepare('INSERT INTO _eaios_migrations (id, applied_at, checksum) VALUES (?, ?, ?)').run(
        m.id,
        Math.floor(Date.now() / 1000),
        checksum,
      );
      ran++;
    }
    logInfo(`${ran} migration(s) applied, ${migrations.length - ran} already up-to-date`);
  } finally {
    db.close();
  }
}

main().catch((e) => {
  logError(e.message);
  process.exit(1);
});
