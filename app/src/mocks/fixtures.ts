/**
 * Deterministic mock fixtures (spec §13). Timestamps are relative to load time
 * so the demo always looks alive. Scenario S2 "Busy Day" is the default.
 */
import type {
  Agent,
  Approval,
  Artifact,
  CronJob,
  ActivityEvent,
  KnowledgeSource,
  UsageSummary,
  WorkItem,
} from '../domain/types';
import type { Connection, CalendarEvent } from '../adapters/interfaces';

const now = Date.now();
const min = (m: number) => new Date(now - m * 60_000).toISOString();
const plus = (m: number) => new Date(now + m * 60_000).toISOString();

export const agents: Agent[] = [
  {
    id: 'ally',
    name: 'Ally',
    role: 'Chief of Staff / Orchestrator',
    model: { provider: 'kimi-coding', model: 'kimi-k3' },
    availableModels: [
      { provider: 'kimi-coding', model: 'kimi-k3' },
      { provider: 'anthropic', model: 'claude-sonnet-4.6' },
    ],
    tools: [{ id: 'all', name: 'Full toolset' }],
    status: 'working',
    currentWorkItemId: 'w-03',
    lastActivityAt: min(1),
    health: 'healthy',
  },
  {
    id: 'scout',
    name: 'Scout',
    role: 'Research & Intelligence',
    reportsToAgentId: 'ally',
    model: { provider: 'anthropic', model: 'claude-sonnet-4.6' },
    availableModels: [{ provider: 'anthropic', model: 'claude-sonnet-4.6' }],
    tools: [{ id: 'web', name: 'Web search/extract' }],
    status: 'working',
    currentWorkItemId: 'w-07',
    lastActivityAt: min(3),
    health: 'healthy',
  },
  {
    id: 'quill',
    name: 'Quill',
    role: 'Writing & Communications',
    reportsToAgentId: 'ally',
    model: { provider: 'openai', model: 'gpt-5.2' },
    availableModels: [{ provider: 'openai', model: 'gpt-5.2' }],
    tools: [{ id: 'docs', name: 'Docs & files' }],
    status: 'waiting_approval',
    currentWorkItemId: 'w-05',
    lastActivityAt: min(12),
    health: 'healthy',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    role: 'Finance & Analysis',
    reportsToAgentId: 'ally',
    model: { provider: 'google', model: 'gemini-3-pro' },
    availableModels: [{ provider: 'google', model: 'gemini-3-pro' }],
    tools: [{ id: 'sheets', name: 'Spreadsheets' }],
    status: 'idle',
    lastActivityAt: min(47),
    health: 'unknown',
  },
  {
    id: 'sentinel',
    name: 'Sentinel',
    role: 'Monitoring & Ops',
    reportsToAgentId: 'ally',
    model: { provider: 'xai', model: 'grok-4.1' },
    availableModels: [{ provider: 'xai', model: 'grok-4.1' }],
    tools: [{ id: 'cron', name: 'Scheduler' }],
    status: 'idle',
    lastActivityAt: min(95),
    health: 'healthy',
  },
];

export const workItems: WorkItem[] = [
  { id: 'w-01', title: 'Review Q3 board deck narrative', summary: 'Final pass before Friday', priority: 'critical', ownerType: 'executive', state: 'ready', dueAt: plus(60 * 26), createdAt: min(60 * 20), updatedAt: min(30) },
  { id: 'w-02', title: 'Approve partnership announcement', summary: 'PR is drafted; legal signed off', priority: 'high', ownerType: 'executive', state: 'waiting_approval', dueAt: plus(60 * 6), createdAt: min(60 * 30), updatedAt: min(45) },
  { id: 'w-03', title: 'Prepare investor update email', summary: 'Ally drafting with Quill', priority: 'high', ownerType: 'agent', ownerId: 'ally', state: 'in_progress', dueAt: plus(60 * 20), createdAt: min(60 * 5), updatedAt: min(4) },
  { id: 'w-04', title: 'Weekly metrics review', priority: 'medium', ownerType: 'executive', state: 'ready', delegationCandidate: true, dueAt: plus(60 * 30), createdAt: min(60 * 26), updatedAt: min(120) },
  { id: 'w-05', title: 'Customer newsletter — September', priority: 'medium', ownerType: 'agent', ownerId: 'quill', state: 'waiting_approval', delegationCandidate: true, createdAt: min(60 * 8), updatedAt: min(12) },
  { id: 'w-06', title: 'Competitor pricing sweep', priority: 'medium', ownerType: 'executive', state: 'new', delegationCandidate: true, createdAt: min(60 * 3), updatedAt: min(60 * 3) },
  { id: 'w-07', title: 'Market scan: AI ops tooling', priority: 'low', ownerType: 'agent', ownerId: 'scout', state: 'in_progress', createdAt: min(60 * 10), updatedAt: min(3) },
  { id: 'w-08', title: 'Renew vendor contract — DataPipe', priority: 'high', ownerType: 'executive', state: 'ready', dueAt: plus(60 * 50), createdAt: min(60 * 44), updatedAt: min(200) },
  { id: 'w-09', title: 'Expense anomaly digest', priority: 'low', ownerType: 'agent', ownerId: 'ledger', state: 'complete', createdAt: min(60 * 52), updatedAt: min(47) },
  { id: 'w-10', title: 'Team offsite agenda draft', priority: 'medium', ownerType: 'executive', state: 'new', delegationCandidate: true, createdAt: min(60 * 2), updatedAt: min(60 * 2) },
  { id: 'w-11', title: 'Security review follow-ups', priority: 'high', ownerType: 'executive', state: 'blocked', createdAt: min(60 * 70), updatedAt: min(300) },
  { id: 'w-12', title: 'Archive August reports', priority: 'low', ownerType: 'executive', state: 'ready', delegationCandidate: true, createdAt: min(60 * 90), updatedAt: min(400) },
];

export const approvals: Approval[] = [
  {
    id: 'a-01', workItemId: 'w-02', requestedByAgentId: 'quill', actionType: 'publish', targetSystem: 'WordPress', targetObject: 'Partnership announcement', risk: 'high', status: 'pending', submittedAt: min(180),
    evidence: [{ kind: 'artifact', label: 'Draft v3 (final)' }, { kind: 'message', label: 'Legal sign-off thread' }],
    rollbackPlan: 'Unpublish + revert to draft within 5 minutes.',
  },
  {
    id: 'a-02', workItemId: 'w-05', requestedByAgentId: 'quill', actionType: 'send', targetSystem: 'Mailchimp', targetObject: 'September newsletter', risk: 'medium', status: 'pending', submittedAt: min(95),
    evidence: [{ kind: 'artifact', label: 'Newsletter draft' }, { kind: 'url', label: 'Preview link' }],
  },
  {
    id: 'a-03', workItemId: 'w-03', requestedByAgentId: 'ally', actionType: 'send', targetSystem: 'Gmail', targetObject: 'Investor update — 14 recipients', risk: 'critical', status: 'pending', submittedAt: min(40),
    evidence: [{ kind: 'artifact', label: 'Investor email draft' }],
    proposedDiff: '+ Q3 ARR $4.2M (+18% QoQ)\n+ NRR 117%\n- Removed: unaudited pipeline figure',
    rollbackPlan: 'Recall attempt within 30s; follow-up correction email template attached.',
  },
];

export const cronJobs: CronJob[] = [
  { id: 'c-01', name: 'Morning briefing → Ally\'s Portal', scheduleExpression: '0 7 * * *', nextRunAt: plus(60 * 19), ownerAgentId: 'ally', approvalPolicy: 'pre_approved', lastResult: 'success', enabled: true },
  { id: 'c-02', name: 'Competitor news digest', scheduleExpression: '*/4h', nextRunAt: plus(75), ownerAgentId: 'scout', approvalPolicy: 'approval_on_result', lastResult: 'success', enabled: true },
  { id: 'c-03', name: 'Expense anomaly scan', scheduleExpression: '0 18 * * 5', nextRunAt: plus(60 * 52), ownerAgentId: 'ledger', approvalPolicy: 'always_approve', lastResult: 'success', enabled: true },
  { id: 'c-04', name: 'Uptime watchdog — allygnment.com', scheduleExpression: '*/15m', nextRunAt: plus(9), ownerAgentId: 'sentinel', approvalPolicy: 'pre_approved', lastResult: 'failed', enabled: true },
];

export const activity: ActivityEvent[] = [
  { id: 'e-01', type: 'agent.progress', occurredAt: min(1), agentId: 'ally', workItemId: 'w-03', action: 'Drafting investor email — section 2 of 3', result: 'in progress', severity: 'info' },
  { id: 'e-02', type: 'agent.progress', occurredAt: min(3), agentId: 'scout', workItemId: 'w-07', action: 'Extracted 12 sources for market scan', result: 'in progress', severity: 'info' },
  { id: 'e-03', type: 'approval.requested', occurredAt: min(12), agentId: 'quill', workItemId: 'w-05', action: 'Requested approval: send newsletter', result: 'pending', severity: 'warning' },
  { id: 'e-04', type: 'cron.failed', occurredAt: min(15), agentId: 'sentinel', action: 'Uptime watchdog: 2nd timeout on allygnment.com', result: 'failed', severity: 'error' },
  { id: 'e-05', type: 'agent.completed', occurredAt: min(47), agentId: 'ledger', workItemId: 'w-09', action: 'Expense anomaly digest ready', result: 'success', severity: 'info' },
  { id: 'e-06', type: 'cron.completed', occurredAt: min(65), agentId: 'ally', action: 'Morning briefing delivered to Telegram', result: 'success', severity: 'info' },
  { id: 'e-07', type: 'work.created', occurredAt: min(120), agentId: 'ally', workItemId: 'w-10', action: 'New item from executive: offsite agenda', result: 'created', severity: 'info' },
  { id: 'e-08', type: 'connector.called', occurredAt: min(150), agentId: 'quill', action: 'Mailchimp: fetch audience stats', result: 'ok', severity: 'info' },
];

export const artifacts: Artifact[] = [
  { id: 'f-01', name: 'Investor_Update_Sept_Draft.md', mimeType: 'text/markdown', sizeBytes: 18_204, createdAt: min(35), createdByAgentId: 'ally', workItemId: 'w-03', approvalId: 'a-03', state: 'draft', previewAvailable: true },
  { id: 'f-02', name: 'AI_Ops_Tooling_Market_Scan.md', mimeType: 'text/markdown', sizeBytes: 61_880, createdAt: min(3), createdByAgentId: 'scout', workItemId: 'w-07', state: 'draft', previewAvailable: true },
  { id: 'f-03', name: 'Expense_Anomaly_Digest_Aug.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sizeBytes: 44_102, createdAt: min(47), createdByAgentId: 'ledger', workItemId: 'w-09', state: 'ready', previewAvailable: false },
  { id: 'f-04', name: 'Partnership_Announcement_v3.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sizeBytes: 92_400, createdAt: min(200), createdByAgentId: 'quill', workItemId: 'w-02', approvalId: 'a-01', state: 'ready', previewAvailable: true },
];

export const usageSummary: UsageSummary = {
  rangeLabel: 'August 2026 (to date)',
  inputTokens: 4_820_400,
  outputTokens: 1_204_700,
  costUsd: 312.44,
  costIsAuthoritative: false,
  budgetUsd: 500,
  byAgent: [
    { agentId: 'ally', inputTokens: 1_910_200, outputTokens: 488_300, costUsd: 121.9 },
    { agentId: 'scout', inputTokens: 1_402_800, outputTokens: 301_100, costUsd: 84.2 },
    { agentId: 'quill', inputTokens: 804_500, outputTokens: 262_900, costUsd: 61.7 },
    { agentId: 'ledger', inputTokens: 512_300, outputTokens: 118_200, costUsd: 33.44 },
    { agentId: 'sentinel', inputTokens: 190_600, outputTokens: 34_200, costUsd: 11.2 },
  ],
  freshnessAt: min(6),
};

export const knowledgeSources: KnowledgeSource[] = [
  { id: 'k-01', type: 'file', name: 'Q3 board deck (working).pptx', scope: 'private', indexingStatus: 'ready', freshnessAt: min(60 * 8), citationEnabled: true },
  { id: 'k-02', type: 'url', name: 'allygnment.com — brand guidelines', uri: 'https://allygnment.com', scope: 'workspace', indexingStatus: 'ready', freshnessAt: min(60 * 30), citationEnabled: true },
  { id: 'k-03', type: 'transcript', name: 'Investor call — Aug 12', scope: 'agent', allowedAgentIds: ['ally'], indexingStatus: 'processing', citationEnabled: true },
  { id: 'k-04', type: 'file', name: 'Vendor contracts 2026.zip', scope: 'private', indexingStatus: 'failed', citationEnabled: false },
];

export const connections: Connection[] = [
  { id: 'cn-01', appKey: 'gmail', appName: 'Gmail', accountLabel: 'don@allygnment.com', state: 'connected', scopes: ['gmail.read', 'gmail.send'], hasWriteScope: true, lastVerifiedAt: min(22), dependentCronJobIds: ['c-01'] },
  { id: 'cn-02', appKey: 'mailchimp', appName: 'Mailchimp', accountLabel: 'Allygnment', state: 'connected', scopes: ['audiences.read', 'campaigns.send'], hasWriteScope: true, lastVerifiedAt: min(160), dependentCronJobIds: [] },
  { id: 'cn-03', appKey: 'wordpress', appName: 'WordPress', accountLabel: 'allygnment.com', state: 'degraded', scopes: ['posts.read', 'posts.publish'], hasWriteScope: true, lastVerifiedAt: min(60 * 26), dependentCronJobIds: ['c-04'] },
  { id: 'cn-04', appKey: 'gcal', appName: 'Google Calendar', accountLabel: 'don@allygnment.com', state: 'connected', scopes: ['calendar.read'], hasWriteScope: false, lastVerifiedAt: min(11), dependentCronJobIds: [] },
];

export const calendarEvents: CalendarEvent[] = [
  { id: 'cal-01', title: 'Board prep — final review', startsAt: plus(60 * 3), endsAt: plus(60 * 4), source: 'executive' },
  { id: 'cal-02', title: '1:1 with Sarah (CRO)', startsAt: plus(60 * 7), endsAt: plus(60 * 7.5), source: 'executive' },
  { id: 'cal-03', title: 'Focus block — no meetings', startsAt: plus(60 * 9), endsAt: plus(60 * 11), source: 'executive' },
  { id: 'cal-04', title: 'Cron: Morning briefing', startsAt: plus(60 * 19), endsAt: plus(60 * 19.25), source: 'cron', refId: 'c-01' },
  { id: 'cal-05', title: 'Cron: Competitor digest', startsAt: plus(75), endsAt: plus(90), source: 'cron', refId: 'c-02' },
  { id: 'cal-06', title: 'Agent: Investor email send window', startsAt: plus(60 * 20), endsAt: plus(60 * 21), source: 'agent', refId: 'w-03' },
];

export const skillsAndPlaybooks = [
  { id: 's-01', kind: 'skill' as const, name: 'competitor-news-monitor', purpose: 'Watch named companies; cited digests', version: '1.4.0', ownerAgentId: 'scout', lastRunAt: min(60 * 5), status: 'published' as const },
  { id: 's-02', kind: 'skill' as const, name: 'email-inbox-triage', purpose: 'Prioritize threads, draft replies safely', version: '2.1.0', ownerAgentId: 'ally', lastRunAt: min(60 * 26), status: 'published' as const },
  { id: 'p-01', kind: 'playbook' as const, name: 'Weekly Investor Update', purpose: 'Metrics pull → draft → approval → send', version: '0.9.2', ownerAgentId: 'ally', lastRunAt: min(60 * 24 * 7), status: 'draft' as const },
  { id: 'p-02', kind: 'playbook' as const, name: 'Monthly Expense Audit', purpose: 'Ledger scans, anomalies → digest → archive', version: '1.2.0', ownerAgentId: 'ledger', lastRunAt: min(60 * 24 * 3), status: 'published' as const },
];
