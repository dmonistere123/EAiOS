#!/usr/bin/env node
// SQLite executes whole scripts; comments, triggers and quoted semicolons are SQL.
import { readdirSync, readFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { DatabaseSync, backup } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';

export async function runMigrations({
  dbPath = process.env.EAIOS_STATE_DB || join(homedir(), '.hermes', 'state.db'),
  migrationsDir = process.env.EAIOS_MIGRATIONS_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  backupDir = process.env.EAIOS_MIGRATION_BACKUP_DIR || join(dirname(dbPath), 'eaios-migration-backups'),
} = {}) {
  if (!existsSync(migrationsDir)) return { applied: 0 };
  const ids = new Set();
  const migrations = readdirSync(migrationsDir).filter(f => /^\d{3}-[\w-]+\.sql$/.test(f)).sort().map(filename => {
    const id = filename.slice(0, 3);
    if (ids.has(id)) throw new Error(`Duplicate migration id ${id}`);
    ids.add(id);
    const content = readFileSync(join(migrationsDir, filename), 'utf8');
    return { id, filename, content, checksum: createHash('sha256').update(content).digest('hex') };
  });
  if (!migrations.length) return { applied: 0 };
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS _eaios_migrations (
      id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL, checksum TEXT NOT NULL
    )`);
    const ledger = new Map(db.prepare('SELECT id, checksum FROM _eaios_migrations').all().map(r => [r.id, r.checksum]));
    for (const m of migrations) {
      if (ledger.has(m.id) && ledger.get(m.id) !== m.checksum) {
        throw new Error(`Migration ${m.filename} changed after it was applied`);
      }
    }
    const pending = migrations.filter(m => !ledger.has(m.id));
    let backupPath;
    if (pending.length) {
      mkdirSync(backupDir, { recursive: true, mode: 0o700 });
      chmodSync(backupDir, 0o700);
      backupPath = join(backupDir, `${Date.now()}-${randomUUID()}.db`);
      // The SQLite backup API includes WAL data, unlike copying a live .db.
      await backup(db, backupPath);
      chmodSync(backupPath, 0o600);
      console.log(`[migrations] Pre-migration backup: ${backupPath}`);
    }
    for (const m of pending) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(m.content);
        db.prepare('INSERT INTO _eaios_migrations (id, applied_at, checksum) VALUES (?, ?, ?)')
          .run(m.id, Math.floor(Date.now() / 1000), m.checksum);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw new Error(`Migration ${m.filename} failed: ${error.message}`, { cause: error });
      }
      console.log(`[migrations] Applied ${m.filename}`);
    }
    return { applied: pending.length, backupPath };
  } finally { db.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runMigrations().then(({ applied }) => console.log(`[migrations] ${applied} migration(s) applied`)).catch(error => {
    console.error(`[migrations] ${error.message}`);
    process.exitCode = 1;
  });
}
