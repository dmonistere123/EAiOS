/** Knowledge — governed RAG sources (mock until Phase 5). */
import { knowledgeSources } from '../mocks/fixtures';
import { Card, EmptyState, RelativeTime, StateBadge } from '../components/ui';

const statusTone = { pending: 'warn', processing: 'signal', ready: 'ok', failed: 'risk', stale: 'warn' } as const;
const typeIcon = { file: '▤', url: '⬡', connector: '⬢', transcript: '❝', text: '¶' } as const;

export default function Knowledge() {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge</h1>
          <p className="mt-1 text-sm text-ink-dim">What Ally and staff are allowed to know. Scope is enforced by the runtime, not hidden in the UI.</p>
        </div>
        <button className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90">Add source</button>
      </header>

      {knowledgeSources.length === 0 ? (
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
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {knowledgeSources.map((k) => (
                <tr key={k.id} className="hover:bg-canvas-overlay/50">
                  <td className="px-4 py-3">
                    <span className="mr-2" aria-hidden>{typeIcon[k.type]}</span>
                    <span className="font-medium text-ink">{k.name}</span>
                    {k.allowedAgentIds && <div className="mt-0.5 text-xs text-ink-faint">Only: {k.allowedAgentIds.join(', ')}</div>}
                  </td>
                  <td className="px-4 py-3"><StateBadge label={k.scope} tone="neutral" /></td>
                  <td className="px-4 py-3"><StateBadge label={k.indexingStatus} tone={statusTone[k.indexingStatus]} /></td>
                  <td className="px-4 py-3 text-xs text-ink-dim">{k.freshnessAt ? <RelativeTime iso={k.freshnessAt} /> : '—'}</td>
                  <td className="px-4 py-3 text-xs">{k.citationEnabled ? <span className="text-ok">Yes</span> : <span className="text-risk">No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <p className="text-xs text-ink-faint">A source is never served to agents until indexing confirms <span className="text-ok">ready</span>. Failed sources keep their error details for retry.</p>
    </div>
  );
}
