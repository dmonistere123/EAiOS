/** Connections — connected apps (middle) + available-to-connect catalog in
 * the right rail (W4, D-B4). Connect = Composio hosted Connect Link in a new
 * tab; first connect creates a Composio-managed auth config on the account
 * (account setup, not an external send). No credentials are ever displayed. */
import { useEffect, useMemo, useState } from 'react';
import { composio } from '../adapters';
import type { AvailableApp, Connection } from '../adapters/interfaces';
import { useRuntime, toast } from '../state/runtime';
import { usePageRail } from '../state/rail';
import { Card, RelativeTime, StateBadge } from '../components/ui';

const stateTone = { connected: 'ok', degraded: 'warn', needs_reconnect: 'risk', disconnected: 'neutral' } as const;

const authBadge: Record<AvailableApp['authKind'], { label: string; hint: string }> = {
  composio_managed: { label: '1-click', hint: 'Hosted Composio sign-in — no app credentials to set up.' },
  bring_own_auth: { label: 'Needs setup', hint: 'Needs a custom auth config on the Composio account first (one-time setup).' },
  no_auth: { label: 'No account', hint: 'Works without connecting an account.' },
};

export default function Connections() {
  const s = useRuntime();
  const [rows, setRows] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [catalog, setCatalog] = useState<AvailableApp[]>([]);
  const [query, setQuery] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);

  const reloadConnections = () => {
    void composio.listConnections().then((r) => {
      setRows(r);
      setLoading(false);
    });
  };
  useEffect(reloadConnections, []);
  useEffect(() => {
    void composio.listAvailableApps().then(setCatalog);
  }, []);

  const cronFor = (c: Connection) => s.cron.filter((j) => c.dependentCronJobIds.includes(j.id));
  const connectedSlugs = useMemo(() => new Set(rows.filter((r) => r.state === 'connected').map((r) => r.appKey)), [rows]);

  const test = async (c: Connection) => {
    setTesting(c.id);
    const res = await composio.testConnection(c.id);
    setTesting(null);
    setTestResult((r) => ({ ...r, [c.id]: { ok: res.ok, text: `${c.appName}: ${res.detail}` } }));
  };

  const connect = async (app: AvailableApp) => {
    setConnecting(app.slug);
    const flow = await composio.connectApp(app.slug);
    setConnecting(null);
    if (flow.authUrl) {
      window.open(flow.authUrl, '_blank', 'noopener');
      toast('info', `Finish connecting ${app.name} in the Composio tab, then refresh.`);
    } else {
      toast('info', flow.note ?? `${app.name} can't be connected from here yet.`);
    }
  };

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((a) => [a.name, a.slug, a.description, ...a.categories].join(' ').toLowerCase().includes(q));
  }, [catalog, query]);

  // W4: the available-to-connect catalog rides the right rail (D-B4).
  const railSections = useMemo(
    () => [
      {
        key: 'available',
        title: 'Available to connect',
        count: filteredCatalog.length,
        node: (
          <div className="space-y-2">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter apps…"
              aria-label="Filter apps"
              className="w-full rounded-lg border border-edge bg-canvas px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-faint"
            />
            <ul className="space-y-1">
              {filteredCatalog.map((a) => {
                const connected = connectedSlugs.has(a.slug);
                const badge = authBadge[a.authKind];
                return (
                  <li key={a.slug} className="rounded-lg px-2 py-1.5 hover:bg-canvas-overlay">
                    <div className="flex items-center gap-2">
                      {a.logoUrl ? (
                        <img src={a.logoUrl} alt="" className="h-5 w-5 rounded" loading="lazy" />
                      ) : (
                        <span className="flex h-5 w-5 items-center justify-center rounded bg-canvas text-[10px] font-semibold text-ink-dim">{a.name[0]}</span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">{a.name}</span>
                      <span className="text-[10px] text-ink-faint">{a.toolsCount} tools</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 pl-7">
                      <span className="rounded-full border border-edge px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-ink-faint" title={badge.hint}>
                        {badge.label}
                      </span>
                      {connected ? (
                        <span className="text-[10px] font-medium text-ok">connected</span>
                      ) : a.authKind === 'composio_managed' ? (
                        <button
                          onClick={() => void connect(a)}
                          disabled={connecting === a.slug}
                          className="rounded-md bg-signal/15 px-2 py-0.5 text-[10px] font-semibold text-signal hover:bg-signal/25 disabled:opacity-50"
                        >
                          {connecting === a.slug ? 'Linking…' : 'Connect'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {filteredCatalog.length === 0 && <li className="px-2 text-xs text-ink-faint">No apps match “{query}”.</li>}
            </ul>
            <button onClick={reloadConnections} className="w-full rounded-lg border border-edge px-2 py-1.5 text-[11px] text-ink-dim hover:bg-canvas-overlay">
              ↻ Refresh connected apps
            </button>
            <p className="px-1 text-[10px] leading-snug text-ink-faint">
              Connect opens Composio's hosted sign-in. First connect creates a managed auth config on the account — acting on a connected app still gates on approvals.
            </p>
          </div>
        ),
      },
    ],
    [filteredCatalog, query, connecting, connectedSlugs],
  );
  usePageRail(railSections);

  if (loading) {
    return <div className="animate-pulse space-y-4">{[...Array(3)].map((_, i) => <div key={i} className="h-36 rounded-xl bg-canvas-raised" />)}</div>;
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Connections</h1>
        <p className="mt-1 text-sm text-ink-dim">Connected applications via Composio. Write scopes are flagged and governed by approvals. The rail lists apps available to connect.</p>
      </header>

      {rows.length === 0 && (
        <Card className="p-5">
          <p className="text-sm text-ink-dim">No apps connected yet — pick one from the <span className="text-ink">Available to connect</span> rail.</p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((c) => (
          <Card key={c.id} className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-base font-semibold text-ink">{c.appName}</div>
                <div className="mt-0.5 text-xs text-ink-faint">{c.accountLabel}</div>
              </div>
              <StateBadge label={c.state === 'degraded' ? 'incomplete' : c.state.replace('_', ' ')} tone={stateTone[c.state]} />
            </div>

            <div className="mt-4 flex flex-wrap gap-1.5">
              {c.scopes.map((sc) => (
                <span key={sc} className={`rounded-md border px-2 py-0.5 text-[11px] ${sc.includes('read') ? 'border-edge bg-canvas text-ink-dim' : 'border-warn/40 bg-warn/10 text-warn'}`}>
                  {sc}{!sc.includes('read') && ' ✎'}
                </span>
              ))}
              {c.scopes.length === 0 && <span className="text-[11px] text-ink-faint">Scopes appear once the connection is active.</span>}
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
                <button
                  onClick={() => {
                    const app = catalog.find((a) => a.slug === c.appKey);
                    if (app) void connect(app);
                    else toast('info', `Reconnect ${c.appName} from the Available to connect rail.`);
                  }}
                  className="rounded-lg bg-warn px-3 py-1.5 text-xs font-semibold text-canvas hover:bg-warn/90"
                >
                  {c.state === 'degraded' ? 'Resume connect' : 'Reconnect'}
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
