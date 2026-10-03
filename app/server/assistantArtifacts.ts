import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { RequestArtifact } from '../src/domain/assistantRequest.ts';
/** Link only explicit task origin-session provenance, including compression descendants.
 * No filename/time/assignee guessing, and no prompt injection or transcript reads. */
export function requestArtifacts(hermesHome: string, roots: string[], profile?: string): { artifacts: RequestArtifact[]; taskIds: string[] } {
  if (!roots.length) return { artifacts: [], taskIds: [] };
  if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile)) return { artifacts: [], taskIds: [] };
  const sessions = new Set(roots); let state: DatabaseSync | undefined; let db: DatabaseSync | undefined;
  try {
    state = new DatabaseSync(join(hermesHome, ...(profile ? ['profiles', profile] : []), 'state.db'), { readOnly: true });
    for (const root of roots) for (const row of state.prepare('WITH RECURSIVE lineage(id) AS (SELECT id FROM sessions WHERE id=? UNION SELECT s.id FROM sessions s JOIN lineage l ON s.parent_session_id=l.id) SELECT id FROM lineage').all(root) as { id: string }[]) sessions.add(row.id);
    db = new DatabaseSync(join(hermesHome, 'kanban.db'), { readOnly: true });
    const taskIds = (db.prepare(`SELECT id FROM tasks WHERE session_id IN (${[...sessions].map(() => '?').join(',')})`).all(...sessions) as { id: string }[]).map(t => t.id);
    const artifacts = taskIds.length ? (db.prepare(`SELECT id,task_id,filename FROM task_attachments WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY created_at`).all(...taskIds) as { id: number; task_id: string; filename: string }[]).map(a => ({ id: `att-${a.id}`, name: a.filename, taskId: a.task_id, url: `/api/artifacts/att-${a.id}/raw` })) : [];
    return { artifacts, taskIds };
  } catch { return { artifacts: [], taskIds: [] }; }
  finally { state?.close(); db?.close(); }
}
