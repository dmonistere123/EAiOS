/**
 * AppShell — left nav / center workspace / right operational rail.
 * Both panes drag-resize (continuous, no text selection), double-click resets,
 * widths + collapse persist per user (localStorage eaios.panes.v1).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  selectActivityNewest, selectCronByNextRun, selectPendingApprovals, useRuntime, agentName,
} from '../state/runtime';
import { RelativeTime, RiskBadge, TimeUntil, ToastHost } from '../components/ui';

const LIMITS = { left: { min: 208, max: 360, def: 264 }, right: { min: 280, max: 440, def: 340 } };
const STORE_KEY = 'eaios.panes.v1';

interface PanePrefs {
  left: number;
  right: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

function loadPrefs(): PanePrefs {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { ...{ left: LIMITS.left.def, right: LIMITS.right.def, leftCollapsed: false, rightCollapsed: false }, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { left: LIMITS.left.def, right: LIMITS.right.def, leftCollapsed: false, rightCollapsed: false };
}

export function resetPanePrefs() {
  localStorage.removeItem(STORE_KEY);
  window.location.reload();
}

const NAV = [
  { to: '/today', label: 'Today', icon: '☀' },
  { to: '/assistant', label: 'My Assistant', icon: '◈' },
  { to: '/staff', label: 'Staff', icon: '⛁' },
  { to: '/connections', label: 'Connections', icon: '⬡' },
  { to: '/approvals', label: 'Approvals', icon: '✓' },
  { to: '/schedule', label: 'Schedule', icon: '▦' },
  { to: '/knowledge', label: 'Knowledge', icon: '❖' },
  { to: '/skills', label: 'Skills & Playbooks', icon: '⚒' },
  { to: '/artifacts', label: 'Artifacts', icon: '▤' },
  { to: '/usage', label: 'Usage', icon: '◔' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function useDrag(side: 'left' | 'right', width: number, setWidth: (n: number) => void) {
  const dragging = useRef(false);
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      document.body.classList.add('eaios-dragging');
      const startX = e.clientX;
      const startW = width;
      const lim = LIMITS[side];
      const move = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX;
        setWidth(Math.min(lim.max, Math.max(lim.min, startW + delta)));
      };
      const up = () => {
        dragging.current = false;
        document.body.classList.remove('eaios-dragging');
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    },
    [side, width, setWidth],
  );
  const onDoubleClick = useCallback(() => setWidth(LIMITS[side].def), [side, setWidth]);
  return { onMouseDown, onDoubleClick };
}

function DragHandle(props: { onMouseDown: (e: React.MouseEvent) => void; onDoubleClick: () => void; label: string }) {
  return (
    <div
      role="separator"
      aria-label={props.label}
      aria-orientation="vertical"
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onMouseDown={props.onMouseDown}
      onDoubleClick={props.onDoubleClick}
      className="group w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-signal/40 focus:bg-signal/60"
    />
  );
}

// ---------- right rail ----------

function RailSection({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="border-b border-edge px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{title}</h3>
        {typeof count === 'number' && <span className="rounded-full bg-canvas-overlay px-2 py-0.5 text-[11px] text-ink-dim">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function RightRail() {
  const s = useRuntime();
  const nav = useNavigate();
  const cron = selectCronByNextRun(s).slice(0, 5);
  const approvals = selectPendingApprovals(s).slice(0, 5);
  const activity = selectActivityNewest(s).slice(0, 9);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-edge px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Operational Watchtower</div>
      </div>

      <RailSection title="Next Cron Jobs" count={cron.length}>
        <ul className="space-y-1.5">
          {cron.map((c) => (
            <li key={c.id}>
              <button onClick={() => nav('/schedule')} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas-overlay">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink">{c.name}</span>
                  {c.lastResult === 'failed' && <span className="text-[10px] text-risk">last failed</span>}
                </div>
                <div className="mt-0.5 flex items-center justify-between text-[11px] text-ink-faint">
                  <span>{agentName(s, c.ownerAgentId)}</span>
                  <TimeUntil iso={c.nextRunAt} />
                </div>
              </button>
            </li>
          ))}
          {cron.length === 0 && <li className="px-2 text-xs text-ink-faint">No scheduled jobs.</li>}
        </ul>
      </RailSection>

      <RailSection title="Awaiting Approval" count={approvals.length}>
        <ul className="space-y-1.5">
          {approvals.map((a) => (
            <li key={a.id}>
              <button onClick={() => nav(`/approvals?focus=${a.id}`)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-canvas-overlay">
                <div className="truncate text-xs font-medium text-ink">{a.targetObject ?? a.targetSystem}</div>
                <div className="mt-1 flex items-center justify-between">
                  <RiskBadge risk={a.risk} />
                  <span className="text-[11px] text-ink-faint"><RelativeTime iso={a.submittedAt} /></span>
                </div>
              </button>
            </li>
          ))}
          {approvals.length === 0 && <li className="px-2 text-xs text-ok">All clear — nothing waiting on you.</li>}
        </ul>
      </RailSection>

      <RailSection title="Activity Ledger">
        <ul className="space-y-1.5">
          {activity.map((e) => (
            <li key={e.id} className="rounded-lg px-2 py-1.5">
              <div className="flex items-start gap-2">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${e.severity === 'error' ? 'bg-risk' : e.severity === 'warning' ? 'bg-warn' : 'bg-signal/60'}`} aria-hidden />
                <div className="min-w-0">
                  <div className="truncate text-xs text-ink-dim">{e.action}</div>
                  <div className="text-[11px] text-ink-faint">
                    {agentName(s, e.agentId)} · <RelativeTime iso={e.occurredAt} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </RailSection>
    </div>
  );
}

// ---------- shell ----------

export default function AppShell() {
  const [prefs, setPrefs] = useState<PanePrefs>(loadPrefs);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < 1024);
  const s = useRuntime();

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
  }, [prefs]);

  const setLeft = useCallback((left: number) => setPrefs((p) => ({ ...p, left })), []);
  const setRight = useCallback((right: number) => setPrefs((p) => ({ ...p, right })), []);
  const leftDrag = useDrag('left', prefs.left, setLeft);
  const rightDrag = useDrag('right', prefs.right, setRight);

  const leftWidth = prefs.leftCollapsed ? 64 : isNarrow ? LIMITS.left.min : prefs.left;
  const showRail = !isNarrow && !prefs.rightCollapsed;
  const pending = selectPendingApprovals(s).length;

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      {/* top strip */}
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-edge px-4">
        <div className="flex items-center gap-2">
          <span className="text-base font-bold tracking-tight text-signal">EAiOS</span>
          <span className="hidden text-xs text-ink-faint md:inline">Executive AI Operating System</span>
        </div>
        <div className="mx-auto w-full max-w-md">
          <input
            type="search"
            placeholder="Search work, agents, artifacts…"
            aria-label="Global search"
            className="w-full rounded-lg border border-edge bg-canvas-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint focus:border-signal/50"
          />
        </div>
        <button className="relative rounded-lg p-2 hover:bg-canvas-overlay" aria-label="Notifications">
          <span aria-hidden>🔔</span>
          {pending > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-warn" aria-label={`${pending} pending approvals`} />}
        </button>
        <div className="flex items-center gap-2 rounded-lg border border-edge bg-canvas-raised px-3 py-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-signal/20 text-xs font-semibold text-signal">DM</span>
          <span className="hidden text-xs text-ink-dim lg:inline">Don M. — CEO</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* left nav */}
        <nav aria-label="Primary" style={{ width: leftWidth }} className="flex shrink-0 flex-col border-r border-edge bg-canvas-raised transition-[width] duration-75">
          <div className="flex-1 overflow-y-auto py-3">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                title={n.label}
                className={({ isActive }) =>
                  `mx-2 mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                    isActive ? 'bg-signal/15 font-medium text-signal' : 'text-ink-dim hover:bg-canvas-overlay hover:text-ink'
                  }`
                }
              >
                <span aria-hidden className="w-4 text-center">{n.icon}</span>
                {!prefs.leftCollapsed && <span className="truncate">{n.label}</span>}
                {!prefs.leftCollapsed && n.to === '/approvals' && pending > 0 && (
                  <span className="ml-auto rounded-full bg-warn/20 px-2 text-[11px] text-warn">{pending}</span>
                )}
              </NavLink>
            ))}
          </div>
          <button
            onClick={() => setPrefs((p) => ({ ...p, leftCollapsed: !p.leftCollapsed }))}
            className="mx-2 mb-3 rounded-lg border border-edge px-3 py-1.5 text-xs text-ink-dim hover:bg-canvas-overlay"
          >
            {prefs.leftCollapsed ? '»' : '« Collapse'}
          </button>
        </nav>

        {!prefs.leftCollapsed && !isNarrow && <DragHandle {...leftDrag} label="Resize navigation pane" />}

        {/* center */}
        <main className="min-w-0 flex-1 overflow-y-auto" id="main">
          <div className="mx-auto max-w-6xl px-6 py-6">
            <Outlet />
          </div>
        </main>

        {/* right rail */}
        {showRail && <DragHandle {...rightDrag} label="Resize operational rail" />}
        {showRail && (
          <aside aria-label="Operational watchtower" style={{ width: prefs.right }} className="shrink-0 border-l border-edge bg-canvas-raised transition-[width] duration-75">
            <RightRail />
          </aside>
        )}
        {!showRail && !isNarrow && (
          <button
            onClick={() => setPrefs((p) => ({ ...p, rightCollapsed: false }))}
            className="w-8 shrink-0 border-l border-edge text-ink-faint hover:bg-canvas-overlay hover:text-signal"
            aria-label="Show operational rail"
            title="Show operational rail"
          >
            «
          </button>
        )}
        {!isNarrow && showRail && (
          <button
            onClick={() => setPrefs((p) => ({ ...p, rightCollapsed: true }))}
            className="fixed bottom-3 text-[10px] text-ink-faint hover:text-ink-dim"
            style={{ right: 4 }}
          >
            hide rail »
          </button>
        )}
      </div>
      <ToastHost />
    </div>
  );
}
