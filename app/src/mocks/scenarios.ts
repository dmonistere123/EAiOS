/**
 * Required mock scenarios S1–S10 (spec §13 — "mocks are not filler; they are
 * acceptance fixtures"). Named states load into the mock adapter via
 * `__loadFixture`. S2/S6/S7/S8 ride the DEFAULT fixtures (they were built to
 * those scenarios); S9/S10 are behavioral (CAS conflict / socket recovery)
 * and need no state.
 */
import * as fx from './fixtures';
import type { Agent, Approval, WorkItem } from '../domain/types';

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const min = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

export interface ScenarioState {
  agents?: Agent[];
  work?: WorkItem[];
  approvals?: Approval[];
}

/** S1 Quiet Morning — 2 executive priorities, no approvals, all agents idle. */
const S1: ScenarioState = {
  agents: clone(fx.agents).map((a: Agent) => ({ ...a, status: 'idle' as const, currentWorkItemId: undefined, lastActivityAt: min(90) })),
  work: [
    { id: 's1-1', title: 'Read the board pre-read', priority: 'medium', ownerType: 'executive', state: 'ready', createdAt: min(120), updatedAt: min(60) },
    { id: 's1-2', title: 'Sign off on August invoice batch', priority: 'low', ownerType: 'executive', state: 'ready', createdAt: min(100), updatedAt: min(50) },
  ],
  approvals: [],
};

/** S3 Agent in Motion — one researcher working with recent events (indeterminate by design, D5). */
const S3: ScenarioState = {
  agents: clone(fx.agents).map((a: Agent) =>
    a.id === 'scout' ? { ...a, status: 'working' as const, currentWorkItemId: 's3-1', lastActivityAt: min(1) } : { ...a, status: 'idle' as const, currentWorkItemId: undefined },
  ),
  work: [{ id: 's3-1', title: 'Market scan: AI ops tooling', priority: 'medium', ownerType: 'agent', ownerId: 'scout', state: 'in_progress', createdAt: min(20), updatedAt: min(1) }],
  approvals: [],
};

/** S4 Agent Lag — working 8 minutes, no event for 4 minutes. */
const S4: ScenarioState = {
  agents: clone(fx.agents).map((a: Agent) =>
    a.id === 'scout' ? { ...a, status: 'working' as const, currentWorkItemId: 's4-1', lastActivityAt: min(8) } : { ...a, status: 'idle' as const, currentWorkItemId: undefined },
  ),
  work: [{ id: 's4-1', title: 'Deep dive: competitor pricing model', priority: 'high', ownerType: 'agent', ownerId: 'scout', state: 'in_progress', createdAt: min(30), updatedAt: min(8) }],
  approvals: [],
};

/** S5 Approval Backlog — 5 approvals, varying age/risk/target (sort + filter + inspector). */
const S5: ScenarioState = {
  approvals: [
    { id: 's5-1', workItemId: 'w-x1', requestedByAgentId: 'quill', actionType: 'send', targetSystem: 'Mailchimp', targetObject: 'September newsletter', risk: 'medium', status: 'pending', submittedAt: min(10), evidence: [{ kind: 'artifact', label: 'Newsletter draft' }] },
    { id: 's5-2', workItemId: 'w-x2', requestedByAgentId: 'ally', actionType: 'send', targetSystem: 'Gmail', targetObject: 'Investor update — 14 recipients', risk: 'critical', status: 'pending', submittedAt: min(40), evidence: [{ kind: 'artifact', label: 'Investor email draft' }] },
    { id: 's5-3', workItemId: 'w-x3', requestedByAgentId: 'quill', actionType: 'publish', targetSystem: 'WordPress', targetObject: 'Partnership announcement', risk: 'high', status: 'pending', submittedAt: min(180), evidence: [{ kind: 'artifact', label: 'Draft v3 (final)' }] },
    { id: 's5-4', workItemId: 'w-x4', requestedByAgentId: 'ledger', actionType: 'delete', targetSystem: 'Sheets', targetObject: 'Stale expense rows (Q2)', risk: 'low', status: 'pending', submittedAt: min(60 * 20), evidence: [{ kind: 'file', label: 'Anomaly report' }] },
    { id: 's5-5', workItemId: 'w-x5', requestedByAgentId: 'scout', actionType: 'publish', targetSystem: 'X', targetObject: 'Market scan teaser thread', risk: 'medium', status: 'pending', submittedAt: min(60 * 26), evidence: [{ kind: 'message', label: 'Draft thread' }] },
  ],
};

export const SCENARIOS = { S1, S3, S4, S5 } as const;
export type ScenarioId = keyof typeof SCENARIOS;
