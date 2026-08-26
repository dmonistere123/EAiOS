/** Today — executive landing: summary KPIs, operating queue, delegation. */
import { useEffect, useMemo, useState } from 'react';
import type { TodaySummary, WorkItem } from '../domain/types';
import { hermes } from '../adapters/mock/MockHermesAdapter';
import { useRuntime, agentName, toast } from '../state/runtime';
import { Card, Drawer, EmptyState, KpiCard, PriorityBadge, SectionTitle, StateBadge, TimeUntil, RelativeTime } from '../components/ui';

const stateTone: Record<WorkItem['state'], 'neutral' | 'ok' | 'warn' | 'risk' | 'signal'> = {
  new: 'neutral',
  ready: 'signal',
  delegated: 'warn',
  in_progress: 'signal',
  waiting_approval: 'warn',
  blocked: 'risk',
  complete: 'ok',
  cancelled: 'neutral',
};

function DelegateDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const s = useRuntime();
  const [agentId, setAgentId] = useState('ally');
  const [busy, setBusy] = useState(false);
  const staff = s.agents;

  const confirm = async () => {
    setBusy(true);
    const res = await hermes.delegateWork(item.id, { agentId });
    setBusy(false);
    if (res.ok) {
      toast('ok', `Delegated “${item.title}” to ${agentName(s, agentId)}.`);
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Delegation failed.');
    }
  };

  return (
    <Drawer title="Delegate work" onClose={onClose}>
      <p className="text-sm text-ink-dim">Hand this item to an agent. The assignment is recorded in the activity ledger.</p>
      <div className="mt-4 rounded-lg border border-edge bg-canvas p-4">
        <div className="text-sm font-medium text-ink">{item.title}</div>
        {item.summary && <div className="mt-1 text-xs text-ink-dim">{item.summary}</div>}
      </div>
      <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-ink-faint" htmlFor="agent-pick">Assign to</label>
      <select
        id="agent-pick"
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
        className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"
      >
        {staff.map((a) => (
          <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
        ))}
      </select>
      <button
        onClick={confirm}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
      >
        {busy ? 'Delegating…' : 'Confirm delegation'}
      </button>
    </Drawer>
  );
}

export default function Today() {
  const s = useRuntime();
  const [summary, setSummary] = useState<TodaySummary | null>(null);
  const [delegating, setDelegating] = useState<WorkItem | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    void hermes.getTodaySummary().then(setSummary);
  }, [s.work.length, s.approvals.length]);

  const executiveQueue = useMemo(
    () =>
      s.work
        .filter((w) => w.ownerType === 'executive' && !['complete', 'cancelled'].includes(w.state))
        .sort((a, b) => {
          const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
          return rank[a.priority] - rank[b.priority];
        }),
    [s.work],
  );

  const recommendations = useMemo(
    () => executiveQueue.filter((w) => w.delegationCandidate && !dismissed.has(w.id)),
    [executiveQueue, dismissed],
  );

  if (!summary) {
    return <div className="animate-pulse space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-canvas-raised" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{summary.greeting}, Don.</h1>
        <p className="mt-1 text-sm text-ink-dim">{summary.date} — {summary.headline}</p>
      </header>

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard label="Your priorities" value={summary.executivePriorities} hint="owned by you" />
        <KpiCard label="Delegatable" value={summary.delegatableCount} hint="AI can take these" tone="ok" />
        <KpiCard label="Approvals waiting" value={summary.approvalsWaiting} hint="need your decision" tone={summary.approvalsWaiting > 0 ? 'warn' : 'ok'} />
        <KpiCard
          label="Next meeting"
          value={summary.nextMeetingAt ? <TimeUntil iso={summary.nextMeetingAt} /> : '—'}
          hint={summary.nextMeetingLabel}
        />
      </div>

      {recommendations.length > 0 && (
        <Card className="border-signal/25 bg-signal/5 p-4">
          <SectionTitle>Recommended to delegate</SectionTitle>
          <ul className="divide-y divide-edge/60">
            {recommendations.map((w) => (
              <li key={w.id} className="flex items-center gap-3 py-2.5">
                <PriorityBadge priority={w.priority} />
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{w.title}</span>
                <button onClick={() => setDelegating(w)} className="rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-signal/90">
                  Delegate
                </button>
                <button
                  onClick={() => setDismissed((d) => new Set(d).add(w.id))}
                  className="rounded-lg px-2 py-1.5 text-xs text-ink-faint hover:text-ink-dim"
                  aria-label={`Dismiss recommendation ${w.title}`}
                >
                  Dismiss
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section>
        <SectionTitle>Operating queue</SectionTitle>
        {executiveQueue.length === 0 ? (
          <EmptyState title="Nothing on your plate" hint="New work will appear here as it arrives." />
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-ink-faint">
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">State</th>
                  <th className="px-4 py-3 font-medium">Due</th>
                  <th className="px-4 py-3 font-medium"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/60">
                {executiveQueue.map((w) => (
                  <tr key={w.id} className="hover:bg-canvas-overlay/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-ink">{w.title}</div>
                      {w.summary && <div className="mt-0.5 text-xs text-ink-faint">{w.summary}</div>}
                    </td>
                    <td className="px-4 py-3"><PriorityBadge priority={w.priority} /></td>
                    <td className="px-4 py-3"><StateBadge label={w.state.replace('_', ' ')} tone={stateTone[w.state]} /></td>
                    <td className="px-4 py-3 text-xs text-ink-dim">{w.dueAt ? <TimeUntil iso={w.dueAt} /> : <RelativeTime iso={w.updatedAt} />}</td>
                    <td className="px-4 py-3 text-right">
                      {w.delegationCandidate ? (
                        <button onClick={() => setDelegating(w)} className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10">
                          Delegate
                        </button>
                      ) : (
                        <span className="text-xs text-ink-faint">Yours</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      {delegating && <DelegateDialog item={delegating} onClose={() => setDelegating(null)} />}
    </div>
  );
}
