#!/usr/bin/env node
// Kept outside the checkout during an update so old releases need not contain it.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [command, ...args] = process.argv.slice(2);
const path = process.env.EAIOS_STATE_DB;
if (!path) throw new Error('EAIOS_STATE_DB must be set');
mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path);
db.exec('PRAGMA busy_timeout = 10000');
try {
  db.exec(`CREATE TABLE IF NOT EXISTS eaios_update_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, started_at INTEGER NOT NULL,
    finished_at INTEGER, old_git_sha TEXT, new_git_sha TEXT,
    old_version TEXT, new_version TEXT, success INTEGER NOT NULL DEFAULT 0,
    error_message TEXT
  )`);
  const columns = new Set(db.prepare('PRAGMA table_info(eaios_update_log)').all().map(r => r.name));
  for (const [name, type] of [['action', "TEXT NOT NULL DEFAULT 'update'"], ['target_git_sha', 'TEXT']]) {
    if (!columns.has(name)) db.exec(`ALTER TABLE eaios_update_log ADD COLUMN ${name} ${type}`);
  }
  switch (command) {
    case 'start': {
      const [action, sha, version] = args;
      console.log(db.prepare('INSERT INTO eaios_update_log (started_at, action, old_git_sha, old_version) VALUES (?, ?, ?, ?)')
        .run(Math.floor(Date.now() / 1000), action, sha, version).lastInsertRowid);
      break;
    }
    case 'target':
      db.prepare('UPDATE eaios_update_log SET target_git_sha=? WHERE id=?').run(args[1], Number(args[0]));
      break;
    case 'finish': {
      const [id, success, error, sha, version] = args;
      db.prepare('UPDATE eaios_update_log SET finished_at=?, success=?, error_message=?, new_git_sha=?, new_version=? WHERE id=?')
        .run(Math.floor(Date.now() / 1000), Number(success), error || null, sha, version, Number(id));
      break;
    }
    case 'rollback-target': {
      // Exclude no-ops and rollbacks. A failed code-changing attempt must
      // return to ITS pre-update revision, not a much older successful update.
      const row = db.prepare(`SELECT old_git_sha FROM eaios_update_log
        WHERE finished_at IS NOT NULL AND action IN ('update', 'update-to')
          AND old_git_sha IS NOT NULL
          AND COALESCE(target_git_sha, new_git_sha) IS NOT NULL
          AND old_git_sha != COALESCE(target_git_sha, new_git_sha)
        ORDER BY id DESC LIMIT 1`).get();
      if (!row) throw new Error('No code-changing update is available to roll back');
      console.log(row.old_git_sha);
      break;
    }
    default: throw new Error(`Unknown update-state command: ${command}`);
  }
} finally { db.close(); }
