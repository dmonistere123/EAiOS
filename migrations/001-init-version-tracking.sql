-- Initial EAiOS version/update tracking schema.
-- Creates the migrations ledger (also created by the runner as a safeguard)
-- and a persistent update log for shipped boxes.

CREATE TABLE IF NOT EXISTS _eaios_migrations (
  id TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eaios_update_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  old_git_sha TEXT,
  new_git_sha TEXT,
  old_version TEXT,
  new_version TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_eaios_update_log_finished
  ON eaios_update_log(finished_at);
