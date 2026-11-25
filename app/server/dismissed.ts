/** Server-persisted dismissal revisions. No expiry and no clock comparisons.
 * A legacy ID array is baselined ONCE against current activity, preserving every
 * previous dismissal. Later meaningful activity changes its revision and makes
 * the item visible again. Re-dismiss records that new revision.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

type RecordEntry = { revision: string | null };
type Store = Map<string, RecordEntry>;
function readStore(root: string): Store {
  let text: string;
  try { text = readFileSync(join(root, 'dismissed.json'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map(); throw error; }
  const value: unknown = JSON.parse(text);
  if (Array.isArray(value) && value.every((id) => typeof id === 'string')) {
    return new Map(value.map((id: string) => [id, { revision: null }]));
  }
  if (value && typeof value === 'object' && 'version' in value && value.version === 2 && 'items' in value && value.items && typeof value.items === 'object') {
    const entries = Object.entries(value.items).map(([id, item]): [string, RecordEntry] => {
      if (!item || typeof item !== 'object' || !('revision' in item) || (item.revision !== null && typeof item.revision !== 'string')) throw new Error('Invalid dismissal record');
      return [id, { revision: item.revision as string | null }];
    });
    return new Map(entries);
  }
  // Accept the earlier, unshipped timestamp map without expiring its entries.
  if (value && typeof value === 'object' && Object.values(value).every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return new Map(Object.keys(value).map((id) => [id, { revision: null }]));
  }
  throw new Error('Invalid dismissal store; refusing to discard existing dismissals');
}
function writeStore(root: string, store: Store): void {
  const file = join(root, 'dismissed.json');
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 2, items: Object.fromEntries(store) }, null, 2));
  renameSync(tmp, file);
}
function baseline(store: Store, activity: Record<string, string>): boolean {
  let changed = false;
  for (const [id, entry] of store) {
    if (entry.revision === null && activity[id] !== undefined) {
      entry.revision = activity[id]; changed = true;
    }
  }
  return changed;
}
function active(store: Store, activity: Record<string, string>): string[] {
  return [...store].filter(([id, entry]) => entry.revision === null || activity[id] === undefined || activity[id] === entry.revision).map(([id]) => id);
}
/** Both dashboard processes share this file. SQLite's crash-safe process lock
 * serializes the WHOLE read-modify-rename, including migration-on-first-read.
 * The mutex DB contains no application data, only the SQLite lock itself.
 */
function withStore<T>(root: string, operation: () => T): T {
  const mutex = new DatabaseSync(join(root, 'dismissed-mutex.sqlite'));
  try {
    mutex.exec('PRAGMA busy_timeout=2000; BEGIN IMMEDIATE');
    const result = operation();
    mutex.exec('COMMIT');
    return result;
  } finally {
    try { mutex.exec('ROLLBACK'); } catch { /* committed or lock not acquired */ }
    mutex.close();
  }
}
/** All stored IDs, including resurfaced items, for a bounded activity query. */
export function recordedDismissalIds(root: string): string[] { return [...readStore(root).keys()]; }
export function listDismissed(root: string, activity: Record<string, string> = {}): string[] {
  return withStore(root, () => {
    const store = readStore(root);
    if (baseline(store, activity)) writeStore(root, store);
    return active(store, activity);
  });
}
export function dismissWorkItem(root: string, id: string, activity: Record<string, string> = {}): string[] {
  return withStore(root, () => {
    const store = readStore(root);
    baseline(store, activity);
    store.set(id, { revision: activity[id] ?? null });
    writeStore(root, store);
    return active(store, activity);
  });
}
export function undismissWorkItem(root: string, id: string, activity: Record<string, string> = {}): string[] {
  return withStore(root, () => {
    const store = readStore(root);
    baseline(store, activity);
    store.delete(id);
    writeStore(root, store);
    return active(store, activity);
  });
}
