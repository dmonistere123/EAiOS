/** Connections — Composio-backed app connections (mock until Phase 4). */
import { useState } from 'react';
import { connections } from '../mocks/fixtures';
import { useRuntime } from '../state/runtime';
import { Card, RelativeTime, SectionTitle, StateBadge } from '../components/ui';

const stateTone = { connected: 'ok', degraded: 'warn', needs_reconnect: 'risk', disconnected: 'neutral' } as const;

export default function Connections() {
  const s = useRuntime();
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const cronFor = (id: string) => s.cron.filter((c) => connections.find((x) => x.id === id)?.dependentCronJobIds.includes(c.id));

  const test = (id: string, name: string) => {
    setTesting(id);
    setTimeout(() => {
      setTesting(null);
      const ok = connections.find((c) => c.id === id)?.state === 'connected';
      setTestResult((r) => ({ ...r, [id]: ok ? `${name}: healthy — credentials verified just now.` : `${name}: token expired — reconnect required.` }));
    }, 1200);
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-ink-dim">Connected applications via Composio. Write scopes are flagged and governed by approvals. No credentials are ever displayed.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {connections.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-semibold text-ink">{c.appName}</div>
                <div className="mt-0.5 text-xs text-ink-faint">{c.accountLabel}</div>
              </div>
              <StateBadge label={c.state.replace('_', ' ')} tone={stateTone[c.state]} />
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {c.scopes.map((sc) => (
                <span key={sc} className={`rounded-md border px-2 py-0.5 text-[11px] ${sc.includes('read') ? 'border-edge bg-canvas text-ink-dim' : 'border-warn/40 bg-warn/10 text-warn'}`}>
                  {sc}{!sc.includes('read') && ' ✎'}
                </span>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-edge pt-3 text-[11px] text-ink-faint">
              <span>Verified <RelativeTime iso={c.lastVerifiedAt} /></span>
              <span>{cronFor(c.id).length} dependent cron job{cronFor(c.id).length === 1 ? '' : 's'}</span>
            </div>

            {testResult[c.id] && <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${testResult[c.id].includes('healthy') ? 'border-ok/30 bg-ok/10 text-ok' : 'border-risk/30 bg-risk/10 text-risk'}`}>{testResult[c.id]}</p>}

            <div className="mt-4 flex gap-2">
              <button onClick={() => test(c.id, c.appName)} disabled={testing === c.id} className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10 disabled:opacity-50">
                {testing === c.id ? 'Testing…' : 'Test connection'}
              </button>
              {c.state !== 'connected' && (
                <button className="rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-warn/90">Reconnect</button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <SectionTitle>Connect a new app</SectionTitle>
        <p className="text-xs text-ink-dim">OAuth flows run inside the connector host in Phase 4 — EAiOS only ever sees safe metadata (health, scopes, last verified).</p>
        <button className="mt-3 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90">Browse app catalog</button>
      </Card>
    </div>
  );
}
