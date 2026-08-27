/**
 * Settings / env-files tests — Phase 6.2. The live adapter's env-file slice
 * (SOUL.md per profile via profiles.describe/configure) is exercised with a
 * stubbed RPC client: list mapping, content-hash versioning, version_conflict
 * on stale saves (configure must NOT fire), and mock fallback when the
 * gateway is down. Mock contract (stale/good version) lives in
 * interactions.test.tsx. Also pins the honesty fix: the mock Model/Approval
 * cards no longer offer fake Save buttons.
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Settings from '../pages/Settings';
import { startRuntime } from '../state/runtime';
import { live } from '../adapters';

beforeAll(() => {
  startRuntime();
});

type RpcCall = { method: string; params: Record<string, unknown> };
const rpcHolder = live as unknown as { rpc: { call: (m: string, p?: Record<string, unknown>) => Promise<unknown> } };
const realRpc = rpcHolder.rpc;

function stubRpc(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  const calls: RpcCall[] = [];
  rpcHolder.rpc = {
    call: (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      return handler(method, params);
    },
  };
  return calls;
}

afterEach(() => {
  rpcHolder.rpc = realRpc;
});

const SOUL = 'You are Ally, chief of staff.\n';

describe('live env files (stubbed RPC)', () => {
  it('lists one SOUL.md per profile', async () => {
    stubRpc(async (m) => {
      if (m === 'profiles.list') return { profiles: [{ name: 'default', is_default: true }, { name: 'scout', is_default: false }] };
      throw new Error(`unexpected ${m}`);
    });
    const refs = await live.listEditableEnvironmentFiles();
    expect(refs.map((r) => r.id)).toEqual(['soul-default', 'soul-scout']);
    expect(refs[0].path).toBe('~/.hermes/SOUL.md');
    expect(refs[0].lastModifiedAt).toBeUndefined(); // no mtime in the RPC — honest absence
  });

  it('reads soul content with a content-hash version', async () => {
    stubRpc(async (m) => {
      if (m === 'profiles.describe') return { soul: SOUL };
      if (m === 'profiles.list') return { profiles: [{ name: 'default', is_default: true }] };
      throw new Error(`unexpected ${m}`);
    });
    const f = await live.readEnvironmentFile('soul-default');
    expect(f.content).toBe(SOUL);
    expect(f.version).toMatch(/^[0-9a-f]+$/);
    const again = await live.readEnvironmentFile('soul-default');
    expect(again.version).toBe(f.version); // deterministic
  });

  it('stale expectedVersion → version_conflict and NO configure call', async () => {
    const calls = stubRpc(async (m) => {
      if (m === 'profiles.describe') return { soul: SOUL };
      if (m === 'profiles.configure') return {};
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.writeEnvironmentFile('soul-default', 'deadbeef', 'new soul');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('version_conflict');
    expect(calls.some((c) => c.method === 'profiles.configure')).toBe(false);
  });

  it('good expectedVersion → configure fires with the new soul, audited', async () => {
    const fresh = await (async () => {
      stubRpc(async (m) => (m === 'profiles.describe' ? { soul: SOUL } : {}));
      return live.readEnvironmentFile('soul-default');
    })();
    const calls = stubRpc(async (m) => {
      if (m === 'profiles.describe') return { soul: SOUL };
      if (m === 'profiles.configure') return {};
      if (m === 'profiles.list') return { profiles: [{ name: 'default', is_default: true }] };
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.writeEnvironmentFile('soul-default', fresh.version, 'updated soul\n');
    expect(res.ok).toBe(true);
    expect(res.auditEventId).toContain('env-write-soul-default');
    const cfg = calls.find((c) => c.method === 'profiles.configure');
    expect(cfg?.params).toEqual({ name: 'default', soul: 'updated soul\n' });
  });

  it('gateway down → mock fallback list (spec §2)', async () => {
    stubRpc(async () => {
      throw new Error('socket closed');
    });
    const refs = await live.listEditableEnvironmentFiles();
    expect(refs.map((r) => r.id)).toEqual(['env-01', 'env-02']);
  });
});

describe('Settings page honesty (mock mode)', () => {
  it('env editor lists files and mock cards carry not-live badges, no fake saves', async () => {
    render(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>,
    );
    expect(await screen.findByText('ALLY.md', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText(/live write lands with agent factory/)).toBeInTheDocument();
    expect(screen.getByText(/policy editor not live yet/)).toBeInTheDocument();
    // the lying toasts are gone — no enabled "Save" buttons on the mock cards
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save policy' })).not.toBeInTheDocument();
  });
});
