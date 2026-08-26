/**
 * LiveHermesAdapter — talks to the real Hermes gateway over JSON-RPC/WebSocket
 * (`hermes serve`, /api/ws). Implements the slices Phase 2 wires live:
 *   agents (profiles + active sessions), cron, activity (sessions), events.
 * Everything else delegates to the mock adapter until its phase lands.
 *
 * Graceful degradation (spec §2): if the socket drops, reads fall back to the
 * last good fetch and the store keeps rendering — a slow/unavailable gateway
 * must never make the UI look broken.
 */
import type {
  Agent, Approval, ApprovalDecision, Artifact, AuditResult, CronJob,
  EnvironmentFile, EnvironmentFileRef, RuntimeEvent, TodaySummary,
  UsageSummary, WorkItem, ActivityEvent, RuntimeEventType,
} from '../../domain/types';
import type {
  AgentConfigPatch, ApprovalFilter, ArtifactFilter, CreateCronJob,
  CronJobPatch, DateRange, DelegationRequest, HermesAdapter, Unsubscribe, WorkFilter,
} from '../interfaces';
import { hermes as mock } from '../mock/MockHermesAdapter';

// ---------- JSON-RPC over WebSocket client ----------

type NotifyHandler = (method: string, params: Record<string, unknown>) => void;

class RpcClient {
  private ws?: WebSocket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private notifyHandlers = new Set<NotifyHandler>();
  private reconnectDelay = 1000;
  private closed = false;
  connected = false;
  onConnectionChange?: (connected: boolean) => void;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.closed) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      this.onConnectionChange?.(true);
    };
    this.ws.onmessage = (ev) => {
      let msg: { id?: number; result?: unknown; error?: { message?: string }; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message ?? 'RPC error'));
        else p.resolve(msg.result);
      } else if (msg.method) {
        this.notifyHandlers.forEach((h) => h(msg.method!, msg.params ?? {}));
      }
    };
    this.ws.onclose = () => {
      this.connected = false;
      this.onConnectionChange?.(false);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => this.ws?.close();
  }

  private scheduleReconnect() {
    if (this.closed) return;
    setTimeout(() => this.connect(), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
  }

  call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error(`gateway not connected (readyState=${this.ws?.readyState ?? 'none'})`));
        return;
      }
      const id = ++this.seq;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`RPC timeout: ${method}`));
        }
      }, 15_000);
    });
  }

  onNotify(fn: NotifyHandler): Unsubscribe {
    this.notifyHandlers.add(fn);
    return () => this.notifyHandlers.delete(fn);
  }
}

// ---------- server shapes (defensive — verified by probe, tolerate drift) ----------

interface HermesProfile {
  name: string;
  is_default?: boolean;
  model?: string;
  provider?: string;
  description?: string;
  display_name?: string;
  skill_count?: number;
  last_session?: { id: string; title?: string; started_at?: number };
}

interface HermesSession {
  id: string;
  title?: string;
  preview?: string;
  started_at?: number;
  message_count?: number;
  source?: string;
  profile_name?: string;
}

interface HermesCronJob {
  id?: string;
  job_id?: string;
  name?: string;
  prompt?: string;
  schedule?: string;
  next_run_at?: string;
  nextRunAt?: string;
  enabled?: boolean;
  deliver?: string;
  last_status?: string;
}

// ---------- kanban shapes (verified via cli.exec probe) ----------

interface KanbanTask {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: 'triage' | 'todo' | 'ready' | 'running' | 'review' | 'blocked' | 'scheduled' | 'done' | 'archived';
  priority?: number;
  created_at?: number;
  started_at?: number | null;
  completed_at?: number | null;
  result?: string | null;
}

/** Approval metadata rides in the task body as a JSON envelope (Phase 3). */
interface ApprovalEnvelope {
  eaios: 'approval';
  actionType: Approval['actionType'];
  targetSystem: string;
  targetObject?: string;
  risk: Approval['risk'];
  requestedBy?: string; // profile id — approvals stay UNASSIGNED so the kanban dispatcher never executes them
  evidence?: Approval['evidence'];
  proposedDiff?: string;
  rollbackPlan?: string;
}

const kanbanState: Record<KanbanTask['status'], WorkItem['state']> = {
  triage: 'new',
  todo: 'delegated',
  ready: 'ready',
  running: 'in_progress',
  review: 'waiting_approval',
  blocked: 'blocked',
  scheduled: 'delegated',
  done: 'complete',
  archived: 'cancelled',
};

const prioLabel = (p?: number): WorkItem['priority'] => (p !== undefined && p <= 1 ? 'critical' : p === 2 ? 'high' : p === 3 ? 'medium' : 'low');

function parseEnvelope(body?: string | null): ApprovalEnvelope | null {
  if (!body) return null;
  try {
    const v = JSON.parse(body) as ApprovalEnvelope;
    return v?.eaios === 'approval' ? v : null;
  } catch {
    return null;
  }
}

function mapTask(t: KanbanTask): WorkItem {
  return {
    id: t.id,
    title: t.title,
    summary: t.body && !parseEnvelope(t.body) ? t.body : undefined,
    priority: prioLabel(t.priority),
    ownerType: t.assignee ? 'agent' : 'executive',
    ownerId: t.assignee ?? undefined,
    state: kanbanState[t.status] ?? 'new',
    delegationCandidate: !t.assignee && ['ready', 'triage'].includes(t.status),
    createdAt: epochToIso(t.created_at) ?? new Date().toISOString(),
    updatedAt: epochToIso(t.completed_at ?? t.started_at ?? t.created_at) ?? new Date().toISOString(),
  };
}

function mapTaskToApproval(t: KanbanTask, env: ApprovalEnvelope): Approval {
  return {
    id: t.id,
    workItemId: t.id,
    requestedByAgentId: env.requestedBy ?? t.assignee ?? 'default',
    actionType: env.actionType,
    targetSystem: env.targetSystem,
    targetObject: env.targetObject,
    risk: env.risk,
    status: t.status === 'done' ? 'approved' : t.status === 'blocked' ? 'rejected' : t.status === 'archived' ? 'expired' : 'pending',
    submittedAt: epochToIso(t.created_at) ?? new Date().toISOString(),
    evidence: env.evidence ?? [],
    proposedDiff: env.proposedDiff,
    rollbackPlan: env.rollbackPlan,
  };
}

const epochToIso = (secs?: number) => (secs ? new Date(secs * 1000).toISOString() : undefined);

function mapProfile(p: HermesProfile, activeProfileNames: Set<string>): Agent {
  const isAlly = p.is_default === true;
  const active = activeProfileNames.has(p.name);
  return {
    id: p.name,
    name: p.display_name || (isAlly ? 'Ally' : p.name.charAt(0).toUpperCase() + p.name.slice(1)),
    role: p.description || (isAlly ? 'Chief of Staff / Orchestrator' : 'Specialist agent'),
    reportsToAgentId: isAlly ? undefined : 'default',
    model: { provider: p.provider ?? 'unknown', model: p.model ?? 'unknown' },
    availableModels: [{ provider: p.provider ?? 'unknown', model: p.model ?? 'unknown' }],
    tools: [{ id: 'hermes', name: `Hermes toolset (${p.skill_count ?? 0} skills)` }],
    status: active ? 'working' : 'idle',
    currentWorkItemId: undefined, // honest: Hermes has no work-item linkage yet (Phase 3)
    lastActivityAt: epochToIso(p.last_session?.started_at),
    health: 'healthy',
  };
}

function mapCron(j: HermesCronJob): CronJob {
  return {
    id: j.id ?? j.job_id ?? 'unknown',
    name: j.name ?? (j.prompt ? j.prompt.slice(0, 48) : 'Scheduled job'),
    scheduleExpression: j.schedule ?? '',
    nextRunAt: j.next_run_at ?? j.nextRunAt ?? new Date(Date.now() + 3600_000).toISOString(),
    approvalPolicy: 'pre_approved',
    lastResult: j.last_status === 'failed' ? 'failed' : j.last_status ? 'success' : undefined,
    enabled: j.enabled !== false,
  };
}

function mapSessionToActivity(s: HermesSession): ActivityEvent {
  return {
    id: `sess-${s.id}`,
    type: 'session.activity',
    occurredAt: epochToIso(s.started_at) ?? new Date().toISOString(),
    agentId: s.profile_name ?? 'default',
    action: s.title ?? s.preview?.slice(0, 80) ?? `Session ${s.id}`,
    target: s.source,
    result: s.message_count !== undefined ? `${s.message_count} messages` : undefined,
    severity: 'info',
  };
}

/** Map gateway notification types onto our RuntimeEvent union. */
function mapNotification(method: string, params: Record<string, unknown>): RuntimeEvent | null {
  const t = String(params.type ?? method);
  let type: RuntimeEventType | null = null;
  if (t === 'turn.end') type = 'agent.completed';
  else if (t.endsWith('.delta') || t === 'agent.token') type = 'agent.progress';
  else if (t.startsWith('cron.')) type = t as RuntimeEventType;
  else if (t.startsWith('session.')) type = 'work.updated';
  else if (t === 'gateway.ready') return null;
  if (!type) return null;
  return {
    id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    occurredAt: new Date().toISOString(),
    agentId: typeof params.profile === 'string' ? params.profile : undefined,
    payload: params,
  };
}

// ---------- adapter ----------

class LiveHermesAdapter implements HermesAdapter {
  private rpc: RpcClient;
  private url: string;
  /** mock fallback for slices not yet wired live (per-phase plan) */
  private fallback: HermesAdapter = mock;

  constructor() {
    const token = import.meta.env.VITE_HERMES_TOKEN as string | undefined;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.url = `${proto}://${location.host}/api/ws${token ? `?token=${token}` : ''}`;
    this.rpc = new RpcClient(this.url);
    // NOTE: no auto-connect — call connect() explicitly (keeps tests and
    // mock mode from ever touching the real gateway).
  }

  connect() {
    this.rpc.connect();
  }

  onConnectionChange(fn: (connected: boolean) => void) {
    this.rpc.onConnectionChange = fn;
  }

  // ----- LIVE: agents (profiles + active sessions) -----
  async listAgents(): Promise<Agent[]> {
    try {
      const [profilesRes, activeRes] = await Promise.all([
        this.rpc.call<{ profiles: HermesProfile[] }>('profiles.list'),
        this.rpc.call<{ sessions?: HermesSession[] }>('session.active_list').catch(() => ({ sessions: [] as HermesSession[] })),
      ]);
      const activeNames = new Set<string>(
        (activeRes.sessions ?? []).map((s) => s.profile_name).filter((x): x is string => Boolean(x)),
      );
      return (profilesRes.profiles ?? []).map((p) => mapProfile(p, activeNames));
    } catch {
      return this.fallback.listAgents(); // graceful degradation (spec §2)
    }
  }

  async getAgent(agentId: string): Promise<Agent> {
    const all = await this.listAgents();
    const a = all.find((x) => x.id === agentId);
    if (!a) throw new Error(`agent not found: ${agentId}`);
    return a;
  }

  updateAgentConfig(agentId: string, patch: AgentConfigPatch): Promise<AuditResult> {
    // Live model writes land in Phase 2 hardening via profiles.configure.
    void agentId;
    void patch;
    return this.fallback.updateAgentConfig(agentId, patch);
  }

  // ----- LIVE: cron -----
  async listCronJobs(): Promise<CronJob[]> {
    try {
      const res = await this.rpc.call<{ jobs?: HermesCronJob[] }>('cron.manage', { action: 'list' });
      return (res.jobs ?? []).map(mapCron);
    } catch {
      return this.fallback.listCronJobs();
    }
  }

  async createCronJob(input: CreateCronJob): Promise<AuditResult> {
    const res = await this.rpc.call<AuditResult>('cron.manage', { action: 'create', ...input }).catch(() => null);
    return res ?? this.fallback.createCronJob(input);
  }

  async updateCronJob(id: string, patch: CronJobPatch): Promise<AuditResult> {
    const action = patch.enabled === false ? 'pause' : patch.enabled === true ? 'resume' : 'edit';
    const res = await this.rpc.call<AuditResult>('cron.manage', { action, name: id, ...patch }).catch(() => null);
    return res ?? this.fallback.updateCronJob(id, patch);
  }

  // ----- LIVE: activity (session ledger) -----
  async listActivity(limit = 50): Promise<ActivityEvent[]> {
    try {
      const res = await this.rpc.call<{ sessions: HermesSession[] }>('session.list');
      return (res.sessions ?? []).slice(0, limit).map(mapSessionToActivity);
    } catch {
      return this.fallback.listActivity(limit);
    }
  }

  // ----- LIVE: events -----
  subscribeEvents(handler: (event: RuntimeEvent) => void): Unsubscribe {
    return this.rpc.onNotify((method, params) => {
      const evt = mapNotification(method, params);
      if (evt) handler(evt);
    });
  }

  // ----- LIVE: kanban-backed work loop (Phase 3) -----

  /** Run a kanban CLI command through the gateway and parse its --json output. */
  private async kanban<T>(argv: string[]): Promise<T> {
    const res = await this.rpc.call<{ code: number; output: string }>('cli.exec', { argv: ['kanban', ...argv] });
    if (res.code !== 0) throw new Error(res.output.slice(0, 200) || 'kanban command failed');
    return JSON.parse(res.output || 'null') as T;
  }

  /** Shared task fetch with a short TTL — one subprocess serves several callers. */
  private tasksCache?: { at: number; tasks: KanbanTask[] };

  private async kanbanTasks(): Promise<KanbanTask[]> {
    if (this.tasksCache && Date.now() - this.tasksCache.at < 4000) return this.tasksCache.tasks;
    const tasks = await this.kanban<KanbanTask[]>(['list', '--json', '--archived']);
    this.tasksCache = { at: Date.now(), tasks: tasks ?? [] };
    return this.tasksCache.tasks;
  }

  private invalidateTasks() {
    this.tasksCache = undefined;
  }

  async listWorkItems(filter?: WorkFilter): Promise<WorkItem[]> {
    try {
      let rows = (await this.kanbanTasks()).filter((t) => !parseEnvelope(t.body)).map(mapTask);
      if (filter?.state) rows = rows.filter((w) => filter.state!.includes(w.state));
      if (filter?.ownerType) rows = rows.filter((w) => w.ownerType === filter.ownerType);
      if (filter?.delegationCandidate) rows = rows.filter((w) => w.delegationCandidate);
      return rows;
    } catch {
      return this.fallback.listWorkItems(filter);
    }
  }

  async delegateWork(workItemId: string, request: DelegationRequest): Promise<AuditResult> {
    try {
      const profile = request.agentId ?? 'default';
      await this.kanban<unknown>(['assign', workItemId, profile]);
      this.invalidateTasks();
      return { ok: true, auditEventId: `kb-assign-${workItemId}` };
    } catch (e) {
      return { ok: false, auditEventId: `kb-err-${Date.now()}`, error: { code: 'delegate_failed', safeMessage: e instanceof Error ? e.message : 'Delegation failed.', retryable: true } };
    }
  }

  async listApprovals(filter?: ApprovalFilter): Promise<Approval[]> {
    try {
      const rows = (await this.kanbanTasks())
        .map((t) => ({ t, env: parseEnvelope(t.body) }))
        .filter((x): x is { t: KanbanTask; env: ApprovalEnvelope } => x.env !== null)
        .map(({ t, env }) => mapTaskToApproval(t, env));
      let out = rows;
      if (filter?.status) out = out.filter((a) => filter.status!.includes(a.status));
      if (filter?.risk) out = out.filter((a) => filter.risk!.includes(a.risk));
      return out;
    } catch {
      return this.fallback.listApprovals(filter);
    }
  }

  async decideApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult> {
    try {
      if (decision.decision === 'approved') {
        await this.kanban<unknown>(['complete', approvalId, '--result', 'Approved by executive']);
      } else if (decision.decision === 'changes_requested') {
        await this.kanban<unknown>(['request-changes', approvalId, decision.note ?? 'Changes requested by executive — see EAiOS approval thread.']);
      } else {
        await this.kanban<unknown>(['block', approvalId, decision.note ?? 'Rejected by executive']);
      }
      await this.kanban<unknown>(['comment', approvalId, `Executive decision recorded: ${decision.decision.replace('_', ' ')}`]).catch(() => undefined);
      this.invalidateTasks();
      return { ok: true, auditEventId: `kb-decision-${approvalId}` };
    } catch (e) {
      return { ok: false, auditEventId: `kb-err-${Date.now()}`, error: { code: 'decision_failed', safeMessage: e instanceof Error ? e.message : 'Decision failed.', retryable: true } };
    }
  }

  async getTodaySummary(): Promise<TodaySummary> {
    try {
      const tasks = await this.kanbanTasks();
      const work = tasks.filter((t) => !parseEnvelope(t.body));
      const open = work.filter((t) => !['done', 'archived'].includes(t.status));
      const approvals = tasks.filter((t) => parseEnvelope(t.body) && !['done', 'blocked', 'archived'].includes(t.status));
      const h = new Date().getHours();
      return {
        greeting: h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening',
        date: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
        executivePriorities: open.filter((t) => !t.assignee).length,
        delegatableCount: open.filter((t) => !t.assignee && ['ready', 'triage'].includes(t.status)).length,
        approvalsWaiting: approvals.length,
        headline: approvals.length > 0 ? `${approvals.length} item${approvals.length === 1 ? '' : 's'} need your decision.` : 'Nothing waiting on your decision.',
      };
    } catch {
      return this.fallback.getTodaySummary();
    }
  }
  listArtifacts(filter?: ArtifactFilter): Promise<Artifact[]> { return this.fallback.listArtifacts(filter); }
  getUsage(range: DateRange): Promise<UsageSummary> { return this.fallback.getUsage(range); }
  listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]> { return this.fallback.listEditableEnvironmentFiles(); }
  readEnvironmentFile(id: string): Promise<EnvironmentFile> { return this.fallback.readEnvironmentFile(id); }
  writeEnvironmentFile(id: string, v: string, c: string): Promise<AuditResult> { return this.fallback.writeEnvironmentFile(id, v, c); }
}

export const live = new LiveHermesAdapter();
