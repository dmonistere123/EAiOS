/** My Assistant — Ally: conversation + visible orchestration (not just chat). */
import { Card, SectionTitle, StateBadge, AgentStatusBadge, IndeterminateBar } from '../components/ui';
import { useRuntime, agentName, selectPendingApprovals } from '../state/runtime';

const THREAD = [
  { from: 'you' as const, text: 'Ally, get the September investor update ready to send by tomorrow.' },
  { from: 'ally' as const, text: 'On it. I\'ve pulled the Q3 metrics from Ledger\'s last digest and I\'m drafting with Quill. Plan: (1) metrics summary, (2) narrative draft, (3) your approval before anything sends.' },
  { from: 'you' as const, text: 'Keep the tone confident but conservative on pipeline numbers.' },
  { from: 'ally' as const, text: 'Noted — I\'ve removed the unaudited pipeline figure and flagged it in the approval diff. Draft is ~70% done; I\'ll route it to Approvals when ready.' },
];

const PLAN = [
  { step: 1, title: 'Compile Q3 metrics', agentId: 'ledger', state: 'complete' as const },
  { step: 2, title: 'Draft narrative + metrics email', agentId: 'ally', state: 'in_progress' as const },
  { step: 3, title: 'Executive approval → send', agentId: 'ally', state: 'ready' as const },
];

export default function Assistant() {
  const s = useRuntime();
  const ally = s.agents.find((a) => a.id === 'ally');
  const approvals = selectPendingApprovals(s);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Assistant</h1>
          <p className="mt-1 text-sm text-ink-dim">Ally — chief of staff. Conversation plus what it\'s actually doing.</p>
        </div>
        {ally && <AgentStatusBadge status={ally.status} />}
      </header>

      <div className="grid gap-4 xl:grid-cols-5">
        {/* conversation */}
        <Card className="flex flex-col p-4 xl:col-span-3">
          <SectionTitle>Conversation</SectionTitle>
          <div className="flex-1 space-y-3 overflow-y-auto">
            {THREAD.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.from === 'you' ? 'ml-auto bg-signal/15 text-ink' : 'bg-canvas-overlay text-ink'}`}>
                <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">{m.from === 'you' ? 'You' : 'Ally'}</div>
                {m.text}
              </div>
            ))}
            {ally?.status === 'working' && (
              <div className="max-w-[85%] rounded-xl bg-canvas-overlay px-4 py-2.5">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Ally is working</div>
                <IndeterminateBar />
              </div>
            )}
          </div>
          <div className="mt-4 flex gap-2">
            <input
              placeholder="Message Ally… (mock mode — wires to prompt.submit in Phase 2)"
              aria-label="Message Ally"
              className="flex-1 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
            <button className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90">Send</button>
          </div>
        </Card>

        {/* orchestration */}
        <div className="space-y-4 xl:col-span-2">
          <Card className="p-4">
            <SectionTitle>Current orchestration plan</SectionTitle>
            <ol className="space-y-3">
              {PLAN.map((p) => (
                <li key={p.step} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-edge bg-canvas text-[11px] text-ink-dim">{p.step}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink">{p.title}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                      {agentName(s, p.agentId)} <StateBadge label={p.state.replace('_', ' ')} tone={p.state === 'complete' ? 'ok' : p.state === 'in_progress' ? 'signal' : 'neutral'} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-4">
            <SectionTitle>Context in scope</SectionTitle>
            <ul className="space-y-1.5 text-xs text-ink-dim">
              <li>Workspace: <span className="text-ink">EAiOS</span></li>
              <li>Knowledge: <span className="text-ink">3 sources ready, 1 indexing</span></li>
              <li>Connected apps: <span className="text-ink">Gmail, Calendar, Mailchimp</span></li>
            </ul>
          </Card>

          <Card className="border-warn/25 p-4">
            <SectionTitle>Approval forecast</SectionTitle>
            {approvals.length === 0 ? (
              <p className="text-xs text-ink-dim">No external actions expected to need approval.</p>
            ) : (
              <ul className="space-y-2">
                {approvals.map((a) => (
                  <li key={a.id} className="text-xs text-ink-dim">
                    <span className="text-ink">{a.targetObject ?? a.targetSystem}</span> — {a.actionType} via {a.targetSystem}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
