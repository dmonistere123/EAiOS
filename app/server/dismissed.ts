/**
 * Server-side dismissal store for the Today page.
 *
 * Dismissing a work item is meant to mean "I no longer need to address this".
 * That decision must follow the user across browsers and machines, so it is
 * persisted server-side in <eaiosRoot>/dismissed.json (gitignored) rather than
 * browser localStorage.
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

const FILENAME = 'dismissed.json';

function pathFor(eaiosRoot: string): string {
  return join(eaiosRoot, FILENAME);
}

function readSet(file: string): Set<string> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(parsed) && parsed.every((i) => typeof i === 'string')) {
      return new Set(parsed);
    }
  } catch {
    // missing or corrupt file = empty set
  }
  return new Set();
}

function writeSet(file: string, ids: Set<string>): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify([...ids], null, 2));
  renameSync(tmp, file);
}

export function listDismissed(eaiosRoot: string): string[] {
  return [...readSet(pathFor(eaiosRoot))];
}

export function dismissWorkItem(eaiosRoot: string, id: string): string[] {
  const file = pathFor(eaiosRoot);
  const ids = readSet(file);
  ids.add(id);
  writeSet(file, ids);
  return [...ids];
}

export function undismissWorkItem(eaiosRoot: string, id: string): string[] {
  const file = pathFor(eaiosRoot);
  const ids = readSet(file);
  ids.delete(id);
  writeSet(file, ids);
  return [...ids];
}
