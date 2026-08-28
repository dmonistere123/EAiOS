/** Artifacts — large agent-created outputs with provenance (spec §8.9).
 * W8: agent filter chips ride the right rail (D-B4 framework). */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Artifact } from '../domain/types';
import { hermes, adapterMode } from '../adapters';
import { useRuntime, agentName, refreshApprovals, toast } from '../state/runtime';
import { usePageRail } from '../state/rail';
import type { RailSectionDef } from '../state/rail';
import { Card, Drawer, EmptyState, RelativeTime, StateBadge } from '../components/ui';

const stateTone = { draft: 'warn', ready: 'ok', approved: 'signal', shared: 'signal', archived: 'neutral' } as const;

function iconFor(mime: string) {
  if (mime.includes('markdown') || mime.includes('text')) return '¶';
  if (mime.includes('sheet')) return '▦';
  if (mime.includes('word')) return '▤';
  return '⬡';
}

function fmtSize(bytes?: number) {
  if (!bytes) return '—';
  return bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function PreviewDrawer({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const [text, setText] = useState<string | null | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let live = true;
    void hermes.getArtifactPreview(artifact.id).then((t) => {
      if (live) setText(t);
    });
    return () => {
      live = false;
    };
  }, [artifact.id]);

  return (
    <Drawer title={artifact.name} onClose={onClose} width={560}>
      <div className="flex-1 overflow-y-auto p-5">
        {text === undefined ? (
          <p className="text-xs text-ink-dim">Loading preview…</p>
        ) : text === null ? (
          <p className="text-xs text-ink-dim">Preview unavailable for this artifact. Download is still available where permitted (§8.9).</p>
        ) : (
          <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-ink-dim">{text}</pre>
        )}
      </div>
    </Drawer>
  );
}

export default function Artifacts() {
  const s = useRuntime();
  const [q, setQ] = useState('');
  const [preview, setPreview] = useState<Artifact | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string | null>(null);

  // W8: agent filter chips in the rail — composes with the search box.
  const agentCounts = useMemo(() => {
    const m = new Map<string, number>();
    s.artifacts.forEach((a) => m.set(a.createdByAgentId, (m.get(a.createdByAgentId) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [s.artifacts]);

  const rows = useMemo(
    () =>
      s.artifacts
        .filter((a) => !agentFilter || a.createdByAgentId === agentFilter)
        .filter((a) => a.name.toLowerCase().includes(q.toLowerCase())),
    [s.artifacts, q, agentFilter],
  );

  const railSections = useMemo<RailSectionDef[]>(
    () => [
      {
        key: 'agent-filter',
        title: 'Filter by agent',
        node: (
          <ul className="space-y-1">
            {[{ id: null as string | null, count: s.artifacts.length }, ...agentCounts.map(([id, count]) => ({ id: id as string | null, count }))].map(({ id, count }) => {
              const active = agentFilter === id;
              return (
                <li key={id ?? 'all'}>
                  <button
                    onClick={() => setAgentFilter(id)}
                    aria-pressed={active}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs ${active ? 'bg-signal/15 font-medium text-signal' : 'text-ink-dim hover:bg-canvas-overlay'}`}
                  >
                    <span>{id ? agentName(s, id) : 'All agents'}</span>
                    <span className="rounded-full bg-canvas-overlay px-2 py-0.5 text-[11px]">{count}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ),
      },
    ],
    [agentCounts, agentFilter, s],
  );
  usePageRail(railSections);

  const share = async (a: Artifact) => {
    setSharingId(a.id);
    const res = await hermes.shareArtifact(a.id);
    setSharingId(null);
    if (res.ok) {
      toast('ok', `Share approval requested for ${a.name} — decide it on the Approvals page.`);
      void refreshApprovals();
    } else {
      toast('error', res.error?.safeMessage ?? 'Share request failed.');
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Artifacts</h1>
          <p className="mt-1 text-sm text-ink-dim">Outputs too large for chat — reports, decks, datasets. Full provenance, governed sharing.</p>
        </div>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search artifacts…"
          aria-label="Search artifacts"
          className="w-64 rounded-lg border border-edge bg-canvas-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
        />
      </header>

      {rows.length === 0 ? (
        <EmptyState title={q || agentFilter ? 'No matches' : 'No artifacts yet'} hint="Agent-created deliverables appear here with their full history." />
      ) : (
        <div className="grid gap-3">
          {rows.map((a) => (
            <Card key={a.id} className="flex items-center gap-4 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-canvas-overlay text-lg" aria-hidden>{iconFor(a.mimeType)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm text-ink">{a.name}</div>
                <div className="mt-0.5 text-xs text-ink-faint">
                  {agentName(s, a.createdByAgentId)} ·{' '}
                  {a.workItemId ? (
                    <Link to="/today" className="text-signal hover:underline" title="Open work items">
                      {a.workItemId}
                    </Link>
                  ) : (
                    'no work item'
                  )}{' '}
                  · <RelativeTime iso={a.createdAt} /> · {fmtSize(a.sizeBytes)}
                </div>
              </div>
              <StateBadge label={a.state} tone={stateTone[a.state]} />
              <div className="flex gap-2">
                <button
                  onClick={() => setPreview(a)}
                  className="rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-dim hover:bg-canvas-overlay"
                  disabled={!a.previewAvailable}
                  title={a.previewAvailable ? 'Preview' : 'Preview unavailable for this type'}
                >
                  Preview
                </button>
                {adapterMode === 'live' ? (
                  <a
                    href={`/api/artifacts/${encodeURIComponent(a.id)}/raw?download=1`}
                    download={a.name}
                    className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10"
                  >
                    Download
                  </a>
                ) : (
                  <button disabled title="Download needs the live artifact store" className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal opacity-40">
                    Download
                  </button>
                )}
                <button
                  onClick={() => void share(a)}
                  disabled={sharingId === a.id}
                  title="Routes through the Approvals page — nothing is sent directly (§8.9)"
                  className="rounded-lg border border-warn/40 px-3 py-1.5 text-xs font-medium text-warn hover:bg-warn/10 disabled:opacity-50"
                >
                  {sharingId === a.id ? 'Requesting…' : 'Share…'}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {preview && <PreviewDrawer artifact={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
