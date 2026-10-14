/**
 * LiveComposioAdapter — Composio REST (v3) via the dev proxy at /composio-api.
 * The x-api-key header is injected by the vite proxy (node-side env); the key
 * never enters the client bundle. Self-detects a missing/invalid key on first
 * call and falls back to the mock adapter until reload or a credential update.
 */
import type { AuditResult } from '../../domain/types';
import type {
  AvailableApp, ComposioAdapter, Connection, ConnectionFlow, ConnectionTestResult,
  ConnectorAction, ConnectorScope,
} from '../interfaces';
import { composio as mock } from '../mock/MockComposioAdapter';

// ----- defensive wire shapes (Composio v3) -----

interface CompAccount {
  id?: string;
  nanoid?: string;
  status?: string;
  toolkit?: { slug?: string; name?: string } | string;
  auth_config?: { id?: string; scopes?: string[] | string };
  user_id?: string;
  state?: { val?: { displayName?: string } };
  created_at?: string;
  updated_at?: string;
  deprecated_uuid?: string;
}

const asArray = <T,>(v: unknown): T[] => {
  if (Array.isArray(v)) return v as T[];
  const o = v as { items?: T[]; data?: T[]; results?: T[] };
  return o?.items ?? o?.data ?? o?.results ?? [];
};

const toolkitSlug = (a: CompAccount): string =>
  typeof a.toolkit === 'string' ? a.toolkit : a.toolkit?.slug ?? 'unknown';

const toolkitName = (a: CompAccount): string =>
  typeof a.toolkit === 'string' ? a.toolkit : a.toolkit?.name ?? a.toolkit?.slug ?? 'Unknown';

const accountId = (a: CompAccount): string => a.nanoid ?? a.id ?? 'unknown';

// ----- toolkits catalog + connect link (W4; probed + verified 2026-08-28) -----

interface CompToolkit {
  name?: string;
  slug?: string;
  auth_schemes?: string[];
  composio_managed_auth_schemes?: string[];
  no_auth?: boolean;
  meta?: { description?: string; logo?: string; tools_count?: number; categories?: { name?: string }[] };
}

interface CompAuthConfig {
  id?: string;
  nanoid?: string;
  is_composio_managed?: boolean;
  toolkit?: { slug?: string } | string;
}

const configToolkitSlug = (c: CompAuthConfig): string =>
  typeof c.toolkit === 'string' ? c.toolkit : c.toolkit?.slug ?? '';

/** Stable Composio user id for this single-executive install. */
const EAIOS_USER_ID = 'eaios-executive';

function mapToolkit(t: CompToolkit): AvailableApp {
  const managed = (t.composio_managed_auth_schemes ?? []).length > 0;
  return {
    slug: t.slug ?? 'unknown',
    name: t.slug === 'twitter' ? 'X (Twitter)' : t.slug === 'snapchat' ? 'Snapchat Ads' : t.name ?? t.slug ?? 'Unknown',
    description: t.meta?.description ?? '',
    logoUrl: t.meta?.logo,
    toolsCount: t.meta?.tools_count ?? 0,
    categories: (t.meta?.categories ?? []).map((c) => c?.name ?? '').filter(Boolean),
    authKind: t.no_auth ? 'no_auth' : managed ? 'composio_managed' : 'bring_own_auth',
  };
}

function mapStatus(status?: string): Connection['state'] {
  const s = (status ?? '').toUpperCase();
  if (s === 'ACTIVE') return 'connected';
  if (s === 'INACTIVE' || s === 'EXPIRED' || s === 'FAILED') return 'needs_reconnect';
  if (s === 'PENDING' || s === 'INITIALIZING') return 'degraded';
  return 'disconnected';
}

function mapScopes(a: CompAccount): string[] {
  const sc = a.auth_config?.scopes;
  if (Array.isArray(sc)) return sc;
  if (typeof sc === 'string' && sc.trim()) return sc.split(/[,\s]+/).filter(Boolean);
  return [];
}

function mapAccount(a: CompAccount): Connection {
  const scopes = mapScopes(a);
  return {
    id: accountId(a),
    appKey: toolkitSlug(a),
    appName: toolkitName(a),
    accountLabel: a.state?.val?.displayName || a.user_id,
    state: mapStatus(a.status),
    scopes,
    hasWriteScope: scopes.some((s) => !/read|get|list|view/i.test(s)),
    lastVerifiedAt: a.updated_at ?? a.created_at,
    dependentCronJobIds: [], // dependency linking arrives with Composio-backed cron in Phase 4 hardening
  };
}

class LiveComposioAdapter implements ComposioAdapter {
  /** once a call fails auth/network, stick to mock for the session */
  private useMock: boolean | undefined;
  private credentialRevision = 0;
  /** A successful Settings save lets the next read check the new credentials. */
  resetCredentials(): void { this.credentialRevision++; this.useMock = undefined; }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`/composio-api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (res.status === 401 || res.status === 403) throw new Error(`composio auth failed (${res.status})`);
    if (!res.ok) throw new Error(`composio ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return (await res.json()) as T;
  }

  /** First call decides: live API reachable+authorized, or mock for the session. */
  private async liveOk(): Promise<boolean> {
    if (this.useMock !== undefined) return !this.useMock;
    const revision = this.credentialRevision;
    let reachable = false;
    try { await this.api('/api/v3/connected_accounts?limit=1'); reachable = true; } catch { /* unavailable */ }
    if (revision === this.credentialRevision) this.useMock = !reachable;
    return revision === this.credentialRevision && reachable;
  }

  async listConnections(): Promise<Connection[]> {
    if (!(await this.liveOk())) return mock.listConnections();
    try {
      const rows = await this.allPages<CompAccount>('/api/v3/connected_accounts?limit=100');
      return rows.map(mapAccount);
    } catch {
      return mock.listConnections();
    }
  }

  /** Follow opaque cursors: client-side filtering must search the whole catalog. */
  private async allPages<T>(path: string): Promise<T[]> {
    const rows: T[] = [], seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 64; page++) {
      const raw = await this.api<{ items?: T[]; next_cursor?: string | null }>(path + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''));
      rows.push(...asArray<T>(raw));
      const next = raw.next_cursor;
      if (!next) return rows;
      if (typeof next !== 'string' || seen.has(next)) throw new Error('The connection catalog returned an invalid page. Refresh and try again.');
      seen.add(next); cursor = next;
    }
    throw new Error('The connection catalog exceeded its page limit.');
  }

  async listAvailableApps(): Promise<AvailableApp[]> {
    if (!(await this.liveOk())) return mock.listAvailableApps();
    const rows = await this.allPages<CompToolkit>('/api/v3/toolkits?limit=100');
    return [...new Map(rows.map(t => [t.slug, mapToolkit(t)])).values()];
  }

  /**
   * Real connect flow (verified live 2026-08-28, scripts/verify-w4-connect.mjs):
   * reuse an existing managed auth config or CREATE one (managed auth
   * configs are API-creatable — the dashboard is not required), then mint a
   * Connect Link (`redirect_url`, ~30 min expiry). First connect therefore
   * writes an account-setup object (an auth config) — not an external send.
   * Note: /link also creates an INITIALIZING connected account; an abandoned
   * flow shows up here as degraded/incomplete and is removable via
   * disconnect — honest, not hidden.
   */
  async connectApp(appKey: string): Promise<ConnectionFlow> {
    if (!(await this.liveOk())) return mock.connectApp(appKey);
    try {
      const apps = await this.listAvailableApps();
      const app = apps.find((a) => a.slug === appKey);
      // Reuse or create the managed auth config. DOGFOOD FIX (2026-08-29):
      // Composio IGNORES ?toolkit= (returns every config — connecting
      // LinkedIn reused Gmail's config and connected Gmail 3×). The working
      // filter is ?toolkit_slug=, AND we still require the config's own
      // toolkit to match appKey before reuse — belt and suspenders.
      const existing = await this.allPages<CompAuthConfig>(`/api/v3/auth_configs?toolkit_slug=${encodeURIComponent(appKey)}&limit=100`);
      const matching = existing.filter(c => configToolkitSlug(c) === appKey && (app?.authKind === 'bring_own_auth' ? !c.is_composio_managed : c.is_composio_managed));
      if (app?.authKind === 'bring_own_auth' && matching.length !== 1) return { flowId: `setup-${appKey}`, note: matching.length > 1 ? 'Multiple custom configurations exist. Choose the intended configuration in Composio before connecting.' : `${app?.name ?? appKey} needs a custom auth config in Composio using your developer credentials. After creating it, return here and choose Set up / connect.` };
      const reusable = matching[0];
      let configId = reusable?.id ?? reusable?.nanoid;
      if (!configId) {
        const created = await this.api<{ auth_config?: CompAuthConfig }>('/api/v3/auth_configs', {
          method: 'POST',
          body: JSON.stringify({
            toolkit: { slug: appKey },
            auth_config: { type: 'use_composio_managed_auth', name: `EAiOS — ${app?.name ?? appKey}` },
          }),
        });
        configId = created.auth_config?.id ?? created.auth_config?.nanoid;
      }
      if (!configId) throw new Error('could not obtain an auth config');
      const link = await this.api<{ link_token?: string; redirect_url?: string; expires_at?: string }>('/api/v3/connected_accounts/link', {
        method: 'POST',
        body: JSON.stringify({ auth_config_id: configId, user_id: EAIOS_USER_ID }),
      });
      if (!link.redirect_url) throw new Error('no redirect_url in link response');
      return { flowId: link.link_token ?? `link-${appKey}`, authUrl: link.redirect_url };
    } catch (e) {
      return { flowId: `link-err-${appKey}`, authUrl: undefined, note: e instanceof Error ? e.message : 'Connect link failed.' };
    }
  }

  async disconnect(connectionId: string): Promise<AuditResult> {
    if (!(await this.liveOk())) return mock.disconnect(connectionId);
    try {
      await this.api(`/api/v3/connected_accounts/${connectionId}`, { method: 'DELETE' });
      return { ok: true, auditEventId: `comp-del-${Date.now()}` };
    } catch (e) {
      return { ok: false, auditEventId: `comp-err-${Date.now()}`, error: { code: 'disconnect_failed', safeMessage: e instanceof Error ? e.message : 'Disconnect failed.', retryable: true } };
    }
  }

  async testConnection(connectionId: string): Promise<ConnectionTestResult> {
    if (!(await this.liveOk())) return mock.testConnection(connectionId);
    try {
      const raw = await this.api<unknown>(`/api/v3/connected_accounts/${connectionId}`);
      const acc = (raw as CompAccount).id ?? (raw as CompAccount).nanoid ? (raw as CompAccount) : asArray<CompAccount>(raw)[0];
      const ok = mapStatus(acc?.status) === 'connected';
      return { ok, checkedAt: new Date().toISOString(), detail: ok ? 'Credentials verified active.' : `Status: ${acc?.status ?? 'unknown'} — reconnect may be required.` };
    } catch (e) {
      return { ok: false, checkedAt: new Date().toISOString(), detail: e instanceof Error ? e.message : 'Test failed.' };
    }
  }

  async listActions(connectionId: string): Promise<ConnectorAction[]> {
    if (!(await this.liveOk())) return mock.listActions(connectionId);
    try {
      const acc = await this.api<CompAccount>(`/api/v3/connected_accounts/${connectionId}`);
      const slug = toolkitSlug(acc);
      const tools = await this.api<unknown>(`/api/v3/tools?toolkit=${encodeURIComponent(slug)}&limit=50`);
      return asArray<{ slug?: string; name?: string; description?: string }>(tools).map((t) => ({
        id: t.slug ?? t.name ?? 'unknown',
        name: t.name ?? t.slug ?? 'unknown',
        kind: /send|create|update|delete|publish|post|write/i.test(t.slug ?? t.name ?? '') ? ('write' as const) : ('read' as const),
      }));
    } catch {
      return mock.listActions(connectionId);
    }
  }

  async listScopes(connectionId: string): Promise<ConnectorScope[]> {
    if (!(await this.liveOk())) return mock.listScopes(connectionId);
    try {
      const acc = await this.api<CompAccount>(`/api/v3/connected_accounts/${connectionId}`);
      return mapScopes(acc).map((name) => ({ name, kind: /read|get|list|view/i.test(name) ? ('read' as const) : ('write' as const) }));
    } catch {
      return mock.listScopes(connectionId);
    }
  }
}

export const liveComposio = new LiveComposioAdapter();
