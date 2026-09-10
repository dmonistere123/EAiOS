/** Today — executive landing: summary KPIs, operating queue, delegation. */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { TodaySummary, WorkItem } from '../domain/types';
import { hermes } from '../adapters';
import { AGENT_NAME } from '../config';
import { useRuntime, agentName, toast } from '../state/runtime';
import { Card, Drawer, EmptyState, KpiCard, PriorityBadge, SectionTitle, StateBadge, TimeUntil, RelativeTime } from '../components/ui';
import { NewDelegationDrawer } from '../components/NewDelegationDrawer';

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
const QUEUE_PAGE = 50; // §15: paginate large lists (no virtualization dep)

function DelegateDialog({ item, onClose }: { item: WorkItem; onClose: () => void }) {
  const s = useRuntime();
  const preferredAgentId = s.agents.find((a) => a.id === 'default')?.id ?? s.agents.find((a) => a.id === 'ally')?.id ?? s.agents[0]?.id ?? 'default';
  const [pickedAgentId, setPickedAgentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const staff = s.agents;
  const agentId = pickedAgentId && staff.some((a) => a.id === pickedAgentId) ? pickedAgentId : preferredAgentId;

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
        onChange={(e) => setPickedAgentId(e.target.value)}
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
  const [showDismissed, setShowDismissed] = useState(false);
  const [queueShown, setQueueShown] = useState(QUEUE_PAGE);
  const [newDelegation, setNewDelegation] = useState(false);

  useEffect(() => {
    void hermes.getTodaySummary().then(setSummary);
  }, [s.work.length, s.approvals.length]);

  // Dismissal is server-side so it follows the user across browsers/machines.
  useEffect(() => {
    void hermes.getDismissedWorkIds().then((ids) => setDismissed(new Set(ids)));
  }, []);

  // Dismissed tasks are hidden from the Today operating queue (and therefore
  // from the recommendations strip). A newly-created task gets a new id, so it
  // is not affected by an old dismissal and will reappear.
  const executiveQueueAll = useMemo(
    () =>
      s.work
        .filter((w) => w.ownerType === 'executive' && !['complete', 'cancelled'].includes(w.state))
        .sort((a, b) => {
          const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const;
          return rank[a.priority] - rank[b.priority];
        }),
    [s.work],
  );

  const executiveQueue = useMemo(
    () => executiveQueueAll.filter((w) => showDismissed || !dismissed.has(w.id)),
    [executiveQueueAll, dismissed, showDismissed],
  );

  const recommendations = useMemo(
    () => executiveQueue.filter((w) => w.delegationCandidate && !dismissed.has(w.id)),
    [executiveQueue, dismissed],
  );

  const dismissedCount = useMemo(
    () => executiveQueueAll.filter((w) => dismissed.has(w.id)).length,
    [executiveQueueAll, dismissed],
  );

  const handleDismiss = async (id: string) => {
    setDismissed((d) => new Set(d).add(id));
    const res = await hermes.dismissWorkItem(id);
    if (!res.ok) {
      toast('error', res.error?.safeMessage ?? 'Could not dismiss item.');
      setDismissed((d) => {
        const next = new Set(d);
        next.delete(id);
        return next;
      });
    }
  };

  const handleUndismiss = async (id: string) => {
    setDismissed((d) => {
      const next = new Set(d);
      next.delete(id);
      return next;
    });
    const res = await hermes.undismissWorkItem(id);
    if (!res.ok) {
      toast('error', res.error?.safeMessage ?? 'Could not unhide item.');
      setDismissed((d) => new Set(d).add(id));
    }
  };

  // Dogfood 2026-08-29: delegated work finished "invisibly" — the result went
  // to Telegram but the front screen said nothing. Delivered = completed in
  // the last 24h, with the real result string and links to its artifacts.
  const delivered = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return s.work
      .filter((w) => w.state === 'complete' && Date.parse(w.updatedAt) >= cutoff)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8);
  }, [s.work]);

  if (!summary) {
    return <div className="animate-pulse space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-xl bg-canvas-raised" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{summary.greeting}, Don.</h1>
          <p className="mt-1 text-sm text-ink-dim">{summary.date} — {summary.headline}</p>
        </div>
        <button
          onClick={() => setNewDelegation(true)}
          className="shrink-0 rounded-lg border border-signal/40 px-3 py-2 text-sm font-medium text-signal hover:bg-signal/10"
        >
          ＋ New delegated task
        </button>
      </header>

      {/* KPIs for executive-owned work are computed from the runtime work list
          filtered by the server-side dismissed set. The fetched summary drives
          greeting/date/headline/meeting/approvals, but its pre-computed counts
          cannot know which items the user has dismissed (dogfood 2026-09-10). */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiCard label="Your priorities" value={executiveQueue.length} hint="owned by you" />
        <KpiCard label="Delegatable" value={recommendations.length} hint="AI can take these" tone="ok" />
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
                  onClick={() => void handleDismiss(w.id)}
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
        <div className="flex items-center justify-between">
          <SectionTitle>Operating queue</SectionTitle>
          {dismissedCount > 0 && (
            <button
              onClick={() => setShowDismissed((v) => !v)}
              className="text-xs text-ink-dim hover:text-ink"
              aria-label={showDismissed ? 'Hide dismissed items' : `Show ${dismissedCount} dismissed items`}
            >
              {showDismissed ? 'Hide dismissed' : `Show ${dismissedCount} dismissed`}
            </button>
          )}
        </div>
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
                {executiveQueue.slice(0, queueShown).map((w) => {
                  const isDismissed = dismissed.has(w.id);
                  return (
                    <tr key={w.id} className={`hover:bg-canvas-overlay/50 ${isDismissed ? 'opacity-60' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-ink">{w.title}</div>
                        {w.summary && <div className="mt-0.5 text-xs text-ink-faint">{w.summary}</div>}
                      </td>
                      <td className="px-4 py-3"><PriorityBadge priority={w.priority} /></td>
                      <td className="px-4 py-3"><StateBadge label={w.state.replace('_', ' ')} tone={stateTone[w.state]} /></td>
                      <td className="px-4 py-3 text-xs text-ink-dim">{w.dueAt ? <TimeUntil iso={w.dueAt} /> : <RelativeTime iso={w.updatedAt} />}</td>
                      <td className="px-4 py-3 text-right">
                        {isDismissed ? (
                          <button
                            onClick={() => void handleUndismiss(w.id)}
                            className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay"
                          >
                            Unhide
                          </button>
                        ) : w.delegationCandidate ? (
                          <button onClick={() => setDelegating(w)} className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10">
                            Delegate
                          </button>
                        ) : (
                          <span className="text-xs text-ink-faint">Yours</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {executiveQueue.length > queueShown && (
              <button onClick={() => setQueueShown((n) => n + QUEUE_PAGE)} className="m-3 rounded-lg border border-edge px-4 py-2 text-sm text-ink-dim hover:bg-canvas-overlay">
                Show more ({executiveQueue.length - queueShown} remaining)
              </button>
            )}
          </Card>
        )}
      </section>

      {delegating && <DelegateDialog item={delegating} onClose={() => setDelegating(null)} />}
      {newDelegation && <NewDelegationDrawer onClose={() => setNewDelegation(false)} />}

      {delivered.length > 0 && (
        <section>
          <SectionTitle>Delivered in the last 24h</SectionTitle>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-edge/60">
              {delivered.map((w) => {
                const files = s.artifacts.filter((a) => a.workItemId === w.id);
                return (
                  <li key={w.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <StateBadge label="complete" tone="ok" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{w.title}</span>
                      <span className="text-xs text-ink-faint">
                        {w.ownerId ? agentName(s, w.ownerId) : AGENT_NAME} · <RelativeTime iso={w.updatedAt} />
                      </span>
                    </div>
                    {w.result && <p className="mt-1.5 line-clamp-2 text-xs text-ink-dim">{w.result}</p>}
                    {files.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {files.map((a) => (
                          <Link key={a.id} to="/artifacts" className="rounded-full border border-signal/30 px-2 py-0.5 text-[10px] text-signal hover:bg-signal/10">
                            📎 {a.name}
                          </Link>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </section>
      )}
    </div>
  );
}
