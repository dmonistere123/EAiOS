/** Skills & Playbooks — reusable capabilities library (mock until Phase 5). */
import { useState } from 'react';
import { skillsAndPlaybooks } from '../mocks/fixtures';
import { useRuntime, agentName } from '../state/runtime';
import { Card, RelativeTime, StateBadge } from '../components/ui';

export default function Skills() {
  const s = useRuntime();
  const [tab, setTab] = useState<'skill' | 'playbook'>('skill');
  const rows = skillsAndPlaybooks.filter((r) => r.kind === tab);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Skills & Playbooks</h1>
        <p className="mt-1 text-sm text-ink-dim">Reusable capabilities (skills) and versioned multi-step workflows (playbooks).</p>
      </header>

      <div className="flex gap-1.5" role="tablist" aria-label="Skills or playbooks">
        {(['skill', 'playbook'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-signal/15 text-signal' : 'text-ink-dim hover:bg-canvas-overlay'}`}
          >
            {t === 'skill' ? 'Skills' : 'Playbooks'}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-mono text-sm font-semibold text-ink">{r.name}</div>
                <div className="mt-1 text-xs text-ink-dim">{r.purpose}</div>
              </div>
              <StateBadge label={r.status} tone={r.status === 'published' ? 'ok' : 'warn'} />
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-[11px] text-ink-faint">
              <span>v{r.version} · {agentName(s, r.ownerAgentId)}</span>
              <span>Last run <RelativeTime iso={r.lastRunAt} /></span>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10">Test run</button>
              <button className="rounded-lg px-3 py-1.5 text-xs text-ink-dim hover:bg-canvas-overlay">History</button>
            </div>
          </Card>
        ))}
      </div>

      <p className="text-xs text-ink-faint">Published versions are immutable — edits create a new draft. Approval checkpoints are shown before any run starts.</p>
    </div>
  );
}
