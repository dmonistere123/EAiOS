/** ChunkDrawer — drill-down for one knowledge chunk (citation contract:
 * `eaios://chunk/<id>` resolves via knowledge.getChunk). Shared by the
 * Knowledge page (retrieval results) and the Assistant page (6.4b citation
 * chips parsed out of Ally's answers). */
import { useEffect, useState } from 'react';
import { knowledge } from '../adapters';
import type { KnowledgeChunk } from '../adapters/interfaces';
import { Drawer, StateBadge } from './ui';

export function ChunkDrawer({ chunkId, onClose }: { chunkId: string; onClose: () => void }) {
  const [chunk, setChunk] = useState<KnowledgeChunk | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    knowledge.getChunk(chunkId).then(
      (c) => live && setChunk(c),
      (e) => live && setError(e instanceof Error ? e.message : 'Load failed.'),
    );
    return () => {
      live = false;
    };
  }, [chunkId]);
  return (
    <Drawer title={`Citation ${chunkId}`} onClose={onClose} width={520}>
      {error && <p className="text-sm text-risk">{error}</p>}
      {!chunk && !error && <p className="text-sm text-ink-dim">Loading chunk…</p>}
      {chunk && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium text-ink">{chunk.sourceName}</span>
            <StateBadge label={chunk.scope} tone="neutral" />
            <StateBadge label={chunk.citationEnabled ? 'citable' : 'not citable'} tone={chunk.citationEnabled ? 'ok' : 'risk'} />
            <span className="text-ink-faint">chunk #{chunk.chunkIndex}</span>
          </div>
          {chunk.sourceUri && <a href={chunk.sourceUri} target="_blank" rel="noreferrer" className="block truncate text-xs text-signal hover:underline">{chunk.sourceUri}</a>}
          <p className="whitespace-pre-wrap rounded-lg border border-edge bg-canvas p-4 text-sm leading-relaxed text-ink">{chunk.text}</p>
          <p className="text-xs text-ink-faint">Cite as <code className="rounded bg-canvas-overlay px-1 font-mono">eaios://chunk/{chunk.chunkId}</code></p>
        </div>
      )}
    </Drawer>
  );
}
