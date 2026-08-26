/** Shared presentational components — executive-grade, summary first. */
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { AgentStatus, RiskLevel, WorkItem } from '../domain/types';
import { useRuntime } from '../state/runtime';

// ---------- badges (status never by color alone — always icon + label) ----------

const statusStyle: Record<AgentStatus, { dot: string; label: string; pulse?: boolean }> = {
  idle: { dot: 'bg-ink-faint', label: 'Idle' },
  queued: { dot: 'bg-warn', label: 'Queued' },
  working: { dot: 'bg-signal', label: 'Working', pulse: true },
  waiting_approval: { dot: 'bg-warn', label: 'Awaiting approval' },
  waiting_dependency: { dot: 'bg-warn', label: 'Waiting' },
  completed: { dot: 'bg-ok', label: 'Completed' },
  failed: { dot: 'bg-risk', label: 'Failed' },
  offline: { dot: 'bg-risk', label: 'Offline' },
};

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const s = statusStyle[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-dim">
      <span className={`h-2 w-2 rounded-full ${s.dot} ${s.pulse ? 'animate-pulse' : ''}`} aria-hidden />
      {s.label}
    </span>
  );
}

const prioStyle: Record<WorkItem['priority'], string> = {
  critical: 'bg-risk/15 text-risk border-risk/30',
  high: 'bg-warn/15 text-warn border-warn/30',
  medium: 'bg-signal/10 text-signal border-signal/25',
  low: 'bg-ink-faint/10 text-ink-dim border-edge',
};

export function PriorityBadge({ priority }: { priority: WorkItem['priority'] }) {
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${prioStyle[priority]}`}>
      {priority}
    </span>
  );
}

const riskStyle: Record<RiskLevel, string> = prioStyle;

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${riskStyle[risk]}`}>
      {risk} risk
    </span>
  );
}

export function StateBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'ok' | 'warn' | 'risk' | 'signal' }) {
  const tones = {
    neutral: 'bg-ink-faint/10 text-ink-dim border-edge',
    ok: 'bg-ok/15 text-ok border-ok/30',
    warn: 'bg-warn/15 text-warn border-warn/30',
    risk: 'bg-risk/15 text-risk border-risk/30',
    signal: 'bg-signal/10 text-signal border-signal/25',
  } as const;
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}>{label}</span>;
}

// ---------- cards ----------

export function KpiCard({ label, value, hint, tone = 'signal' }: { label: string; value: ReactNode; hint?: string; tone?: 'signal' | 'warn' | 'ok' | 'risk' }) {
  const toneText = { signal: 'text-signal', warn: 'text-warn', ok: 'text-ok', risk: 'text-risk' }[tone];
  return (
    <div className="rounded-xl border border-edge bg-canvas-raised p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`mt-2 text-3xl font-semibold ${toneText}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-dim">{hint}</div>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-edge bg-canvas-raised ${className}`}>{children}</div>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold tracking-wide text-ink">{children}</h2>
      {right}
    </div>
  );
}

// ---------- progress ----------

export function IndeterminateBar() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-canvas-overlay" role="progressbar" aria-label="Working">
      <div className="h-full w-1/3 animate-[eaios-slide_1.4s_ease-in-out_infinite] rounded-full bg-signal" />
      <style>{`@keyframes eaios-slide{0%{transform:translateX(-100%)}100%{transform:translateX(400%)}}`}</style>
    </div>
  );
}

// ---------- time ----------

export function RelativeTime({ iso }: { iso?: string }) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return <span className="text-ink-faint">—</span>;
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  const text = s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
  return <span title={new Date(iso).toLocaleString()}>{text}</span>;
}

export function TimeUntil({ iso }: { iso: string }) {
  const ms = new Date(iso).getTime() - Date.now();
  const m = Math.round(ms / 60000);
  const text = m <= 0 ? 'now' : m < 60 ? `in ${m}m` : m < 1440 ? `in ${Math.round(m / 60)}h` : `in ${Math.round(m / 1440)}d`;
  return <span title={new Date(iso).toLocaleString()}>{text}</span>;
}

// ---------- empty state ----------

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-edge py-12 text-center">
      <div className="text-sm font-medium text-ink-dim">{title}</div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}

// ---------- drawer ----------

export function Drawer({ title, onClose, children, width = 420 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="absolute right-0 top-0 flex h-full flex-col border-l border-edge bg-canvas-raised shadow-2xl" style={{ width }}>
        <div className="flex items-center justify-between border-b border-edge px-5 py-4">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-ink-dim hover:bg-canvas-overlay hover:text-ink" aria-label="Close">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

// ---------- toasts ----------

export function ToastHost() {
  const { toasts } = useRuntime();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-xl backdrop-blur ${
            t.kind === 'ok' ? 'border-ok/40 bg-ok/10 text-ok' : t.kind === 'error' ? 'border-risk/40 bg-risk/10 text-risk' : 'border-edge bg-canvas-overlay text-ink'
          }`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
