/**
 * Adapter contracts — from the build planner §6.
 * Page components NEVER import Hermes/Composio/calendar/RAG SDKs.
 * The only allowed dependency is this file. Mock and live adapters
 * implement the same interfaces so mock-mode and live-mode align.
 */
import type {
  Agent,
  AgentChannel,
  Approval,
  ApprovalDecision,
  Artifact,
  AssistantEvent,
  AssistantSessionRef,
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
  /** Role line — profiles.configure description. */
  description?: string;
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

/** Playbook create/edit payload (W7). Version is SERVER-side — never client-picked. */
export interface PlaybookInput {
  /** existing file slug for edits; omitted = create (slug derived from name) */
  id?: string;
  name: string;
  description: string;
  status: Playbook['status'];
  mode: Playbook['mode'];
  assignee?: string;
  ownerAgentId?: string;
  skills: string[];
  workers?: string[];
  verifier?: string;
  synthesizer?: string;
  body: string;
}

/** New user-local skill (W7). Create-only — overwrite refused. */
export interface CreateSkill {
  /** lowercase slug, ^[a-z][a-z0-9-]*$ */
  name: string;
  category: string;
  description: string;
  body: string;
}

/** On-the-fly task delegation (dogfood 2026-08-29): create a kanban task from Today/Schedule. */
export interface CreateWorkItem {
  title: string;
  summary?: string;
  priority?: WorkItem['priority'];
  /** Assignee profile id; omitted = unassigned ("potential delegation" — sits in the executive queue). */
  agentId?: string;
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

export type CronJobPatch = Partial<Pick<CronJob, 'name' | 'scheduleExpression' | 'enabled' | 'approvalPolicy' | 'prompt' | 'deliver'>>;

/** Work-item lifecycle actions (dogfood 2026-08-29): dynamic kanban control from Schedule. */
export type WorkItemAction = 'pause' | 'resume' | 'complete' | 'stop' | 'defer' | 'reclaim';

export interface HermesAdapter {
  getTodaySummary(): Promise<TodaySummary>;
  listAgents(): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent>;
  updateAgentConfig(agentId: string, patch: AgentConfigPatch): Promise<AuditResult>;
  /** Live provider/model catalog, grouped by provider (agent factory). */
  listModelOptions(): Promise<ModelOptionGroup[]>;
  /** Spin up a new staff agent (profile). Config write — audited, no approval gate (D3). */
  createAgent(input: CreateAgent): Promise<AuditResult>;
  /** Telegram bot binding: EXISTENCE only — token values are never returned (dogfood 2026-08-29). */
  getTelegramBotStatus(profile: string): Promise<{ bound: boolean }>;
  /** Bind a bot token to a profile: allowlisted .env write server-side (chmod 600, never read back). */
  setTelegramBotToken(profile: string, token: string): Promise<AuditResult>;

  listWorkItems(filter?: WorkFilter): Promise<WorkItem[]>;
  /** Create a task on the fly (Today/Schedule). Assigned tasks are auto-executed by the kanban dispatcher; unassigned sit in the executive queue. */
  createWorkItem(input: CreateWorkItem): Promise<AuditResult>;
  delegateWork(workItemId: string, request: DelegationRequest): Promise<AuditResult>;
  /** Dynamic kanban control (dogfood 2026-08-29): pause/resume/complete/stop/defer/reclaim from Schedule. */
  setWorkItemState(workItemId: string, action: WorkItemAction, note?: string): Promise<AuditResult>;
  /** Run health per task (zombie detection). 'stale' = host-flagged (dead worker/expired lock); drives the stale badge. */
  getWorkItemHealth?(workItemIds: string[]): Promise<Record<string, 'healthy' | 'stale' | 'unknown'>>;

  listApprovals(filter?: ApprovalFilter): Promise<Approval[]>;
  decideApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult>;

  listCronJobs(profile?: string): Promise<CronJob[]>;
  createCronJob(input: CreateCronJob): Promise<AuditResult>;
  updateCronJob(id: string, patch: CronJobPatch): Promise<AuditResult>;
  /** Permanently remove a scheduled job (confirm in UI first). */
  deleteCronJob(id: string): Promise<AuditResult>;

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
  /** Create or edit a playbook (W7, D-B3). Edit bumps the patch version server-side; editing a published playbook lands as a new draft. */
  savePlaybook(input: PlaybookInput): Promise<AuditResult<Playbook>>;
  /** Create a user-local skill (W7, D-B3). Create-only — overwrite refused. */
  createSkill(input: CreateSkill): Promise<AuditResult>;

  listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]>;
  readEnvironmentFile(id: string): Promise<EnvironmentFile>;
  writeEnvironmentFile(id: string, expectedVersion: string, content: string): Promise<AuditResult>;

  // ---------- Assistant chat (Phase 6.4a) ----------
  /** Authoritative conversation with a staff agent (default = Ally). Hydrates the chat on load. */
  getAssistantHistory(agentId?: string): Promise<ChatMessage[]>;
  /** Send a message to a staff agent (default = Ally); the reply arrives via subscribeAssistant events. */
  sendAssistantMessage(text: string, agentId?: string): Promise<AuditResult>;
  /** Streaming chat events for the selected agent session ONLY — other sessions' events never surface here. */
  subscribeAssistant(handler: (event: AssistantEvent) => void, agentId?: string): Unsubscribe;

  // ---------- Assistant: sessions + channel views (W1, D-B1/D-B2) ----------
  /** Durable sessions of a profile, all sources (D-B2). profile omitted = Ally (default profile). */
  listSessionsFor(profile?: string): Promise<AssistantSessionRef[]>;
  /** Read-only channel for a staff agent: delegated work + the Ally↔agent chat (null when none exists). */
  getChannelFor(agentId: string): Promise<AgentChannel>;
  /** Read-only transcript of any one session of any profile (drawer view — never a chat target). */
  getSessionTranscript(profile: string | undefined, sessionId: string): Promise<ChatMessage[]>;
  /** Resume one of Ally's stored sessions into the Assistant chat (Ally-only, D-B1). Fails honestly — never pretends a resume worked. */
  resumeAssistantSession(storedId: string): Promise<AuditResult>;
  /** Start a fresh Ally chat, replacing the stored session id. */
  startNewAssistantChat(): Promise<AuditResult>;
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
  /** Honest reason when no authUrl could be minted (e.g. toolkit needs a custom auth config — F6). */
  note?: string;
}

/** A toolkit from the Composio catalog (W4) — an app available to connect. */
export interface AvailableApp {
  slug: string;
  name: string;
  description: string;
  logoUrl?: string;
  toolsCount: number;
  categories: string[];
  /** 'composio_managed' = one-click hosted connect; 'bring_own_auth' = needs a custom auth config (F6); 'no_auth' = no credentials needed. */
  authKind: 'composio_managed' | 'bring_own_auth' | 'no_auth';
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
  /** Catalog of apps available to connect (Composio /toolkits, W4). */
  listAvailableApps(): Promise<AvailableApp[]>;
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
