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
  DailySpendReport,
  WorkItem,
  TravelTrip,
} from '../domain/types';
import type { Connection, CalendarEvent, TravelSearchResult } from '../adapters/interfaces';

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
    payload: 'To: investors@allygnment.com\nSubject: Investor Update — September 2026\n\nTeam,\n\nQ3 ARR $4.2M (+18% QoQ). NRR 117%.\n\nBest,\nDon',
  },
];

export const cronJobs: CronJob[] = [
  { id: 'c-01', name: 'Morning briefing → Ally\'s Portal', scheduleExpression: '0 7 * * *', nextRunAt: plus(60 * 19), ownerAgentId: 'ally', approvalPolicy: 'pre_approved', lastResult: 'success', enabled: true, prompt: 'Check Gmail for overnight emails, summarize key messages from executives and team leads, pull calendar events for today, and deliver a morning digest to the Ally Portal Telegram group.' },
  { id: 'c-02', name: 'Competitor news digest', scheduleExpression: '*/4h', nextRunAt: plus(75), ownerAgentId: 'scout', approvalPolicy: 'approval_on_result', lastResult: 'success', enabled: true, prompt: 'Scan news feeds and industry blogs for mentions of our top 5 competitors (Threaded Fasteners, AutoBolt, etc.). Summarize notable announcements, pricing changes, and new product launches. Flag anything that needs a response.' },
  { id: 'c-03', name: 'Expense anomaly scan', scheduleExpression: '0 18 * * 5', nextRunAt: plus(60 * 52), ownerAgentId: 'ledger', approvalPolicy: 'always_approve', lastResult: 'success', enabled: true, prompt: 'Review the week\'s expense reports and credit card transactions. Flag any entries outside normal patterns — duplicate charges, unusual merchant categories, amounts over $500 without prior approval. Produce a digest for the finance review.' },
  { id: 'c-04', name: 'Uptime watchdog — allygnment.com', scheduleExpression: '*/15m', nextRunAt: plus(9), ownerAgentId: 'sentinel', approvalPolicy: 'pre_approved', lastResult: 'failed', enabled: true, prompt: 'Ping allygnment.com and key subdomains (app.allygnment.com, api.allygnment.com) every 15 minutes. If any endpoint returns non-200 or takes longer than 5 seconds, escalate to Don via Telegram with response time and HTTP status code.' },
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
  { id: 'f-05', name: 'inbox-triage-report.html', mimeType: 'text/html', sizeBytes: 34_120, createdAt: min(5), createdByAgentId: 'ally', workItemId: 'w-09', state: 'ready', previewAvailable: true },
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

/** F29: 14-day rate-card spend strip. Day -3 breaches the $5 threshold so the
 * UI's risk styling + drill-down are exercised; today shows a small in-progress day. */
export const dailySpendReport: DailySpendReport = {
  thresholdUsd: 5,
  estimatedWith: 'eaios-rate-card',
  days: [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map((back) => {
    const d = new Date(Date.now() - back * 86_400_000);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const base = [1.2, 0.4, 2.1, 0.9, 3.3, 1.1, 0.2, 2.8, 1.6, 0.7, 11.35, 2.65, 1.9, 0.42][13 - back];
    const day: DailySpendReport['days'][number] = {
      date,
      costUsd: base,
      inputTokens: Math.round(base * 400_000),
      outputTokens: Math.round(base * 40_000),
      overThreshold: base > 5,
      topSessions: [],
    };
    if (back === 3) {
      day.topSessions = [
        { sessionId: 'sess-casual', title: 'Casual check-in', model: 'kimi-k3', costUsd: 5.96, inputTokens: 1_610_000, outputTokens: 81_000 },
        { sessionId: 'sess-ncaaf', title: 'NCAAF week lookahead', model: 'kimi-k3', costUsd: 0.9, inputTokens: 142_000, outputTokens: 34_000 },
        { sessionId: 'sess-triage', title: 'Inbox triage 2026-09-02', model: 'kimi-k3', costUsd: 0.72, inputTokens: 121_000, outputTokens: 26_000 },
      ];
    }
    if (back === 0) {
      day.topSessions = [{ sessionId: 'sess-eaios', title: 'Continue EAiOS handoff', model: 'kimi-k3', costUsd: 0.31, inputTokens: 82_000, outputTokens: 6_000 }];
    }
    return day;
  }),
  freshnessAt: min(4),
};

export const knowledgeSources: KnowledgeSource[] = [
  { id: 'k-01', type: 'file', name: 'Q3 board deck (working).pptx', scope: 'private', indexingStatus: 'ready', freshnessAt: min(60 * 8), citationEnabled: true },
  { id: 'k-02', type: 'url', name: 'allygnment.com — brand guidelines', uri: 'https://allygnment.com', scope: 'workspace', indexingStatus: 'ready', freshnessAt: min(60 * 30), citationEnabled: true },
  { id: 'k-03', type: 'transcript', name: 'Investor call — Aug 12', scope: 'agent', allowedAgentIds: ['ally'], indexingStatus: 'processing', citationEnabled: true },
  { id: 'k-04', type: 'file', name: 'Vendor contracts 2026.zip', scope: 'private', indexingStatus: 'failed', error: 'Unsupported archive format (.zip) — extract and upload the contents instead.', citationEnabled: false },
];

export const connections: Connection[] = [
  { id: 'cn-01', appKey: 'gmail', appName: 'Gmail', accountLabel: 'don@allygnment.com', state: 'connected', scopes: ['gmail.read', 'gmail.send'], hasWriteScope: true, lastVerifiedAt: min(22), dependentCronJobIds: ['c-01'] },
  { id: 'cn-02', appKey: 'mailchimp', appName: 'Mailchimp', accountLabel: 'Allygnment', state: 'connected', scopes: ['audiences.read', 'campaigns.send'], hasWriteScope: true, lastVerifiedAt: min(160), dependentCronJobIds: [] },
  { id: 'cn-03', appKey: 'wordpress', appName: 'WordPress', accountLabel: 'allygnment.com', state: 'degraded', scopes: ['posts.read', 'posts.publish'], hasWriteScope: true, lastVerifiedAt: min(60 * 26), dependentCronJobIds: ['c-04'] },
  { id: 'cn-04', appKey: 'gcal', appName: 'Google Calendar', accountLabel: 'don@allygnment.com', state: 'connected', scopes: ['calendar.read'], hasWriteScope: false, lastVerifiedAt: min(11), dependentCronJobIds: [] },
];

export const calendarEvents: CalendarEvent[] = [
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

// F31: travel fixtures — realistic enough to exercise the UI; live adapters
// replace these with Duffel/browser-use/OpenTable results when keys are configured.
const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};
const at = (baseIso: string, h: number, m = 0) => {
  const d = new Date(baseIso);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

export const travelTrips: TravelTrip[] = [
  {
    id: 'trip-01',
    name: 'Baton Rouge quarterly visit',
    destination: 'Baton Rouge, LA',
    startsAt: day(12).slice(0, 10),
    endsAt: day(14).slice(0, 10),
    status: 'upcoming',
    bookings: [
      {
        id: 'bk-01', tripId: 'trip-01', kind: 'flight', status: 'confirmed', provider: 'duffel',
        airline: 'Delta', flightNumber: 'DL1456', origin: 'BHM', destination: 'BTR',
        departureAt: at(day(12), 9, 30), arrivalAt: at(day(12), 11, 5), cabin: 'First',
        costUsd: 420, confirmationNumber: 'ABC123',
      },
      {
        id: 'bk-02', tripId: 'trip-01', kind: 'hotel', status: 'confirmed', provider: 'other',
        hotelName: 'Watermark Hotel', checkIn: day(12).slice(0, 10), checkOut: day(14).slice(0, 10),
        roomType: 'King Executive', address: '123 Main St, Baton Rouge, LA', costUsd: 380, confirmationNumber: 'XYZ789',
      },
      {
        id: 'bk-03', tripId: 'trip-01', kind: 'car', status: 'proposed', provider: 'other',
        company: 'Enterprise', carType: 'Midsize', pickupLocation: 'BTR Airport', dropoffLocation: 'BTR Airport',
        pickupAt: at(day(12), 12, 0), dropoffAt: at(day(14), 16, 0), costUsd: 140,
      },
    ],
    approvals: [
      { id: 'ta-01', tripId: 'trip-01', bookingId: 'bk-03', resultId: 'sr-c-1', actionType: 'book', targetSystem: 'other',
        targetObject: 'Enterprise Midsize BTR 12–14 Sep', risk: 'low', status: 'pending', submittedAt: min(60 * 24 * 2),
        payload: 'Book Enterprise Midsize at BTR Airport, pickup 12 Sep 12:00, dropoff 14 Sep 16:00, ~$140.',
      },
    ],
  },
  {
    id: 'trip-02',
    name: 'Investor dinner — NYC',
    destination: 'New York, NY',
    startsAt: day(5).slice(0, 10),
    endsAt: day(5).slice(0, 10),
    status: 'upcoming',
    bookings: [
      {
        id: 'bk-04', tripId: 'trip-02', kind: 'restaurant', status: 'proposed', provider: 'opentable',
        restaurantName: 'Gramercy Tavern', cuisine: 'American', reservationAt: at(day(5), 19, 30), partySize: 4,
        address: '42 E 20th St, New York, NY', costUsd: 0,
      },
    ],
    approvals: [
      {
        id: 'ta-02', tripId: 'trip-02', bookingId: 'bk-04', actionType: 'book', targetSystem: 'opentable',
        targetObject: 'Gramercy Tavern reservation for 4', risk: 'low', status: 'pending', submittedAt: min(60 * 5),
        payload: 'Reserve Gramercy Tavern for 4 on 5 Sep at 7:30 PM.',
      },
    ],
  },
];

export const travelSearchResults: Record<string, TravelSearchResult[]> = {
  flights: [
    { id: 'sr-f-1', kind: 'flight', title: 'Delta DL1456', subtitle: 'BHM → BTR · 09:30–11:05 · First', priceUsd: 420, provider: 'duffel', meta: { airline: 'Delta', flightNumber: 'DL1456', origin: 'BHM', destination: 'BTR', departureAt: at(day(12), 9, 30), arrivalAt: at(day(12), 11, 5), cabin: 'First' } },
    { id: 'sr-f-2', kind: 'flight', title: 'Southwest WN204', subtitle: 'BHM → BTR · 13:10–14:35 · Business Select', priceUsd: 310, provider: 'duffel', meta: { airline: 'Southwest', flightNumber: 'WN204', origin: 'BHM', destination: 'BTR', departureAt: at(day(12), 13, 10), arrivalAt: at(day(12), 14, 35), cabin: 'Business Select' } },
  ],
  hotels: [
    { id: 'sr-h-1', kind: 'hotel', title: 'Watermark Hotel', subtitle: 'King Executive · 12–14 Sep', priceUsd: 380, provider: 'other', meta: { hotelName: 'Watermark Hotel', checkIn: day(12).slice(0, 10), checkOut: day(14).slice(0, 10), roomType: 'King Executive', address: '123 Main St, Baton Rouge, LA' } },
    { id: 'sr-h-2', kind: 'hotel', title: 'Renaissance Baton Rouge', subtitle: 'Deluxe Queen · 12–14 Sep', priceUsd: 295, provider: 'other', meta: { hotelName: 'Renaissance Baton Rouge', checkIn: day(12).slice(0, 10), checkOut: day(14).slice(0, 10), roomType: 'Deluxe Queen', address: '7000 Bluebonnet Blvd, Baton Rouge, LA' } },
  ],
  cars: [
    { id: 'sr-c-1', kind: 'car', title: 'Enterprise Midsize', subtitle: 'BTR Airport · 12 Sep 12:00 → 14 Sep 16:00', priceUsd: 140, provider: 'other', meta: { company: 'Enterprise', carType: 'Midsize', pickupLocation: 'BTR Airport', dropoffLocation: 'BTR Airport', pickupAt: at(day(12), 12, 0), dropoffAt: at(day(14), 16, 0) } },
    { id: 'sr-c-2', kind: 'car', title: 'Hertz Compact', subtitle: 'BTR Airport · 12 Sep 12:00 → 14 Sep 16:00', priceUsd: 115, provider: 'other', meta: { company: 'Hertz', carType: 'Compact', pickupLocation: 'BTR Airport', dropoffLocation: 'BTR Airport', pickupAt: at(day(12), 12, 0), dropoffAt: at(day(14), 16, 0) } },
  ],
  restaurants: [
    { id: 'sr-r-1', kind: 'restaurant', title: 'Gramercy Tavern', subtitle: 'American · 5 Sep 19:30 · Party of 4', priceUsd: 0, provider: 'opentable', meta: { restaurantName: 'Gramercy Tavern', cuisine: 'American', reservationAt: at(day(5), 19, 30), partySize: '4', address: '42 E 20th St, New York, NY' } },
    { id: 'sr-r-2', kind: 'restaurant', title: 'Lilia', subtitle: 'Italian · 5 Sep 19:45 · Party of 4', priceUsd: 0, provider: 'opentable', meta: { restaurantName: 'Lilia', cuisine: 'Italian', reservationAt: at(day(5), 19, 45), partySize: '4', address: '567 Union Ave, Brooklyn, NY' } },
  ],
};
