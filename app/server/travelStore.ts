import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { TravelTrip } from '../src/domain/types.ts';

/** Shared by both web services; dataRoot remains stable across staged releases. */
export function travelStore<T>(dataRoot: string, run: (db: DatabaseSync) => T): T {
  const directory = join(dataRoot, 'travel-data');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'travel.db');
  const db = new DatabaseSync(path);
  try {
    chmodSync(path, 0o600);
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS trips (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, body TEXT NOT NULL, expires_at INTEGER NOT NULL);`);
    db.exec('BEGIN IMMEDIATE');
    try { const value = run(db); db.exec('COMMIT'); return value; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } finally { db.close(); }
}
export function readTrip(db: DatabaseSync, id: string): TravelTrip | null {
  const row = db.prepare('SELECT body FROM trips WHERE id=?').get(id) as { body: string } | undefined;
  return row ? JSON.parse(row.body) as TravelTrip : null;
}
export function writeTrip(db: DatabaseSync, trip: TravelTrip): void {
  db.prepare('INSERT INTO trips VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(trip.id, JSON.stringify(trip));
}
