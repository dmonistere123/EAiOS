/**
 * MockComposioAdapter — fixture-backed ComposioAdapter (Phase 4 contract).
 * Swaps for a live Composio MCP adapter once the Composio account/tenant
 * model is verified (Phase 0 matrix, Connections row).
 */
import type { AuditResult } from '../../domain/types';
import type {
  AvailableApp, ComposioAdapter, Connection, ConnectionFlow, ConnectionTestResult,
  ConnectorAction, ConnectorScope,
} from '../interfaces';
import { connections } from '../../mocks/fixtures';

const delay = (ms = 700) => new Promise((r) => setTimeout(r, ms + Math.random() * 400));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
let auditSeq = 5000;

const ACTIONS: Record<string, ConnectorAction[]> = {
  gmail: [
    { id: 'gmail.search', name: 'Search messages', kind: 'read' },
    { id: 'gmail.send', name: 'Send email', kind: 'write' },
  ],
  mailchimp: [
    { id: 'mc.audiences', name: 'List audiences', kind: 'read' },
    { id: 'mc.campaign', name: 'Send campaign', kind: 'execute' },
  ],
  wordpress: [
    { id: 'wp.posts', name: 'List posts', kind: 'read' },
    { id: 'wp.publish', name: 'Publish post', kind: 'write' },
  ],
  gcal: [{ id: 'gcal.events', name: 'Read events', kind: 'read' }],
};

class MockComposioAdapter implements ComposioAdapter {
  private rows = clone(connections);

  /** W4 catalog fixture — mixed auth kinds so every connect path renders. */
  private catalog: AvailableApp[] = [
    { slug: 'gmail', name: 'Gmail', description: 'Google email — search, read, send.', toolsCount: 61, categories: ['email'], authKind: 'composio_managed' },
    { slug: 'googlecalendar', name: 'Google Calendar', description: 'Calendar events and scheduling.', toolsCount: 24, categories: ['calendar'], authKind: 'composio_managed' },
    { slug: 'slack', name: 'Slack', description: 'Channels, messages, and search.', toolsCount: 48, categories: ['messaging'], authKind: 'composio_managed' },
    { slug: 'notion', name: 'Notion', description: 'Pages, databases, and search.', toolsCount: 33, categories: ['docs'], authKind: 'composio_managed' },
    { slug: 'github', name: 'GitHub', description: 'Repos, issues, PRs, code search.', toolsCount: 45, categories: ['dev'], authKind: 'composio_managed' },
    { slug: 'mailchimp', name: 'Mailchimp', description: 'Audiences and campaigns.', toolsCount: 19, categories: ['marketing'], authKind: 'bring_own_auth' },
    { slug: 'wordpress', name: 'WordPress', description: 'Posts and pages.', toolsCount: 12, categories: ['publishing'], authKind: 'bring_own_auth' },
    { slug: 'hackernews', name: 'Hacker News', description: 'Top stories and search — no account needed.', toolsCount: 4, categories: ['news'], authKind: 'no_auth' },
  ];

  async listAvailableApps(): Promise<AvailableApp[]> {
    await delay(200);
    return clone(this.catalog);
  }

  async listConnections(): Promise<Connection[]> {
    await delay(200);
    return clone(this.rows);
  }

  async connectApp(appKey: string): Promise<ConnectionFlow> {
    await delay();
    const app = this.catalog.find((a) => a.slug === appKey);
    if (app?.authKind === 'bring_own_auth') {
      return { flowId: `flow-${appKey}-mock`, authUrl: undefined, note: `${app.name} needs a custom auth config on the Composio account first (one-time setup).` };
    }
    return { flowId: `flow-${appKey}-mock`, authUrl: `https://connect.composio.dev/link/mock-${appKey}` };
  }

  async disconnect(connectionId: string): Promise<AuditResult> {
    await delay();
    this.rows = this.rows.map((c) => (c.id === connectionId ? { ...c, state: 'disconnected' } : c));
    return { ok: true, auditEventId: `aud-${auditSeq++}` };
  }

  async testConnection(connectionId: string): Promise<ConnectionTestResult> {
    await delay(900);
    const c = this.rows.find((x) => x.id === connectionId);
    const ok = c?.state === 'connected';
    if (c) c.lastVerifiedAt = new Date().toISOString();
    return {
      ok,
      checkedAt: new Date().toISOString(),
      detail: ok ? 'Credentials verified.' : 'Token expired — reconnect required.',
    };
  }

  async listActions(connectionId: string): Promise<ConnectorAction[]> {
    await delay(150);
    const c = this.rows.find((x) => x.id === connectionId);
    return ACTIONS[c?.appKey ?? ''] ?? [];
  }

  async listScopes(connectionId: string): Promise<ConnectorScope[]> {
    await delay(150);
    const c = this.rows.find((x) => x.id === connectionId);
    return (c?.scopes ?? []).map((name) => ({ name, kind: name.includes('read') ? ('read' as const) : ('write' as const) }));
  }
}

export const composio = new MockComposioAdapter();
