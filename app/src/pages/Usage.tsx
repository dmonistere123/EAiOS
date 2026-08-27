/** Usage — tokens, cost, budget. Estimated vs authoritative is always labeled. */
import { useRuntime, agentName } from '../state/runtime';
import { Card, KpiCard, RelativeTime, SectionTitle, StateBadge } from '../components/ui';

const fmt = (n: number) => n.toLocaleString();

export default function Usage() {
  const s = useRuntime();
  const u = s.usage;

  if (!u) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
        <p className="text-sm text-ink-dim">Loading usage…</p>
      </div>
    );
  }

  const budgetPct = u.budgetUsd && u.costUsd ? Math.min(100, (u.costUsd / u.budgetUsd) * 100) : null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-ink-dim">{u.rangeLabel} · data fresh <RelativeTime iso={u.freshnessAt} /></p>
        </div>
        <StateBadge label={u.costIsAuthoritative ? 'Authoritative billing' : 'Estimated from token rates'} tone={u.costIsAuthoritative ? 'ok' : 'warn'} />
      </header>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard label="Input tokens" value={fmt(u.inputTokens)} />
        <KpiCard label="Output tokens" value={fmt(u.outputTokens)} />
        <KpiCard label="Cost to date" value={u.costUsd !== undefined ? `$${u.costUsd.toFixed(2)}` : 'Not provided'} hint={u.costUsd !== undefined ? (u.costIsAuthoritative ? 'from provider billing' : 'estimate') : 'provider reports no pricing'} tone={u.costIsAuthoritative ? 'ok' : 'warn'} />
        <KpiCard label="Monthly budget" value={u.budgetUsd ? `$${u.budgetUsd}` : 'No budget set'} />
      </div>

      {budgetPct !== null && (
        <Card className="p-5">
          <SectionTitle>Budget consumption</SectionTitle>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-canvas-overlay">
            <div className={`h-full rounded-full ${budgetPct > 85 ? 'bg-risk' : budgetPct > 65 ? 'bg-warn' : 'bg-signal'}`} style={{ width: `${budgetPct}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-ink-faint">
            <span>${u.costUsd!.toFixed(2)} spent</span>
            <span>{budgetPct.toFixed(0)}% of ${u.budgetUsd}</span>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-ink-faint">
              <th className="px-4 py-3 font-medium">Agent</th>
              <th className="px-4 py-3 font-medium">Input</th>
              <th className="px-4 py-3 font-medium">Output</th>
              <th className="px-4 py-3 font-medium">Est. cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge/60">
            {u.byAgent.map((r) => (
              <tr key={r.agentId} className="hover:bg-canvas-overlay/50">
                <td className="px-4 py-3 font-medium text-ink">{agentName(s, r.agentId)}</td>
                <td className="px-4 py-3 text-xs text-ink-dim">{fmt(r.inputTokens)}</td>
                <td className="px-4 py-3 text-xs text-ink-dim">{fmt(r.outputTokens)}</td>
                <td className="px-4 py-3 text-xs text-ink-dim">{r.costUsd !== undefined ? `$${r.costUsd.toFixed(2)}` : 'Not provided'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-ink-faint">Costs are labeled estimates until provider billing confirms them — the live adapter reads Hermes' <code className="text-signal">session_model_usage</code> estimated/actual columns and never invents a figure.</p>
    </div>
  );
}
