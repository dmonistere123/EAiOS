/**
 * LiveComposioAdapter — Composio REST (v3) via the dev proxy at /composio-api.
 * The x-api-key header is injected by the vite proxy (node-side env); the key
 * never enters the client bundle. Self-detects a missing/invalid key on first
 * call and permanently falls back to the mock adapter (graceful degradation).
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
}

/** Stable Composio user id for this single-executive install. */
const EAIOS_USER_ID = 'eaios-executive';

function mapToolkit(t: CompToolkit): AvailableApp {
  const managed = (t.composio_managed_auth_schemes ?? []).length > 0;
  return {
    slug: t.slug ?? 'unknown',
    name: t.name ?? t.slug ?? 'Unknown',
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
    accountLabel: a.user_id,
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
    try {
      await this.api('/api/v3/connected_accounts?limit=1');
      this.useMock = false;
    } catch {
      this.useMock = true;
    }
    return !this.useMock;
  }

  async listConnections(): Promise<Connection[]> {
    if (!(await this.liveOk())) return mock.listConnections();
    try {
      const raw = await this.api<unknown>('/api/v3/connected_accounts?limit=100');
      return asArray<CompAccount>(raw).map(mapAccount);
    } catch {
      return mock.listConnections();
    }
  }

  async listAvailableApps(): Promise<AvailableApp[]> {
    if (!(await this.liveOk())) return mock.listAvailableApps();
    try {
      const raw = await this.api<unknown>('/api/v3/toolkits?limit=100');
      return asArray<CompToolkit>(raw).map(mapToolkit);
    } catch {
      return mock.listAvailableApps();
    }
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
      if (app?.authKind === 'bring_own_auth') {
        return { flowId: `link-${appKey}`, authUrl: undefined, note: `${app.name} needs a custom auth config on the Composio account first (one-time setup).` };
      }
      // Reuse or create the managed auth config.
      const existing = asArray<CompAuthConfig>(await this.api<unknown>(`/api/v3/auth_configs?toolkit=${encodeURIComponent(appKey)}`));
      let configId = existing.find((c) => c.is_composio_managed)?.id ?? existing.find((c) => c.is_composio_managed)?.nanoid;
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
