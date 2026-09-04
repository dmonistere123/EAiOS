/** Approvals — human gate. Decisions are auditable; governed actions wait here. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Approval } from '../domain/types';
import { hermes } from '../adapters';
import { useRuntime, selectPendingApprovals, agentName, toast, refreshApprovals } from '../state/runtime';
import { Card, Drawer, EmptyState, RelativeTime, RiskBadge, StateBadge } from '../components/ui';

function Inspector({ approval, onClose }: { approval: Approval; onClose: () => void }) {
  const s = useRuntime();
  const [busy, setBusy] = useState(false);
  const [editingPayload, setEditingPayload] = useState(false);
  const [draftPayload, setDraftPayload] = useState(approval.payload ?? '');
  const work = s.work.find((w) => w.id === approval.workItemId);

  useEffect(() => {
    setDraftPayload(approval.payload ?? '');
    setEditingPayload(false);
  }, [approval.id, approval.payload]);

  const decide = async (decision: 'approved' | 'rejected' | 'changes_requested') => {
    setBusy(true);
    const res = await hermes.decideApproval(approval.id, { decision });
    setBusy(false);
    if (res.ok) {
      toast('ok', `Decision recorded: ${decision.replace('_', ' ')}. Audit ${res.auditEventId}.`);
      await refreshApprovals();
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Decision failed.');
    }
  };

  const savePayload = async () => {
    setBusy(true);
    const res = await hermes.updateApprovalPayload(approval.id, draftPayload);
    setBusy(false);
    if (res.ok) {
      toast('ok', `Payload updated. Audit ${res.auditEventId}.`);
      await refreshApprovals();
      setEditingPayload(false);
    } else {
      toast('error', res.error?.safeMessage ?? 'Save failed.');
    }
  };

  return (
    <Drawer title="Approval inspection" onClose={onClose} width={480}>
      <div className="space-y-5">
        <div>
          <div className="text-lg font-semibold text-ink">{approval.targetObject ?? approval.targetSystem}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-dim">
            <RiskBadge risk={approval.risk} />
            <StateBadge label={approval.actionType} tone="signal" />
            <span>via {approval.targetSystem}</span>
          </div>
        </div>

        <div className="rounded-lg border border-edge bg-canvas p-3 text-xs text-ink-dim">
          <div>Requested by <span className="text-ink">{agentName(s, approval.requestedByAgentId)}</span> · <RelativeTime iso={approval.submittedAt} /></div>
          {work && <div className="mt-1">Work item: <span className="text-ink">{work.title}</span></div>}
          <div className="mt-1">Policy: <span className="text-ink">external {approval.actionType} requires executive approval</span></div>
        </div>

        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Evidence</div>
          <ul className="mt-2 space-y-1.5">
            {approval.evidence.map((e, i) => (
              <li key={i} className="rounded-lg border border-edge bg-canvas px-3 py-2 text-xs text-ink-dim">
                <span className="text-ink-faint">[{e.kind}]</span> {e.label}
              </li>
            ))}
          </ul>
        </div>

        {approval.proposedDiff && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Proposed changes</div>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-edge bg-canvas p-3 text-xs text-ink-dim">{approval.proposedDiff}</pre>
          </div>
        )}

        {approval.payload && (
          <div>
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Prepared content — exactly what gets executed</div>
              {!editingPayload && (
                <button onClick={() => setEditingPayload(true)} disabled={busy} className="rounded px-2 py-1 text-xs font-medium text-signal hover:bg-signal/10 disabled:opacity-50">
                  Edit
                </button>
              )}
            </div>
            {editingPayload ? (
              <div className="mt-2 space-y-2">
                <textarea
                  value={draftPayload}
                  onChange={(e) => setDraftPayload(e.target.value)}
                  rows={10}
                  className="w-full rounded-lg border border-edge bg-canvas p-3 text-xs text-ink-dim outline-none focus:border-signal/60"
                />
                <div className="flex gap-2">
                  <button onClick={() => void savePayload()} disabled={busy} className="rounded-lg bg-signal px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
                    Save changes
                  </button>
                  <button onClick={() => { setDraftPayload(approval.payload ?? ''); setEditingPayload(false); }} disabled={busy} className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-edge bg-canvas p-3 text-xs text-ink-dim">{approval.payload}</pre>
            )}
          </div>
        )}

        {approval.rollbackPlan && (
          <div>
            <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Rollback path</div>
            <p className="mt-1 text-xs text-ink-dim">{approval.rollbackPlan}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-2">
          <button onClick={() => decide('approved')} disabled={busy} className="rounded-lg bg-ok px-3 py-2.5 text-sm font-semibold text-canvas hover:bg-ok/90 disabled:opacity-50">Approve &amp; execute</button>
          <button onClick={() => decide('changes_requested')} disabled={busy} className="rounded-lg bg-warn px-3 py-2.5 text-sm font-semibold text-canvas hover:bg-warn/90 disabled:opacity-50">Request changes</button>
          <button onClick={() => decide('rejected')} disabled={busy} className="rounded-lg bg-risk px-3 py-2.5 text-sm font-semibold text-canvas hover:bg-risk/90 disabled:opacity-50">Reject</button>
        </div>
        <p className="text-[11px] text-ink-faint">Approve hands the task back to the requesting agent, which executes it and reports the result here and in the activity ledger. Every decision is audited.</p>
      </div>
    </Drawer>
  );
}

export default function Approvals() {
  const s = useRuntime();
  const [params] = useSearchParams();
  const [riskFilter, setRiskFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('focus'));

  const pending = useMemo(() => {
    const rows = selectPendingApprovals(s);
    return riskFilter === 'all' ? rows : rows.filter((a) => a.risk === riskFilter);
  }, [s, riskFilter]);

  const selected = pending.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Approvals</h1>
          <p className="mt-1 text-sm text-ink-dim">Nothing writes, sends, publishes, or executes externally without your decision.</p>
        </div>
        <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} aria-label="Filter by risk" className="rounded-lg border border-edge bg-canvas-raised px-3 py-1.5 text-xs text-ink">
          {['all', 'low', 'medium', 'high', 'critical'].map((r) => <option key={r} value={r}>{r === 'all' ? 'All risk levels' : `${r} risk`}</option>)}
        </select>
      </header>

      {pending.length === 0 ? (
        <EmptyState title="Queue clear" hint="Governed actions will appear here when agents prepare them." />
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Risk</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Age</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge/60">
              {pending.map((a) => (
                <tr key={a.id} onClick={() => setSelectedId(a.id)} className="cursor-pointer hover:bg-canvas-overlay/50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{a.targetObject ?? a.targetSystem}</div>
                    <div className="mt-0.5 text-xs text-ink-faint">{a.actionType} · {a.targetSystem}</div>
                  </td>
                  <td className="px-4 py-3"><RiskBadge risk={a.risk} /></td>
                  <td className="px-4 py-3 text-xs text-ink-dim">{agentName(s, a.requestedByAgentId)}</td>
                  <td className="px-4 py-3 text-xs text-ink-dim">{a.targetSystem}</td>
                  <td className="px-4 py-3 text-xs text-ink-dim"><RelativeTime iso={a.submittedAt} /></td>
                  <td className="px-4 py-3 text-right">
                    {/* §14.4: keyboard-reachable path to the inspector (the row click is pointer-only). */}
                    <button onClick={(e) => { e.stopPropagation(); setSelectedId(a.id); }} className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10">
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {selected && <Inspector approval={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
