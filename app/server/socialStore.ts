import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SocialBoard, SocialBrief, SocialPost } from '../src/domain/social.ts';
export class SocialError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export function socialStore<T>(root: string, run: (db: DatabaseSync) => T): T {
  const dir = join(root, 'social-data'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, 'social.db'); const db = new DatabaseSync(file);
  try {
    chmodSync(file, 0o600);
    db.exec(`PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, status TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, data BLOB NOT NULL);
      BEGIN IMMEDIATE;`);
    try { const value = run(db); db.exec('COMMIT'); return value; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  } finally { db.close(); }
}
export function readSocialPost(db: DatabaseSync, id: string): SocialPost {
  const row = db.prepare('SELECT body FROM posts WHERE id=?').get(id) as {body: string} | undefined;
  if (!row) throw new SocialError(404, 'Post not found.');
  return JSON.parse(row.body);
}
export function putSocialPost(db: DatabaseSync, post: SocialPost) {
  db.prepare('INSERT INTO posts VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(post.id, JSON.stringify(post));
}
export function socialBoard(root: string): SocialBoard {
  return socialStore(root, db => ({
    posts: (db.prepare('SELECT body FROM posts').all() as {body: string}[]).map(r => JSON.parse(r.body)),
    brief: JSON.parse((db.prepare('SELECT body FROM preferences WHERE id=1').get() as {body: string} | undefined)?.body ?? 'null'),
  }));
}
export function saveSocialBrief(db: DatabaseSync, brief: SocialBrief) {
  db.prepare('INSERT INTO preferences VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(brief));
}
export function reserveSocialRequest(root: string, id: unknown) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new SocialError(400, 'A request ID is required.');
  socialStore(root, db => {
    if (db.prepare('SELECT id FROM requests WHERE id=?').get(id)) throw new SocialError(409, 'This generation request was already submitted. Reload the list before creating another request.');
    db.prepare('INSERT INTO requests VALUES (?, ?)').run(id, 'started');
  });
}
