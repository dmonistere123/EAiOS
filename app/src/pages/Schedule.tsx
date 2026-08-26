/** Schedule — one time view: executive calendar + agent work + cron overlays. */
import { useMemo, useState } from 'react';
import { calendarEvents } from '../mocks/fixtures';
import { useRuntime } from '../state/runtime';
import { Card, SectionTitle, StateBadge, TimeUntil } from '../components/ui';

type Source = 'executive' | 'agent' | 'cron' | 'team';
const SOURCE_META: Record<Source, { label: string; dot: string; tone: 'signal' | 'warn' | 'ok' | 'neutral' }> = {
  executive: { label: 'My calendar', dot: 'bg-signal', tone: 'signal' },
  agent: { label: 'Agent schedules', dot: 'bg-secondary', tone: 'neutral' },
  cron: { label: 'Cron jobs', dot: 'bg-warn', tone: 'warn' },
  team: { label: 'Team', dot: 'bg-ok', tone: 'ok' },
};

export default function Schedule() {
  const s = useRuntime();
  const [enabled, setEnabled] = useState<Record<Source, boolean>>({ executive: true, agent: true, cron: true, team: false });

  const events = useMemo(
    () => calendarEvents.filter((e) => enabled[e.source]).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [enabled],
  );

  // Next 3 days, grouped by day.
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
          <p className="mt-1 text-sm text-ink-dim">Your meetings and your AI staff's planned work in one view.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(SOURCE_META) as Source[]).map((src) => (
            <label key={src} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-edge bg-canvas-raised px-2.5 py-1.5 text-xs text-ink-dim">
              <input
                type="checkbox"
                checked={enabled[src]}
                onChange={() => setEnabled((e) => ({ ...e, [src]: !e[src] }))}
                className="accent-[#32c5ff]"
              />
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
        <SectionTitle right={<StateBadge label="mock mode" tone="neutral" />}>Create scheduled AI work</SectionTitle>
        <p className="text-xs text-ink-dim">
          Cron jobs created here land in the same store as the right rail and Connections — {s.cron.length} job{s.cron.length === 1 ? '' : 's'} currently scheduled.
          In Phase 4 this form calls <code className="text-signal">cron.manage</code> on the live gateway.
        </p>
        <button className="mt-3 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90">New scheduled task</button>
      </Card>
    </div>
  );
}
