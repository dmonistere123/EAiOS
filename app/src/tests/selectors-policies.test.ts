/** Spec §14.1 — selector sorting + policy evaluator unit tests. */
import { describe, expect, it } from 'vitest';
import { selectActivityNewest, selectCronByNextRun, selectPendingApprovals } from '../state/runtime';
import type { Agent, Approval, CronJob, ActivityEvent, WorkItem } from '../domain/types';
import { evaluateAction, evaluateCredentialChange, DEFAULT_WORKSPACE_POLICY } from '../domain/policies';

type RuntimeState = Parameters<typeof selectCronByNextRun>[0];

const baseState = (): RuntimeState => ({
  ready: true,
  gateway: 'mock',
  degraded: [],
  agents: [] as Agent[],
  work: [] as WorkItem[],
  approvals: [] as Approval[],
  cron: [] as CronJob[],
  activity: [] as ActivityEvent[],
  skills: [],
  knowledge: [],
  playbooks: [],
  playbookRuns: [],
  usage: null,
  dailySpend: null,
  artifacts: [],
  toasts: [],
});

describe('right-rail selectors (spec §7.1)', () => {
  it('sorts cron jobs by nextRunAt ascending and drops disabled', () => {
    const s = baseState();
    s.cron = [
      { id: 'c2', name: 'later', scheduleExpression: '', nextRunAt: '2026-08-25T20:00:00Z', approvalPolicy: 'pre_approved', enabled: true },
      { id: 'c1', name: 'sooner', scheduleExpression: '', nextRunAt: '2026-08-25T18:00:00Z', approvalPolicy: 'pre_approved', enabled: true },
      { id: 'c3', name: 'disabled', scheduleExpression: '', nextRunAt: '2026-08-25T17:00:00Z', approvalPolicy: 'pre_approved', enabled: false },
    ];
    const out = selectCronByNextRun(s);
    expect(out.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('sorts pending approvals oldest first and filters non-pending', () => {
    const s = baseState();
    const mk = (id: string, status: Approval['status'], submittedAt: string): Approval => ({
      id, workItemId: 'w', requestedByAgentId: 'a', actionType: 'send', targetSystem: 'Gmail',
      risk: 'low', status, submittedAt, evidence: [],
    });
    s.approvals = [mk('a2', 'pending', '2026-08-25T10:00:00Z'), mk('a1', 'pending', '2026-08-25T08:00:00Z'), mk('a3', 'approved', '2026-08-25T07:00:00Z')];
    const out = selectPendingApprovals(s);
    expect(out.map((a) => a.id)).toEqual(['a1', 'a2']);
  });

  it('sorts activity newest first', () => {
    const s = baseState();
    const mk = (id: string, occurredAt: string): ActivityEvent => ({ id, type: 't', occurredAt, action: id });
    s.activity = [mk('e1', '2026-08-25T08:00:00Z'), mk('e2', '2026-08-25T12:00:00Z'), mk('e3', '2026-08-25T10:00:00Z')];
    expect(selectActivityNewest(s).map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
  });
});

describe('policy evaluator (spec §9)', () => {
  it('allows reads', () => {
    expect(evaluateAction({ actorAgentId: 'a', actionType: 'read', targetSystem: 'Gmail' }).decision).toBe('allow');
  });

  it('requires approval for external send/write/publish', () => {
    for (const actionType of ['send', 'write', 'publish'] as const) {
      const r = evaluateAction({ actorAgentId: 'a', actionType, targetSystem: 'Gmail' });
      expect(r.decision).toBe('require_approval');
    }
  });

  it('treats deletes as high-risk approvals', () => {
    const r = evaluateAction({ actorAgentId: 'a', actionType: 'delete', targetSystem: 'Drive' });
    expect(r).toMatchObject({ decision: 'require_approval', risk: 'high' });
  });

  it('honors pre-approved automation policies', () => {
    const ws = { ...DEFAULT_WORKSPACE_POLICY, preApproved: [{ actionType: 'execute' as const, connectorId: 'cn-01' }] };
    expect(evaluateAction({ actorAgentId: 'a', actionType: 'execute', connectorId: 'cn-01', targetSystem: 'X' }, ws).decision).toBe('allow');
    expect(evaluateAction({ actorAgentId: 'a', actionType: 'execute', connectorId: 'cn-99', targetSystem: 'X' }, ws).decision).toBe('require_approval');
  });

  it('escalates risk on risk signals', () => {
    const r = evaluateAction({ actorAgentId: 'a', actionType: 'send', targetSystem: 'Gmail', riskSignals: ['mass_send', 'external_audience'] });
    expect(r).toMatchObject({ risk: 'high' });
  });

  it('denies credential changes for non-admins', () => {
    expect(evaluateCredentialChange(false).decision).toBe('deny');
    expect(evaluateCredentialChange(true).decision).toBe('require_approval');
  });

  it('fails closed on unknown action classes', () => {
    const r = evaluateAction({ actorAgentId: 'a', actionType: 'teleport' as never, targetSystem: 'X' });
    expect(r.decision).toBe('require_approval');
  });
});
