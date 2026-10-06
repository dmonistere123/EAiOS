// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { decideApprovalTask, editApprovalTask } from '../../server/approvalGate.ts';
import { handleApiRequest } from '../../server/httpApi.ts';
import { isAwaitingApproval } from '../domain/approvalGate';

let root: string, path: string, db: DatabaseSync, server: Server | undefined;
const draft = { eaios: 'approval', actionType: 'send', targetSystem: 'outlook', requestedBy: 'quill', payload: 'To: example@example.invalid\nSubject: Test\nBody: Test draft', sourceContext: { subject: 'Original' }, workerGuard: 'Never send before approval', custom: { keep: true } };
const body = JSON.stringify(draft);
function seed(id = 'draft', patch: Record<string, unknown> = {}) {
  db.prepare("INSERT INTO tasks (id, body, status) VALUES (?, ?, 'blocked')").run(id, body);
  for (const [key, value] of Object.entries(patch)) db.prepare(`UPDATE tasks SET ${key} = ? WHERE id = ?`).run(value as string, id);
}
function row(id = 'draft') { return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)!; }
function decide(decision = 'approved', extra: Record<string, unknown> = {}) { return decideApprovalTask(path, 'draft', { decision, expectedBody: body, ...extra }); }
function events() { return db.prepare('SELECT kind, payload FROM task_events ORDER BY id').all(); }
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'eaios-approval-'));
  path = join(root, 'kanban.db');
  db = new DatabaseSync(path);
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, body TEXT, status TEXT, assignee TEXT, block_kind TEXT, result TEXT, started_at INTEGER, claim_lock TEXT, current_run_id INTEGER, consecutive_failures INTEGER DEFAULT 0, last_failure_error TEXT);
    CREATE TABLE task_links (parent_id TEXT, child_id TEXT);
    CREATE TABLE task_events (id INTEGER PRIMARY KEY, task_id TEXT, kind TEXT, payload TEXT, created_at INTEGER);`);
  seed();
});
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined; db.close(); rmSync(root, { recursive: true, force: true });
});

describe('approval execution gate with real temporary SQLite', () => {
  it('rejects malformed decisions without changing the draft', () => {
    expect(() => decideApprovalTask(path, 'draft', { decision: ['approved'], expectedBody: body })).toThrow('Invalid approval decision');
    expect(row()).toMatchObject({ body, status: 'blocked', assignee: null });
  });
  it('shows legacy blocked drafts without changing execution state', () => {
    expect(isAwaitingApproval(row() as never)).toBe(true);
    expect(row()).toMatchObject({ status: 'blocked', assignee: null, block_kind: null });
    expect(events()).toEqual([]);
  });
  it.each(['rejected', 'changes_requested'])('%s never releases, assigns, or unlinks a blocked task', decision => {
    db.prepare("INSERT INTO task_links VALUES ('unfinished-parent', 'draft')").run();
    decide(decision);
    expect(row()).toMatchObject({ status: 'blocked', assignee: null, block_kind: 'needs_input' });
    expect(JSON.parse(String(row().body))).toMatchObject({ ...draft, decision });
    expect(events().map(e => e.kind)).toEqual(['approval_decided', 'blocked']);
    expect(db.prepare('SELECT count(*) AS n FROM task_links').get()?.n).toBe(1);
  });
  it('records approval and releases to requestedBy atomically; repeated approval is a no-op', () => {
    decide();
    expect(row()).toMatchObject({ status: 'ready', assignee: 'quill' });
    expect(JSON.parse(String(row().body))).toMatchObject({ ...draft, decision: 'approved' });
    expect(events().map(e => e.kind)).toEqual(['approval_decided', 'unblocked', 'assigned']);
    const before = JSON.stringify(row());
    expect(decide().alreadyDecided).toBe(true);
    expect(JSON.stringify(row())).toBe(before);
    expect(events()).toHaveLength(3);
    expect(() => decide('rejected')).toThrow('already been recorded');
  });
  it('rolls back both the decision and release when audit persistence fails', () => {
    db.exec("CREATE TRIGGER fail_assignment BEFORE INSERT ON task_events WHEN NEW.kind = 'assigned' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END");
    expect(() => decide()).toThrow('audit unavailable');
    expect(row()).toMatchObject({ body, status: 'blocked', assignee: null });
    expect(events()).toEqual([]);
  });
  it.each(['capability', 'dependency', 'transient'])('keeps a %s blocker blocked', block_kind => {
    db.prepare('UPDATE tasks SET block_kind = ?').run(block_kind);
    expect(isAwaitingApproval(row() as never)).toBe(false);
    expect(() => decide()).toThrow('blocker');
    expect(row().status).toBe('blocked');
  });
  it.each(['running', 'done', 'archived'])('does not release a %s task', status => {
    db.prepare('UPDATE tasks SET status = ?').run(status);
    expect(() => decide()).toThrow('executing or closed');
    expect(events()).toEqual([]);
  });
  it('does not bypass unfinished prerequisites', () => {
    seed('parent', { status: 'ready' });
    db.exec("INSERT INTO task_links VALUES ('parent', 'draft')");
    expect(() => decide()).toThrow('prerequisite');
    expect(row().status).toBe('blocked');
  });
  it.each([{ requestedBy: '' }, { payload: '' }])('refuses incomplete drafts without recording approval: %j', change => {
    const altered = JSON.stringify({ ...draft, ...change });
    db.prepare('UPDATE tasks SET body = ?').run(altered);
    expect(() => decide('approved', { expectedBody: altered })).toThrow();
    expect(events()).toEqual([]);
    expect(row().status).toBe('blocked');
  });
  it('does not approve content changed since review; editing preserves all metadata', () => {
    editApprovalTask(path, 'draft', JSON.stringify({ ...draft, payload: 'Edited content' }), body);
    expect(() => decide()).toThrow('changed since you reviewed');
    expect(row()).toMatchObject({ status: 'blocked', assignee: null });
    expect(JSON.parse(String(row().body))).toEqual({ ...draft, payload: 'Edited content' });
  });
  it('cannot forge a decision or redirect execution through the draft-edit endpoint', () => {
    for (const change of [{ decision: 'approved' }, { requestedBy: 'other' }, { targetSystem: 'other' }]) {
      expect(() => editApprovalTask(path, 'draft', JSON.stringify({ ...draft, ...change }), body)).toThrow('Only the draft');
    }
    decide();
    expect(() => editApprovalTask(path, 'draft', body, row().body)).toThrow('decided draft');
  });
  it('handles simultaneous HTTP approvals once and rejects cross-origin decisions', async () => {
    server = createServer((req, res) => { void handleApiRequest(req, res, { hermesHome: root, eaiosRoot: root }); });
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const request = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: 'approved', expectedBody: body }) };
    const url = base + '/api/kanban/approvals/draft/decision';
    const denied = await fetch(url, { ...request, headers: { ...request.headers, origin: 'https://other.invalid' } });
    expect(denied.status).toBe(400);
    expect(row().status).toBe('blocked');
    const results = await Promise.all([fetch(url, request), fetch(url, request)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(events()).toHaveLength(3);
  });
});
