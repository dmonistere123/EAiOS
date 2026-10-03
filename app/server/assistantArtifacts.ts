import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { RequestArtifact } from '../src/domain/assistantRequest.ts';
import { compressionLineage, profileStatePath } from './assistantEvidence.ts';
interface Links { artifacts: RequestArtifact[]; taskIds: string[]; linkageLimited?: boolean; linkageUnavailable?: boolean; }
const cache = new Map<string, { expires: number; links: Links }>();
const empty = (): Links => ({ artifacts: [], taskIds: [] });
/** Explicit origin-task provenance only, with proved compression continuity. Independent
 * branch/reset/delegate children are excluded. A delegated task whose origin session
 * is ours is attributable directly through tasks.session_id, without guessing ancestry. */
export function requestArtifacts(home: string, roots: string[], profile?: string): Links {
  if (!roots.length) return empty();
  const key = JSON.stringify([home, roots, profile]); const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.links;
  let state: DatabaseSync | undefined; let db: DatabaseSync | undefined; let links: Links;
  try {
    state = new DatabaseSync(profileStatePath(home, profile), { readOnly: true }); state.exec('PRAGMA busy_timeout=1000');
    const lineages = roots.map(root => compressionLineage(state!, root));
    const sessions = new Set(lineages.flat());
    db = new DatabaseSync(join(home, 'kanban.db'), { readOnly: true }); db.exec('PRAGMA busy_timeout=1000');
    const rows = db.prepare(`SELECT id FROM tasks WHERE session_id IN (${[...sessions].map(() => '?').join(',')}) ORDER BY id LIMIT 201`).all(...sessions) as { id: string }[];
    const taskIds = rows.slice(0, 200).map(t => t.id);
    const artifacts = taskIds.length ? db.prepare(`SELECT id,task_id,substr(filename,1,256) AS filename FROM task_attachments WHERE task_id IN (${taskIds.map(() => '?').join(',')}) ORDER BY created_at DESC LIMIT 201`).all(...taskIds) as { id: number; task_id: string; filename: string }[] : [];
    links = { taskIds, artifacts: artifacts.slice(0, 200).map(a => ({ id: `att-${a.id}`, name: a.filename, taskId: a.task_id, url: `/api/artifacts/att-${a.id}/raw` })), linkageLimited: lineages.some(ids => ids.length >= 33) || rows.length > 200 || artifacts.length > 200 };
  } catch { links = { ...empty(), linkageUnavailable: true }; }
  finally { state?.close(); db?.close(); }
  if (cache.size >= 128) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 10000, links });
  return links;
}
