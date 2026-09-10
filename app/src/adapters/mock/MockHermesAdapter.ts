/**
 * MockHermesAdapter — in-memory implementation of HermesAdapter.
 * Simulates latency and emits periodic runtime events so the shell behaves
 * live in mock mode (spec §13: mocks are acceptance fixtures, not filler).
 */
import type {
  Agent, AgentChannel, Approval, ApprovalDecision, Artifact, AssistantEvent, AssistantSessionRef, AuditResult, ChatMessage, CronJob,
  DelegatedRun, EnvironmentFile, EnvironmentFileRef, RuntimeEvent, TodaySummary,
  UsageSummary, DailySpendReport, WorkItem, ActivityEvent, Skill, Playbook, PlaybookRun, TravelTrip, TravelBooking, TravelAgentResult,
} from '../../domain/types';
import type {
  AgentConfigPatch, ApprovalFilter, ArtifactFilter, CreateAgent, CreateCronJob,
  CreateSkill, CreateWorkItem, CronJobPatch, DateRange, DelegationRequest, HermesAdapter, ModelOptionGroup, PlaybookInput, Unsubscribe, WorkFilter, WorkItemAction, AssistantAttachment,
  CreateTripInput, TravelSearchParams, TravelSearchResult,
} from '../interfaces';
import * as fx from '../../mocks/fixtures';
import { MockTravelAdapter } from './MockTravelAdapter';

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms + Math.random() * 160));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
let auditSeq = 1000;
const audit = <T,>(data?: T): AuditResult<T> => ({ ok: true, data, auditEventId: `aud-${auditSeq++}` });

// W7 mock helpers — mirror server/authoring.ts (client bundle can't import node:fs).
const mockSlugify = (raw: string) =>
  raw.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'a$1');
const mockBumpPatch = (version?: string) => {
  const m = version?.match(/^(\d+)\.(\d+)\.(\d+)$/);
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '0.1.0';
};

type Handler = (e: RuntimeEvent) => void;

class MockHermesAdapter implements HermesAdapter {
  private agents = clone(fx.agents);
  private work = clone(fx.workItems);
  private approvals = clone(fx.approvals);
  private cron = clone(fx.cronJobs);
  private activity = clone(fx.activity);
  private artifacts = clone(fx.artifacts);
  private handlers = new Set<Handler>();
  private tick?: ReturnType<typeof setInterval>;
  private travel = new MockTravelAdapter();
  private dismissed = new Set<string>();

  // ----- event simulation -------------------------------------------------
  private emit(type: RuntimeEvent['type'], agentId: string | undefined, action: string, workItemId?: string) {
    const evt: RuntimeEvent = { id: uid('evt'), type, occurredAt: new Date().toISOString(), agentId, workItemId, payload: { action } };
    const row: ActivityEvent = {
      id: evt.id, type, occurredAt: evt.occurredAt, agentId, workItemId,
      action, result: 'in progress', severity: 'info',
    };
    this.activity = [row, ...this.activity].slice(0, 200);
    this.handlers.forEach((h) => h(evt));
  }

  subscribeEvents(handler: Handler): Unsubscribe {
    this.handlers.add(handler);
    if (!this.tick) {
      const working = () => this.agents.filter((a) => a.status === 'working');
      this.tick = setInterval(() => {
        const active = working();
        if (active.length === 0) return;
        const a = active[Math.floor(Math.random() * active.length)];
        const lines = [
          'Processing tool call…', 'Reading source material…', 'Composing section…',
          'Cross-checking facts…', 'Summarizing findings…', 'Updating draft…',
        ];
        this.emit('agent.progress', a.id, lines[Math.floor(Math.random() * lines.length)], a.currentWorkItemId);
        this.agents = this.agents.map((x) => (x.id === a.id ? { ...x, lastActivityAt: new Date().toISOString() } : x));
      }, 7000);
    }
    return () => {
      this.handlers.delete(handler);
      if (this.handlers.size === 0 && this.tick) {
        clearInterval(this.tick);
        this.tick = undefined;
      }
    };
  }

  /** Test hook: stop the background event tick. */
  __stopEvents() {
    if (this.tick) {
      clearInterval(this.tick);
      this.tick = undefined;
    }
  }

  /** Test hook: clear the server-side-dismissed simulation. */
  __clearDismissed() {
    this.dismissed.clear();
  }

  /** §13 acceptance-fixture API: replace mock state wholesale (scenario tests only — never called by pages). */
  __loadFixture(patch: { agents?: Agent[]; work?: WorkItem[]; approvals?: Approval[]; cron?: CronJob[]; activity?: ActivityEvent[]; artifacts?: Artifact[] }) {
    if (patch.agents) this.agents = clone(patch.agents);
    if (patch.work) this.work = clone(patch.work);
    if (patch.approvals) this.approvals = clone(patch.approvals);
    if (patch.cron) this.cron = clone(patch.cron);
    if (patch.activity) this.activity = clone(patch.activity);
    if (patch.artifacts) this.artifacts = clone(patch.artifacts);
  }

  /** §13: drive a runtime event through the mock's event bus (scenario tests). */
  __emit(type: RuntimeEvent['type'], agentId: string | undefined, action: string, workItemId?: string) {
    this.emit(type, agentId, action, workItemId);
  }

  // ----- reads --------------------------------------------------------------
  async getTodaySummary(): Promise<TodaySummary> {
    await delay();
    const h = new Date().getHours();
    return {
      greeting: h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening',
      date: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      executivePriorities: this.work.filter((w) => w.ownerType === 'executive' && !['complete', 'cancelled'].includes(w.state)).length,
      delegatableCount: this.work.filter((w) => w.delegationCandidate && w.ownerType === 'executive').length,
      approvalsWaiting: this.approvals.filter((a) => a.status === 'pending').length,
      nextMeetingAt: fx.calendarEvents.find((e) => e.source === 'executive')?.startsAt,
      nextMeetingLabel: fx.calendarEvents.find((e) => e.source === 'executive')?.title,
      headline: 'Ally is drafting the investor update; 3 items need your decision.',
    };
  }

  async listAgents(): Promise<Agent[]> { await delay(); return clone(this.agents); }

  async getAgent(agentId: string): Promise<Agent> {
    await delay();
    const a = this.agents.find((x) => x.id === agentId);
    if (!a) throw new Error(`agent not found: ${agentId}`);
    return clone(a);
  }

  async updateAgentConfig(agentId: string, patch: AgentConfigPatch): Promise<AuditResult> {
    await delay(300);
    const before = this.agents.find((a) => a.id === agentId);
    if (!before) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Agent not found.', retryable: false } };
    if (patch.model && !before.availableModels.some((m) => m.model === patch.model!.model && m.provider === patch.model!.provider)) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'model_not_allowed', safeMessage: 'That model is not in this agent’s allowed list.', retryable: false } };
    }
    // description maps to the role line (profiles.configure semantics)
    const { description, ...rest } = patch;
    this.agents = this.agents.map((a) => (a.id === agentId ? { ...a, ...rest, ...(description !== undefined ? { role: description } : {}) } : a));
    this.emit('config.changed', agentId, `Agent config updated: ${agentId}`);
    return audit();
  }

  /** Mock model catalog — small but shaped like the live model.options payload. */
  async listModelOptions(): Promise<ModelOptionGroup[]> {
    await delay(100);
    return [
      { slug: 'nous', name: 'Nous Portal', models: ['moonshotai/kimi-k3', 'anthropic/claude-sonnet-5', 'openai/gpt-5.5'], authenticated: true },
      { slug: 'openrouter', name: 'OpenRouter', models: ['anthropic/claude-haiku-4.5', 'deepseek/deepseek-v4-flash'], authenticated: true },
    ];
  }

  /** Mock agent factory: validates slug + duplicates, then staffs the new agent. */
  async createAgent(input: CreateAgent): Promise<AuditResult> {
    await delay(250);
    if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_name', safeMessage: 'Agent id must be a lowercase slug (letters, digits, dashes; start with a letter).', retryable: false } };
    }
    if (this.agents.some((a) => a.id === input.name)) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'duplicate', safeMessage: `An agent named "${input.name}" already exists.`, retryable: false } };
    }
    this.agents = [
      ...this.agents,
      {
        id: input.name,
        name: input.name.charAt(0).toUpperCase() + input.name.slice(1),
        role: input.role || 'Specialist agent',
        reportsToAgentId: 'default',
        model: { provider: input.model.provider, model: input.model.model },
        availableModels: [{ provider: input.model.provider, model: input.model.model }],
        tools: [{ id: 'hermes', name: 'Hermes toolset' }],
        status: 'idle',
        lastActivityAt: new Date().toISOString(),
        health: 'healthy',
      },
    ];
    this.emit('config.changed', input.name, `Agent created: ${input.name} (${input.model.provider}/${input.model.model})`);
    return audit();
  }

  /** Mock Telegram binding (dogfood 2026-08-29): a Set of bound profile ids. */
  private botBindings = new Set<string>();

  async getTelegramBotStatus(profile: string): Promise<{ bound: boolean }> {
    await delay(80);
    return { bound: this.botBindings.has(profile) };
  }

  async setTelegramBotToken(profile: string, token: string): Promise<AuditResult> {
    await delay(150);
    if (!/^[a-z][a-z0-9-]*$/.test(profile) || profile === 'default') {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_profile', safeMessage: 'Invalid profile (default profile .env is user-edits-only).', retryable: false } };
    }
    if (!token.trim()) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_input', safeMessage: 'Bot token is required.', retryable: false } };
    }
    this.botBindings.add(profile);
    this.emit('config.changed', profile, `Telegram bot bound for ${profile}`);
    return audit();
  }

  async listWorkItems(filter?: WorkFilter): Promise<WorkItem[]> {
    await delay();
    let rows = this.work;
    if (filter?.state) rows = rows.filter((w) => filter.state!.includes(w.state));
    if (filter?.ownerType) rows = rows.filter((w) => w.ownerType === filter.ownerType);
    if (filter?.delegationCandidate) rows = rows.filter((w) => w.delegationCandidate);
    return clone(rows);
  }

  async getDismissedWorkIds(): Promise<string[]> {
    await delay(50);
    return [...this.dismissed];
  }

  async dismissWorkItem(id: string): Promise<AuditResult> {
    await delay(100);
    this.dismissed.add(id);
    return audit();
  }

  async undismissWorkItem(id: string): Promise<AuditResult> {
    await delay(100);
    this.dismissed.delete(id);
    return audit();
  }

  async delegateWork(workItemId: string, request: DelegationRequest): Promise<AuditResult> {
    await delay(250);
    const agentId = request.agentId ?? 'ally';
    this.work = this.work.map((w) =>
      w.id === workItemId
        ? { ...w, state: 'delegated', ownerType: 'agent', ownerId: agentId, delegationCandidate: false, updatedAt: new Date().toISOString() }
        : w,
    );
    this.agents = this.agents.map((a) =>
      a.id === agentId && a.status === 'idle' ? { ...a, status: 'queued', currentWorkItemId: workItemId, lastActivityAt: new Date().toISOString() } : a,
    );
    this.emit('work.updated', agentId, `Delegated work item ${workItemId}`, workItemId);
    // Simulate the agent picking it up shortly after.
    setTimeout(() => {
      this.agents = this.agents.map((a) => (a.id === agentId ? { ...a, status: 'working', lastActivityAt: new Date().toISOString() } : a));
      this.work = this.work.map((w) => (w.id === workItemId ? { ...w, state: 'in_progress', updatedAt: new Date().toISOString() } : w));
      this.emit('agent.started', agentId, 'Picked up delegated work', workItemId);
    }, 4000);
    return audit();
  }

  /** Mock on-the-fly delegation (dogfood 2026-08-29). */
  async createWorkItem(input: CreateWorkItem): Promise<AuditResult> {
    await delay(200);
    if (!input.title.trim()) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_input', safeMessage: 'A title is required.', retryable: false } };
    }
    const id = `w-new-${Date.now() % 100000}`;
    this.work = [
      {
        id,
        title: input.title.trim(),
        summary: input.summary?.trim() || undefined,
        priority: input.priority ?? 'medium',
        ownerType: input.agentId ? 'agent' : 'executive',
        ownerId: input.agentId,
        state: input.agentId ? 'delegated' : 'ready',
        delegationCandidate: !input.agentId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      ...this.work,
    ];
    this.emit('work.created', input.agentId, input.agentId ? `Task created and delegated: ${input.title.trim()}` : `Task created: ${input.title.trim()}`, id);
    return { ...audit(), id };
  }

  async listApprovals(filter?: ApprovalFilter): Promise<Approval[]> {
    await delay();
    let rows = this.approvals;
    if (filter?.status) rows = rows.filter((a) => filter.status!.includes(a.status));
    if (filter?.risk) rows = rows.filter((a) => filter.risk!.includes(a.risk));
    return clone(rows);
  }

  async decideApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult> {
    await delay(250);
    const ap = this.approvals.find((a) => a.id === approvalId);
    if (!ap) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Approval not found.', retryable: false } };
    this.approvals = this.approvals.map((a) => (a.id === approvalId ? { ...a, status: decision.decision } : a));
    this.emit('approval.decided', ap.requestedByAgentId, `Approval ${decision.decision}: ${ap.targetObject ?? ap.targetSystem}`, ap.workItemId);
    // Parity with live assign-on-approve (2026-08-29): the requester executes.
    if (decision.decision === 'approved') {
      this.emit('agent.started', ap.requestedByAgentId, `Executing approved action: ${ap.targetObject ?? ap.targetSystem}`, ap.workItemId);
    }
    return audit();
  }

  async updateApprovalPayload(approvalId: string, payload: string): Promise<AuditResult> {
    await delay(200);
    const ap = this.approvals.find((a) => a.id === approvalId);
    if (!ap) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Approval not found.', retryable: false } };
    this.approvals = this.approvals.map((a) => (a.id === approvalId ? { ...a, payload } : a));
    this.emit('approval.updated', ap.requestedByAgentId, `Approval payload updated: ${ap.targetObject ?? ap.targetSystem}`, ap.workItemId);
    return audit();
  }

  async listCronJobs(profile?: string): Promise<CronJob[]> {
    await delay();
    // W5 mock parity: profile scopes to that agent's jobs; undefined = all.
    return clone(profile ? this.cron.filter((c) => c.ownerAgentId === profile) : this.cron);
  }

  async createCronJob(input: CreateCronJob): Promise<AuditResult<CronJob>> {
    await delay(250);
    const job: CronJob = { id: uid('c'), nextRunAt: new Date(Date.now() + 3600_000).toISOString(), lastResult: undefined, enabled: true, ...input };
    this.cron = [...this.cron, job];
    this.emit('config.changed', input.ownerAgentId, `Cron job created: ${input.name}`);
    return audit(clone(job));
  }

  async updateCronJob(id: string, patch: CronJobPatch): Promise<AuditResult> {
    await delay(250);
    this.cron = this.cron.map((c) => (c.id === id ? { ...c, ...patch } : c));
    this.emit('config.changed', undefined, `Cron job updated: ${id}`);
    return audit();
  }

  async deleteCronJob(id: string): Promise<AuditResult> {
    await delay(250);
    this.cron = this.cron.filter((c) => c.id !== id);
    this.emit('config.changed', undefined, `Cron job removed: ${id}`);
    return audit();
  }

  /** Mock dynamic kanban control (dogfood 2026-08-29). */
  async setWorkItemState(workItemId: string, action: WorkItemAction, note?: string): Promise<AuditResult> {
    await delay(200);
    const item = this.work.find((w) => w.id === workItemId);
    if (!item) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Task not found.', retryable: false } };
    if (action === 'delete') {
      this.work = this.work.filter((w) => w.id !== workItemId);
      this.emit('work.updated', item.ownerId, `Deleted: ${item.title}${note ? ` — ${note}` : ''}`, workItemId);
      return audit();
    }
    const stateFor: Record<Exclude<WorkItemAction, 'delete'>, WorkItem['state']> = {
      pause: 'blocked',
      resume: item.ownerId ? 'delegated' : 'ready',
      complete: 'complete',
      stop: 'cancelled',
      defer: 'delegated',
      reclaim: item.ownerId ? 'delegated' : 'ready',
    };
    this.work = this.work.map((w) => (w.id === workItemId ? { ...w, state: stateFor[action], updatedAt: new Date().toISOString() } : w));
    this.emit('work.updated', item.ownerId, `${action}: ${item.title}${note ? ` — ${note}` : ''}`, workItemId);
    return audit();
  }

  /** Mock health: no real runs exist, so the 30-min heuristic stands in
   * (documented — live mode uses host diagnostics, never timestamps). */
  async getWorkItemHealth(workItemIds: string[]): Promise<Record<string, 'healthy' | 'stale' | 'unknown'>> {
    await delay(60);
    return Object.fromEntries(
      workItemIds.map((id) => {
        const w = this.work.find((x) => x.id === id);
        const stale = w?.state === 'in_progress' && Date.now() - new Date(w.updatedAt).getTime() > 30 * 60_000;
        return [id, stale ? ('stale' as const) : ('healthy' as const)];
      }),
    );
  }

  async listActivity(limit = 50): Promise<ActivityEvent[]> {
    await delay(80);
    return clone(this.activity.slice(0, limit));
  }

  async listArtifacts(filter?: ArtifactFilter): Promise<Artifact[]> {
    await delay();
    let rows = this.artifacts;
    if (filter?.state) rows = rows.filter((a) => filter.state!.includes(a.state));
    if (filter?.createdByAgentId) rows = rows.filter((a) => a.createdByAgentId === filter.createdByAgentId);
    return clone(rows);
  }

  async getArtifactPreview(id: string): Promise<string | null> {
    await delay(120);
    const a = this.artifacts.find((x) => x.id === id);
    if (!a || !a.previewAvailable) return null;
    if (a.mimeType === 'text/html') {
      return `<!doctype html><html><head><meta charset="utf-8"><title>${a.name}</title><style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;line-height:1.6;color:#111}h1{border-bottom:2px solid #eee;padding-bottom:.5rem}</style></head><body><h1>${a.name}</h1><p>Mock preview content for an HTML report — created by ${a.createdByAgentId} for ${a.workItemId ?? 'no work item'}.</p><p>This is where the rendered HTML report appears in the preview drawer and in a new browser tab.</p></body></html>`;
    }
    return `# ${a.name}\n\nMock preview content for ${a.name} — created by ${a.createdByAgentId} for ${a.workItemId ?? 'no work item'}.\n\n## Summary\nThis is where the rendered text of the artifact appears in the preview drawer.\n`;
  }

  /** Governed share (§8.9): mock appends a pending approval linked to the artifact. */
  async shareArtifact(id: string): Promise<AuditResult> {
    await delay(200);
    const a = this.artifacts.find((x) => x.id === id);
    if (!a) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Artifact not found.', retryable: false } };
    const approvalId = `a-share-${id}`;
    this.approvals = [
      ...this.approvals,
      {
        id: approvalId,
        workItemId: a.workItemId ?? approvalId,
        requestedByAgentId: a.createdByAgentId,
        actionType: 'send',
        targetSystem: 'external',
        targetObject: a.name,
        risk: 'medium',
        status: 'pending',
        submittedAt: new Date().toISOString(),
        evidence: [{ kind: 'artifact', label: a.name, uri: `eaios://artifact/${a.id}` }],
        rollbackPlan: 'Share not yet executed — approving records the decision; the sharing agent executes under the approvals policy.',
      },
    ];
    this.artifacts = this.artifacts.map((x) => (x.id === id ? { ...x, approvalId } : x));
    this.emit('approval.decided', a.createdByAgentId, `Share approval requested: ${a.name}`, a.workItemId);
    return audit();
  }

  async getUsage(_range: DateRange): Promise<UsageSummary> { await delay(); return clone(fx.usageSummary); }

  /** F15: mock budget lives in the fixture — edits persist for the session. */
  async setUsageBudget(budgetUsd: number | null): Promise<AuditResult> {
    await delay(150);
    fx.usageSummary.budgetUsd = budgetUsd ?? undefined;
    this.emit('config.changed', undefined, budgetUsd === null ? 'Usage budget cleared' : `Usage budget set to $${budgetUsd}`);
    return audit();
  }

  async getDailySpend(_days = 14): Promise<DailySpendReport> {
    await delay();
    return clone(fx.dailySpendReport);
  }

  /** F29: mock threshold lives in the fixture — edits persist for the session. */
  async setDailySpendAlert(thresholdUsd: number | null): Promise<AuditResult> {
    await delay(150);
    fx.dailySpendReport.thresholdUsd = thresholdUsd ?? 5;
    for (const d of fx.dailySpendReport.days) d.overThreshold = d.costUsd > fx.dailySpendReport.thresholdUsd;
    this.emit('config.changed', undefined, thresholdUsd === null ? 'Daily spend alert cleared (default $5)' : `Daily spend alert set to $${thresholdUsd}`);
    return audit();
  }

  /** W7: writable in-memory skills list (create lands here; mock parity). */
  private skillsList: Skill[] = fx.skillsAndPlaybooks
    .filter((r) => r.kind === 'skill')
    .map((r) => ({
      id: r.id,
      name: r.name,
      category: 'productivity',
      description: r.purpose,
      version: r.version,
      status: 'enabled' as const,
    }));

  async listSkills(): Promise<Skill[]> {
    await delay();
    return clone(this.skillsList);
  }

  /** Mock skill authoring (W7): slug/category validated, duplicates refused. */
  async createSkill(input: CreateSkill): Promise<AuditResult> {
    await delay(200);
    const slug = input.name.trim();
    const category = input.category.trim();
    if (!/^[a-z][a-z0-9-]*$/.test(slug) || !/^[a-z][a-z0-9-]*$/.test(category)) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_name', safeMessage: 'Skill name and category must be lowercase slugs.', retryable: false } };
    }
    if (!input.description.trim() || !input.body.trim()) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_input', safeMessage: 'Description and body are required.', retryable: false } };
    }
    if (this.skillsList.some((sk) => sk.id === slug)) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'already_exists', safeMessage: `Skill "${slug}" already exists — editing arrives in a later workstream.`, retryable: false } };
    }
    this.skillsList = [...this.skillsList, { id: slug, name: slug, category, description: input.description, version: '0.1.0', status: 'enabled' }];
    this.emit('config.changed', undefined, `Skill created: ${slug}`);
    return audit();
  }

  async updateSkillStatus(slug: string, category: string, status: 'enabled' | 'disabled'): Promise<AuditResult> {
    await delay(150);
    const sk = this.skillsList.find((s) => s.id === slug && s.category === category);
    if (!sk) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Skill not found.', retryable: false } };
    this.skillsList = this.skillsList.map((s) => (s.id === slug ? { ...s, status } : s));
    this.emit('config.changed', undefined, `Skill ${status}: ${slug}`);
    return audit();
  }

  async deleteSkill(slug: string, category: string): Promise<AuditResult> {
    await delay(150);
    const sk = this.skillsList.find((s) => s.id === slug && s.category === category);
    if (!sk) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Skill not found.', retryable: false } };
    this.skillsList = this.skillsList.filter((s) => !(s.id === slug && s.category === category));
    this.emit('config.changed', undefined, `Skill deleted: ${slug}`);
    return audit();
  }

  // ----- playbooks (Phase 5.4) -----

  private playbooks: Playbook[] = fx.skillsAndPlaybooks
    .filter((r) => r.kind === 'playbook')
    .map((r) => ({
      id: r.id,
      name: r.name,
      description: r.purpose,
      version: r.version,
      status: r.status,
      enabled: true,
      ownerAgentId: r.ownerAgentId,
      mode: 'task' as const,
      body: `# ${r.name}\n\nMock workflow body — the live adapter reads the real markdown from ~/eaios/playbooks.`,
      skills: [],
    }));

  private playbookRuns: PlaybookRun[] = [
    {
      id: 'run-seed-01',
      playbookId: 'p-02',
      playbookVersion: '1.2.0',
      title: 'Playbook: Monthly Expense Audit v1.2.0',
      assignee: 'ledger',
      state: 'complete',
      createdAt: new Date(Date.now() - 3 * 86400_000).toISOString(),
      completedAt: new Date(Date.now() - 3 * 86400_000 + 540_000).toISOString(),
      result: 'Digest archived; 4 anomalies (1 medium, 3 low).',
    },
  ];

  async listPlaybooks(): Promise<Playbook[]> {
    await delay();
    return clone(this.playbooks);
  }

  async runPlaybook(playbookId: string, opts?: { assignee?: string }): Promise<AuditResult<PlaybookRun>> {
    await delay(250);
    const pb = this.playbooks.find((p) => p.id === playbookId);
    if (!pb) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Playbook not found.', retryable: false } };
    const assignee = opts?.assignee ?? pb.assignee;
    const run: PlaybookRun = {
      id: uid('run'),
      playbookId: pb.id,
      playbookVersion: pb.version,
      title: `Playbook: ${pb.name} v${pb.version}`,
      assignee,
      state: assignee ? 'delegated' : 'ready',
      createdAt: new Date().toISOString(),
    };
    this.playbookRuns = [run, ...this.playbookRuns];
    this.emit('work.updated', assignee, `Playbook run started: ${pb.name}`);
    if (assignee) {
      // Simulate pickup + completion like delegateWork does.
      setTimeout(() => {
        this.playbookRuns = this.playbookRuns.map((r) => (r.id === run.id ? { ...r, state: 'in_progress' } : r));
        this.emit('agent.started', assignee, `Running playbook ${pb.name}`);
      }, 3000);
      setTimeout(() => {
        this.playbookRuns = this.playbookRuns.map((r) =>
          r.id === run.id ? { ...r, state: 'complete', completedAt: new Date().toISOString(), result: 'Mock run complete.' } : r,
        );
        this.emit('agent.completed', assignee, `Playbook ${pb.name} finished`);
      }, 8000);
    }
    return audit(clone(run));
  }

  async listPlaybookRuns(playbookId?: string): Promise<PlaybookRun[]> {
    await delay();
    const rows = playbookId ? this.playbookRuns.filter((r) => r.playbookId === playbookId) : this.playbookRuns;
    return clone(rows);
  }

  /**
   * Mock playbook authoring (W7): same version discipline as the server —
   * create → 0.1.0; edit → patch bump of the CURRENT version; editing a
   * published playbook lands as a new draft.
   */
  async savePlaybook(input: PlaybookInput): Promise<AuditResult<Playbook>> {
    await delay(200);
    if (!input.name.trim() || !input.body.trim()) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_input', safeMessage: 'Name and body are required.', retryable: false } };
    }
    const slug = input.id ?? mockSlugify(input.name);
    if (!/^[a-z][a-z0-9-]*$/.test(slug)) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'invalid_name', safeMessage: 'Playbook id must be a lowercase slug.', retryable: false } };
    }
    const existing = this.playbooks.find((p) => p.id === slug);
    const saved: Playbook = {
      id: slug,
      name: input.name,
      description: input.description,
      version: existing ? mockBumpPatch(existing.version) : '0.1.0',
      status: existing ? (existing.status === 'published' ? 'draft' : input.status) : input.status,
      enabled: true,
      ownerAgentId: input.ownerAgentId,
      mode: input.mode,
      assignee: input.assignee,
      body: input.body,
      skills: input.skills,
      workers: input.workers,
      verifier: input.verifier,
      synthesizer: input.synthesizer,
    };
    this.playbooks = existing ? this.playbooks.map((p) => (p.id === slug ? saved : p)) : [...this.playbooks, saved];
    this.emit('config.changed', input.ownerAgentId, `Playbook ${existing ? 'updated' : 'created'}: ${input.name} v${saved.version}`);
    return audit(clone(saved));
  }

  async updatePlaybookEnabled(slug: string, enabled: boolean): Promise<AuditResult> {
    await delay(150);
    const pb = this.playbooks.find((p) => p.id === slug);
    if (!pb) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Playbook not found.', retryable: false } };
    this.playbooks = this.playbooks.map((p) => (p.id === slug ? { ...p, enabled } : p));
    this.emit('config.changed', pb.ownerAgentId, `Playbook ${enabled ? 'enabled' : 'disabled'}: ${pb.name}`);
    return audit();
  }

  async deletePlaybook(slug: string): Promise<AuditResult> {
    await delay(150);
    const pb = this.playbooks.find((p) => p.id === slug);
    if (!pb) return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'Playbook not found.', retryable: false } };
    this.playbooks = this.playbooks.filter((p) => p.id !== slug);
    this.emit('config.changed', pb.ownerAgentId, `Playbook deleted: ${pb.name}`);
    return audit();
  }

  // ----- mock assistant chat (Phase 6.4a; lane-keyed F26 2026-08-30) -----
  // Lanes are keyed by agentId ('default' = Ally's main chat, 'concierge' =
  // the navigation widget); the default lane keeps the seeded greeting and
  // its singleton-persistence semantics across tests in a file.
  private assistantThreads = new Map<string, ChatMessage[]>([
    ['default', [{ id: 'm-1', role: 'ally', text: "Morning. I'm Ally — chief of staff. Ask me to draft something, dig into a number, or schedule work across the team.", at: new Date().toISOString() }]],
  ]);
  private assistantHandlers = new Map<string, Set<(e: AssistantEvent) => void>>();

  private assistantLaneThread(agentId = 'default'): ChatMessage[] {
    let t = this.assistantThreads.get(agentId);
    if (!t) {
      t = [];
      this.assistantThreads.set(agentId, t);
    }
    return t;
  }

  private assistantLaneHandlers(agentId = 'default'): Set<(e: AssistantEvent) => void> {
    let h = this.assistantHandlers.get(agentId);
    if (!h) {
      h = new Set();
      this.assistantHandlers.set(agentId, h);
    }
    return h;
  }

  async getAssistantHistory(agentId = 'default'): Promise<ChatMessage[]> {
    await delay();
    return clone(this.assistantLaneThread(agentId));
  }

  /** Mock send: appends the user message, then streams a canned Ally reply. */
  async sendAssistantMessage(text: string, opts: { agentId?: string; attachments?: AssistantAttachment[] } = {}): Promise<AuditResult> {
    await delay(120);
    const agentId = opts.agentId ?? 'default';
    const thread = this.assistantLaneThread(agentId);
    const attachmentNote = opts.attachments?.length
      ? `\n\n[Attached: ${opts.attachments.map((a) => `${a.name} (${a.encoding})`).join(', ')}]`
      : '';
    const fullText = text + attachmentNote;
    thread.push({ id: `m-${Date.now()}-u`, role: 'you', text: fullText, at: new Date().toISOString() });
    const reply = `On it — "${text.slice(0, 60)}"${opts.attachments?.length ? ` with ${opts.attachments.length} attachment${opts.attachments.length === 1 ? '' : 's'}` : ''}. (Mock reply: live mode streams Ally's real answer through the gateway; external actions would route through Approvals.) Grounded in your knowledge base: eaios://chunk/k-01-0`;
    const handlers = this.assistantLaneHandlers(agentId);
    const emit = (e: AssistantEvent) => handlers.forEach((h) => h(e));
    setTimeout(() => {
      emit({ kind: 'start' });
      const words = reply.split(' ');
      words.forEach((w, i) => setTimeout(() => emit({ kind: 'delta', text: (i ? ' ' : '') + w }), 25 * (i + 1)));
      setTimeout(() => {
        thread.push({ id: `m-${Date.now()}-a`, role: 'ally', text: reply, at: new Date().toISOString() });
        emit({ kind: 'complete', text: reply });
      }, 25 * words.length + 80);
    }, 80);
    return audit();
  }

  subscribeAssistant(handler: (event: AssistantEvent) => void, agentId = 'default'): Unsubscribe {
    const handlers = this.assistantLaneHandlers(agentId);
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  // ----- mock assistant sessions + channels (W1, D-B1/D-B2) -----
  private freshGreeting(): ChatMessage {
    return { id: 'm-1', role: 'ally', text: "Morning. I'm Ally — chief of staff. Ask me to draft something, dig into a number, or schedule work across the team.", at: new Date().toISOString() };
  }

  private sessionIndex: Record<string, AssistantSessionRef[]> = {
    ally: [
      { id: 'sess-ally-2', title: 'EAiOS — My Assistant', preview: "Morning. I'm Ally — chief of staff…", startedAt: new Date(Date.now() - 3600_000).toISOString(), messageCount: 3, source: 'desktop' },
      { id: 'sess-ally-1', title: 'Morning review', preview: 'What needs my attention before the board call?', startedAt: new Date(Date.now() - 20 * 3600_000).toISOString(), messageCount: 12, source: 'telegram' },
    ],
    scout: [
      { id: 'sess-scout-1', title: 'AI ops tooling — vendor notes', preview: 'Shortlist is down to four vendors…', startedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), messageCount: 8, source: 'desktop' },
    ],
    quill: [
      { id: 'sess-quill-1', title: 'Newsletter second draft', preview: 'Tightened the opener per your note…', startedAt: new Date(Date.now() - 8 * 3600_000).toISOString(), messageCount: 5, source: 'desktop' },
    ],
  };

  private transcripts: Record<string, ChatMessage[]> = {
    'sess-ally-1': [
      { id: 'ta-1', role: 'you', text: 'What needs my attention before the board call?', at: new Date(Date.now() - 20 * 3600_000).toISOString() },
      { id: 'ta-2', role: 'ally', text: 'Three things: the partnership approval, the Q3 deck narrative, and rain on your Dallas drive Thursday.', at: new Date(Date.now() - 20 * 3600_000 + 60_000).toISOString() },
    ],
    'sess-run-1': [
      { id: 'tr-1', role: 'you', text: 'work kanban task t-run-1', at: new Date(Date.now() - 3 * 3600_000).toISOString() },
      { id: 'tr-2', role: 'ally', text: "Reading both inboxes now — Gmail first, then Outlook.", at: new Date(Date.now() - 3 * 3600_000 + 30_000).toISOString() },
      { id: 'tr-3', role: 'ally', text: 'Triaged Gmail + Outlook: 3 actionable items (Regions alert, Kojo Fit return, AA trip confirmation). Full report attached.', at: new Date(Date.now() - 2.8 * 3600_000).toISOString() },
    ],
    'sess-scout-1': [
      { id: 'ts-1', role: 'you', text: 'Where did the tooling shortlist land?', at: new Date(Date.now() - 5 * 3600_000).toISOString() },
      { id: 'ts-2', role: 'ally', text: 'Shortlist is down to four vendors; pricing notes are in the scan artifact.', at: new Date(Date.now() - 5 * 3600_000 + 60_000).toISOString() },
    ],
    'sess-quill-1': [
      { id: 'tq-1', role: 'you', text: 'Can you tighten the newsletter opener?', at: new Date(Date.now() - 8 * 3600_000).toISOString() },
      { id: 'tq-2', role: 'ally', text: 'Tightened the opener per your note — second draft reads much cleaner.', at: new Date(Date.now() - 8 * 3600_000 + 60_000).toISOString() },
    ],
  };

  /** Bot Chat contract: user rows are Ally's deliveries, assistant rows are the agent. */
  private channelChats: Record<string, ChatMessage[]> = {
    quill: [
      { id: 'cq-1', role: 'you', text: 'Quill — please draft the September customer newsletter. Angle: the EAiOS beta. Nothing sends without executive approval.', at: new Date(Date.now() - 9 * 3600_000).toISOString() },
      { id: 'cq-2', role: 'ally', text: 'Draft is up (work item w-05) — 400 words, and the Mailchimp send is parked in Approvals.', at: new Date(Date.now() - 9 * 3600_000 + 120_000).toISOString() },
    ],
  };

  async listSessionsFor(profile?: string): Promise<AssistantSessionRef[]> {
    await delay();
    const key = !profile || profile === 'default' ? 'ally' : profile;
    return clone(this.sessionIndex[key] ?? []);
  }

  async getChannelFor(agentId: string): Promise<AgentChannel> {
    await delay();
    return {
      delegations: clone(this.work.filter((w) => w.ownerId === agentId)),
      agentChat: this.channelChats[agentId] ? clone(this.channelChats[agentId]) : null,
    };
  }

  async getSessionTranscript(_profile: string | undefined, sessionId: string): Promise<ChatMessage[]> {
    await delay();
    return clone(this.transcripts[sessionId] ?? []);
  }

  /** Delegated runs (mock parity for the rail/Schedule drawers): two fixture
   * runs — one done with a real transcript, one in flight without one. */
  async listDelegatedRuns(): Promise<DelegatedRun[]> {
    await delay();
    return clone(this.delegatedRuns);
  }

  private delegatedRuns: DelegatedRun[] = [
    {
      taskId: 't-run-1',
      title: 'Email triage — both inboxes',
      assignee: 'ally',
      status: 'done',
      result: 'Triaged Gmail + Outlook: 3 actionable items (Regions alert, Kojo Fit return, AA trip confirmation). Full report attached.',
      createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      completedAt: new Date(Date.now() - 2.8 * 3600_000).toISOString(),
      workerSessionId: 'sess-run-1',
      workerMessageCount: 4,
    },
    {
      taskId: 't-run-2',
      title: 'Market scan: AI ops tooling',
      assignee: 'scout',
      status: 'running',
      createdAt: new Date(Date.now() - 900_000).toISOString(),
    },
  ];

  async resumeAssistantSession(storedId: string): Promise<AuditResult> {
    await delay(200);
    const t = this.transcripts[storedId];
    if (!t) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'not_found', safeMessage: 'That conversation could not be resumed.', retryable: false } };
    }
    this.assistantThreads.set('default', clone(t));
    return audit();
  }

  async startNewAssistantChat(agentId = 'default'): Promise<AuditResult> {
    await delay(200);
    // Default lane reseeds its greeting; other lanes reset to EMPTY (the
    // concierge widget renders its own intro card + example prompts).
    this.assistantThreads.set(agentId, agentId === 'default' ? [this.freshGreeting()] : []);
    return audit();
  }

  async listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]> {
    await delay();
    return [
      { id: 'env-01', name: 'ALLY.md', path: '~/.hermes/ALLY.md', lastModifiedAt: new Date().toISOString() },
      { id: 'env-02', name: 'OPERATING_RULES.txt', path: '~/.hermes/OPERATING_RULES.txt', lastModifiedAt: new Date().toISOString() },
    ];
  }

  async readEnvironmentFile(id: string): Promise<EnvironmentFile> {
    await delay();
    // Per-profile SOUL.md (properties drawer editor, dogfood 2026-08-29).
    if (id.startsWith('soul-')) {
      const name = id.replace(/^soul-/, '');
      const content = this.soulContents.get(id) ?? `# ${name} — Operating Identity\n\nMock SOUL.md for ${name} — persona, rules, priorities. Edits persist (version-checked).\n`;
      return {
        ref: { id, name: name === 'ally' || name === 'default' ? 'SOUL.md (Ally — default profile)' : `SOUL.md (${name})`, path: name === 'ally' || name === 'default' ? '~/.hermes/SOUL.md' : `~/.hermes/profiles/${name}/SOUL.md` },
        content,
        version: String(content.length),
      };
    }
    const refs = await this.listEditableEnvironmentFiles();
    const ref = refs.find((r) => r.id === id)!;
    const content = id === 'env-01'
      ? '# Ally — Operating Identity\n\nYou are Ally, chief of staff to the executive.\n\n## Voice\nCrisp, warm, direct. Summary first, detail on request.\n\n## Priorities\n1. Protect the executive’s time\n2. Never send externally without approval\n'
      : 'OPERATING RULES\n\n1. External writes require approval.\n2. Escalate critical-risk items immediately.\n3. Weekly metrics digest ships Friday 16:00.\n';
    return { ref, content, version: String(content.length) };
  }

  private soulContents = new Map<string, string>();

  async writeEnvironmentFile(id: string, expectedVersion: string, _content: string): Promise<AuditResult> {
    await delay(250);
    const current = await this.readEnvironmentFile(id);
    if (current.version !== expectedVersion) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'version_conflict', safeMessage: 'File changed since you opened it. Reload before saving.', retryable: true } };
    }
    if (id.startsWith('soul-')) this.soulContents.set(id, _content);
    this.emit('config.changed', undefined, `Environment file saved: ${id}`);
    return audit();
  }

  // ---------- Travel (F31) ----------
  async listTrips(): Promise<TravelTrip[]> {
    await delay();
    return this.travel.listTrips();
  }

  async getTrip(id: string): Promise<TravelTrip | null> {
    await delay();
    return this.travel.getTrip(id);
  }

  async searchTravel(params: TravelSearchParams): Promise<TravelSearchResult[]> {
    await delay(350);
    return this.travel.searchTravel(params);
  }

  async travelAgent(query: string): Promise<TravelAgentResult> {
    await delay(400);
    return this.travel.travelAgent(query);
  }

  async createTrip(input: CreateTripInput): Promise<AuditResult<TravelTrip>> {
    await delay(250);
    return this.travel.createTrip(input);
  }

  async proposeBooking(tripId: string, resultId: string, note?: string): Promise<AuditResult<TravelBooking>> {
    await delay(250);
    return this.travel.proposeBooking(tripId, resultId, note);
  }

  async decideTravelApproval(approvalId: string, decision: ApprovalDecision): Promise<AuditResult> {
    await delay(200);
    return this.travel.decideTravelApproval(approvalId, decision);
  }

}

export const hermes = new MockHermesAdapter();
