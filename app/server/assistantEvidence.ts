import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
/** Installed Hermes: hermes_state_compression.py:_CHAIN_STEP_SQL. Only a proved
 * compression continuation is followed. Branch/delegate/reset/tool children are not
 * interchangeable with the originating prompt (hermes_state_messages.py:687). */
export function compressionLineage(db: DatabaseSync, root: string): string[] {
  const ids = root ? [root] : [];
  for (let depth = 0; depth < 32 && ids.length; depth++) {
    const row = db.prepare(`SELECT child.id FROM sessions parent JOIN sessions child ON child.parent_session_id=parent.id
      WHERE parent.id=? AND parent.end_reason='compression'
      AND json_extract(COALESCE(child.model_config,'{}'),'$._branched_from') IS NULL
      AND json_extract(COALESCE(child.model_config,'{}'),'$._delegate_from') IS NULL
      AND json_extract(COALESCE(child.model_config,'{}'),'$._reset_from') IS NULL
      AND COALESCE(child.source,'')!='tool'
      ORDER BY CASE WHEN child.end_reason='compression' THEN 0 WHEN child.ended_at IS NULL THEN 1 ELSE 2 END,
      COALESCE(child.last_activity_at,child.ended_at,child.started_at) DESC,child.started_at DESC,child.id DESC LIMIT 1`).get(ids.at(-1)!) as { id: string } | undefined;
    if (!row || ids.includes(row.id)) break;
    ids.push(row.id);
  }
  return ids;
}
export function profileStatePath(home: string, profile?: string) {
  if (profile && !/^[a-zA-Z0-9_-]+$/.test(profile)) throw new Error('Invalid profile');
  return join(home, ...(profile ? ['profiles', profile] : []), 'state.db');
}
export interface SavedEvidence { response?: string; responseLimited?: boolean; available: boolean; incompleteLineage?: boolean; }
/** Never invokes session.resume or constructs a runtime. Limit the actual SQL result,
 * not just JS rendering. A saved assistant row does not prove successful completion. */
export function savedEvidence(home: string, root: string, profile?: string): SavedEvidence {
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(profileStatePath(home, profile), { readOnly: true });
    db.exec('PRAGMA busy_timeout=1000');
    const lineage = compressionLineage(db, root);
    // The bounded last ancestor is not a verified tip. Do not read its answer or
    // jump to a later stored ID without proving continuity from the original root.
    if (lineage.length >= 33) return { available: false, incompleteLineage: true };
    const tip = lineage.at(-1); if (!tip) return { available: false };
    const row = db.prepare(`SELECT role,substr(content,1,65536) AS text,length(content)>65536 AS limited
      FROM messages WHERE session_id=? AND role IN ('user','assistant') AND COALESCE(display_kind,'') NOT IN ('hidden','interim')
      ORDER BY id DESC LIMIT 1`).get(tip) as { role: string; text: string; limited: number } | undefined;
    return { available: true, response: row?.role === 'assistant' ? row.text : undefined, responseLimited: !!row?.limited };
  } catch { return { available: false }; }
  finally { db?.close(); }
}
