/**
 * Runtime store — single source of truth for agents, work, approvals, cron,
 * and activity. Pages AND the right rail read from here (spec §5.2: the rail
 * never invents separate copies of state). Hydrates from the adapter, then
 * applies live events from subscribeEvents.
 */
import { useSyncExternalStore } from 'react';
import type { Agent, Approval, CronJob, ActivityEvent, WorkItem } from '../domain/types';
import { hermes } from '../adapters/mock/MockHermesAdapter';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  message: string;
}

interface State {
  ready: boolean;
  agents: Agent[];
  work: WorkItem[];
  approvals: Approval[];
  cron: CronJob[];
  activity: ActivityEvent[];
  toasts: Toast[];
}

let state: State = {
  ready: false,
  agents: [],
  work: [],
  approvals: [],
  cron: [],
  activity: [],
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

export async function refreshApprovals() {
  set({ approvals: await hermes.listApprovals({ status: ['pending'] }) });
}

export async function refreshAgents() {
  set({ agents: await hermes.listAgents() });
}

export async function refreshWork() {
  set({ work: await hermes.listWorkItems() });
}

export async function refreshActivity() {
  set({ activity: await hermes.listActivity(60) });
}

export async function refreshCron() {
  set({ cron: await hermes.listCronJobs() });
}

export async function refreshAll() {
  await Promise.all([refreshAgents(), refreshWork(), refreshApprovals(), refreshCron(), refreshActivity()]);
}

// ---------- boot + live event wiring ----------

let started = false;

export function startRuntime() {
  if (started) return;
  started = true;
  void refreshAll().then(() => set({ ready: true }));
  hermes.subscribeEvents?.((evt) => {
    // Re-pull the slices each event type can touch — the mock adapter mutates
    // its store before emitting, and the live adapter will do the same.
    switch (evt.type) {
      case 'agent.started':
      case 'agent.progress':
      case 'agent.completed':
      case 'agent.failed':
      case 'agent.waiting':
        void refreshAgents();
        void refreshActivity();
        break;
      case 'work.created':
      case 'work.updated':
        void refreshWork();
        void refreshAgents();
        void refreshActivity();
        break;
      case 'approval.requested':
      case 'approval.decided':
        void refreshApprovals();
        void refreshActivity();
        break;
      case 'cron.started':
      case 'cron.completed':
      case 'cron.failed':
        void refreshCron();
        void refreshActivity();
        break;
      case 'config.changed':
        void refreshAgents();
        void refreshCron();
        void refreshActivity();
        break;
      default:
        void refreshActivity();
    }
  });
}

// ---------- selectors (contractual sorts — spec §7.1) ----------

export const selectCronByNextRun = (s: State) =>
  [...s.cron].filter((c) => c.enabled).sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt));

export const selectPendingApprovals = (s: State) =>
  s.approvals.filter((a) => a.status === 'pending').sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

export const selectActivityNewest = (s: State) =>
  [...s.activity].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

export const agentName = (s: State, id?: string) => s.agents.find((a) => a.id === id)?.name ?? '—';
