// @vitest-environment node
import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decideApprovalTask } from '../../server/approvalGate.ts';
import { isAwaitingApproval } from '../domain/approvalGate';

it.skipIf(!process.env.EAIOS_TEST_HERMES_ROOT)('real Hermes creation, scheduler sweep, approval, and single claim use an isolated database', () => {
  const root = mkdtempSync(join(tmpdir(), 'eaios-hermes-approval-'));
  const dbPath = join(root, 'kanban.db');
  const probe = (mode: string, id?: string) => JSON.parse(execFileSync(process.env.EAIOS_TEST_HERMES_PYTHON ?? 'python3',
    ['src/tests/fixtures/approval-hermes-probe.py', mode, ...(id ? [id] : [])], {
      env: { ...process.env, HERMES_HOME: root, HERMES_KANBAN_DB: dbPath, HERMES_PROFILE: 'default', PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8',
    }));
  try {
    const ids = probe('create') as Record<string, string>;
    const before = probe('sweep') as { id: string; status: string; assignee: string | null }[];
    for (const task of before) {
      expect(task).toMatchObject({ status: 'blocked', assignee: null });
      expect(isAwaitingApproval(task)).toBe(true);
      expect(probe('claim', task.id).claimed).toBe(false);
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      for (const [name, decision] of [['approve', 'approved'], ['reject', 'rejected'], ['changes', 'changes_requested']]) {
        const expectedBody = db.prepare('SELECT body FROM tasks WHERE id = ?').get(ids[name])!.body;
        decideApprovalTask(dbPath, ids[name], { decision, expectedBody });
        decideApprovalTask(dbPath, ids[name], { decision, expectedBody });
      }
      const after = probe('sweep') as typeof before;
      expect(after.find(t => t.id === ids.approve)).toMatchObject({ status: 'ready', assignee: 'default' });
      for (const name of ['reject', 'changes', 'future']) {
        expect(after.find(t => t.id === ids[name])).toMatchObject({ status: 'blocked', assignee: null });
        expect(probe('claim', ids[name]).claimed).toBe(false);
      }
      expect(probe('claim', ids.approve).claimed).toBe(true);
      expect(probe('claim', ids.approve).claimed).toBe(false);
      expect(db.prepare('SELECT count(*) AS n FROM task_runs WHERE task_id = ?').get(ids.approve)?.n).toBe(1);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);
