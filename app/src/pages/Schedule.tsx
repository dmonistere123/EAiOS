/** Schedule — one time view: calendar events + live cron overlay + cron creation.
 * W5: the rail groups live cron jobs by OWNING agent (per-profile jobs.json
 * stores, HANDOFF #17). The host records no creator field — the rail says so. */
import { useEffect, useMemo, useState } from 'react';
import { calendarEvents } from '../mocks/fixtures';
import { hermes } from '../adapters';
import { TELEGRAM_HOME_DELIVERY } from '../config';
import { useRuntime, refreshCron, toast } from '../state/runtime';
import { usePageRail } from '../state/rail';
import type { RailSectionDef } from '../state/rail';
import type { CronJob } from '../domain/types';
import { Card, SectionTitle, StateBadge, TimeUntil } from '../components/ui';

type Source = 'executive' | 'agent' | 'cron' | 'team';
const SOURCE_META: Record<Source, { label: string; dot: string }> = {
  executive: { label: 'My calendar', dot: 'bg-signal' },
  agent: { label: 'Agent schedules', dot: 'bg-secondary' },
  cron: { label: 'Cron jobs', dot: 'bg-warn' },
  team: { label: 'Team', dot: 'bg-ok' },
};

const SCHEDULE_PRESETS = [
  { label: 'Weekday mornings · 7:00', value: '0 7 * * 1-5' },
  { label: 'Daily · 7:00', value: '0 7 * * *' },
  { label: 'Every 4 hours', value: '0 */4 * * *' },
  { label: 'Fridays · 16:00', value: '0 16 * * 5' },
  { label: 'Custom…', value: 'custom' },
];

function NewCronForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(SCHEDULE_PRESETS[0].value);
  const [custom, setCustom] = useState('');
  const [prompt, setPrompt] = useState('');
  const [deliver, setDeliver] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const scheduleExpression = preset === 'custom' ? custom.trim() : preset;
    if (!name.trim() || !scheduleExpression || !prompt.trim()) {
      toast('error', 'Name, schedule, and instructions are all required.');
      return;
    }
    setBusy(true);
    const res = await hermes.createCronJob({
      name: name.trim(),
      scheduleExpression,
      actionRef: prompt.trim(),
      approvalPolicy: 'approval_on_result',
      deliver: deliver ? TELEGRAM_HOME_DELIVERY : undefined,
    });
    setBusy(false);
    if (res.ok) {
      toast('ok', `Scheduled “${name.trim()}” — it now appears here and in the right rail.`);
      await refreshCron();
      setOpen(false);
      setName('');
      setPrompt('');
      setDeliver(false);
      onCreated();
    } else {
      toast('error', res.error?.safeMessage ?? 'Could not create the job.');
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90">
        New scheduled task
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-edge bg-canvas p-4">
      <div>
        <label htmlFor="cron-name" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Name</label>
        <input id="cron-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Morning briefing" className="mt-1 w-full rounded-lg border border-edge bg-canvas-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint" />
      </div>
      <div>
        <label htmlFor="cron-schedule" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Schedule</label>
        <select id="cron-schedule" value={preset} onChange={(e) => setPreset(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas-raised px-3 py-2 text-sm text-ink">
          {SCHEDULE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        {preset === 'custom' && (
          <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="0 9 * * 1 (cron expression or 'every 2h')" aria-label="Custom schedule" className="mt-2 w-full rounded-lg border border-edge bg-canvas-raised px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint" />
        )}
      </div>
      <div>
        <label htmlFor="cron-prompt" className="text-xs font-medium uppercase tracking-wider text-ink-faint">What should Ally do?</label>
        <textarea id="cron-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Summarize overnight mentions and draft a digest…" className="mt-1 w-full rounded-lg border border-edge bg-canvas-raised px-3 py-2 text-sm text-ink placeholder:text-ink-faint" />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-dim">
        <input type="checkbox" checked={deliver} onChange={(e) => setDeliver(e.target.checked)} className="accent-[#32c5ff]" />
        Deliver results to Telegram (Ally's Portal)
      </label>
      <div className="flex gap-2">
        <button onClick={submit} disabled={busy} className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Creating…' : 'Create job'}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-ink-dim hover:bg-canvas-overlay">Cancel</button>
      </div>
      <p className="text-[11px] text-ink-faint">Runs through Hermes' real scheduler. External sends in the job's output still pass the approval policy.</p>
    </div>
  );
}

export default function Schedule() {
  const s = useRuntime();
  const [enabled, setEnabled] = useState<Record<Source, boolean>>({ executive: true, agent: true, cron: true, team: false });
  const [byAgent, setByAgent] = useState<Record<string, CronJob[]>>({});

  // W5: per-agent cron ownership. Keyed on the agent id SET, not the slice
  // identity — event-driven refreshes must not refetch N profiles each time.
  const agentIds = s.agents.map((a) => a.id).join(',');
  useEffect(() => {
    if (!agentIds) return;
    let stale = false;
    void Promise.all(agentIds.split(',').map(async (id) => [id, await hermes.listCronJobs(id)] as const)).then((entries) => {
      if (!stale) setByAgent(Object.fromEntries(entries));
    });
    return () => {
      stale = true;
    };
  }, [agentIds]);

  const agentsWithJobs = s.agents.filter((a) => (byAgent[a.id] ?? []).length > 0);
  const totalJobs = agentsWithJobs.reduce((n, a) => n + (byAgent[a.id] ?? []).length, 0);
  const railSections = useMemo<RailSectionDef[]>(
    () => [
      {
        key: 'schedules-by-agent',
        title: 'Schedules by agent',
        count: totalJobs,
        node: (
          <div className="space-y-3">
            {agentsWithJobs.map((a) => (
              <div key={a.id}>
                <div className="px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">{a.name}</div>
                <ul className="mt-1 space-y-1">
                  {(byAgent[a.id] ?? []).map((j) => (
                    <li key={j.id} className="rounded-lg px-2 py-1.5">
                      <div className="truncate text-xs font-medium text-ink">{j.name}</div>
                      <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-faint">
                        <TimeUntil iso={j.nextRunAt} />
                        {!j.enabled && <span>paused</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {Object.keys(byAgent).length > 0 && totalJobs === 0 && <p className="px-2 text-xs text-ink-faint">No scheduled jobs.</p>}
            <p className="px-2 pt-1 text-[10px] leading-snug text-ink-faint">
              Ownership = the profile whose scheduler runs the job. The host doesn't record who created each job — that gap is on the roadmap.
            </p>
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byAgent, totalJobs, s.agents],
  );
  usePageRail(railSections);

  // Calendar events = fixture events (executive/agent — mock until Google
  // Calendar is connected) + REAL cron jobs as their own overlay.
  const events = useMemo(() => {
    const cronEvts = s.cron.map((j) => ({
      id: `cron-${j.id}`,
      title: j.name,
      startsAt: j.nextRunAt,
      endsAt: j.nextRunAt,
      source: 'cron' as const,
      refId: j.id,
    }));
    return [...calendarEvents.filter((e) => e.source !== 'cron'), ...cronEvts]
      .filter((e) => enabled[e.source])
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [enabled, s.cron]);

  const days = useMemo(() => {
    const map = new Map<string, typeof events>();
    events.forEach((e) => {
      const key = new Date(e.startsAt).toDateString();
      map.set(key, [...(map.get(key) ?? []), e]);
    });
    return [...map.entries()].slice(0, 3);
  }, [events]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="mt-1 text-sm text-ink-dim">Your meetings and your AI staff's planned work in one view. Cron overlay is live; executive calendar connects via Google in the Connections phase.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SOURCE_META) as Source[]).map((src) => (
            <label key={src} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge bg-canvas-raised px-2.5 py-1.5 text-xs text-ink-dim">
              <input type="checkbox" checked={enabled[src]} onChange={() => setEnabled((e) => ({ ...e, [src]: !e[src] }))} className="accent-[#32c5ff]" />
              <span className={`h-2 w-2 rounded-full ${SOURCE_META[src].dot}`} aria-hidden />
              {SOURCE_META[src].label}
            </label>
          ))}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {days.map(([day, evts]) => (
          <Card key={day} className="p-4">
            <SectionTitle>{new Date(day).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</SectionTitle>
            <ul className="space-y-2">
              {evts.map((e) => (
                <li key={e.id} className="rounded-lg border border-edge bg-canvas p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_META[e.source].dot}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{e.title}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-faint">
                    <span>{new Date(e.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                    <TimeUntil iso={e.startsAt} />
                  </div>
                </li>
              ))}
              {evts.length === 0 && <li className="text-xs text-ink-faint">Nothing scheduled.</li>}
            </ul>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <SectionTitle right={<StateBadge label={`${s.cron.length} live job${s.cron.length === 1 ? '' : 's'}`} tone="signal" />}>Create scheduled AI work</SectionTitle>
        <p className="text-xs text-ink-dim">Jobs created here run on the real Hermes scheduler and appear in this calendar, the right rail, and Connections — same object, same store.</p>
        <NewCronForm onCreated={() => undefined} />
      </Card>
    </div>
  );
}
