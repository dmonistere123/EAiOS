/** Usage — tokens, cost, budget. Estimated vs authoritative is always labeled. */
import { useEffect, useState } from 'react';
import { hermes } from '../adapters';
import { useRuntime, agentName, refreshUsage, refreshDailySpend, toast } from '../state/runtime';
import { Card, KpiCard, RelativeTime, SectionTitle, StateBadge } from '../components/ui';
import type { DailySpendDay } from '../domain/types';

const fmt = (n: number) => n.toLocaleString();

/** F29: threshold editor — the same settings store the 6:30am watchdog cron reads. */
function ThresholdEditor({ thresholdUsd, onSaved }: { thresholdUsd: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (value: number | null) => {
    setSaving(true);
    const res = await hermes.setDailySpendAlert(value);
    setSaving(false);
    if (res.ok) {
      toast('ok', value === null ? 'Daily alert reset to $5 default.' : `Daily alert threshold set to $${value}.`);
      setEditing(false);
      onSaved();
    } else {
      toast('error', res.error?.safeMessage ?? 'Threshold save failed.');
    }
  };

  if (editing) {
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = Number(draft);
          if (Number.isFinite(v) && v > 0) void save(v);
        }}
      >
        <input
          type="number" min="0.5" step="0.5" required autoFocus value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Daily spend alert threshold in USD"
          className="w-20 rounded-lg border border-edge bg-canvas px-2 py-1 text-sm text-ink"
        />
        <button type="submit" disabled={saving} className="rounded-lg bg-signal px-2.5 py-1 text-xs font-semibold text-canvas disabled:opacity-50">Save</button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink-faint hover:text-ink-dim">Cancel</button>
      </form>
    );
  }
  return (
    <button onClick={() => { setDraft(String(thresholdUsd)); setEditing(true); }} className="text-[11px] text-signal hover:underline">
      Alert above ${thresholdUsd}/day
    </button>
  );
}

/** F29: 14-day rate-card spend strip with breach flags + day drill-down. */
function DailySpendCard({ days, thresholdUsd, freshnessAt, onThresholdSaved }: { days: DailySpendDay[]; thresholdUsd: number; freshnessAt: string; onThresholdSaved: () => void }) {
  const firstBreach = [...days].reverse().find((d) => d.overThreshold);
  const [selected, setSelected] = useState<string>(firstBreach?.date ?? days[days.length - 1]?.date ?? '');
  const max = Math.max(thresholdUsd * 1.2, ...days.map((d) => d.costUsd), 0.01);
  const sel = days.find((d) => d.date === selected);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>Daily estimated spend</SectionTitle>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-ink-faint">fresh <RelativeTime iso={freshnessAt} /></span>
          <ThresholdEditor thresholdUsd={thresholdUsd} onSaved={onThresholdSaved} />
        </div>
      </div>

      <div className="mt-4 flex h-28 items-end gap-1.5" role="list" aria-label="Daily spend bars">
        {days.map((d) => {
          const pct = Math.max(3, (d.costUsd / max) * 100);
          const isToday = d.date === days[days.length - 1]?.date;
          return (
            <button
              key={d.date}
              role="listitem"
              onClick={() => setSelected(d.date)}
              title={`${d.date} — $${d.costUsd.toFixed(2)}${d.overThreshold ? ' (over threshold)' : ''}`}
              aria-label={`${d.date}: $${d.costUsd.toFixed(2)}${d.overThreshold ? ', over threshold' : ''}`}
              className={`flex-1 rounded-t transition-colors ${d.overThreshold ? 'bg-risk hover:bg-risk/80' : 'bg-signal/50 hover:bg-signal/70'} ${selected === d.date ? 'ring-2 ring-signal' : ''} ${isToday ? 'border border-dashed border-signal/60' : ''}`}
              style={{ height: `${pct}%` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
        <span>{days[0]?.date}</span>
        <span className="text-risk">— ${thresholdUsd} alert line</span>
        <span>{days[days.length - 1]?.date} (today)</span>
      </div>

      {sel && (
        <div className="mt-4 rounded-lg border border-edge bg-canvas p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-ink">{sel.date}</div>
            <div className={`text-sm font-semibold ${sel.overThreshold ? 'text-risk' : 'text-signal'}`}>${sel.costUsd.toFixed(2)}</div>
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">{fmt(sel.inputTokens)} in · {fmt(sel.outputTokens)} out</div>
          {sel.topSessions.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {sel.topSessions.map((t) => (
                <li key={t.sessionId} className="flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-ink-dim">{t.title} <span className="text-ink-faint">· {t.model}</span></span>
                  <span className="shrink-0 font-medium text-ink">${t.costUsd.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-2 text-[11px] text-ink-faint">No spend recorded this day.</div>
          )}
        </div>
      )}

      <p className="mt-3 text-xs text-ink-faint">EAiOS rate-card estimate — fresh input + output tokens at public model rates, cache reads excluded (validated within ~5% of provider billing). Over-threshold days also trigger the 6:30am Telegram watchdog.</p>
    </Card>
  );
}

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

  useEffect(() => {
    void refreshDailySpend();
  }, []);

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

      {s.dailySpend && <DailySpendCard days={s.dailySpend.days} thresholdUsd={s.dailySpend.thresholdUsd} freshnessAt={s.dailySpend.freshnessAt} onThresholdSaved={() => void refreshDailySpend()} />}

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
