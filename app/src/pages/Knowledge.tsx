/** Knowledge — governed RAG sources. Live via the Python sidecar
 * (/knowledge-api proxy) with mock fallback; FTS5 retrieval + chunk
 * drill-down wired in Phase 5.3 (citation contract in adapters/interfaces). */
import { useEffect, useRef, useState } from 'react';
import { useRuntime, refreshKnowledge, toast } from '../state/runtime';
import { knowledge } from '../adapters';
import type { KnowledgeSource } from '../domain/types';
import type { KnowledgeChunk, KnowledgeSearchResult } from '../adapters/interfaces';
import { Card, Drawer, EmptyState, RelativeTime, StateBadge } from '../components/ui';

const statusTone = { pending: 'warn', processing: 'signal', ready: 'ok', failed: 'risk', stale: 'warn' } as const;
const typeIcon = { file: '▤', url: '⬡', connector: '⬢', transcript: '❝', text: '¶' } as const;

/** Render a sidecar snippet with « » match marks as highlights. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(«[^»]*»)/g);
  return (
    <span>
      {parts.map((p, i) =>
        p.startsWith('«') && p.endsWith('»') ? (
          <mark key={i} className="rounded bg-signal/20 px-0.5 text-signal">{p.slice(1, -1)}</mark>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </span>
  );
}

function ChunkDrawer({ chunkId, onClose }: { chunkId: string; onClose: () => void }) {
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

function RetrievalPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<KnowledgeSearchResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [openChunk, setOpenChunk] = useState<string | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await knowledge.searchKnowledge(query.trim()));
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Retrieval failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Try retrieval</h2>
      <p className="mt-0.5 text-xs text-ink-faint">Executive context — searches every ready source. Agent queries are scope-filtered by the sidecar.</p>
      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
          placeholder="Ask the knowledge base…"
          aria-label="Retrieval query"
          className="flex-1 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm outline-none focus:border-signal/60"
        />
        <button onClick={() => void run()} disabled={busy} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>
      {results && (
        <ul className="mt-4 space-y-2">
          {results.length === 0 && <li className="text-sm text-ink-faint">No matching chunks in ready sources.</li>}
          {results.map((r) => (
            <li key={r.chunkId}>
              <button onClick={() => setOpenChunk(r.chunkId)} className="w-full rounded-lg border border-edge/70 bg-canvas px-4 py-3 text-left hover:border-signal/50">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-ink">{r.sourceName}</span>
                  <span className={r.citationEnabled ? 'text-ok' : 'text-risk'}>{r.citationEnabled ? 'citable' : 'not citable'}</span>
                </div>
                <div className="mt-1 text-sm text-ink-dim"><Snippet text={r.snippet} /></div>
                <div className="mt-1 font-mono text-[10px] text-ink-faint">{r.chunkId}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {openChunk && <ChunkDrawer chunkId={openChunk} onClose={() => setOpenChunk(null)} />}
    </Card>
  );
}

function AddSourceDrawer({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'file' | 'url'>('file');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<KnowledgeSource['scope']>('private');
  const [citable, setCitable] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const meta = { name, scope, citationEnabled: citable };
    setBusy(true);
    try {
      if (mode === 'file') {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          toast('error', 'Choose a file first.');
          return;
        }
        await knowledge.uploadSource(file, meta);
        toast('ok', `Source added: ${file.name}`);
      } else {
        if (!url.trim()) {
          toast('error', 'Enter a URL first.');
          return;
        }
        await knowledge.addUrl(url.trim(), meta);
        toast('ok', 'URL source added.');
      }
      await refreshKnowledge();
      onClose();
    } catch (e) {
      toast('error', e instanceof Error ? e.message : 'Add source failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title="Add knowledge source" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex gap-1.5" role="tablist" aria-label="Source type">
          {(['file', 'url'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-4 py-2 text-sm font-medium ${mode === m ? 'bg-signal/15 text-signal' : 'text-ink-dim hover:bg-canvas-overlay'}`}
            >
              {m === 'file' ? 'Upload file' : 'Add URL'}
            </button>
          ))}
        </div>

        {mode === 'file' ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-dim">File (.pdf, .docx, .pptx, .md, .txt, .html, .csv)</span>
            <input ref={fileRef} type="file" className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-signal/15 file:px-3 file:py-1 file:text-signal" />
          </label>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-dim">URL</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm outline-none focus:border-signal/60" />
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-ink-dim">Display name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm outline-none focus:border-signal/60" />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block text-xs text-ink-dim">Scope</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as KnowledgeSource['scope'])} className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm outline-none focus:border-signal/60">
            <option value="private">private — executive only</option>
            <option value="workspace">workspace — all staff agents</option>
            <option value="agent">agent — named agents only</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={citable} onChange={(e) => setCitable(e.target.checked)} className="accent-signal" />
          Citable — answers may quote this source with references
        </label>

        <button onClick={submit} disabled={busy} className="w-full rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Indexing…' : 'Add & index'}
        </button>
        <p className="text-xs text-ink-faint">Indexing runs immediately; large files may take a few seconds. The source only becomes servable to agents when status reaches ready.</p>
      </div>
    </Drawer>
  );
}

export default function Knowledge() {
  const s = useRuntime();
  const [adding, setAdding] = useState(false);

  const reindex = async (id: string) => {
    const res = await knowledge.reindex(id);
    toast(res.ok ? 'ok' : 'error', res.ok ? 'Reindexed.' : (res.error?.safeMessage ?? 'Reindex failed.'));
    await refreshKnowledge();
  };

  const remove = async (id: string, name: string) => {
    const res = await knowledge.removeSource(id);
    toast(res.ok ? 'ok' : 'error', res.ok ? `Removed ${name}.` : (res.error?.safeMessage ?? 'Remove failed.'));
    await refreshKnowledge();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="mt-1 text-sm text-ink-dim">What Ally and staff are allowed to know. Scope is enforced by the runtime, not hidden in the UI.</p>
        </div>
        <button onClick={() => setAdding(true)} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90">Add source</button>
      </header>

      <RetrievalPanel />

      {s.knowledge.length === 0 ? (
        <EmptyState title="No knowledge sources" hint="Upload files or add URLs to ground Ally's answers." />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Indexing</th>
                <th className="px-4 py-3 font-medium">Freshness</th>
                <th className="px-4 py-3 font-medium">Citable</th>
                <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {s.knowledge.map((k) => (
                <tr key={k.id} className="hover:bg-canvas-overlay/50">
                  <td className="px-4 py-3">
                    <span className="mr-2" aria-hidden>{typeIcon[k.type]}</span>
                    <span className="font-medium text-ink">{k.name}</span>
                    {k.allowedAgentIds && <div className="mt-0.5 text-xs text-ink-faint">Only: {k.allowedAgentIds.join(', ')}</div>}
                    {k.indexingStatus === 'failed' && k.error && <div className="mt-0.5 max-w-md truncate text-xs text-risk" title={k.error}>{k.error}</div>}
                  </td>
                  <td className="px-4 py-3"><StateBadge label={k.scope} tone="neutral" /></td>
                  <td className="px-4 py-3"><StateBadge label={k.indexingStatus} tone={statusTone[k.indexingStatus]} /></td>
                  <td className="px-4 py-3 text-xs text-ink-dim">{k.freshnessAt ? <RelativeTime iso={k.freshnessAt} /> : '—'}</td>
                  <td className="px-4 py-3 text-xs">{k.citationEnabled ? <span className="text-ok">Yes</span> : <span className="text-risk">No</span>}</td>
                  <td className="px-4 py-3 text-right text-xs">
                    <button onClick={() => void reindex(k.id)} className="mr-2 rounded px-2 py-1 text-ink-dim hover:bg-canvas-overlay hover:text-ink">Reindex</button>
                    <button onClick={() => void remove(k.id, k.name)} className="rounded px-2 py-1 text-risk/80 hover:bg-canvas-overlay hover:text-risk">Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-xs text-ink-faint">A source is never served to agents until indexing confirms <span className="text-ok">ready</span>. Failed sources keep their error details for retry.</p>

      {adding && <AddSourceDrawer onClose={() => setAdding(false)} />}
    </div>
  );
}
