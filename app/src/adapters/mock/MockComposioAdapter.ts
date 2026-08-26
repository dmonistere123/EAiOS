/**
 * MockComposioAdapter — fixture-backed ComposioAdapter (Phase 4 contract).
 * Swaps for a live Composio MCP adapter once the Composio account/tenant
 * model is verified (Phase 0 matrix, Connections row).
 */
import type { AuditResult } from '../../domain/types';
import type {
  ComposioAdapter, Connection, ConnectionFlow, ConnectionTestResult,
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

  async listConnections(): Promise<Connection[]> {
    await delay(200);
    return clone(this.rows);
  }

  async connectApp(appKey: string): Promise<ConnectionFlow> {
    await delay();
    return { flowId: `flow-${appKey}-mock`, authUrl: undefined };
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
