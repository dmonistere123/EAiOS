/** Connections — Composio-backed app connections, via the adapter contract only. */
import { useEffect, useState } from 'react';
import { composio } from '../adapters';
import type { Connection } from '../adapters/interfaces';
import { useRuntime } from '../state/runtime';
import { Card, RelativeTime, SectionTitle, StateBadge } from '../components/ui';

const stateTone = { connected: 'ok', degraded: 'warn', needs_reconnect: 'risk', disconnected: 'neutral' } as const;

export default function Connections() {
  const s = useRuntime();
  const [rows, setRows] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  useEffect(() => {
    void composio.listConnections().then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, []);

  const cronFor = (c: Connection) => s.cron.filter((j) => c.dependentCronJobIds.includes(j.id));

  const test = async (c: Connection) => {
    setTesting(c.id);
    const res = await composio.testConnection(c.id);
    setTesting(null);
    setTestResult((r) => ({ ...r, [c.id]: { ok: res.ok, text: `${c.appName}: ${res.detail}` } }));
  };

  if (loading) {
    return <div className="animate-pulse space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-36 rounded-xl bg-canvas-raised" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-ink-dim">Connected applications via Composio. Write scopes are flagged and governed by approvals. No credentials are ever displayed.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((c) => (
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
              <span>{cronFor(c).length} dependent cron job{cronFor(c).length === 1 ? '' : 's'}</span>
            </div>

            {testResult[c.id] && (
              <p className={`mt-3 rounded-lg border px-3 py-2 text-xs ${testResult[c.id].ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-risk/30 bg-risk/10 text-risk'}`}>
                {testResult[c.id].text}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button onClick={() => test(c)} disabled={testing === c.id} className="rounded-lg border border-signal/40 px-3 py-1.5 text-xs font-medium text-signal hover:bg-signal/10 disabled:opacity-50">
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
        <p className="text-xs text-ink-dim">OAuth flows run inside the connector host — EAiOS only ever sees safe metadata (health, scopes, last verified). Live Composio wiring lands when the account/tenant model is verified.</p>
        <button className="mt-3 rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-canvas hover:bg-signal/90">Browse app catalog</button>
      </Card>
    </div>
  );
}
