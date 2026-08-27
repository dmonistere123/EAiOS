/**
 * Adapter contracts — from the build planner §6.
 * Page components NEVER import Hermes/Composio/calendar/RAG SDKs.
 * The only allowed dependency is this file. Mock and live adapters
 * implement the same interfaces so mock-mode and live-mode align.
 */
import type {
  Agent,
  Approval,
  ApprovalDecision,
  Artifact,
  AssistantEvent,
  AuditResult,
  ChatMessage,
  CronJob,
  EnvironmentFile,
  EnvironmentFileRef,
  RuntimeEvent,
  TodaySummary,
  UsageSummary,
  WorkItem,
  KnowledgeSource,
  Skill,
  Playbook,
  PlaybookRun,
} from '../domain/types';

export type Unsubscribe = () => void;

export interface WorkFilter {
  state?: WorkItem['state'][];
  ownerType?: WorkItem['ownerType'];
  delegationCandidate?: boolean;
}

export interface ApprovalFilter {
  status?: Approval['status'][];
  risk?: Approval['risk'][];
}

export interface ArtifactFilter {
  state?: Artifact['state'][];
  createdByAgentId?: string;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface AgentConfigPatch {
  model?: Agent['model'];
  tools?: Agent['tools'];
}

/** Provider-grouped model catalog entry (agent factory, 6.5). */
export interface ModelOptionGroup {
  slug: string;
  name: string;
  models: string[];
  authenticated: boolean;
}

export interface CreateAgent {
  /** lowercase slug, ^[a-z][a-z0-9-]*$ */
  name: string;
  /** one-line role — becomes the profile description */
  role: string;
  model: { provider: string; model: string };
  /** optional SOUL.md seed */
  soul?: string;
  /** optional source profile to clone */
  cloneFrom?: string;
}

export interface DelegationRequest {
  agentId?: string;
  playbookId?: string;
  note?: string;
}

export interface CreateCronJob {
  name: string;
  scheduleExpression: string;
  ownerAgentId?: string;
  connectorId?: string;
  actionRef?: string;
  approvalPolicy: CronJob['approvalPolicy'];
  /** Gateway delivery target, e.g. 'telegram:-100…' — empty = save only */
  deliver?: string;
}

export type CronJobPatch = Partial<Pick<CronJob, 'name' | 'scheduleExpression' | 'enabled' | 'approvalPolicy'>>;

export interface HermesAdapter {
  getTodaySummary(): Promise<TodaySummary>;
  listAgents(): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent>;
  updateAgentConfig(agentId: string, patch: AgentConfigPatch): Promise<AuditResult>;
  /** Live provider/model catalog, grouped by provider (agent factory). */
  listModelOptions(): Promise<ModelOptionGroup[]>;
  /** Spin up a new staff agent (profile). Config write — audited, no approval gate (D3). */
  createAgent(input: CreateAgent): Promise<AuditResult>;

  listWorkItems(filter?: WorkFilter): Promise<WorkItem[]>;
  delegateWork(workItemId: string, request: DelegationRequest): Promise<AuditResult>;

  listApprovals(filter?: ApprovalFilter): Promise<Approval[]>;
  decideApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult>;

  listCronJobs(): Promise<CronJob[]>;
  createCronJob(input: CreateCronJob): Promise<AuditResult>;
  updateCronJob(id: string, patch: CronJobPatch): Promise<AuditResult>;

  listActivity(limit?: number): Promise<import('../domain/types').ActivityEvent[]>;
  subscribeEvents?(handler: (event: RuntimeEvent) => void): Unsubscribe;

  listArtifacts(filter?: ArtifactFilter): Promise<Artifact[]>;
  /** Text preview of an artifact's content; null = unavailable (type, size, or fetch failure). */
  getArtifactPreview(id: string): Promise<string | null>;
  /** Governed share (§8.9): creates a pending approval — never sends directly. */
  shareArtifact(id: string): Promise<AuditResult>;
  getUsage(range: DateRange): Promise<UsageSummary>;
  /** Set (or clear, with null) the EAiOS-owned monthly usage budget (F15). */
  setUsageBudget(budgetUsd: number | null): Promise<AuditResult>;
  listSkills(): Promise<Skill[]>;

  listPlaybooks(): Promise<Playbook[]>;
  /**
   * Start a run: creates a kanban task (task mode) or swarm graph (swarm
   * mode) whose body carries the playbook instructions plus an
   * `eaios-playbook: <id>@v<version>` marker for history. Assigning to a
   * profile means the kanban dispatcher WILL execute it — external writes
   * still gate on approvals.
   */
  runPlaybook(playbookId: string, opts?: { assignee?: string }): Promise<AuditResult<PlaybookRun>>;
  listPlaybookRuns(playbookId?: string): Promise<PlaybookRun[]>;

  listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]>;
  readEnvironmentFile(id: string): Promise<EnvironmentFile>;
  writeEnvironmentFile(id: string, expectedVersion: string, content: string): Promise<AuditResult>;

  // ---------- Assistant chat (Phase 6.4a) ----------
  /** Authoritative conversation with Ally (hydrates the chat on load). */
  getAssistantHistory(): Promise<ChatMessage[]>;
  /** Send a message to Ally; her reply arrives via subscribeAssistant events. */
  sendAssistantMessage(text: string): Promise<AuditResult>;
  /** Streaming chat events for the EAiOS assistant session ONLY — other sessions' events never surface here. */
  subscribeAssistant(handler: (event: AssistantEvent) => void): Unsubscribe;
}

// ---------- Composio (mock until Phase 4) ----------

export interface Connection {
  id: string;
  appKey: string;
  appName: string;
  accountLabel?: string;
  state: 'connected' | 'degraded' | 'needs_reconnect' | 'disconnected';
  scopes: string[];
  hasWriteScope: boolean;
  lastVerifiedAt?: string;
  dependentCronJobIds: string[];
}

export interface ConnectionFlow {
  flowId: string;
  authUrl?: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  checkedAt: string;
  detail?: string;
}

export interface ConnectorAction {
  id: string;
  name: string;
  kind: 'read' | 'write' | 'execute';
}

export interface ConnectorScope {
  name: string;
  kind: 'read' | 'write';
}

export interface ComposioAdapter {
  listConnections(): Promise<Connection[]>;
  connectApp(appKey: string): Promise<ConnectionFlow>;
  disconnect(connectionId: string): Promise<AuditResult>;
  testConnection(connectionId: string): Promise<ConnectionTestResult>;
  listActions(connectionId: string): Promise<ConnectorAction[]>;
  listScopes(connectionId: string): Promise<ConnectorScope[]>;
}

// ---------- Knowledge (mock until Phase 5) ----------

export interface KnowledgeSourceInput {
  name: string;
  scope: KnowledgeSource['scope'];
  allowedAgentIds?: string[];
  citationEnabled: boolean;
}

/** One retrieved chunk from the knowledge index (sidecar /search). */
export interface KnowledgeSearchResult {
  chunkId: string; // 'k-xxxxxxxx:N' — the citation handle answers reference
  sourceId: string;
  sourceName: string;
  chunkIndex: number;
  snippet: string; // may contain « » highlight marks around matched terms
  score: number;
  citationEnabled: boolean;
}

/** Full chunk drill-down (sidecar /chunks/<id>). */
export interface KnowledgeChunk {
  chunkId: string;
  sourceId: string;
  sourceName: string;
  sourceUri?: string;
  scope: KnowledgeSource['scope'];
  chunkIndex: number;
  text: string;
  citationEnabled: boolean;
}

/**
 * Citation contract (Phase 5.3): an answer citing knowledge carries
 * EvidenceRef { kind: 'file'|'url', label: <sourceName>, uri: 'eaios://chunk/<chunkId>' }.
 * The uri resolves through getChunk for drill-down. getRetrievalEvidence
 * hydrates those refs once the Assistant page stores answer→chunk links.
 */
export interface KnowledgeAdapter {
  listSources(): Promise<KnowledgeSource[]>;
  uploadSource(file: File, metadata: KnowledgeSourceInput): Promise<KnowledgeSource>;
  addUrl(url: string, metadata: KnowledgeSourceInput): Promise<KnowledgeSource>;
  reindex(sourceId: string): Promise<AuditResult>;
  removeSource(sourceId: string): Promise<AuditResult>;
  searchKnowledge(query: string, limit?: number): Promise<KnowledgeSearchResult[]>;
  getChunk(chunkId: string): Promise<KnowledgeChunk>;
  getRetrievalEvidence(answerId: string): Promise<import('../domain/types').EvidenceRef[]>;
}

// ---------- Calendar (mock until Phase 4) ----------

export interface CalendarEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  source: 'executive' | 'agent' | 'cron' | 'team';
  refId?: string; // cron job id / work item id
}

export interface CalendarAdapter {
  listEvents(range: DateRange): Promise<CalendarEvent[]>;
}
