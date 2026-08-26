/** Artifacts — large agent-created outputs with provenance. */
import { useMemo, useState } from 'react';
import { artifacts } from '../mocks/fixtures';
import { useRuntime, agentName } from '../state/runtime';
import { Card, EmptyState, RelativeTime, StateBadge } from '../components/ui';

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

export default function Artifacts() {
  const s = useRuntime();
  const [q, setQ] = useState('');

  const rows = useMemo(
    () => artifacts.filter((a) => a.name.toLowerCase().includes(q.toLowerCase())),
    [q],
  );

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
        <EmptyState title={q ? 'No matches' : 'No artifacts yet'} hint="Agent-created deliverables appear here with their full history." />
      ) : (
        <div className="grid gap-3">
          {rows.map((a) => (
            <Card key={a.id} className="flex items-center gap-4 p-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-canvas-overlay text-lg" aria-hidden>{iconFor(a.mimeType)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm text-ink">{a.name}</div>
                <div className="mt-0.5 text-xs text-ink-faint">
                  {agentName(s, a.createdByAgentId)} · {a.workItemId ?? 'no work item'} · <RelativeTime iso={a.createdAt} /> · {fmtSize(a.sizeBytes)}
                </div>
              </div>
              <StateBadge label={a.state} tone={stateTone[a.state]} />
              <div className="flex gap-2">
                <button className="rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-dim hover:bg-canvas-overlay" disabled={!a.previewAvailable} title={a.previewAvailable ? 'Preview' : 'Preview unavailable for this type'}>
                  Preview
                </button>
                <button className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10">Download</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
