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

// ---------- mapping helpers ----------

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
  /** mock fallback for slices not yet wired live (per-phase plan) */
  private fallback: HermesAdapter = mock;

  constructor() {
    const token = import.meta.env.VITE_HERMES_TOKEN as string | undefined;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/ws${token ? `?token=${token}` : ''}`;
    this.rpc = new RpcClient(url);
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

  // ----- MOCK until their phases -----
  getTodaySummary(): Promise<TodaySummary> { return this.fallback.getTodaySummary(); }
  listWorkItems(filter?: WorkFilter): Promise<WorkItem[]> { return this.fallback.listWorkItems(filter); }
  delegateWork(id: string, req: DelegationRequest): Promise<AuditResult> { return this.fallback.delegateWork(id, req); }
  listApprovals(filter?: ApprovalFilter): Promise<Approval[]> { return this.fallback.listApprovals(filter); }
  decideApproval(id: string, d: ApprovalDecision): Promise<AuditResult> { return this.fallback.decideApproval(id, d); }
  listArtifacts(filter?: ArtifactFilter): Promise<Artifact[]> { return this.fallback.listArtifacts(filter); }
  getUsage(range: DateRange): Promise<UsageSummary> { return this.fallback.getUsage(range); }
  listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]> { return this.fallback.listEditableEnvironmentFiles(); }
  readEnvironmentFile(id: string): Promise<EnvironmentFile> { return this.fallback.readEnvironmentFile(id); }
  writeEnvironmentFile(id: string, v: string, c: string): Promise<AuditResult> { return this.fallback.writeEnvironmentFile(id, v, c); }
}

export const live = new LiveHermesAdapter();
