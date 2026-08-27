/** Skills & Playbooks — skills live via skills.manage RPC (Phase 5.1);
 * playbooks live from ~/eaios/playbooks with kanban-backed runs (Phase 5.4). */
import { useState } from 'react';
import { useRuntime, agentName, refreshPlaybookRuns, refreshWork, toast } from '../state/runtime';
import { hermes } from '../adapters';
import type { Playbook } from '../domain/types';
import { Card, Drawer, RelativeTime, StateBadge } from '../components/ui';

const runTone: Record<string, 'ok' | 'warn' | 'risk' | 'signal' | 'neutral'> = {
  complete: 'ok',
  in_progress: 'signal',
  delegated: 'signal',
  ready: 'warn',
  waiting_approval: 'warn',
  blocked: 'risk',
  cancelled: 'neutral',
};

function RunPlaybookDrawer({ playbook, onClose }: { playbook: Playbook; onClose: () => void }) {
  const s = useRuntime();
  const [assignee, setAssignee] = useState(playbook.assignee ?? '');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const res = await hermes.runPlaybook(playbook.id, { assignee: assignee || undefined });
    setBusy(false);
    if (res.ok) {
      toast('ok', assignee
        ? `Run started — ${agentName(s, assignee)} will pick it up. External writes still need approval.`
        : 'Run created unassigned — it will NOT execute until delegated.');
      await Promise.all([refreshPlaybookRuns(), refreshWork()]);
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Run failed.');
    }
  };

  return (
    <Drawer title={`Run: ${playbook.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="text-sm text-ink-dim">
          <span className="font-mono text-xs text-ink-faint">v{playbook.version} · {playbook.mode} mode</span>
          <p className="mt-2">{playbook.description}</p>
        </div>
        <div className="rounded-lg border border-edge bg-canvas p-3 text-xs text-ink-dim">
          Creates a kanban task carrying these instructions.{' '}
          <span className="text-ink">Assigning an agent means the dispatcher WILL execute it.</span>{' '}
          External writes in the workflow still gate on your approval queue.
        </div>
        {playbook.mode === 'task' && (
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-ink-dim">Assign to</span>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className="w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm outline-none focus:border-signal/60">
              <option value="">Unassigned — create but don't execute</option>
              {s.agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
        )}
        {playbook.mode === 'swarm' && (
          <p className="text-xs text-ink-dim">Swarm mode: {playbook.workers?.length ?? 0} workers → verifier {playbook.verifier} → synthesizer {playbook.synthesizer}.</p>
        )}
        <button onClick={() => void run()} disabled={busy} className="w-full rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Creating run…' : 'Confirm run'}
        </button>
      </div>
    </Drawer>
  );
}

function PlaybookCard({ playbook }: { playbook: Playbook }) {
  const s = useRuntime();
  const [running, setRunning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const runs = s.playbookRuns.filter((r) => r.playbookId === playbook.id);
  const lastRun = runs[0];

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-mono text-sm font-semibold text-ink">{playbook.name}</div>
          <div className="mt-1 text-xs text-ink-dim">{playbook.description}</div>
        </div>
        <div className="flex gap-1.5">
          <StateBadge label={playbook.status} tone={playbook.status === 'published' ? 'ok' : 'warn'} />
          {playbook.mode === 'swarm' && <StateBadge label="swarm" tone="signal" />}
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-[11px] text-ink-faint">
        <span>v{playbook.version}{playbook.ownerAgentId ? ` · ${agentName(s, playbook.ownerAgentId)}` : ''}</span>
        <span>{lastRun ? <>Last run <RelativeTime iso={lastRun.createdAt} /></> : 'Never run'}</span>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={() => setRunning(true)} className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10">Run</button>
        <button onClick={() => setShowHistory((v) => !v)} className="rounded-lg px-3 py-1.5 text-xs text-ink-dim hover:bg-canvas-overlay" aria-expanded={showHistory}>
          History ({runs.length})
        </button>
      </div>
      {showHistory && (
        <ul className="mt-3 space-y-1.5 border-t border-edge/60 pt-3">
          {runs.length === 0 && <li className="text-xs text-ink-faint">No runs yet.</li>}
          {runs.map((r) => (
            <li key={r.id} className="rounded-lg bg-canvas px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <StateBadge label={r.state} tone={runTone[r.state] ?? 'neutral'} />
                <span className="text-ink-faint"><RelativeTime iso={r.createdAt} />{r.assignee ? ` · ${agentName(s, r.assignee)}` : ''}</span>
              </div>
              {r.result && <div className="mt-1 text-ink-dim">{r.result}</div>}
            </li>
          ))}
        </ul>
      )}
      {running && <RunPlaybookDrawer playbook={playbook} onClose={() => setRunning(false)} />}
    </Card>
  );
}

export default function Skills() {
  const s = useRuntime();
  const [tab, setTab] = useState<'skill' | 'playbook'>('skill');

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
            {t === 'skill' ? `Skills (${s.skills.length})` : `Playbooks (${s.playbooks.length})`}
          </button>
        ))}
      </div>

      {tab === 'skill' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {s.skills.map((sk) => (
            <Card key={sk.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-semibold text-ink">{sk.name}</div>
                  <div className="mt-1 text-xs text-ink-dim">{sk.description ?? 'No description.'}</div>
                </div>
                <StateBadge label={sk.status} tone={sk.status === 'enabled' ? 'ok' : 'warn'} />
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-[11px] text-ink-faint">
                <span className="rounded bg-canvas-overlay px-1.5 py-0.5 font-mono">{sk.category}</span>
                <span>{sk.version ? `v${sk.version}` : '—'}</span>
              </div>
            </Card>
          ))}
          {s.skills.length === 0 && (
            <p className="text-sm text-ink-faint">No skills loaded yet — the runtime hydrates this list from the adapter.</p>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {s.playbooks.map((p) => <PlaybookCard key={p.id} playbook={p} />)}
          {s.playbooks.length === 0 && (
            <p className="text-sm text-ink-faint">No playbooks found — add markdown workflows to ~/eaios/playbooks/.</p>
          )}
        </div>
      )}

      <p className="text-xs text-ink-faint">Published versions are immutable — edits create a new draft. Approval checkpoints are shown before any run starts.</p>
    </div>
  );
}
