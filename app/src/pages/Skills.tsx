/** Skills & Playbooks — skills live via skills.manage RPC (Phase 5.1);
 * playbooks live from ~/eaios/playbooks with kanban-backed runs (Phase 5.4).
 * W7 (D-B3): authoring — create/edit playbooks (server-side version bump,
 * published edits land as drafts) and create user-local skills. */
import { useMemo, useState } from 'react';
import { useRuntime, agentName, refreshPlaybooks, refreshPlaybookRuns, refreshSkills, refreshWork, toast } from '../state/runtime';
import { hermes } from '../adapters';
import type { Playbook } from '../domain/types';
import type { PlaybookInput } from '../adapters/interfaces';
import { Card, Drawer, RelativeTime, StateBadge } from '../components/ui';
import { slugify } from './Staff';

const runTone: Record<string, 'ok' | 'warn' | 'risk' | 'signal' | 'neutral'> = {
  complete: 'ok',
  in_progress: 'signal',
  delegated: 'signal',
  ready: 'warn',
  waiting_approval: 'warn',
  blocked: 'risk',
  cancelled: 'neutral',
};

const inputCls = 'mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint';
const labelCls = 'text-xs font-medium uppercase tracking-wider text-ink-faint';

// ---------- playbook editor (W7) ----------

function PlaybookEditorDrawer({ existing, onClose }: { existing?: Playbook; onClose: () => void }) {
  const s = useRuntime();
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [mode, setMode] = useState<Playbook['mode']>(existing?.mode ?? 'task');
  const [ownerAgentId, setOwnerAgentId] = useState(existing?.ownerAgentId ?? '');
  const [assignee, setAssignee] = useState(existing?.assignee ?? '');
  const [skills, setSkills] = useState((existing?.skills ?? []).join(', '));
  const [workers, setWorkers] = useState((existing?.workers ?? []).join(', '));
  const [verifier, setVerifier] = useState(existing?.verifier ?? '');
  const [synthesizer, setSynthesizer] = useState(existing?.synthesizer ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = existing?.id ?? slugify(name);
  const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);

  const save = async () => {
    setBusy(true);
    setError(null);
    const input: PlaybookInput = {
      ...(existing ? { id: existing.id } : {}),
      name: name.trim(),
      description: description.trim(),
      status: existing?.status ?? 'draft',
      mode,
      ...(assignee ? { assignee } : {}),
      ...(ownerAgentId ? { ownerAgentId } : {}),
      skills: list(skills),
      ...(mode === 'swarm' ? { workers: list(workers), ...(verifier ? { verifier } : {}), ...(synthesizer ? { synthesizer } : {}) } : {}),
      body,
    };
    const res = await hermes.savePlaybook(input);
    setBusy(false);
    if (res.ok && res.data) {
      toast('ok', `${existing ? 'Updated' : 'Created'} ${res.data.name} — v${res.data.version} (${res.data.status}).`);
      await refreshPlaybooks();
      onClose();
    } else {
      setError(res.error?.safeMessage ?? 'Save failed.');
    }
  };

  const canSave = name.trim() && description.trim() && body.trim() && (existing || slug);

  return (
    <Drawer title={existing ? `Edit: ${existing.name}` : 'New playbook'} onClose={onClose} width={520}>
      <div className="space-y-4">
        {existing?.status === 'published' && (
          <p className="rounded-lg border border-warn/30 bg-warn/10 p-3 text-xs text-warn">
            Published versions are immutable — saving creates the next version as a new <span className="font-semibold">draft</span>.
          </p>
        )}
        <div>
          <label htmlFor="pb-name" className={labelCls}>Name</label>
          <input id="pb-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Investor Update" className={inputCls} />
          {name.trim() && (
            <p className="mt-1 text-[11px] text-ink-faint">
              Playbook id: <code className="font-mono text-signal">{slug || '—'}</code>
              {existing && <span> (fixed — the file keeps its slug)</span>}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="pb-desc" className={labelCls}>Description</label>
          <input id="pb-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line — what this workflow produces" className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pb-mode" className={labelCls}>Mode</label>
            <select id="pb-mode" value={mode} onChange={(e) => setMode(e.target.value as Playbook['mode'])} className={inputCls}>
              <option value="task">task — one agent runs it</option>
              <option value="swarm">swarm — workers → verifier → synthesizer</option>
            </select>
          </div>
          <div>
            <label htmlFor="pb-owner" className={labelCls}>Owner</label>
            <select id="pb-owner" value={ownerAgentId} onChange={(e) => setOwnerAgentId(e.target.value)} className={inputCls}>
              <option value="">—</option>
              {s.agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
        {mode === 'task' ? (
          <div>
            <label htmlFor="pb-assignee" className={labelCls}>Default assignee (optional)</label>
            <select id="pb-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls}>
              <option value="">Choose at run time</option>
              {s.agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="pb-workers" className={labelCls}>Workers (comma-separated profile:task)</label>
              <input id="pb-workers" value={workers} onChange={(e) => setWorkers(e.target.value)} placeholder="default:Research, default:Analysis" className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pb-verifier" className={labelCls}>Verifier</label>
                <input id="pb-verifier" value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="default" className={inputCls} />
              </div>
              <div>
                <label htmlFor="pb-synth" className={labelCls}>Synthesizer</label>
                <input id="pb-synth" value={synthesizer} onChange={(e) => setSynthesizer(e.target.value)} placeholder="default" className={inputCls} />
              </div>
            </div>
          </>
        )}
        <div>
          <label htmlFor="pb-skills" className={labelCls}>Skills used (comma-separated, optional)</label>
          <input id="pb-skills" value={skills} onChange={(e) => setSkills(e.target.value)} placeholder="eaios-knowledge-retrieval, xurl" className={inputCls} />
        </div>
        <div>
          <label htmlFor="pb-body" className={labelCls}>Workflow instructions (markdown)</label>
          <textarea id="pb-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder={'## Steps\n1. Pull the inputs…\n2. Draft…\n3. Park external sends in Approvals.'} className={`${inputCls} font-mono text-xs`} />
        </div>
        {error && (
          <div role="alert" className="rounded-lg border border-risk/30 bg-risk/10 p-3 text-xs text-risk">{error}</div>
        )}
        <button onClick={() => void save()} disabled={busy || !canSave} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Saving…' : existing ? 'Save new version' : 'Create playbook'}
        </button>
        <p className="text-[11px] text-ink-faint">Versioning is automatic — edits bump the patch version; you never pick one.</p>
      </div>
    </Drawer>
  );
}

// ---------- skill creator (W7) ----------

function NewSkillDrawer({ onClose }: { onClose: () => void }) {
  const s = useRuntime();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const slug = slugify(name);
  const slugOk = /^[a-z][a-z0-9-]*$/.test(slug);
  const categories = useMemo(() => [...new Set(s.skills.map((sk) => sk.category))].sort(), [s.skills]);

  const create = async () => {
    setBusy(true);
    setError(null);
    const res = await hermes.createSkill({ name: slug, category: category.trim(), description: description.trim(), body });
    setBusy(false);
    if (res.ok) {
      toast('ok', `Skill "${slug}" created in ${category.trim()} — it appears in the list within ~30s.`);
      await refreshSkills();
      onClose();
    } else {
      setError(res.error?.safeMessage ?? 'Skill creation failed.');
    }
  };

  return (
    <Drawer title="New skill" onClose={onClose} width={520}>
      <div className="space-y-4">
        <p className="text-xs text-ink-dim">
          Creates a user-local <code className="font-mono">SKILL.md</code> your agents can load. Create-only for now — edit on disk or in a later update.
        </p>
        <div>
          <label htmlFor="sk-name" className={labelCls}>Name</label>
          <input id="sk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Board Memo Drafts" className={inputCls} />
          {name.trim() && (
            <p className="mt-1 text-[11px] text-ink-faint">
              Skill id: <code className="font-mono text-signal">{slug || '—'}</code>
              {!slug && <span className="text-warn"> — needs at least one letter or digit</span>}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="sk-category" className={labelCls}>Category</label>
          <input id="sk-category" value={category} onChange={(e) => setCategory(e.target.value)} list="skill-categories" className={inputCls} />
          <datalist id="skill-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="sk-desc" className={labelCls}>Description <span className="normal-case text-ink-faint">(≤60 chars — agents match on this)</span></label>
          <input id="sk-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Draft board memos from notes and metrics." className={inputCls} />
          <p className={`mt-1 text-[11px] ${description.length > 60 ? 'text-warn' : 'text-ink-faint'}`}>{description.length}/60</p>
        </div>
        <div>
          <label htmlFor="sk-body" className={labelCls}>Instructions (markdown)</label>
          <textarea id="sk-body" value={body} onChange={(e) => setBody(e.target.value)} rows={10} placeholder={'# Board Memo Drafts\n\n## When to Use\n- The executive asks for a board memo…\n\n## Procedure\n1. Gather…\n2. Draft…\n\n## Pitfalls\n- Never send externally without approval.'} className={`${inputCls} font-mono text-xs`} />
        </div>
        {error && (
          <div role="alert" className="rounded-lg border border-risk/30 bg-risk/10 p-3 text-xs text-risk">{error}</div>
        )}
        <button onClick={() => void create()} disabled={busy || !slugOk || !description.trim() || !body.trim() || !category.trim()} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create skill'}
        </button>
      </div>
    </Drawer>
  );
}

// ---------- run + cards (pre-W7, unchanged behavior) ----------

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

function PlaybookCard({ playbook, onEdit }: { playbook: Playbook; onEdit: () => void }) {
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
        <button onClick={onEdit} className="rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-ink-dim hover:bg-canvas-overlay">Edit</button>
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
                <span className="flex items-center gap-2">
                  <StateBadge label={r.state} tone={runTone[r.state] ?? 'neutral'} />
                  <span className="font-mono text-ink-faint">v{r.playbookVersion}</span>
                </span>
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
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [creatingPlaybook, setCreatingPlaybook] = useState(false);
  const [editingPlaybook, setEditingPlaybook] = useState<Playbook | null>(null);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Skills & Playbooks</h1>
          <p className="mt-1 text-sm text-ink-dim">Reusable capabilities (skills) and versioned multi-step workflows (playbooks).</p>
        </div>
        <button
          onClick={() => (tab === 'skill' ? setCreatingSkill(true) : setCreatingPlaybook(true))}
          className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90"
        >
          {tab === 'skill' ? '+ New skill' : '+ New playbook'}
        </button>
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
          {s.playbooks.map((p) => <PlaybookCard key={p.id} playbook={p} onEdit={() => setEditingPlaybook(p)} />)}
          {s.playbooks.length === 0 && (
            <p className="text-sm text-ink-faint">No playbooks found — add markdown workflows to ~/eaios/playbooks/.</p>
          )}
        </div>
      )}

      <p className="text-xs text-ink-faint">Published versions are immutable — edits create a new draft. Approval checkpoints are shown before any run starts.</p>

      {creatingSkill && <NewSkillDrawer onClose={() => setCreatingSkill(false)} />}
      {creatingPlaybook && <PlaybookEditorDrawer onClose={() => setCreatingPlaybook(false)} />}
      {editingPlaybook && <PlaybookEditorDrawer existing={editingPlaybook} onClose={() => setEditingPlaybook(null)} />}
    </div>
  );
}
