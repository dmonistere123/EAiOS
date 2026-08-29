/**
 * EAiOS domain model — verbatim from the build planner §5, §9, §10.1.
 * Mock adapters, live adapters, tests, and UI selectors all use these types.
 * Semantic objects are stable even if field details change when wired to Hermes.
 */

// ---------- Agents (Staff = AI agents, never human users) ----------

export type AgentStatus =
  | 'idle'
  | 'queued'
  | 'working'
  | 'waiting_approval'
  | 'waiting_dependency'
  | 'completed'
  | 'failed'
  | 'offline';

export interface ModelRef {
  provider: string;
  model: string;
  version?: string;
}

export interface ToolRef {
  id: string;
  name: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  reportsToAgentId?: string; // Staff normally report to Ally
  model: ModelRef;
  availableModels: ModelRef[];
  tools: ToolRef[];
  status: AgentStatus;
  progress?: number; // 0..100 when meaningful; otherwise use indeterminate
  currentWorkItemId?: string;
  lastActivityAt?: string;
  health?: 'healthy' | 'degraded' | 'unknown';
}

// ---------- Work items ----------

export type WorkState =
  | 'new'
  | 'ready'
  | 'delegated'
  | 'in_progress'
  | 'waiting_approval'
  | 'blocked'
  | 'complete'
  | 'cancelled';

export interface SourceRef {
  kind: 'email' | 'meeting' | 'message' | 'document' | 'manual' | 'agent';
  label: string;
  uri?: string;
}

export interface WorkItem {
  id: string;
  title: string;
  summary?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  ownerType: 'executive' | 'agent';
  ownerId?: string;
  state: WorkState;
  dueAt?: string;
  delegationCandidate?: boolean;
  sourceRefs?: SourceRef[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Approvals ----------

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface EvidenceRef {
  kind: 'file' | 'url' | 'artifact' | 'message' | 'diff';
  label: string;
  uri?: string;
}

export interface Approval {
  id: string;
  workItemId: string;
  requestedByAgentId: string;
  actionType: 'send' | 'write' | 'publish' | 'execute' | 'delete' | 'other';
  targetSystem: string;
  targetObject?: string;
  risk: RiskLevel;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'expired';
  submittedAt: string;
  evidence: EvidenceRef[];
  proposedDiff?: string;
  rollbackPlan?: string;
  /** The fully-prepared action content (e.g. To/Subject/Body) — what the executor sends and what the executive reviews (dogfood 2026-08-29). */
  payload?: string;
  expiresAt?: string;
}

export interface ApprovalDecision {
  decision: 'approved' | 'rejected' | 'changes_requested';
  note?: string;
}

// ---------- Cron ----------

export interface CronJob {
  id: string;
  name: string;
  scheduleExpression: string; // storage format verified with Hermes
  nextRunAt: string;
  ownerAgentId?: string;
  connectorId?: string;
  actionRef?: string;
  approvalPolicy: 'pre_approved' | 'approval_on_result' | 'always_approve';
  lastResult?: 'success' | 'failed' | 'skipped';
  enabled: boolean;
}

// ---------- Activity ledger ----------

export interface ActivityEvent {
  id: string;
  type: string;
  occurredAt: string;
  agentId?: string;
  workItemId?: string;
  action: string;
  target?: string;
  result?: string;
  severity?: 'info' | 'warning' | 'error';
  auditRef?: string;
}

// ---------- Knowledge ----------

export interface KnowledgeSource {
  id: string;
  type: 'file' | 'url' | 'connector' | 'transcript' | 'text';
  name: string;
  uri?: string;
  scope: 'private' | 'workspace' | 'agent';
  allowedAgentIds?: string[];
  indexingStatus: 'pending' | 'processing' | 'ready' | 'failed' | 'stale';
  /** extraction/indexing error detail when indexingStatus === 'failed' */
  error?: string;
  freshnessAt?: string;
  citationEnabled: boolean;
}

// ---------- Skills ----------

export interface Skill {
  id: string; // skill name (unique)
  name: string;
  category: string;
  description?: string;
  version?: string;
  status: 'enabled' | 'disabled';
}

// ---------- Playbooks ----------

export interface Playbook {
  id: string; // file slug, e.g. 'weekly-investor-update'
  name: string;
  description: string;
  version: string;
  status: 'draft' | 'published';
  ownerAgentId?: string;
  mode: 'task' | 'swarm';
  /** default profile to run as; undefined = executive chooses at run time */
  assignee?: string;
  body: string; // workflow instructions (markdown)
  skills: string[];
  /** swarm mode only */
  workers?: string[];
  verifier?: string;
  synthesizer?: string;
}

export interface PlaybookRun {
  id: string; // kanban task id
  playbookId: string;
  playbookVersion: string;
  title: string;
  assignee?: string;
  state: WorkItem['state'];
  createdAt: string;
  completedAt?: string;
  result?: string;
}

// ---------- Artifacts ----------

export interface Artifact {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
  createdAt: string;
  createdByAgentId: string;
  workItemId?: string;
  approvalId?: string;
  state: 'draft' | 'ready' | 'approved' | 'shared' | 'archived';
  previewAvailable?: boolean;
}

// ---------- Usage ----------

export interface UsageRecord {
  id: string;
  agentId: string;
  modelId: string;
  workItemId?: string;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  occurredAt: string;
}

export interface UsageSummary {
  rangeLabel: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number; // undefined = not provided; never invent
  costIsAuthoritative: boolean;
  budgetUsd?: number;
  byAgent: { agentId: string; inputTokens: number; outputTokens: number; costUsd?: number }[];
  freshnessAt: string;
}

// ---------- Today ----------

export interface TodaySummary {
  greeting: string;
  date: string;
  executivePriorities: number;
  delegatableCount: number;
  approvalsWaiting: number;
  nextMeetingAt?: string;
  nextMeetingLabel?: string;
  headline?: string;
}

// ---------- Runtime events (spec §4.4) ----------

export type RuntimeEventType =
  | 'work.created'
  | 'work.updated'
  | 'agent.started'
  | 'agent.progress'
  | 'agent.waiting'
  | 'agent.completed'
  | 'agent.failed'
  | 'approval.requested'
  | 'approval.decided'
  | 'connector.called'
  | 'cron.started'
  | 'cron.completed'
  | 'cron.failed'
  | 'artifact.created'
  | 'config.changed';

export interface RuntimeEvent {
  id: string;
  type: RuntimeEventType;
  occurredAt: string;
  agentId?: string;
  workItemId?: string;
  payload?: Record<string, unknown>;
}

// ---------- Policy engine (spec §9) ----------

export type PolicyResult =
  | { decision: 'allow'; policyId: string }
  | { decision: 'require_approval'; policyId: string; risk: RiskLevel }
  | { decision: 'deny'; policyId: string; reason: string };

export interface PolicyInput {
  actorAgentId: string;
  actionType: Approval['actionType'] | 'read';
  connectorId?: string;
  targetSystem: string;
  targetObject?: string;
  riskSignals?: string[];
}

// ---------- Write contract (spec §10.1) ----------

export interface AuditResult<T = unknown> {
  ok: boolean;
  data?: T;
  auditEventId: string;
  /** Newly created entity id when the action creates one (e.g. kanban task). */
  id?: string;
  newVersion?: string;
  error?: {
    code: string;
    safeMessage: string;
    retryable: boolean;
  };
}

// ---------- Assistant chat (spec §8.2, Phase 6.4) ----------

export interface ChatMessage {
  id: string; // history row_id, or synthetic for optimistic/streaming rows
  role: 'you' | 'ally';
  text: string;
  at: string; // ISO
}

export type AssistantEvent =
  | { kind: 'start' }
  | { kind: 'delta'; text: string }
  | { kind: 'complete'; text: string }
  | { kind: 'error'; message: string };

// ---------- Assistant: sessions + channel views (W1, D-B1/D-B2) ----------

/** A durable session of a profile, from session.list (all sources; the
 * gateway deny-lists kanban/tool). No last_activity_at on the RPC row —
 * the list arrives last-active-first, startedAt is the only timestamp. */
export interface AssistantSessionRef {
  id: string; // stored (durable) session id — the resume handle
  title: string;
  preview: string;
  startedAt: string; // ISO
  messageCount: number;
  source: string; // desktop | telegram | cli | cron | …
}

/** Read-only channel view for a staff agent (D-B1: the user never chats
 * with the agent directly — they see what Ally delegated and the
 * Ally↔agent chat). */
export interface AgentChannel {
  delegations: WorkItem[];
  /** Ally↔agent chat (canonical per-profile "Bot Chat" session); null = none exists yet. */
  agentChat: ChatMessage[] | null;
}

// ---------- Environment files (spec §8.11) ----------

export interface EnvironmentFileRef {
  id: string;
  name: string;
  path: string;
  lastModifiedAt?: string; // optional: the live RPC surface has no mtime source
}

export interface EnvironmentFile {
  ref: EnvironmentFileRef;
  content: string;
  version: string; // content hash — used as expectedVersion on save
}
