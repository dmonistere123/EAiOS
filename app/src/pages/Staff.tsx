/** Staff — the AI agent workforce. Status is runtime-driven, never decorative. */
import { useMemo, useState } from 'react';
import type { Agent } from '../domain/types';
import { hermes } from '../adapters/mock/MockHermesAdapter';
import { useRuntime, refreshAgents, toast } from '../state/runtime';
import { AgentStatusBadge, Card, Drawer, IndeterminateBar, RelativeTime } from '../components/ui';

type Filter = 'all' | 'active' | 'waiting' | 'failed' | 'idle';
const FILTERS: { id: Filter; label: string; match: (a: Agent) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'active', label: 'Active', match: (a) => ['working', 'queued'].includes(a.status) },
  { id: 'waiting', label: 'Waiting', match: (a) => a.status.startsWith('waiting') },
  { id: 'failed', label: 'Failed / Offline', match: (a) => ['failed', 'offline'].includes(a.status) },
  { id: 'idle', label: 'Idle', match: (a) => a.status === 'idle' },
];

function AgentPropertiesDrawer({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [model, setModel] = useState(agent.model.model);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const picked = agent.availableModels.find((m) => m.model === model);
    const res = await hermes.updateAgentConfig(agent.id, { model: picked });
    setBusy(false);
    if (res.ok) {
      toast('ok', `${agent.name} model updated to ${model}.`);
      await refreshAgents();
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Model change rejected.');
    }
  };

  return (
    <Drawer title={`${agent.name} — properties`} onClose={onClose}>
      <div className="space-y-5">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Role</div>
          <div className="mt-1 text-sm text-ink">{agent.role}</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Status</div>
          <div className="mt-1"><AgentStatusBadge status={agent.status} /></div>
          <div className="mt-1 text-xs text-ink-faint">Last activity <RelativeTime iso={agent.lastActivityAt} /></div>
        </div>
        <div>
          <label htmlFor="model-pick" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Model</label>
          <select
            id="model-pick"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"
          >
            {agent.availableModels.map((m) => (
              <option key={`${m.provider}/${m.model}`} value={m.model}>{m.provider} / {m.model}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-ink-faint">Only models in this agent's allowed list can be saved. Changes are audited.</p>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Tools</div>
          <ul className="mt-1 space-y-1">
            {agent.tools.map((t) => <li key={t.id} className="rounded-lg border border-edge bg-canvas px-3 py-1.5 text-xs text-ink-dim">{t.name}</li>)}
          </ul>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">Health</div>
          <div className="mt-1 text-sm text-ink">{agent.health ?? 'unknown'}</div>
        </div>
        <button onClick={save} disabled={busy} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <p className="text-[11px] text-ink-faint">Provider credentials are never shown here — only safe metadata.</p>
      </div>
    </Drawer>
  );
}

export default function Staff() {
  const s = useRuntime();
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Agent | null>(null);

  const agents = useMemo(() => s.agents.filter(FILTERS.find((f) => f.id === filter)!.match), [s.agents, filter]);
  const workTitle = (id?: string) => s.work.find((w) => w.id === id)?.title;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="mt-1 text-sm text-ink-dim">Your AI workforce. Status lights reflect live runtime state.</p>
        </div>
        <div className="flex gap-1.5" role="tablist" aria-label="Filter agents">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === f.id ? 'bg-signal/15 text-signal' : 'text-ink-dim hover:bg-canvas-overlay'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <button key={a.id} onClick={() => setSelected(a)} className="text-left">
            <Card className="h-full p-5 transition-colors hover:border-signal/40">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-base font-semibold text-ink">{a.name}</div>
                  <div className="mt-0.5 text-xs text-ink-dim">{a.role}</div>
                </div>
                <AgentStatusBadge status={a.status} />
              </div>
              <div className="mt-4 space-y-2">
                {a.status === 'working' || a.status === 'queued' ? (
                  <>
                    <div className="truncate text-xs text-ink-dim">{workTitle(a.currentWorkItemId) ?? 'Assigned work'}</div>
                    <IndeterminateBar />
                  </>
                ) : (
                  <div className="text-xs text-ink-faint">{a.status === 'idle' ? 'Idle — ready for work' : a.status.replace(/_/g, ' ')}</div>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-[11px] text-ink-faint">
                <span>{a.model.provider}/{a.model.model}</span>
                <span><RelativeTime iso={a.lastActivityAt} /></span>
              </div>
            </Card>
          </button>
        ))}
      </div>

      {selected && <AgentPropertiesDrawer agent={s.agents.find((x) => x.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
