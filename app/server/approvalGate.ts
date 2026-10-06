import { DatabaseSync } from 'node:sqlite';
import { isAwaitingApproval } from '../src/domain/approvalGate.ts';

interface Task {
  id: string; body: string; status: string; assignee: string | null;
  block_kind: string | null; result: string | null; started_at: number | null;
  claim_lock: string | null; current_run_id: number | null;
}
export class ApprovalGateError extends Error {
  status = 409;
}
function fail(message: string): never { throw new ApprovalGateError(message); }
function envelope(body: string): Record<string, unknown> {
  let value;
  try { value = JSON.parse(body); } catch { fail('Invalid approval envelope.'); }
  if (!value || value.eaios !== 'approval') fail('Task is not an approval envelope.');
  return value;
}
function transaction<T>(path: string, action: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE');
    const result = action(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally { db.close(); }
}
function taskFor(db: DatabaseSync, id: string): Task {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as unknown as Task | undefined;
  if (!task) fail('Approval task not found.');
  return task;
}
function idle(task: Task) {
  if (task.claim_lock || task.current_run_id || !['blocked', 'ready', 'todo', 'triage'].includes(task.status)) {
    fail('This task is already executing or closed. Refresh Approvals.');
  }
}

/** One commit exposes both the human decision and runnable state to Hermes.
 * No CLI release/assign sequence, no provider call, and no automatic retry. */
export function decideApprovalTask(path: string, id: string, input: Record<string, unknown>) {
  const decision = input.decision;
  if (typeof decision !== 'string' || !['approved', 'rejected', 'changes_requested'].includes(decision)) fail('Invalid approval decision.');
  if (typeof input.expectedBody !== 'string') fail('Refresh and review the draft before deciding.');
  return transaction(path, db => {
    const task = taskFor(db, id), env = envelope(task.body);
    if (env.decision) {
      if (env.decision === decision) return { ok: true, auditEventId: `kb-decision-${id}`, alreadyDecided: true };
      fail('A decision has already been recorded. Refresh Approvals.');
    }
    if (task.body !== input.expectedBody) fail('The draft changed since you reviewed it. Refresh and review it again.');
    idle(task);
    if (decision === 'approved') {
      if (!isAwaitingApproval(task)) fail('Resolve the execution blocker before approving this task.');
      if (typeof env.requestedBy !== 'string' || !env.requestedBy.trim()) fail('No requesting agent is specified. Keep the draft blocked until it is corrected.');
      if (typeof env.payload !== 'string' || !env.payload.trim()) fail('The draft has no prepared content to approve.');
      const parent = db.prepare("SELECT 1 FROM task_links e JOIN tasks p ON p.id = e.parent_id WHERE e.child_id = ? AND p.status NOT IN ('done', 'archived') LIMIT 1").get(id);
      if (parent) fail('A prerequisite is unfinished. The draft remains blocked.');
    }
    const now = Math.floor(Date.now() / 1000);
    const event = (kind: string, payload: Record<string, unknown>) => db.prepare(
      'INSERT INTO task_events (task_id, kind, payload, created_at) VALUES (?, ?, ?, ?)'
    ).run(id, kind, JSON.stringify({ ...payload, actor: 'eaios-executive' }), now);
    const body = JSON.stringify({ ...env, decision, decidedAt: new Date().toISOString(), ...(typeof input.note === 'string' ? { decisionNote: input.note } : {}) });
    event('approval_decided', { decision });
    if (decision === 'approved') {
      db.prepare("UPDATE tasks SET body = ?, status = 'ready', assignee = ?, consecutive_failures = 0, last_failure_error = NULL WHERE id = ?").run(body, env.requestedBy as string, id);
      event('unblocked', { status: 'ready', reason: 'Executive approved prepared action' });
      event('assigned', { assignee: env.requestedBy, from: task.assignee });
    } else {
      db.prepare("UPDATE tasks SET body = ?, status = 'blocked', assignee = NULL, block_kind = 'needs_input' WHERE id = ?").run(body, id);
      event('blocked', { kind: 'needs_input', reason: decision === 'rejected' ? 'Rejected by executive' : 'Changes requested by executive' });
    }
    return { ok: true, auditEventId: `kb-decision-${id}` };
  });
}

/** Draft edits cannot forge a decision, change its recipient/agent metadata,
 * or race with a send. Preserve unknown envelope fields from the stored row. */
export function editApprovalTask(path: string, id: string, nextBody: string, expectedBody: unknown) {
  return transaction(path, db => {
    const task = taskFor(db, id), env = envelope(task.body), next = envelope(nextBody);
    idle(task);
    if (env.decision) fail('A decided draft cannot be edited. Create a new approval.');
    if (typeof expectedBody !== 'string' || expectedBody !== task.body) fail('The draft changed. Refresh before editing.');
    if (JSON.stringify({ ...next, payload: env.payload }) !== JSON.stringify(env)) fail('Only the draft content can be edited here.');
    if (typeof next.payload !== 'string' || !next.payload.trim()) fail('Draft content is required.');
    db.prepare('UPDATE tasks SET body = ? WHERE id = ?').run(JSON.stringify({ ...env, payload: next.payload }), id);
    return { ok: true };
  });
}
