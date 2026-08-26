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
  AuditResult,
  CronJob,
  EnvironmentFile,
  EnvironmentFileRef,
  RuntimeEvent,
  TodaySummary,
  UsageSummary,
  WorkItem,
  KnowledgeSource,
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
}

export type CronJobPatch = Partial<Pick<CronJob, 'name' | 'scheduleExpression' | 'enabled' | 'approvalPolicy'>>;

export interface HermesAdapter {
  getTodaySummary(): Promise<TodaySummary>;
  listAgents(): Promise<Agent[]>;
  getAgent(agentId: string): Promise<Agent>;
  updateAgentConfig(agentId: string, patch: AgentConfigPatch): Promise<AuditResult>;

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
  getUsage(range: DateRange): Promise<UsageSummary>;

  listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]>;
  readEnvironmentFile(id: string): Promise<EnvironmentFile>;
  writeEnvironmentFile(id: string, expectedVersion: string, content: string): Promise<AuditResult>;
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

export interface KnowledgeAdapter {
  listSources(): Promise<KnowledgeSource[]>;
  uploadSource(file: File, metadata: KnowledgeSourceInput): Promise<KnowledgeSource>;
  addUrl(url: string, metadata: KnowledgeSourceInput): Promise<KnowledgeSource>;
  reindex(sourceId: string): Promise<AuditResult>;
  removeSource(sourceId: string): Promise<AuditResult>;
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
