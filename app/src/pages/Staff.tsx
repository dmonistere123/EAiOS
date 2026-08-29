/** Staff — the AI agent workforce. Status is runtime-driven, never decorative.
 * W3: org visualization (Ally hub, radial staff, working = pulse) with the
 * pre-W3 grid kept as the List toggle; selecting an agent opens its
 * properties drawer AND declares its channel into the right rail (D-B4). */
import { useEffect, useMemo, useState } from 'react';
import type { Agent } from '../domain/types';
import type { ModelOptionGroup } from '../adapters/interfaces';
import { hermes } from '../adapters';
import { useRuntime, refreshAgents, toast } from '../state/runtime';
import { usePageRail } from '../state/rail';
import type { RailSectionDef } from '../state/rail';
import { AgentStatusBadge, Card, Drawer, IndeterminateBar, RelativeTime, StateBadge } from '../components/ui';
import { OrgChart } from '../components/OrgChart';
import { useAgentChannel } from '../components/AgentChannel';

/** Add Agent drawer (Phase 6.5) — profile creation via the live model catalog. */

/** Natural input → slug: "Sales Scout!" → "sales-scout". Empty when nothing usable remains. */
export function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, 'a$1'); // ids must start with a letter
}

function AddAgentDrawer({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [catalog, setCatalog] = useState<ModelOptionGroup[] | null>(null);
  const [picked, setPicked] = useState(''); // "provider/model"
  const [soul, setSoul] = useState('');
  const [botToken, setBotToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null); // persistent — a 4s toast is too easy to miss

  useEffect(() => {
    let live = true;
    void hermes.listModelOptions().then((groups) => {
      if (!live) return;
      setCatalog(groups);
      const first = groups.find((g) => g.authenticated && g.models.length) ?? groups[0];
      if (first) setPicked(`${first.slug}/${first.models[0]}`);
    });
    return () => {
      live = false;
    };
  }, []);

  const create = async () => {
    const [provider, ...rest] = picked.split('/');
    const model = rest.join('/');
    if (!slug || !provider || !model) return;
    setBusy(true);
    setError(null);
    const res = await hermes.createAgent({
      name: slug,
      role: role.trim() || 'Specialist agent',
      model: { provider, model },
      ...(soul.trim() ? { soul: soul.trim() } : {}),
    });
    if (res.ok) {
      // Bind the agent's own Telegram bot if a token was supplied (dogfood ask).
      let bound = false;
      if (botToken.trim()) {
        const b = await hermes.setTelegramBotToken(slug, botToken.trim());
        if (!b.ok) {
          setBusy(false);
          setError(`Agent "${slug}" was created, but the bot token write failed: ${b.error?.safeMessage ?? 'unknown error'} — bind it from the agent's properties drawer.`);
          await refreshAgents();
          return;
        }
        bound = true;
      }
      setBusy(false);
      toast('ok', `Agent "${slug}" created${bound ? ' with its Telegram bot bound' : ''}. Audit ${res.auditEventId}.`);
      await refreshAgents();
      onClose();
    } else {
      setBusy(false);
      setError(res.error?.safeMessage ?? 'Agent creation failed.');
    }
  };

  const slug = slugify(name);
  const slugOk = /^[a-z][a-z0-9-]*$/.test(slug);
  const disabledReason = !slugOk ? 'Agent id needs at least one letter or digit.' : !picked ? 'Waiting for the model catalog…' : null;

  return (
    <Drawer title="Add agent" onClose={onClose} width={460}>
      <div className="space-y-4">
        <p className="text-xs text-ink-dim">
          Creates a new Hermes profile — a real staff agent that can infer out of the box (credentials mirror from the default profile). Config write: audited, no approval needed.
        </p>
        <div>
          <label htmlFor="agent-name" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Name</label>
          <input
            id="agent-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sales Scout"
            className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
          {name.trim() && (
            <p className="mt-1 text-[11px] text-ink-faint">
              Agent id: <code className="font-mono text-signal">{slug || '—'}</code>
              {!slug && <span className="text-warn"> — needs at least one letter or digit</span>}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="agent-role" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Role</label>
          <input
            id="agent-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Competitive intelligence analyst"
            className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
        </div>
        <div>
          <label htmlFor="agent-model" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Model</label>
          <select
            id="agent-model"
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"
          >
            {(catalog ?? []).map((g) => (
              <optgroup key={g.slug} label={`${g.name}${g.authenticated ? '' : ' (not authenticated)'}`}>
                {g.models.map((m) => (
                  <option key={`${g.slug}/${m}`} value={`${g.slug}/${m}`}>{m}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {!catalog && <p className="mt-1 text-[11px] text-ink-faint">Loading model catalog…</p>}
        </div>
        <div>
          <label htmlFor="agent-soul" className="text-xs font-medium uppercase tracking-wider text-ink-faint">SOUL.md seed (optional)</label>
          <textarea
            id="agent-soul"
            value={soul}
            onChange={(e) => setSoul(e.target.value)}
            rows={4}
            placeholder="Operating identity for this agent — personality, rules, priorities."
            className="mt-1 w-full rounded-lg border border-edge bg-canvas p-3 font-mono text-xs text-ink placeholder:text-ink-faint"
          />
        </div>
        <div>
          <label htmlFor="agent-bot-token" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Telegram bot token (optional)</label>
          <input
            id="agent-bot-token"
            type="password"
            value={botToken}
            onChange={(e) => setBotToken(e.target.value)}
            placeholder="123456:ABC-DEF… — binds this agent's own bot"
            autoComplete="off"
            className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
          />
          <p className="mt-1 text-[11px] text-ink-faint">
            Written to the profile's .env (chmod 600) and never displayed again. Bring the bot online with <code className="font-mono text-signal">hermes -p {slug || 'slug'} gateway install && start</code> — automating that is Phase 8.
          </p>
        </div>
        {error && (
          <div role="alert" className="rounded-lg border border-risk/30 bg-risk/10 p-3 text-xs text-risk">
            {error}
          </div>
        )}
        <button
          onClick={() => void create()}
          disabled={busy || !slugOk || !picked}
          className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create agent'}
        </button>
        {disabledReason && !busy && <p className="text-[11px] text-ink-faint">{disabledReason}</p>}
      </div>
    </Drawer>
  );
}

type Filter = 'all' | 'active' | 'waiting' | 'failed' | 'idle';
const FILTERS: { id: Filter; label: string; match: (a: Agent) => boolean }[] = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'active', label: 'Active', match: (a) => ['working', 'queued'].includes(a.status) },
  { id: 'waiting', label: 'Waiting', match: (a) => a.status.startsWith('waiting') },
  { id: 'failed', label: 'Failed / Offline', match: (a) => ['failed', 'offline'].includes(a.status) },
  { id: 'idle', label: 'Idle', match: (a) => a.status === 'idle' },
];

function AgentPropertiesDrawer({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [model, setModel] = useState(`${agent.model.provider}/${agent.model.model}`);
  const [role, setRole] = useState(agent.role);
  const [busy, setBusy] = useState(false);
  const [catalog, setCatalog] = useState<ModelOptionGroup[] | null>(null);
  // Dogfood fix (2026-08-29): SOUL.md editing rides the 6.2 env-file surface.
  const [soul, setSoul] = useState<string | null>(null);
  const [soulVersion, setSoulVersion] = useState('');
  const [soulBusy, setSoulBusy] = useState(false);
  // Telegram bot binding — existence only, tokens never displayed.
  const [botBound, setBotBound] = useState<boolean | null>(null);
  const [botToken, setBotToken] = useState('');
  const [botBusy, setBotBusy] = useState(false);

  // Live mode: the agent's own allowed list has only its current model —
  // enrich from the catalog so the picker is real (6.5).
  useEffect(() => {
    let live = true;
    void hermes.listModelOptions().then((groups) => {
      if (live && groups.length) setCatalog(groups);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    void hermes.readEnvironmentFile(`soul-${agent.id}`).then((f) => {
      if (live) {
        setSoul(f.content);
        setSoulVersion(f.version);
      }
    });
    return () => {
      live = false;
    };
  }, [agent.id]);

  useEffect(() => {
    let live = true;
    void hermes.getTelegramBotStatus(agent.id).then((s) => {
      if (live) setBotBound(s.bound);
    });
    return () => {
      live = false;
    };
  }, [agent.id]);

  const saveBotToken = async () => {
    if (!botToken.trim()) return;
    setBotBusy(true);
    const res = await hermes.setTelegramBotToken(agent.id, botToken.trim());
    setBotBusy(false);
    if (res.ok) {
      toast('ok', `Telegram bot token bound to ${agent.name}.`);
      setBotToken('');
      setBotBound(true);
    } else {
      toast('error', res.error?.safeMessage ?? 'Bot binding failed.');
    }
  };

  const save = async () => {
    setBusy(true);
    const [provider, ...rest] = model.split('/');
    const res = await hermes.updateAgentConfig(agent.id, {
      model: { provider, model: rest.join('/') },
      ...(role.trim() !== agent.role ? { description: role.trim() } : {}),
    });
    setBusy(false);
    if (res.ok) {
      toast('ok', `${agent.name} settings saved.`);
      await refreshAgents();
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Save rejected.');
    }
  };

  const saveSoul = async () => {
    if (soul === null) return;
    setSoulBusy(true);
    const res = await hermes.writeEnvironmentFile(`soul-${agent.id}`, soulVersion, soul);
    setSoulBusy(false);
    if (res.ok) {
      toast('ok', `${agent.name}'s SOUL.md saved (version-checked).`);
      const fresh = await hermes.readEnvironmentFile(`soul-${agent.id}`);
      setSoulVersion(fresh.version);
    } else {
      toast('error', res.error?.safeMessage ?? 'SOUL save failed.');
    }
  };

  return (
    <Drawer title={`${agent.name} — properties`} onClose={onClose}>
      <div className="space-y-5">
        <div>
          <label htmlFor="agent-role-edit" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Role</label>
          <input
            id="agent-role-edit"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink"
          />
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
            {catalog ? (
              catalog.map((g) => (
                <optgroup key={g.slug} label={g.name}>
                  {g.models.map((m) => (
                    <option key={`${g.slug}/${m}`} value={`${g.slug}/${m}`}>{m}</option>
                  ))}
                </optgroup>
              ))
            ) : (
              agent.availableModels.map((m) => (
                <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>{m.provider} / {m.model}</option>
              ))
            )}
          </select>
          <p className="mt-1 text-[11px] text-ink-faint">Validated against the live model catalog. Changes are audited.</p>
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
        <div>
          <label htmlFor="soul-edit" className="text-xs font-medium uppercase tracking-wider text-ink-faint">SOUL.md — operating identity</label>
          {soul === null ? (
            <p className="mt-1 text-xs text-ink-faint">Loading…</p>
          ) : (
            <>
              <textarea
                id="soul-edit"
                value={soul}
                onChange={(e) => setSoul(e.target.value)}
                rows={8}
                className="mt-1 w-full rounded-lg border border-edge bg-canvas p-3 font-mono text-xs text-ink"
              />
              <button onClick={() => void saveSoul()} disabled={soulBusy} className="mt-2 w-full rounded-lg border border-signal/40 px-3 py-2 text-xs font-medium text-signal hover:bg-signal/10 disabled:opacity-50">
                {soulBusy ? 'Saving…' : 'Save SOUL.md (version-checked)'}
              </button>
            </>
          )}
        </div>
        {agent.id !== 'default' && agent.id !== 'ally' && (
          <div>
            <label htmlFor="bot-token-edit" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Telegram bot</label>
            <p className="mt-1 text-xs text-ink-dim">
              {botBound === null ? 'Checking…' : botBound ? 'A bot token is present (possibly mirrored from the default profile).' : 'No bot token bound.'}
            </p>
            <div className="mt-2 flex gap-2">
              <input
                id="bot-token-edit"
                type="password"
                value={botToken}
                onChange={(e) => setBotToken(e.target.value)}
                placeholder="Paste a new bot token to bind"
                autoComplete="off"
                className="flex-1 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
              />
              <button onClick={() => void saveBotToken()} disabled={botBusy || !botToken.trim()} className="rounded-lg border border-signal/40 px-3 py-2 text-xs font-medium text-signal hover:bg-signal/10 disabled:opacity-50">
                {botBusy ? 'Binding…' : 'Bind token'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-ink-faint">Written to the profile's .env (chmod 600), never shown again. Bring the bot online with <code className="font-mono text-signal">hermes -p {agent.id} gateway install && start</code>.</p>
          </div>
        )}
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
  const [view, setView] = useState<'org' | 'list'>('org');
  const [selected, setSelected] = useState<Agent | null>(null);
  const [adding, setAdding] = useState(false);

  const agents = useMemo(() => s.agents.filter(FILTERS.find((f) => f.id === filter)!.match), [s.agents, filter]);
  const workTitle = (id?: string) => s.work.find((w) => w.id === id)?.title;

  // Ally (the hub) always renders in the org chart — filters apply to staff only.
  const hubAgent = s.agents.find((a) => !a.reportsToAgentId) ?? s.agents[0];
  const orgAgents = hubAgent ? [hubAgent, ...agents.filter((a) => a.id !== hubAgent.id)] : agents;

  // W3: the selected agent's channel rides the right rail (W1 data path).
  const channel = useAgentChannel(selected?.id ?? null);
  const selectedName = selected?.name ?? '';
  const railSections = useMemo<RailSectionDef[] | null>(() => {
    if (!selected) return null;
    return [
      {
        key: 'delegations',
        title: `Delegated to ${selectedName}`,
        count: channel?.delegations.length,
        node: !channel ? (
          <p className="px-2 text-xs text-ink-faint">Loading…</p>
        ) : channel.delegations.length === 0 ? (
          <p className="px-2 text-xs text-ink-faint">Nothing delegated to {selectedName} right now.</p>
        ) : (
          <ul className="space-y-1.5">
            {channel.delegations.map((w) => (
              <li key={w.id} className="rounded-lg px-2 py-1.5">
                <div className="truncate text-xs font-medium text-ink">{w.title}</div>
                <div className="mt-1">
                  <StateBadge label={w.state.replace('_', ' ')} tone={w.state === 'in_progress' ? 'signal' : w.state === 'waiting_approval' ? 'warn' : 'neutral'} />
                </div>
              </li>
            ))}
          </ul>
        ),
      },
      {
        key: 'agent-chat',
        title: `Ally ↔ ${selectedName}`,
        count: channel?.agentChat?.length,
        node: !channel ? (
          <p className="px-2 text-xs text-ink-faint">Loading…</p>
        ) : channel.agentChat === null ? (
          <p className="px-2 text-xs text-ink-faint">No Ally↔{selectedName} chat yet — one appears here the first time Ally messages {selectedName}.</p>
        ) : (
          <ul className="space-y-2">
            {channel.agentChat.map((m) => (
              <li key={m.id} className="rounded-lg bg-canvas px-2 py-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.role === 'you' ? 'Ally' : selectedName}</div>
                <div className="whitespace-pre-wrap text-xs text-ink-dim">{m.text}</div>
              </li>
            ))}
          </ul>
        ),
      },
    ];
  }, [selected, selectedName, channel]);
  usePageRail(railSections);

  const selectAgent = (a: Agent) => setSelected((cur) => (cur?.id === a.id ? null : a));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>
          <p className="mt-1 text-sm text-ink-dim">Your AI workforce. Status lights reflect live runtime state. Select an agent for its channel.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5" role="tablist" aria-label="Staff view">
            {(['org', 'list'] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${view === v ? 'bg-signal/15 text-signal' : 'text-ink-dim hover:bg-canvas-overlay'}`}
              >
                {v === 'org' ? 'Org' : 'List'}
              </button>
            ))}
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
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90"
          >
            + Add agent
          </button>
        </div>
      </header>

      {view === 'org' ? (
        <OrgChart agents={orgAgents} selectedId={selected?.id} onSelect={selectAgent} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <button key={a.id} onClick={() => selectAgent(a)} className="text-left">
              <Card className={`h-full p-5 transition-colors hover:border-signal/40 ${selected?.id === a.id ? 'border-signal/60' : ''}`}>
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
      )}

      {selected && <AgentPropertiesDrawer agent={s.agents.find((x) => x.id === selected.id) ?? selected} onClose={() => setSelected(null)} />}
      {adding && <AddAgentDrawer onClose={() => setAdding(false)} />}
    </div>
  );
}
