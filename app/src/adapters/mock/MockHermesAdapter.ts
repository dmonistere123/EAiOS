/**
 * MockHermesAdapter — in-memory implementation of HermesAdapter.
 * Simulates latency and emits periodic runtime events so the shell behaves
 * live in mock mode (spec §13: mocks are acceptance fixtures, not filler).
 */
import type {
  Agent, Approval, ApprovalDecision, Artifact, AuditResult, CronJob,
  EnvironmentFile, EnvironmentFileRef, RuntimeEvent, TodaySummary,
  UsageSummary, WorkItem, ActivityEvent, Skill, Playbook, PlaybookRun,
} from '../../domain/types';
import type {
  AgentConfigPatch, ApprovalFilter, ArtifactFilter, CreateCronJob,
  CronJobPatch, DateRange, DelegationRequest, HermesAdapter, Unsubscribe, WorkFilter,
} from '../interfaces';
import * as fx from '../../mocks/fixtures';

const delay = (ms = 180) => new Promise((r) => setTimeout(r, ms + Math.random() * 160));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 8)}`;
let auditSeq = 1000;
const audit = <T,>(data?: T): AuditResult<T> => ({ ok: true, data, auditEventId: `aud-${auditSeq++}` });

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
    this.agents = this.agents.map((a) => (a.id === agentId ? { ...a, ...patch } : a));
    this.emit('config.changed', agentId, `Model updated to ${patch.model?.model ?? 'unchanged'}`);
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
    return audit();
  }

  async listCronJobs(): Promise<CronJob[]> { await delay(); return clone(this.cron); }

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

  async getUsage(_range: DateRange): Promise<UsageSummary> { await delay(); return clone(fx.usageSummary); }

  async listSkills(): Promise<Skill[]> {
    await delay();
    return fx.skillsAndPlaybooks
      .filter((r) => r.kind === 'skill')
      .map((r) => ({
        id: r.id,
        name: r.name,
        category: 'productivity',
        description: r.purpose,
        version: r.version,
        status: 'enabled' as const,
      }));
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

  async listEditableEnvironmentFiles(): Promise<EnvironmentFileRef[]> {
    await delay();
    return [
      { id: 'env-01', name: 'ALLY.md', path: '~/.hermes/ALLY.md', lastModifiedAt: new Date().toISOString() },
      { id: 'env-02', name: 'OPERATING_RULES.txt', path: '~/.hermes/OPERATING_RULES.txt', lastModifiedAt: new Date().toISOString() },
    ];
  }

  async readEnvironmentFile(id: string): Promise<EnvironmentFile> {
    await delay();
    const refs = await this.listEditableEnvironmentFiles();
    const ref = refs.find((r) => r.id === id)!;
    const content = id === 'env-01'
      ? '# Ally — Operating Identity\n\nYou are Ally, chief of staff to the executive.\n\n## Voice\nCrisp, warm, direct. Summary first, detail on request.\n\n## Priorities\n1. Protect the executive’s time\n2. Never send externally without approval\n'
      : 'OPERATING RULES\n\n1. External writes require approval.\n2. Escalate critical-risk items immediately.\n3. Weekly metrics digest ships Friday 16:00.\n';
    return { ref, content, version: String(content.length) };
  }

  async writeEnvironmentFile(id: string, expectedVersion: string, _content: string): Promise<AuditResult> {
    await delay(250);
    const current = await this.readEnvironmentFile(id);
    if (current.version !== expectedVersion) {
      return { ok: false, auditEventId: `aud-${auditSeq++}`, error: { code: 'version_conflict', safeMessage: 'File changed since you opened it. Reload before saving.', retryable: true } };
    }
    this.emit('config.changed', undefined, `Environment file saved: ${id}`);
    return audit();
  }
}

export const hermes = new MockHermesAdapter();
