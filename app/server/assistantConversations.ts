import { DatabaseSync } from 'node:sqlite';
import { compressionLineage, profileStatePath } from './assistantEvidence.ts';

/** History reads never activate/resume a runtime or submit a prompt. */
export function readConversation(home: string, id: string, profile?: string) {
  if (!id || id.length > 256) throw new Error('Invalid conversation');
  const db = new DatabaseSync(profileStatePath(home, profile), { readOnly: true });
  try {
    let root = id;
    if (!db.prepare('SELECT id FROM sessions WHERE id=?').get(root)) throw new Error('Conversation not found');
    const visited = new Set<string>();
    while (!visited.has(root) && visited.size < 32) {
      visited.add(root);
      const parent = db.prepare(`SELECT p.id FROM sessions c JOIN sessions p ON c.parent_session_id=p.id
        WHERE c.id=? AND p.end_reason='compression' AND COALESCE(c.source,'')!='tool'
        AND json_extract(COALESCE(c.model_config,'{}'),'$._branched_from') IS NULL
        AND json_extract(COALESCE(c.model_config,'{}'),'$._delegate_from') IS NULL
        AND json_extract(COALESCE(c.model_config,'{}'),'$._reset_from') IS NULL`).get(root);
      if (!parent) break;
      root = String(parent.id);
    }
    if (visited.size >= 32) throw new Error('Conversation history is too deeply linked to load safely');
    const lineage = compressionLineage(db, root);
    if (lineage.length >= 33) throw new Error('Conversation history is too deeply linked to load safely');
    const placeholders = lineage.map(() => '?').join(',');
    const rows = db.prepare(`SELECT id,role,timestamp,substr(content,1,16384) AS text,length(content)>16384 AS shortened
      FROM messages WHERE session_id IN (${placeholders}) AND role IN ('user','assistant')
      AND COALESCE(display_kind,'') NOT IN ('hidden','interim') AND length(trim(COALESCE(content,'')))>0
      ORDER BY id DESC LIMIT 501`).all(...lineage);
    let bytes = 0; const selected = [];
    for (const row of rows.slice(0,500)) {
      bytes += Buffer.byteLength(String(row.text)); if (bytes > 1024 * 1024) break;
      selected.push({ id: `stored-${row.id}`, role: row.role === 'user' ? 'you' : 'ally', text: String(row.text) + (row.shortened ? '\n[Display shortened; the original remains saved in this conversation.]' : ''), at: new Date(Number(row.timestamp) * 1000).toISOString() });
    }
    return { messages: selected.reverse(), limited: selected.length < rows.length, root, sessionId: lineage.at(-1) };
  } finally { db.close(); }
}
