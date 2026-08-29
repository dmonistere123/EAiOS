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
  Agent, AgentChannel, Approval, ApprovalDecision, Artifact, AssistantEvent, AssistantSessionRef, AuditResult, ChatMessage, CronJob,
  EnvironmentFile, EnvironmentFileRef, RuntimeEvent, TodaySummary,
  UsageSummary, WorkItem, ActivityEvent, RuntimeEventType, Skill, Playbook, PlaybookRun,
} from '../../domain/types';
import type {
  AgentConfigPatch, ApprovalFilter, ArtifactFilter, CreateAgent, CreateCronJob,
  CreateSkill, CreateWorkItem, CronJobPatch, DateRange, DelegationRequest, HermesAdapter, ModelOptionGroup, PlaybookInput, Unsubscribe, WorkFilter,
} from '../interfaces';
import { hermes as mock } from '../mock/MockHermesAdapter';

// ---------- JSON-RPC over WebSocket client ----------

type NotifyHandler = (method: string, params: Record<string, unknown>) => void;

class RpcClient {
  private ws?: WebSocket;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private notifyHandlers = new Set<NotifyHandler>();
  private openWaiters = new Set<() => void>();
  private reconnectDelay = 1000;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private closed = false;
  connected = false;
  onConnectionChange?: (connected: boolean) => void;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectDelay = 1000;
      const waiters = [...this.openWaiters];
      this.openWaiters.clear();
      waiters.forEach((fn) => fn());
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
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15_000);
  }

  private waitForOpen(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.openWaiters.delete(onOpen);
        reject(new Error(`gateway not connected (readyState=${this.ws?.readyState ?? 'none'})`));
      }, 15_000);
      const onOpen = () => {
        clearTimeout(timer);
        this.openWaiters.delete(onOpen);
        resolve();
      };
      this.openWaiters.add(onOpen);
    });
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.ws) this.connect();
    await this.waitForOpen();
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
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
  /** The fully-prepared action content (e.g. To/Subject/Body) — what the executor sends and what the executive reviews (2026-08-29). */
  payload?: string;
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
    payload: env.payload,
  };
}

const epochToIso = (secs?: number) => (secs ? new Date(secs * 1000).toISOString() : undefined);

/** FNV-1a 32-bit hex — content hash for env-file optimistic concurrency. */
function contentHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** /api/usage middleware response (state.db session_model_usage aggregates). */
export interface UsageIndexResponse {
  range: { from: string; to: string };
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  actualCostUsd: number;
  byAgent: { agentId: string; inputTokens: number; outputTokens: number; estimatedCostUsd: number; actualCostUsd: number }[];
  freshnessAt: string;
}

/**
 * Map usage aggregates onto UsageSummary with honest cost labeling (D7):
 * actual > 0 → authoritative; else estimated > 0 → estimate; else undefined
 * (UI renders "Not provided" — never invent a dollar figure).
 */
export function mapUsageResponse(res: UsageIndexResponse): UsageSummary {
  const pick = (estimated: number, actual: number): { costUsd?: number; authoritative: boolean } =>
    actual > 0 ? { costUsd: actual, authoritative: true } : estimated > 0 ? { costUsd: estimated, authoritative: false } : { authoritative: false };
  const total = pick(res.estimatedCostUsd, res.actualCostUsd);
  const from = new Date(res.range.from);
  const rangeLabel = `${from.toLocaleString('en-US', { month: 'long', year: 'numeric' })} (to date)`;
  return {
    rangeLabel,
    inputTokens: res.inputTokens,
    outputTokens: res.outputTokens,
    costUsd: total.costUsd,
    costIsAuthoritative: total.authoritative,
    budgetUsd: undefined, // no host source — page renders "No budget set"
    byAgent: res.byAgent.map((a) => {
      const c = pick(a.estimatedCostUsd, a.actualCostUsd);
      return { agentId: a.agentId, inputTokens: a.inputTokens, outputTokens: a.outputTokens, costUsd: c.costUsd };
    }),
    freshnessAt: res.freshnessAt,
  };
}

/** /api/artifacts middleware row (kanban task_attachments JOIN tasks). */
export interface ArtifactIndexRow {
  id: string;
  taskId: string;
  taskTitle: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  agentId: string;
  taskStatus: string | null;
  createdAt: string;
}

/**
 * Map an attachment row onto Artifact (§8.9). State is derived from the
 * parent task: done→ready, archived→archived, else draft. 'approved' and
 * 'shared' have no host concept and are never emitted live.
 */
export function mapArtifactRow(r: ArtifactIndexRow): Artifact {
  const state: Artifact['state'] = r.taskStatus === 'done' ? 'ready' : r.taskStatus === 'archived' ? 'archived' : 'draft';
  const textish = /^(text\/|application\/(json|csv))/.test(r.mimeType);
  return {
    id: r.id,
    name: r.name,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    createdAt: r.createdAt,
    createdByAgentId: r.agentId,
    workItemId: r.taskId,
    state,
    previewAvailable: textish && r.sizeBytes <= 1_048_576,
  };
}

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
    fn(this.rpc.connected); // late subscribers still get the current socket state
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

  // ----- LIVE: agent factory (Phase 6.5, spec §8.3) -----
  /** Live provider/model catalog, grouped by provider. */
  async listModelOptions(): Promise<ModelOptionGroup[]> {
    try {
      const res = await this.rpc.call<{ providers?: { slug?: string; name?: string; models?: string[]; authenticated?: boolean }[] }>('model.options', { explicit_only: true });
      return (res.providers ?? [])
        .filter((p) => p.slug && (p.models ?? []).length > 0)
        .map((p) => ({ slug: p.slug!, name: p.name ?? p.slug!, models: p.models ?? [], authenticated: p.authenticated !== false }));
    } catch {
      return this.fallback.listModelOptions(); // graceful degradation (spec §2)
    }
  }

  /**
   * Create a staff agent (Hermes profile). Config write per policy: audited,
   * no approval gate (D3 gates external writes only). mirror_credentials is
   * the host default (true) — the new agent can infer out of the box.
   */
  async createAgent(input: CreateAgent): Promise<AuditResult> {
    if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
      return { ok: false, auditEventId: `agent-err-${Date.now()}`, error: { code: 'invalid_name', safeMessage: 'Agent id must be a lowercase slug (letters, digits, dashes; start with a letter).', retryable: false } };
    }
    try {
      await this.rpc.call('profiles.create', {
        name: input.name,
        description: input.role,
        model: input.model.model,
        provider: input.model.provider,
        ...(input.soul ? { soul: input.soul } : {}),
        ...(input.cloneFrom ? { clone_from: input.cloneFrom } : {}),
      });
      return { ok: true, auditEventId: `agent-create-${input.name}-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `agent-err-${Date.now()}`, error: { code: 'agent_create_failed', safeMessage: e instanceof Error ? e.message : 'Agent creation failed.', retryable: false } };
    }
  }

  /**
   * Telegram bot binding (dogfood 2026-08-29) via /api/profile-env. GET is
   * existence-only; the POST writes the allowlisted key server-side. The
   * token is NEVER read back — a WRITE, so failure returns an honest error
   * instead of falling back to the mock (which would pretend to persist).
   */
  async getTelegramBotStatus(profile: string): Promise<{ bound: boolean }> {
    try {
      const res = await fetch(`/api/profile-env?profile=${encodeURIComponent(profile)}&key=TELEGRAM_BOT_TOKEN`);
      const data = (await res.json().catch(() => ({}))) as { present?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `profile-env HTTP ${res.status}`);
      return { bound: data.present === true };
    } catch {
      return this.fallback.getTelegramBotStatus(profile); // graceful degradation (spec §2)
    }
  }

  async setTelegramBotToken(profile: string, token: string): Promise<AuditResult> {
    try {
      const res = await fetch('/api/profile-env', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile, key: 'TELEGRAM_BOT_TOKEN', value: token }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `profile-env HTTP ${res.status}`);
      return { ok: true, auditEventId: `bot-bind-${profile}-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `bot-bind-err-${Date.now()}`, error: { code: 'bot_bind_failed', safeMessage: e instanceof Error ? e.message : 'Bot binding failed.', retryable: true } };
    }
  }

  /** Live config writes: model is catalog-validated (model+provider go together); description writes through profiles.configure. */
  async updateAgentConfig(agentId: string, patch: AgentConfigPatch): Promise<AuditResult> {
    if (!patch.model && patch.description === undefined) return this.fallback.updateAgentConfig(agentId, patch); // tools-only patches stay mock for now
    try {
      if (patch.model) {
        const catalog = await this.listModelOptions();
        const allowed = catalog.some((g) => g.slug === patch.model!.provider && g.models.includes(patch.model!.model));
        if (!allowed) {
          return { ok: false, auditEventId: `agent-err-${Date.now()}`, error: { code: 'model_not_allowed', safeMessage: `${patch.model.provider}/${patch.model.model} is not in the live model catalog.`, retryable: false } };
        }
        await this.rpc.call('profiles.configure', { name: agentId, model: patch.model.model, provider: patch.model.provider });
      }
      if (patch.description !== undefined) {
        await this.rpc.call('profiles.configure', { name: agentId, description: patch.description });
      }
      return { ok: true, auditEventId: `agent-config-${agentId}-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `agent-err-${Date.now()}`, error: { code: 'agent_config_failed', safeMessage: e instanceof Error ? e.message : 'Model change failed.', retryable: true } };
    }
  }
  // ----- LIVE: cron -----
  /**
   * W5: profile scoping (probed 2026-08-28, HANDOFF #17) — cron jobs live
   * in per-profile jobs.json stores; params.profile scopes the read and the
   * response carries a `scoped: '<profile>'` marker proving the gateway
   * honored it. Owner = profile scope; the host records NO creator field
   * (jobs.json `origin` is delivery routing, not attribution) — the
   * Schedule rail shows owner-only and says so.
   */
  async listCronJobs(profile?: string): Promise<CronJob[]> {
    try {
      const res = await this.rpc.call<{ jobs?: HermesCronJob[]; scoped?: string }>('cron.manage', {
        action: 'list',
        include_disabled: true,
        ...(profile ? { profile } : {}),
      });
      const owner = res.scoped ?? profile;
      return (res.jobs ?? []).map((j) => ({ ...mapCron(j), ...(owner ? { ownerAgentId: owner } : {}) }));
    } catch {
      return this.fallback.listCronJobs(profile); // graceful degradation (spec §2)
    }
  }

  async createCronJob(input: CreateCronJob): Promise<AuditResult> {
    try {
      await this.rpc.call('cron.manage', {
        action: 'add',
        name: input.name,
        schedule: input.scheduleExpression,
        prompt: input.actionRef ?? input.name,
        ...(input.deliver ? { deliver: input.deliver } : {}),
      });
      return { ok: true, auditEventId: `cron-add-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `cron-err-${Date.now()}`, error: { code: 'cron_create_failed', safeMessage: e instanceof Error ? e.message : 'Cron create failed.', retryable: true } };
    }
  }

  async updateCronJob(id: string, patch: CronJobPatch): Promise<AuditResult> {
    if (patch.enabled === undefined) {
      return { ok: false, auditEventId: `cron-err-${Date.now()}`, error: { code: 'unsupported', safeMessage: 'Only pause/resume is supported against the live scheduler right now.', retryable: false } };
    }
    try {
      await this.rpc.call('cron.manage', { action: patch.enabled ? 'resume' : 'pause', name: id });
      return { ok: true, auditEventId: `cron-${patch.enabled ? 'resume' : 'pause'}-${id}` };
    } catch (e) {
      return { ok: false, auditEventId: `cron-err-${Date.now()}`, error: { code: 'cron_update_failed', safeMessage: e instanceof Error ? e.message : 'Cron update failed.', retryable: true } };
    }
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

  /** Run a kanban CLI command through the gateway. --json output is parsed;
   * write subcommands (assign/complete/block/…) print human text on success
   * (exit 0) — DOGFOOD FIX 2026-08-29: blind JSON.parse turned SUCCESSFUL
   * assigns/decisions into error toasts. Text output on code 0 is a fine
   * result for write commands (callers ignore it). */
  private async kanban<T>(argv: string[]): Promise<T> {
    const res = await this.rpc.call<{ code: number; output: string }>('cli.exec', { argv: ['kanban', ...argv] });
    if (res.code !== 0) throw new Error(res.output.slice(0, 200) || 'kanban command failed');
    const out = (res.output ?? '').trim();
    if (out.startsWith('[') || out.startsWith('{')) return JSON.parse(out) as T;
    return out as T;
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

  /** On-the-fly delegation (dogfood 2026-08-29): kanban create + optional assignee.
   * Assigned tasks are auto-executed by the kanban dispatcher (gotcha #14) —
   * that IS the delegation. Unassigned tasks sit in the executive queue. */
  async createWorkItem(input: CreateWorkItem): Promise<AuditResult> {
    try {
      const prioNum = { critical: 1, high: 2, medium: 3, low: 4 }[input.priority ?? 'medium'];
      const argv = ['create', input.title, '--priority', String(prioNum), '--created-by', 'eaios-executive', '--json'];
      if (input.summary?.trim()) argv.push('--body', input.summary.trim());
      if (input.agentId) argv.push('--assignee', input.agentId);
      const created = await this.kanban<{ id?: string; task_id?: string }>(argv);
      this.invalidateTasks();
      const id = created?.id ?? created?.task_id;
      return { ok: true, auditEventId: `kb-create-${id ?? Date.now()}`, id };
    } catch (e) {
      return { ok: false, auditEventId: `kb-err-${Date.now()}`, error: { code: 'create_failed', safeMessage: e instanceof Error ? e.message : 'Task creation failed.', retryable: true } };
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
        // DOGFOOD FIX (2026-08-29): approve must EXECUTE, not just close.
        // Assign the envelope task to its requesting agent — the kanban
        // dispatcher runs it, the agent executes via its tools (Composio
        // MCP) and completes with the result. The old `complete` left the
        // send/publish unexecuted (the "approved but never sent" bug).
        let assignee = 'default';
        try {
          const task = (await this.kanbanTasks()).find((t) => t.id === approvalId);
          const env = parseEnvelope(task?.body);
          assignee = env?.requestedBy ?? task?.assignee ?? 'default';
        } catch {
          /* fall through with default */
        }
        await this.kanban<unknown>(['assign', approvalId, assignee]);
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
  // ----- LIVE: skills (Phase 5) -----
  /**
   * skills.manage returns {category: [names]} only — no descriptions.
   * Descriptions/versions come from the dev-server /api/skills-index
   * middleware (walks ~/.hermes/skills frontmatter); enrichment is optional
   * and skipped silently where no dev server serves it (tests, packaging).
   *
   * W7: the RPC's get_available_skills() is cached PER-PROCESS (it feeds
   * the startup banner), so a skill created at runtime NEVER appears via
   * RPC until the gateway restarts. The index walk (30s cache) does see
   * it — so the listing is the UNION: RPC names first (platform-gated,
   * disabled-filtered), then index-only names (newly created). Caveat:
   * index-only entries skip the RPC's platform/disabled filtering —
   * acceptable here (no disable feature in EAiOS, F2; box is linux).
   */
  async listSkills(): Promise<Skill[]> {
    try {
      const res = await this.rpc.call<{ skills: Record<string, string[]> }>('skills.manage', { action: 'list' });
      const byCategory = res.skills ?? {};
      let details = new Map<string, { category: string; description?: string; version?: string }>();
      try {
        const idxRes = await fetch('/api/skills-index');
        if (idxRes.ok) {
          const idx = (await idxRes.json()) as { skills?: { name: string; category: string; description?: string; version?: string }[] };
          details = new Map((idx.skills ?? []).map((s) => [s.name, s]));
        }
      } catch {
        // enrichment unavailable — names + categories still render
      }
      const out: Skill[] = [];
      const seen = new Set<string>();
      for (const [category, names] of Object.entries(byCategory)) {
        for (const name of names) {
          seen.add(name);
          const d = details.get(name);
          out.push({ id: name, name, category, description: d?.description, version: d?.version, status: 'enabled' });
        }
      }
      for (const [name, d] of details) {
        if (!seen.has(name)) out.push({ id: name, name, category: d.category, description: d.description, version: d.version, status: 'enabled' });
      }
      return out.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    } catch {
      return this.fallback.listSkills(); // graceful degradation (spec §2)
    }
  }

  // ----- LIVE: playbooks (Phase 5.4) -----
  /**
   * Definitions come from /api/playbooks-index (vite middleware over
   * ~/eaios/playbooks/*.md); RUNS go through kanban. A run's body carries
   * the instructions + an `eaios-playbook: <id>@v<version>` marker so
   * history is just a kanban query — and the run shows up as a governed
   * WorkItem (approvals still gate external writes).
   */
  private playbooksCache?: { at: number; playbooks: Playbook[] };
  private static PLAYBOOK_MARKER = /eaios-playbook: ([\w-]+)@v([\d.]+)/;

  private async playbookDefs(): Promise<Playbook[]> {
    if (this.playbooksCache && Date.now() - this.playbooksCache.at < 30_000) return this.playbooksCache.playbooks;
    const res = await fetch('/api/playbooks-index');
    if (!res.ok) throw new Error(`playbooks-index HTTP ${res.status}`);
    const data = (await res.json()) as { playbooks?: Playbook[] };
    const playbooks = data.playbooks ?? [];
    this.playbooksCache = { at: Date.now(), playbooks };
    return playbooks;
  }

  async listPlaybooks(): Promise<Playbook[]> {
    try {
      return await this.playbookDefs();
    } catch {
      return this.fallback.listPlaybooks();
    }
  }

  async runPlaybook(playbookId: string, opts?: { assignee?: string }): Promise<AuditResult<PlaybookRun>> {
    const fail = (code: string, safeMessage: string, retryable: boolean): AuditResult<PlaybookRun> =>
      ({ ok: false, auditEventId: `pb-err-${Date.now()}`, error: { code, safeMessage, retryable } });
    try {
      const pb = (await this.playbookDefs()).find((p) => p.id === playbookId);
      if (!pb) return fail('not_found', 'Playbook not found.', false);
      const assignee = opts?.assignee ?? pb.assignee;
      const title = `Playbook: ${pb.name} v${pb.version}`;
      const body = `${pb.body}\n\n---\neaios-playbook: ${pb.id}@v${pb.version}`;
      let taskId: string;
      if (pb.mode === 'swarm') {
        if (!pb.verifier || !pb.synthesizer || !(pb.workers ?? []).length) {
          return fail('invalid_playbook', 'Swarm playbooks need workers, a verifier, and a synthesizer.', false);
        }
        const argv = ['swarm', `${title}\n\n${body}`, '--verifier', pb.verifier, '--synthesizer', pb.synthesizer, '--json'];
        for (const w of pb.workers ?? []) argv.push('--worker', w);
        const out = await this.kanban<{ root_task_id?: string; id?: string; task_id?: string }>(argv);
        taskId = out.root_task_id ?? out.id ?? out.task_id ?? 'unknown';
      } else {
        const argv = ['create', title, '--body', body, '--json'];
        if (assignee) argv.push('--assignee', assignee);
        for (const sk of pb.skills) argv.push('--skill', sk);
        const out = await this.kanban<{ id?: string; task_id?: string }>(argv);
        taskId = out.id ?? out.task_id ?? 'unknown';
      }
      this.invalidateTasks();
      const run: PlaybookRun = {
        id: taskId,
        playbookId: pb.id,
        playbookVersion: pb.version,
        title,
        assignee,
        state: assignee ? 'delegated' : 'ready',
        createdAt: new Date().toISOString(),
      };
      return { ok: true, data: run, auditEventId: `pb-run-${taskId}` };
    } catch (e) {
      return fail('run_failed', e instanceof Error ? e.message : 'Playbook run failed.', true);
    }
  }

  /**
   * Playbook authoring (W7): PUT to the playbooks-index middleware, which
   * owns version discipline + confinement. A WRITE — never falls back to
   * the mock: failure returns an honest error instead of pretending.
   */
  async savePlaybook(input: PlaybookInput): Promise<AuditResult<Playbook>> {
    try {
      const res = await fetch('/api/playbooks-index', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => ({}))) as { playbook?: Playbook; error?: string };
      if (!res.ok || !data.playbook) throw new Error(data.error ?? `playbooks-index HTTP ${res.status}`);
      this.playbooksCache = undefined; // bust the 30s defs cache
      return { ok: true, data: data.playbook, auditEventId: `pb-save-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `pb-save-err-${Date.now()}`, error: { code: 'playbook_save_failed', safeMessage: e instanceof Error ? e.message : 'Playbook save failed.', retryable: true } };
    }
  }

  /** Skill authoring (W7): POST to the skill-create middleware (confined, create-only). WRITE — never mock-faked. */
  async createSkill(input: CreateSkill): Promise<AuditResult> {
    try {
      const res = await fetch('/api/skill-create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `skill-create HTTP ${res.status}`);
      return { ok: true, auditEventId: `skill-create-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `skill-create-err-${Date.now()}`, error: { code: 'skill_create_failed', safeMessage: e instanceof Error ? e.message : 'Skill creation failed.', retryable: true } };
    }
  }

  async listPlaybookRuns(playbookId?: string): Promise<PlaybookRun[]> {
    try {
      const rows: PlaybookRun[] = [];
      for (const t of await this.kanbanTasks()) {
        const m = t.body?.match(LiveHermesAdapter.PLAYBOOK_MARKER);
        if (!m) continue;
        if (playbookId && m[1] !== playbookId) continue;
        rows.push({
          id: t.id,
          playbookId: m[1],
          playbookVersion: m[2],
          title: t.title,
          assignee: t.assignee ?? undefined,
          state: kanbanState[t.status] ?? 'new',
          createdAt: epochToIso(t.created_at) ?? new Date().toISOString(),
          completedAt: epochToIso(t.completed_at ?? undefined),
          result: t.result ?? undefined,
        });
      }
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return this.fallback.listPlaybookRuns(playbookId);
    }
  }

  // ----- LIVE: artifacts (Phase 6.3, spec §8.9) -----
  /** Kanban attachments via /api/artifacts middleware (kanban.db read-only). */
  async listArtifacts(filter?: ArtifactFilter): Promise<Artifact[]> {
    try {
      const res = await fetch('/api/artifacts');
      if (!res.ok) throw new Error(`artifacts index ${res.status}`);
      const data = (await res.json()) as { artifacts?: ArtifactIndexRow[] };
      let rows = (data.artifacts ?? []).map(mapArtifactRow);
      if (filter?.state) rows = rows.filter((a) => filter.state!.includes(a.state));
      if (filter?.createdByAgentId) rows = rows.filter((a) => a.createdByAgentId === filter.createdByAgentId);
      return rows;
    } catch {
      return this.fallback.listArtifacts(filter); // graceful degradation (spec §2)
    }
  }

  async getArtifactPreview(id: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(id)}/raw`);
      if (!res.ok) return null;
      return (await res.text()).slice(0, 200_000); // preview cap
    } catch {
      return this.fallback.getArtifactPreview(id);
    }
  }

  /**
   * Governed share: creates an UNASSIGNED kanban task carrying an approval
   * envelope — it surfaces on the Approvals page and the kanban dispatcher
   * never executes it (approvals-stay-unassigned invariant). Approving is a
   * decision record, not a send: post-approval execution is the agent's work.
   */
  async shareArtifact(id: string): Promise<AuditResult> {
    try {
      const all = await this.listArtifacts();
      const a = all.find((x) => x.id === id);
      if (!a) return { ok: false, auditEventId: `art-err-${Date.now()}`, error: { code: 'not_found', safeMessage: 'Artifact not found.', retryable: false } };
      const envelope = {
        eaios: 'approval',
        actionType: 'send',
        targetSystem: 'external',
        targetObject: a.name,
        risk: 'medium',
        requestedBy: a.createdByAgentId,
        evidence: [{ kind: 'artifact', label: a.name, uri: `eaios://artifact/${a.id}` }],
        rollbackPlan: 'Share not yet executed — approving records the decision; the sharing agent executes under the approvals policy.',
      };
      await this.kanban<unknown>(['create', `Share externally: ${a.name}`, '--body', JSON.stringify(envelope), '--json']);
      this.invalidateTasks();
      return { ok: true, auditEventId: `art-share-${id}-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `art-err-${Date.now()}`, error: { code: 'share_failed', safeMessage: e instanceof Error ? e.message : 'Share request failed.', retryable: true } };
    }
  }
  // ----- LIVE: usage (Phase 6.1) -----
  /**
   * insights.get RPC carries no token/cost data (verified 2026-08-26), so
   * aggregates come from the dev-server /api/usage middleware over state.db
   * session_model_usage. Mock fallback on any failure (spec §2).
   */
  async getUsage(range: DateRange): Promise<UsageSummary> {
    try {
      const res = await fetch(`/api/usage?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      if (!res.ok) throw new Error(`usage index ${res.status}`);
      const summary = mapUsageResponse((await res.json()) as UsageIndexResponse);
      // EAiOS-owned budget rides alongside (F15) — optional enrichment,
      // exactly like the skills-index pattern: missing = no budget set.
      try {
        const s = await fetch('/api/eaios-settings');
        if (s.ok) {
          const settings = (await s.json()) as { usageBudgetUsd?: number };
          if (typeof settings.usageBudgetUsd === 'number') summary.budgetUsd = settings.usageBudgetUsd;
        }
      } catch {
        // settings unavailable — budget stays unset, totals still render
      }
      return summary;
    } catch {
      return this.fallback.getUsage(range); // graceful degradation (spec §2)
    }
  }

  /** Writes go to the EAiOS settings store; failure = error, never mock-pretend. */
  async setUsageBudget(budgetUsd: number | null): Promise<AuditResult> {
    try {
      const res = await fetch('/api/eaios-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usageBudgetUsd: budgetUsd }),
      });
      if (!res.ok) throw new Error(`settings ${res.status}`);
      return { ok: true, auditEventId: `settings-budget-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `settings-err-${Date.now()}`, error: { code: 'settings_write_failed', safeMessage: e instanceof Error ? e.message : 'Budget save failed.', retryable: true } };
    }
  }
  // ----- LIVE: assistant chat (Phase 6.4a, spec §8.2) -----
  /**
   * Session lifecycle (probed 2026-08-26): session.create returns a runtime
   * session_id (dies with the gateway) + stored_session_id (durable). The
   * stored id rides localStorage (UI state, not a secret); resume-or-create
   * on load, recreate-once-and-retry on a stale runtime sid (4001). Turn
   * events arrive as method 'event' with params.type; EVERY session's events
   * share the socket, so the filter is strict on our sid. Completion is
   * 'message.complete' — turn.end does not fire on this path.
   */
  private assistantLanes = new Map<string, { sid?: string; handlers: Set<(e: AssistantEvent) => void> }>();
  private assistantSidToAgent = new Map<string, string>();
  private assistantWired = false;

  private static assistantStoredKey(agentId: string) {
    return agentId === 'default' ? 'eaios.assistant.storedSessionId' : `eaios.assistant.storedSessionId.${agentId}`;
  }

  private assistantLane(agentId: string) {
    let lane = this.assistantLanes.get(agentId);
    if (!lane) {
      lane = { handlers: new Set<(e: AssistantEvent) => void>() };
      this.assistantLanes.set(agentId, lane);
    }
    return lane;
  }

  private assistantProfileParams(agentId: string) {
    return agentId && agentId !== 'default' ? { profile: agentId } : {};
  }

  private async ensureAssistantSession(agentId = 'default'): Promise<string> {
    const lane = this.assistantLane(agentId);
    if (lane.sid) return lane.sid;
    const storedKey = LiveHermesAdapter.assistantStoredKey(agentId);
    const profileParams = this.assistantProfileParams(agentId);
    const stored = localStorage.getItem(storedKey);
    if (stored) {
      try {
        const r = await this.rpc.call<{ session_id: string }>('session.resume', { session_id: stored, ...profileParams });
        if (r.session_id) {
          lane.sid = r.session_id;
          this.assistantSidToAgent.set(lane.sid, agentId);
          return lane.sid;
        }
      } catch {
        // stale stored id — fall through to create
      }
    }
    const c = await this.rpc.call<{ session_id: string; stored_session_id?: string }>('session.create', {
      title: `EAiOS — ${agentId === 'default' ? 'My Assistant' : agentId}`,
      ...profileParams,
    });
    lane.sid = c.session_id;
    this.assistantSidToAgent.set(lane.sid, agentId);
    if (c.stored_session_id) localStorage.setItem(storedKey, c.stored_session_id);
    return lane.sid!;
  }

  private wireAssistant() {
    if (this.assistantWired) return;
    this.assistantWired = true;
    this.rpc.onNotify((method, params) => {
      if (method !== 'event') return;
      const evtSid = String(params.session_id ?? params.sid ?? ''); // turn.error uses 'sid'
      const agentId = this.assistantSidToAgent.get(evtSid);
      if (!agentId) return; // strict filter — every session shares the socket
      const lane = this.assistantLanes.get(agentId);
      if (!lane) return;
      const type = String(params.type ?? '');
      const payload = (params.payload ?? {}) as Record<string, unknown>;
      const emit = (e: AssistantEvent) => lane.handlers.forEach((h) => h(e));
      if (type === 'message.start') emit({ kind: 'start' });
      else if (type === 'message.delta') emit({ kind: 'delta', text: String(payload.text ?? '') });
      else if (type === 'message.complete') emit({ kind: 'complete', text: String(payload.text ?? '') });
      else if (type === 'turn.error') emit({ kind: 'error', message: String(params.message ?? payload.message ?? 'Turn failed.') });
    });
  }

  /** Shared session.history → ChatMessage mapping (user/assistant rows only). */
  private static mapHistoryMessages(h: { messages?: { role: string; text?: string; timestamp?: number; row_id?: number }[] }): ChatMessage[] {
    return (h.messages ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: String(m.row_id ?? `${m.role}-${m.timestamp ?? 0}`),
        role: m.role === 'user' ? ('you' as const) : ('ally' as const),
        text: m.text ?? '',
        at: m.timestamp ? new Date(m.timestamp * 1000).toISOString() : new Date().toISOString(),
      }));
  }

  async getAssistantHistory(agentId = 'default'): Promise<ChatMessage[]> {
    try {
      const sid = await this.ensureAssistantSession(agentId);
      const h = await this.rpc.call<{ messages?: { role: string; text?: string; timestamp?: number; row_id?: number }[] }>(
        'session.history',
        { session_id: sid },
      );
      return LiveHermesAdapter.mapHistoryMessages(h);
    } catch {
      return this.fallback.getAssistantHistory(); // graceful degradation (spec §2)
    }
  }

  async sendAssistantMessage(text: string, agentId = 'default'): Promise<AuditResult> {
    try {
      let sid = await this.ensureAssistantSession(agentId);
      try {
        await this.rpc.call('prompt.submit', { session_id: sid, text });
      } catch (e) {
        // Stale runtime sid (gateway restarted): drop it, resume/create, retry ONCE.
        if (!/4001|session not found/i.test(e instanceof Error ? e.message : String(e))) throw e;
        this.assistantSidToAgent.delete(sid);
        this.assistantLane(agentId).sid = undefined;
        sid = await this.ensureAssistantSession(agentId);
        await this.rpc.call('prompt.submit', { session_id: sid, text });
      }
      return { ok: true, auditEventId: `chat-send-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `chat-err-${Date.now()}`, error: { code: 'chat_send_failed', safeMessage: e instanceof Error ? e.message : 'Message failed to send.', retryable: true } };
    }
  }

  subscribeAssistant(handler: (event: AssistantEvent) => void, agentId = 'default'): Unsubscribe {
    this.wireAssistant();
    const lane = this.assistantLane(agentId);
    lane.handlers.add(handler);
    return () => lane.handlers.delete(handler);
  }

  // ----- LIVE: assistant sessions + channel views (W1, D-B1/D-B2) -----
  /**
   * Probed 2026-08-28 (HANDOFF gotcha #17): session.list rows carry
   * {id, title, preview, started_at, message_count, source} — no
   * profile_name/last_activity_at. params.profile scopes the read to that
   * profile's own state.db; the gateway deny-lists kanban/tool sources and
   * returns rows last-active-first.
   */
  async listSessionsFor(profile?: string): Promise<AssistantSessionRef[]> {
    try {
      const r = await this.rpc.call<{ sessions?: { id: string; title?: string; preview?: string; started_at?: number; message_count?: number; source?: string }[] }>(
        'session.list',
        { limit: 50, ...(profile ? { profile } : {}) },
      );
      return (r.sessions ?? []).map((s) => ({
        id: s.id,
        title: s.title || '(untitled)',
        preview: s.preview ?? '',
        startedAt: s.started_at ? new Date(s.started_at * 1000).toISOString() : new Date(0).toISOString(),
        messageCount: s.message_count ?? 0,
        source: s.source ?? '',
      }));
    } catch {
      return this.fallback.listSessionsFor(profile); // graceful degradation (spec §2)
    }
  }

  /**
   * Read-only channel: delegations (kanban ownerId filter) + the agent's
   * canonical "Bot Chat" (exact-title lookup, include_hidden — canonical
   * chats are born hidden; resolved_id = compression tip). No Bot Chat →
   * agentChat null (honest absence, not an error).
   */
  async getChannelFor(agentId: string): Promise<AgentChannel> {
    try {
      const [work, bot] = await Promise.all([
        this.listWorkItems(),
        this.rpc.call<{ sessions?: { id: string; resolved_id?: string }[] }>(
          'session.list',
          { profile: agentId, title: 'Bot Chat', include_hidden: true },
        ),
      ]);
      const row = bot.sessions?.[0];
      const agentChat = row ? await this.getSessionTranscript(agentId, row.resolved_id ?? row.id) : null;
      return { delegations: work.filter((w) => w.ownerId === agentId), agentChat };
    } catch {
      return this.fallback.getChannelFor(agentId); // graceful degradation (spec §2)
    }
  }

  /** Read-only transcript of any session of any profile (channel drawer). */
  async getSessionTranscript(profile: string | undefined, sessionId: string): Promise<ChatMessage[]> {
    try {
      const h = await this.rpc.call<{ messages?: { role: string; text?: string; timestamp?: number; row_id?: number }[] }>(
        'session.history',
        { session_id: sessionId, ...(profile ? { profile } : {}) },
      );
      return LiveHermesAdapter.mapHistoryMessages(h);
    } catch {
      return this.fallback.getSessionTranscript(profile, sessionId); // graceful degradation (spec §2)
    }
  }

  /** Rebind the default (Ally) lane to a runtime sid + persist the stored id. */
  private bindAllyLane(runtimeSid: string, storedId?: string) {
    const lane = this.assistantLane('default');
    if (lane.sid && lane.sid !== runtimeSid) this.assistantSidToAgent.delete(lane.sid);
    lane.sid = runtimeSid;
    this.assistantSidToAgent.set(runtimeSid, 'default');
    if (storedId) localStorage.setItem(LiveHermesAdapter.assistantStoredKey('default'), storedId);
  }

  /**
   * Resume one of Ally's stored sessions into the chat. The localStorage
   * stored id is overwritten ONLY after the gateway confirms the resume —
   * a failed resume leaves the previous conversation untouched.
   */
  async resumeAssistantSession(storedId: string): Promise<AuditResult> {
    try {
      const r = await this.rpc.call<{ session_id?: string }>('session.resume', { session_id: storedId });
      if (!r.session_id) throw new Error('resume returned no session id');
      this.bindAllyLane(r.session_id, storedId);
      return { ok: true, auditEventId: `chat-resume-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `chat-resume-err-${Date.now()}`, error: { code: 'chat_resume_failed', safeMessage: e instanceof Error ? e.message : 'Could not resume that conversation.', retryable: true } };
    }
  }

  /** Fresh Ally chat: create a new session (bypassing the stored id) and rebind. */
  async startNewAssistantChat(): Promise<AuditResult> {
    try {
      const c = await this.rpc.call<{ session_id: string; stored_session_id?: string }>('session.create', { title: 'EAiOS — My Assistant' });
      if (!c.session_id) throw new Error('create returned no session id');
      this.bindAllyLane(c.session_id, c.stored_session_id);
      return { ok: true, auditEventId: `chat-new-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `chat-new-err-${Date.now()}`, error: { code: 'chat_new_failed', safeMessage: e instanceof Error ? e.message : 'Could not start a new chat.', retryable: true } };
    }
  }

  // ----- LIVE: environment files (Phase 6.2) -----
  /**
   * D4 allowlist: SOUL.md of each Hermes profile — the only .MD the gateway
   * exposes (profiles.describe returns `soul`; profiles.configure writes it).
   * No generic file RPC exists, and the mock's ALLY.md/OPERATING_RULES.txt
   * never existed on disk — the live list shows exactly what the host
   * supports. lastModifiedAt is omitted (no mtime in the RPC).
   */
  async listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]> {
    try {
      const res = await this.rpc.call<{ profiles: HermesProfile[] }>('profiles.list');
      return (res.profiles ?? []).map((p) => ({
        id: `soul-${p.name}`,
        name: p.is_default ? 'SOUL.md (Ally — default profile)' : `SOUL.md (${p.display_name || p.name})`,
        path: p.is_default ? '~/.hermes/SOUL.md' : `~/.hermes/profiles/${p.name}/SOUL.md`,
      }));
    } catch {
      return this.fallback.listEditableEnvironmentFiles(); // graceful degradation (spec §2)
    }
  }

  async readEnvironmentFile(id: string): Promise<EnvironmentFile> {
    const profile = id.replace(/^soul-/, '');
    try {
      const d = await this.rpc.call<{ soul?: string }>('profiles.describe', { name: profile });
      const content = d.soul ?? '';
      const refs = await this.listEditableEnvironmentFiles();
      const ref = refs.find((r) => r.id === id) ?? { id, name: `SOUL.md (${profile})`, path: `~/.hermes/profiles/${profile}/SOUL.md` };
      return { ref, content, version: contentHash(content) };
    } catch {
      return this.fallback.readEnvironmentFile(id); // graceful degradation (spec §2)
    }
  }

  /**
   * Read-compare-write against the gateway. NOT atomic — the host has no
   * soul write precondition, so the CAS window is the editor's save click
   * (recorded in docs/phase6-brief.md §6.2; fine at executive scale).
   */
  async writeEnvironmentFile(id: string, expectedVersion: string, content: string): Promise<AuditResult> {
    const profile = id.replace(/^soul-/, '');
    try {
      const fresh = await this.rpc.call<{ soul?: string }>('profiles.describe', { name: profile });
      if (contentHash(fresh.soul ?? '') !== expectedVersion) {
        return { ok: false, auditEventId: `env-conflict-${id}-${Date.now()}`, error: { code: 'version_conflict', safeMessage: 'File changed since you opened it. Reload before saving.', retryable: true } };
      }
      await this.rpc.call('profiles.configure', { name: profile, soul: content });
      return { ok: true, auditEventId: `env-write-${id}-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `env-err-${Date.now()}`, error: { code: 'env_write_failed', safeMessage: e instanceof Error ? e.message : 'Save failed.', retryable: true } };
    }
  }
}

export const live = new LiveHermesAdapter();
