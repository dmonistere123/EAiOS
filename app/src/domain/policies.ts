/**
 * Approval policy engine (spec §9) — pages and agents ask this layer whether
 * an intended action can execute immediately, requires approval, or is denied.
 * Implemented as pure functions, not page-specific if-statements.
 *
 * Default governance posture (spec §9.1): conservative external-write default
 * until workspace policy is defined (D3).
 */
import type { Approval, PolicyInput, PolicyResult, RiskLevel } from './types';

export interface WorkspacePolicy {
  /** connector/action pairs explicitly pre-approved for unattended runs */
  preApproved: { connectorId?: string; actionType: Approval['actionType']; targetSystem?: string }[];
  /** admin authorization held by the current user (single-executive default: true) */
  userIsAdmin: boolean;
}

export const DEFAULT_WORKSPACE_POLICY: WorkspacePolicy = {
  preApproved: [],
  userIsAdmin: true,
};

const POLICY_IDS = {
  read: 'pol.read.allow',
  internalDraft: 'pol.draft.allow',
  externalWrite: 'pol.external.require_approval',
  destructive: 'pol.destructive.require_approval_high',
  execute: 'pol.execute.require_approval',
  preApproved: 'pol.execute.preapproved',
  credential: 'pol.credential.deny_non_admin',
  envWrite: 'pol.env.explicit_save',
} as const;

const EXTERNAL_ACTIONS = new Set(['send', 'write', 'publish']);
const DESTRUCTIVE = new Set(['delete']);

function highestRisk(signals: string[] | undefined, base: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
  let idx = order.indexOf(base);
  for (const s of signals ?? []) {
    if (/payment|financial|legal|external_audience|mass_send/i.test(s)) idx = Math.max(idx, order.indexOf('high'));
    if (/irreversible|credential|production/i.test(s)) idx = Math.max(idx, order.indexOf('critical'));
  }
  return order[idx];
}

export function evaluateAction(input: PolicyInput, workspace: WorkspacePolicy = DEFAULT_WORKSPACE_POLICY): PolicyResult {
  const { actionType } = input;

  // Reads and retrieval: allow if permissions permit (enforced upstream); log material external calls.
  if (actionType === 'read') {
    return { decision: 'allow', policyId: POLICY_IDS.read };
  }

  // Explicitly pre-approved automations bypass the gate (spec §9.1 execute row).
  const pre = workspace.preApproved.find(
    (p) =>
      p.actionType === actionType &&
      (!p.connectorId || p.connectorId === input.connectorId) &&
      (!p.targetSystem || p.targetSystem === input.targetSystem),
  );
  if (pre) {
    return { decision: 'allow', policyId: POLICY_IDS.preApproved };
  }

  // Deletes and destructive updates: approval with high-risk treatment.
  if (DESTRUCTIVE.has(actionType)) {
    return { decision: 'require_approval', policyId: POLICY_IDS.destructive, risk: highestRisk(input.riskSignals, 'high') };
  }

  // External send/write/publish: require approval.
  if (EXTERNAL_ACTIONS.has(actionType)) {
    return { decision: 'require_approval', policyId: POLICY_IDS.externalWrite, risk: highestRisk(input.riskSignals, 'medium') };
  }

  // Execute / other operational actions: require approval unless pre-approved (handled above).
  if (actionType === 'execute' || actionType === 'other') {
    return { decision: 'require_approval', policyId: POLICY_IDS.execute, risk: highestRisk(input.riskSignals, 'medium') };
  }

  // Unknown action class: fail closed.
  return { decision: 'require_approval', policyId: 'pol.unknown.fail_closed', risk: 'high' };
}

/** Credential/scope changes are admin-only and never display secret material. */
export function evaluateCredentialChange(userIsAdmin: boolean): PolicyResult {
  return userIsAdmin
    ? { decision: 'require_approval', policyId: 'pol.credential.admin_review', risk: 'high' }
    : { decision: 'deny', policyId: POLICY_IDS.credential, reason: 'Credential and scope changes require administrator authorization.' };
}
