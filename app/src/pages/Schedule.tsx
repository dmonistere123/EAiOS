/** Schedule — one time view: calendar events + live cron overlay + cron creation.
 * W5: the rail groups live cron jobs by OWNING agent (per-profile jobs.json
 * stores, HANDOFF #17). The host records no creator field — the rail says so. */
import { useEffect, useMemo, useState } from 'react';
import { calendarEvents } from '../mocks/fixtures';
import { hermes } from '../adapters';
import { TELEGRAM_HOME_DELIVERY } from '../config';
import { useRuntime, refreshCron, refreshWork, toast, agentName } from '../state/runtime';
import { usePageRail } from '../state/rail';
import type { RailSectionDef } from '../state/rail';
import type { CronJob, WorkItem } from '../domain/types';
import type { WorkItemAction } from '../adapters/interfaces';
import { Card, Drawer, SectionTitle, StateBadge, TimeUntil, RelativeTime } from '../components/ui';
import { NewDelegationDrawer } from '../components/NewDelegationDrawer';

const DAY_MS = 24 * 3600_000;

/** Cron inspector (dogfood 2026-08-29): see what a job WILL do, edit, pause, delete. */
function CronInspector({ job, onClose, onChanged }: { job: CronJob; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState(job.name);
  const [schedule, setSchedule] = useState(job.scheduleExpression);
  const [prompt, setPrompt] = useState(job.prompt ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await hermes.updateCronJob(job.id, {
      ...(name.trim() !== job.name ? { name: name.trim() } : {}),
      ...(schedule.trim() !== job.scheduleExpression ? { scheduleExpression: schedule.trim() } : {}),
      ...(prompt !== (job.prompt ?? '') ? { prompt } : {}),
    });
    setBusy(false);
    if (res.ok) {
      toast('ok', `Job "${name.trim()}" updated.`);
      await refreshCron();
      onChanged();
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Update failed.');
    }
  };

  const toggleEnabled = async () => {
    setBusy(true);
    const res = await hermes.updateCronJob(job.id, { enabled: !job.enabled });
    setBusy(false);
    if (res.ok) {
      toast('ok', job.enabled ? `"${job.name}" paused.` : `"${job.name}" resumed.`);
      await refreshCron();
      onChanged();
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Update failed.');
    }
  };

  const remove = async () => {
    setBusy(true);
    const res = await hermes.deleteCronJob(job.id);
    setBusy(false);
    if (res.ok) {
      toast('ok', `"${job.name}" deleted.`);
      await refreshCron();
      onChanged();
      onClose();
    } else {
      toast('error', res.error?.safeMessage ?? 'Delete failed.');
    }
  };

  return (
    <Drawer title={`${job.name} — scheduled job`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <StateBadge label={job.enabled ? 'enabled' : 'paused'} tone={job.enabled ? 'ok' : 'warn'} />
          {job.lastStatus && <StateBadge label={`last run: ${job.lastStatus}`} tone={job.lastStatus === 'ok' ? 'ok' : 'neutral'} />}
          <span className="text-ink-faint">next <TimeUntil iso={job.nextRunAt} /></span>
        </div>
        <div>
          <label htmlFor="ci-name" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Name</label>
          <input id="ci-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink" />
        </div>
        <div>
          <label htmlFor="ci-schedule" className="text-xs font-medium uppercase tracking-wider text-ink-faint">Schedule (cron expression)</label>
          <input id="ci-schedule" value={schedule} onChange={(e) => setSchedule(e.target.value)} className="mt-1 w-full rounded-lg border border-edge bg-canvas px-3 py-2 font-mono text-sm text-ink" />
        </div>
        <div>
          <label htmlFor="ci-prompt" className="text-xs font-medium uppercase tracking-wider text-ink-faint">What the job does (prompt)</label>
          <textarea id="ci-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} className="mt-1 w-full rounded-lg border border-edge bg-canvas p-3 text-sm text-ink" />
        </div>
        {job.deliver && <p className="text-xs text-ink-faint">Delivers to <code className="font-mono text-signal">{job.deliver}</code></p>}
        <button onClick={() => void save()} disabled={busy || !name.trim()} className="w-full rounded-lg bg-signal px-4 py-2.5 text-sm font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50">
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => void toggleEnabled()} disabled={busy} className="rounded-lg border border-warn/40 px-3 py-2 text-xs font-medium text-warn hover:bg-warn/10 disabled:opacity-50">
            {job.enabled ? 'Pause job' : 'Resume job'}
          </button>
          {confirmDelete ? (
            <button onClick={() => void remove()} disabled={busy} className="rounded-lg bg-risk px-3 py-2 text-xs font-semibold text-canvas hover:bg-risk/90 disabled:opacity-50">
              {busy ? 'Deleting…' : 'Confirm delete'}
            </button>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="rounded-lg border border-risk/40 px-3 py-2 text-xs font-medium text-risk hover:bg-risk/10">
              Delete job
            </button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

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
  const [newDelegation, setNewDelegation] = useState(false);
  const [inspectingCron, setInspectingCron] = useState<CronJob | null>(null);
  const [confirmStop, setConfirmStop] = useState<string | null>(null);
  const [confirmDone, setConfirmDone] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [railBump, setRailBump] = useState(0);

  // Dogfood 2026-08-29: delegated work is visible here, not just on Today.
  const workInFlight = useMemo(
    () =>
      s.work
        .filter((w) => w.ownerType === 'agent' && !['complete', 'cancelled'].includes(w.state))
        .sort((a, b) => {
          const rank = { in_progress: 0, waiting_approval: 1, delegated: 2, ready: 3, blocked: 4, new: 5 } as const;
          return (rank[a.state as keyof typeof rank] ?? 6) - (rank[b.state as keyof typeof rank] ?? 6) || b.updatedAt.localeCompare(a.updatedAt);
        }),
    [s.work],
  );

  const completedRecently = useMemo(
    () =>
      s.work
        .filter((w) => ['complete', 'cancelled'].includes(w.state) && Date.now() - new Date(w.updatedAt).getTime() < DAY_MS)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [s.work],
  );

  const isStale = (w: WorkItem) => health[w.id] === 'stale';

  // Health comes from the host's diagnostics (live) — never timestamps alone
  // (the updatedAt heuristic false-flagged healthy long runs, dogfood 2026-08-29).
  const inProgressIds = workInFlight.filter((w) => w.state === 'in_progress').map((w) => w.id).join(',');
  const [health, setHealth] = useState<Record<string, 'healthy' | 'stale' | 'unknown'>>({});
  useEffect(() => {
    if (!inProgressIds || !hermes.getWorkItemHealth) return;
    let live = true;
    const check = () =>
      void hermes.getWorkItemHealth!(inProgressIds.split(',')).then((h) => {
        if (live) setHealth(h);
      });
    check();
    const t = setInterval(check, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [inProgressIds]);

  const act = async (w: WorkItem, action: WorkItemAction) => {
    setBusyAction(`${w.id}:${action}`);
    const note = action === 'defer' ? 'Deferred by executive from EAiOS' : action === 'reclaim' ? 'Reclaimed from EAiOS (stale run)' : undefined;
    const res = await hermes.setWorkItemState(w.id, action, note);
    setBusyAction(null);
    setConfirmStop(null);
    setConfirmDone(null);
    if (res.ok) {
      toast('ok', `${action === 'stop' ? 'Stopped' : action === 'complete' ? 'Completed' : action === 'pause' ? 'Paused' : action === 'resume' ? 'Resumed' : action === 'defer' ? 'Deferred' : 'Reclaimed'}: ${w.title}`);
      await refreshWork();
    } else {
      toast('error', res.error?.safeMessage ?? 'Action failed.');
    }
  };

  // W5: per-agent cron ownership. Keyed on the agent id SET + job COUNT —
  // identity-stable refreshes don't refetch, but a created/deleted job does.
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
  }, [agentIds, s.cron.length, railBump]);

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
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-xs font-medium text-ink">{j.name}</div>
                        <button onClick={() => setInspectingCron(j)} className="shrink-0 rounded border border-signal/40 px-1.5 py-0.5 text-[10px] font-medium text-signal hover:bg-signal/10">
                          Inspect
                        </button>
                      </div>
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
        <SectionTitle right={<StateBadge label={`${workInFlight.length} active`} tone={workInFlight.length ? 'signal' : 'neutral'} />}>Work in flight — delegated tasks</SectionTitle>
        <p className="mb-3 text-xs text-ink-dim">Live kanban tasks your agents hold right now. Approvals still gate external writes — nothing here bypasses them.</p>
        {workInFlight.length === 0 ? (
          <p className="text-xs text-ink-faint">Nothing delegated right now — use ＋ New delegated task to put an agent to work.</p>
        ) : (
          <ul className="divide-y divide-edge/60">
            {workInFlight.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-ink">{w.title}</span>
                <span className="text-xs text-ink-dim">{agentName(s, w.ownerId ?? '')}</span>
                <StateBadge label={w.state.replace('_', ' ')} tone={w.state === 'in_progress' ? 'signal' : w.state === 'waiting_approval' ? 'warn' : 'neutral'} />
                {isStale(w) && <StateBadge label="stale — no heartbeat" tone="risk" />}
                <span className="w-16 text-right text-xs text-ink-faint"><RelativeTime iso={w.updatedAt} /></span>
                <span className="flex gap-1.5 text-[11px]">
                  {isStale(w) && (
                    <button onClick={() => void act(w, 'reclaim')} disabled={busyAction !== null} className="rounded border border-risk/40 px-2 py-1 font-medium text-risk hover:bg-risk/10 disabled:opacity-50">
                      Reclaim
                    </button>
                  )}
                  {w.state === 'blocked' ? (
                    <button onClick={() => void act(w, 'resume')} disabled={busyAction !== null} className="rounded border border-ok/40 px-2 py-1 font-medium text-ok hover:bg-ok/10 disabled:opacity-50">
                      Resume
                    </button>
                  ) : (
                    <button onClick={() => void act(w, 'pause')} disabled={busyAction !== null} className="rounded border border-warn/40 px-2 py-1 font-medium text-warn hover:bg-warn/10 disabled:opacity-50">
                      Pause
                    </button>
                  )}
                  <button onClick={() => void act(w, 'defer')} disabled={busyAction !== null} className="rounded border border-edge px-2 py-1 font-medium text-ink-dim hover:bg-canvas-overlay disabled:opacity-50" title="Park the task (scheduled state) — resume any time">
                    Defer
                  </button>
                  {confirmDone === w.id ? (
                    <button onClick={() => void act(w, 'complete')} disabled={busyAction !== null} className="rounded bg-signal px-2 py-1 font-semibold text-canvas hover:bg-signal/90 disabled:opacity-50" title="A worker may be actively running this task — completing now abandons its in-flight output">
                      Worker may be active — confirm Done
                    </button>
                  ) : (
                    <button
                      onClick={() => (w.state === 'in_progress' && health[w.id] !== 'stale' ? setConfirmDone(w.id) : void act(w, 'complete'))}
                      disabled={busyAction !== null}
                      className="rounded border border-signal/40 px-2 py-1 font-medium text-signal hover:bg-signal/10 disabled:opacity-50"
                    >
                      Done
                    </button>
                  )}
                  {confirmStop === w.id ? (
                    <button onClick={() => void act(w, 'stop')} disabled={busyAction !== null} className="rounded bg-risk px-2 py-1 font-semibold text-canvas hover:bg-risk/90 disabled:opacity-50" title={health[w.id] !== 'stale' ? 'A worker may be actively running this task — stopping abandons its in-flight output' : undefined}>
                      {health[w.id] !== 'stale' && w.state === 'in_progress' ? 'Worker may be active — confirm stop' : 'Confirm stop'}
                    </button>
                  ) : (
                    <button onClick={() => setConfirmStop(w.id)} disabled={busyAction !== null} className="rounded border border-risk/40 px-2 py-1 font-medium text-risk hover:bg-risk/10 disabled:opacity-50">
                      Stop
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {completedRecently.length > 0 && (
          <div className="mt-4 border-t border-edge pt-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Completed in the last 24h</div>
            <ul className="mt-1.5 divide-y divide-edge/40">
              {completedRecently.map((w) => (
                <li key={w.id} className="flex items-center gap-3 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate text-ink-dim">{w.title}</span>
                  <span className="text-ink-faint">{agentName(s, w.ownerId ?? '')}</span>
                  <StateBadge label={w.state === 'complete' ? 'complete' : 'stopped'} tone={w.state === 'complete' ? 'ok' : 'neutral'} />
                  <span className="w-14 text-right text-ink-faint"><RelativeTime iso={w.updatedAt} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <SectionTitle right={<StateBadge label={`${s.cron.length} live job${s.cron.length === 1 ? '' : 's'}`} tone="signal" />}>Create scheduled AI work</SectionTitle>
        <p className="text-xs text-ink-dim">Jobs created here run on the real Hermes scheduler and appear in this calendar, the right rail, and Connections — same object, same store.</p>
        <div className="flex flex-wrap items-start gap-3">
          <NewCronForm onCreated={() => undefined} />
          {/* Dogfood 2026-08-29: one-off delegation lives beside scheduled work */}
          <button onClick={() => setNewDelegation(true)} className="rounded-lg border border-signal/40 px-4 py-2 text-sm font-medium text-signal hover:bg-signal/10">
            ＋ New delegated task
          </button>
        </div>
      </Card>
      {newDelegation && <NewDelegationDrawer onClose={() => setNewDelegation(false)} />}
      {inspectingCron && <CronInspector job={inspectingCron} onClose={() => setInspectingCron(null)} onChanged={() => setRailBump((b) => b + 1)} />}
    </div>
  );
}
