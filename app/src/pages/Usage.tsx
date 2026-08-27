/** Usage — tokens, cost, budget. Estimated vs authoritative is always labeled. */
import { useState } from 'react';
import { hermes } from '../adapters';
import { useRuntime, agentName, refreshUsage, toast } from '../state/runtime';
import { Card, KpiCard, RelativeTime, SectionTitle, StateBadge } from '../components/ui';

const fmt = (n: number) => n.toLocaleString();

/** Monthly budget KPI with inline editor (F15 — EAiOS-owned settings store). */
function BudgetCard({ budgetUsd }: { budgetUsd?: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (value: number | null) => {
    setSaving(true);
    const res = await hermes.setUsageBudget(value);
    setSaving(false);
    if (res.ok) {
      toast('ok', value === null ? 'Budget cleared.' : `Budget set to $${value}.`);
      setEditing(false);
      void refreshUsage();
    } else {
      toast('error', res.error?.safeMessage ?? 'Budget save failed.');
    }
  };

  return (
    <div className="rounded-xl border border-edge bg-canvas-raised p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Monthly budget</div>
        {!editing && (
          <button onClick={() => { setDraft(budgetUsd ? String(budgetUsd) : ''); setEditing(true); }} className="text-[11px] text-signal hover:underline">
            {budgetUsd ? 'Edit' : 'Set'}
          </button>
        )}
      </div>
      {editing ? (
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const v = Number(draft);
            if (Number.isFinite(v) && v > 0) void save(Math.round(v));
          }}
        >
          <input
            type="number" min="1" step="1" required autoFocus value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Monthly budget in USD"
            className="w-24 rounded-lg border border-edge bg-canvas px-2 py-1 text-sm text-ink"
          />
          <button type="submit" disabled={saving} className="rounded-lg bg-signal px-2.5 py-1 text-xs font-semibold text-canvas disabled:opacity-50">Save</button>
          {budgetUsd !== undefined && (
            <button type="button" disabled={saving} onClick={() => void save(null)} className="text-xs text-warn hover:underline">Clear</button>
          )}
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink-faint hover:text-ink-dim">Cancel</button>
        </form>
      ) : (
        <div className="mt-2 text-3xl font-semibold text-signal">{budgetUsd ? `$${budgetUsd}` : 'No budget set'}</div>
      )}
    </div>
  );
}

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
        <BudgetCard budgetUsd={u.budgetUsd} />
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
