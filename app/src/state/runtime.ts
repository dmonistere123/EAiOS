/**
 * Runtime store — single source of truth for agents, work, approvals, cron,
 * and activity. Pages AND the right rail read from here (spec §5.2: the rail
 * never invents separate copies of state). Hydrates from the adapter, then
 * applies live events from subscribeEvents.
 */
import { useSyncExternalStore } from 'react';
import type { Agent, Approval, CronJob, ActivityEvent, WorkItem, Skill, KnowledgeSource, Playbook, PlaybookRun, UsageSummary, Artifact } from '../domain/types';
import { hermes, adapterMode, live, knowledge } from '../adapters';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  message: string;
}

interface State {
  ready: boolean;
  gateway: 'live' | 'mock' | 'offline';
  agents: Agent[];
  work: WorkItem[];
  approvals: Approval[];
  cron: CronJob[];
  activity: ActivityEvent[];
  skills: Skill[];
  knowledge: KnowledgeSource[];
  playbooks: Playbook[];
  playbookRuns: PlaybookRun[];
  usage: UsageSummary | null;
  artifacts: Artifact[];
  toasts: Toast[];
}

let state: State = {
  ready: false,
  gateway: 'mock',
  agents: [],
  work: [],
  approvals: [],
  cron: [],
  activity: [],
  skills: [],
  knowledge: [],
  playbooks: [],
  playbookRuns: [],
  usage: null,
  artifacts: [],
  toasts: [],
};

const listeners = new Set<() => void>();
let toastSeq = 1;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState() {
  return state;
}

export function useRuntime(): State {
  return useSyncExternalStore(subscribe, getState);
}

export function toast(kind: Toast['kind'], message: string) {
  const id = toastSeq++;
  set({ toasts: [...state.toasts, { id, kind, message }] });
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), 4200);
}

// ---------- refresh helpers (called after mutations) ----------

// Per-slice sequence guards: a slower stale read must never clobber a newer
// one (boot race: mock fallback resolving after the live read landed).
const seqs: Record<string, number> = {};

async function guarded<T>(key: string, fn: () => Promise<T>, apply: (v: T) => void) {
  const my = (seqs[key] = (seqs[key] ?? 0) + 1);
  const v = await fn();
  if (seqs[key] === my) apply(v);
}

export async function refreshApprovals() {
  await guarded('approvals', () => hermes.listApprovals({ status: ['pending'] }), (approvals) => set({ approvals }));
}

export async function refreshAgents() {
  await guarded('agents', () => hermes.listAgents(), (agents) => set({ agents }));
}

export async function refreshWork() {
  await guarded('work', () => hermes.listWorkItems(), (work) => set({ work }));
}

export async function refreshActivity() {
  await guarded('activity', () => hermes.listActivity(60), (activity) => set({ activity }));
}

export async function refreshCron() {
  await guarded('cron', () => hermes.listCronJobs(), (cron) => set({ cron }));
}

export async function refreshSkills() {
  await guarded('skills', () => hermes.listSkills(), (skills) => set({ skills }));
}

export async function refreshKnowledge() {
  await guarded('knowledge', () => knowledge.listSources(), (list) => set({ knowledge: list }));
}

export async function refreshPlaybooks() {
  await guarded('playbooks', () => hermes.listPlaybooks(), (playbooks) => set({ playbooks }));
}

export async function refreshPlaybookRuns() {
  await guarded('playbookRuns', () => hermes.listPlaybookRuns(), (playbookRuns) => set({ playbookRuns }));
}

/** Usage range: current month-to-date (matches the fixture's contract). */
export function usageRangeMonthToDate() {
  const now = new Date();
  return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: now.toISOString() };
}

export async function refreshUsage() {
  await guarded('usage', () => hermes.getUsage(usageRangeMonthToDate()), (usage) => set({ usage }));
}

export async function refreshArtifacts() {
  await guarded('artifacts', () => hermes.listArtifacts(), (artifacts) => set({ artifacts }));
}

export async function refreshAll() {
  // Per-slice tolerance: a failing slice must never take down the rest.
  await Promise.allSettled([refreshAgents(), refreshWork(), refreshApprovals(), refreshCron(), refreshActivity(), refreshSkills(), refreshKnowledge(), refreshPlaybooks(), refreshPlaybookRuns(), refreshUsage(), refreshArtifacts()]);
}

// ---------- boot + live event wiring ----------

let started = false;

export function startRuntime() {
  if (started) return;
  started = true;
  if (adapterMode === 'live') {
    set({ gateway: 'offline' });
    live.onConnectionChange((connected) => {
      set({ gateway: connected ? 'live' : 'offline' });
      if (connected) void refreshAll();
    });
    live.connect();
  }
  void refreshAll().then(() => set({ ready: true }));
  // Event-driven refresh, debounced (spec §15: meaningful event rendered
  // within ~1s). The gateway can emit bursts (e.g. sessions.changed storms);
  // a trailing debounce keeps refreshes cheap and ordered.
  let evtTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleEventRefresh = () => {
    clearTimeout(evtTimer);
    evtTimer = setTimeout(() => void refreshAll(), 800);
  };
  hermes.subscribeEvents?.(() => scheduleEventRefresh());
}

// ---------- selectors (contractual sorts — spec §7.1) ----------

export const selectCronByNextRun = (s: State) =>
  [...s.cron].filter((c) => c.enabled).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));

export const selectPendingApprovals = (s: State) =>
  s.approvals.filter((a) => a.status === 'pending').sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

export const selectActivityNewest = (s: State) =>
  [...s.activity].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

export const agentName = (s: State, id?: string) => s.agents.find((a) => a.id === id)?.name ?? '—';
