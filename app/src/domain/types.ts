/**
 * EAiOS domain model — verbatim from the build planner §5, §9, §10.1.
 * Mock adapters, live adapters, tests, and UI selectors all use these types.
 * Semantic objects are stable even if field details change when wired to Hermes.
 */
import type { TravelSearchParams, TravelSearchResult } from '../adapters/interfaces.ts';

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
  /** The agent's completion result (what was produced + where) — shown on completed rows (dogfood 2026-08-29). */
  result?: string;
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
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'expired' | 'blocked';
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
  /** What the job actually does (the agent prompt) — shown in the inspector (dogfood 2026-08-29). */
  prompt?: string;
  /** Delivery target, e.g. 'telegram:-100…'. */
  deliver?: string;
  /** Raw last-run status from the host (ok/error/…). */
  lastStatus?: string;
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

// ---------- Podcasts ----------

export type TtsProvider = 'edge' | 'elevenlabs' | 'openai';

export interface PodcastVoiceMap {
  host: string;
  guest: string;
}

export interface Podcast {
  id: string;
  sourceId?: string;
  sourceName: string;
  sourceType: 'knowledge_source' | 'file';
  status: 'pending' | 'processing' | 'ready' | 'failed';
  ttsModel?: TtsProvider;
  voiceMap?: PodcastVoiceMap;
  audioPath?: string;
  transcriptPath?: string;
  error?: string;
  createdAt: string;
  finishedAt?: string;
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
  enabled: boolean;
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

/** F29 daily spend estimate (EAiOS rate card, config/rate-card.json — shared
 * with the spend-watchdog cron). Fresh input+output only, cache excluded;
 * labeled estimate, never presented as provider billing. */
export interface DailySpendDay {
  date: string; // YYYY-MM-DD, server-local
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  overThreshold: boolean;
  topSessions: { sessionId: string; title: string; model: string; costUsd: number; inputTokens: number; outputTokens: number }[];
}

export interface DailySpendReport {
  thresholdUsd: number;
  estimatedWith: 'eaios-rate-card';
  days: DailySpendDay[];
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
  | 'approval.updated'
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

/** A delegated task execution, joined to its kanban worker session (Don
 * 2026-08-29: "delegated runs should show as sessions in the rail"). The
 * worker session is deny-listed from session.list (source='kanban'), but
 * resume+history works — workerSessionId unlocks the real transcript. */
export interface DelegatedRun {
  taskId: string;
  title: string;
  assignee: string; // profile name ('default' = Ally)
  status: string; // kanban status (ready/running/done/blocked/…)
  result?: string;
  createdAt: string;
  completedAt?: string;
  workerSessionId?: string;
  workerMessageCount?: number;
}

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

// ---------- Travel (F31) ----------

export type TravelBookingKind = 'flight' | 'hotel' | 'car' | 'restaurant';
export type TravelBookingStatus = 'proposed' | 'confirmed' | 'cancelled';

interface TravelBookingBase {
  id: string;
  tripId: string;
  kind: TravelBookingKind;
  status: TravelBookingStatus;
  provider: string;
  confirmationNumber?: string;
  costUsd?: number;
  externalUrl?: string;
}

export interface TravelFlight extends TravelBookingBase {
  kind: 'flight';
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureAt: string;
  arrivalAt: string;
  cabin: string;
}

export interface TravelHotel extends TravelBookingBase {
  kind: 'hotel';
  hotelName: string;
  checkIn: string;
  checkOut: string;
  roomType: string;
  address?: string;
}

export interface TravelCar extends TravelBookingBase {
  kind: 'car';
  company: string;
  carType: string;
  pickupLocation: string;
  dropoffLocation: string;
  pickupAt: string;
  dropoffAt: string;
}

export interface TravelRestaurant extends TravelBookingBase {
  kind: 'restaurant';
  restaurantName: string;
  cuisine?: string;
  reservationAt: string;
  partySize: number;
  address?: string;
}

export type TravelBooking = TravelFlight | TravelHotel | TravelCar | TravelRestaurant;

export interface TravelApproval {
  id: string;
  tripId: string;
  bookingId?: string;
  /** Original search result id, used to replay the offer during booking execution. */
  resultId?: string;
  actionType: 'book' | 'cancel' | 'other';
  targetSystem: 'duffel' | 'opentable' | 'other';
  targetObject?: string;
  risk: RiskLevel;
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested';
  submittedAt: string;
  payload?: string;
}

export interface TravelTrip {
  id: string;
  name: string;
  destination: string;
  startsAt: string;
  endsAt: string;
  status: 'planning' | 'upcoming' | 'active' | 'past' | 'cancelled';
  bookings: TravelBooking[];
  approvals: TravelApproval[];
}

export interface TravelAgentResult {
  /** Natural language summary of the search outcome. */
  summary: string;
  /** The search kind that was executed (null if the query wasn't a travel search). */
  kind: TravelSearchParams['kind'] | null;
  /** The parsed search parameters used. */
  params: TravelSearchParams | null;
  /** Search results matching the query. */
  results: TravelSearchResult[];
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

// ---------- Version / update path ----------

export interface BuildVersion {
  version: string;
  gitSha: string;
  gitBranch: string;
  gitTag?: string;
  releaseChannel?: 'stable' | 'rc' | 'dev';
  dirty?: boolean;
  builtAt: string;
}

export interface UpdateLogEntry {
  id: number;
  startedAt: string;
  finishedAt?: string;
  oldGitSha?: string;
  newGitSha?: string;
  oldVersion?: string;
  newVersion?: string;
  success: boolean;
  errorMessage?: string;
}

export interface VersionInfo {
  current: BuildVersion;
  log: UpdateLogEntry[];
}
