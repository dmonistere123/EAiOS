/**
 * NewDelegationDrawer (dogfood 2026-08-29) — create a task on the fly from
 * Today or Schedule. Assigned tasks are auto-executed by the kanban
 * dispatcher (that IS the delegation); unassigned tasks sit in the
 * executive queue as potential delegations. Shared by both pages.
 */
import { useState } from 'react';
import { hermes } from '../adapters';
import { useRuntime, agentName, toast, refreshWork } from '../state/runtime';
import { Drawer } from './ui';
import type { WorkItem } from '../domain/types';

export function NewDelegationDrawer({ onClose }: { onClose: () => void }) {
  const s = useRuntime();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [priority, setPriority] = useState<WorkItem['priority']>('medium');
  const [agentId, setAgentId] = useState(''); // '' = unassigned (potential delegation)
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await hermes.createWorkItem({
      title: title.trim(),
      ...(summary.trim() ? { summary: summary.trim() } : {}),
      priority,
      ...(agentId ? { agentId } : {}),
    });
    setBusy(false);
    if (res.ok) {
      toast('ok', agentId ? `Task created and delegated to ${agentName(s, agentId)}.` : 'Task created — it’s in your queue to delegate when ready.');
      await refreshWork();
      onClose();
    } else {
      setError(res.error?.safeMessage ?? 'Task creation failed.');
    }
  };

  return (
    <Drawer title="New delegated task" onClose={onClose}>
      <p className="text-sm text-ink-dim">
        Create a task on the fly. Assign it now and the agent picks it up automatically; leave it unassigned and it waits in your queue as a potential delegation.
      </p>
      <div className="mt-4 space-y-4">
        <div>
          <label htmlFor="nd-title" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Title</label>
          <input
            id="nd-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Draft the September investor update"
            className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <div>
          <label htmlFor="nd-summary" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Details (optional)</label>
          <textarea
            id="nd-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="Context, constraints, definition of done — becomes the task body."
            className="mt-1 w-full rounded-lg border border-edge bg-canvas p-3 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="nd-priority" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Priority</label>
            <select id="nd-priority" value={priority} onChange={(e) => setPriority(e.target.value as WorkItem['priority'])} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink">
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div>
            <label htmlFor="nd-agent" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Assign to</label>
            <select id="nd-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink">
              <option value="">Unassigned — decide later</option>
              {s.agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name} — {a.role}</option>
              ))}
            </select>
          </div>
        </div>
        {agentId && (
          <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-ink-dim">
            Assigned tasks are picked up by the agent automatically within seconds (kanban dispatcher).
          </p>
        )}
        {error && (
          <div role="alert" className="rounded-lg border border-risk/30 bg-risk/10 p-3 text-xs text-risk">{error}</div>
        )}
        <button onClick={() => void create()} disabled={busy || !title.trim()} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Creating…' : agentId ? `Create & delegate to ${agentName(s, agentId)}` : 'Create task'}
        </button>
      </div>
    </Drawer>
  );
}
