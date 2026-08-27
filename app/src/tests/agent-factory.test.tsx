/**
 * Agent factory tests — Phase 6.5 (spec §8.3). Live paths with stubbed RPC:
 * model catalog grouping, createAgent validation + profiles.create payload,
 * updateAgentConfig catalog validation + profiles.configure. Mock parity:
 * slug/duplicate validation and the agent actually joining the roster.
 * Page: Add Agent drawer renders the grouped catalog and a created agent
 * lands on the staff grid.
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Staff from '../pages/Staff';
import { startRuntime } from '../state/runtime';
import { hermes, live } from '../adapters';

beforeAll(() => {
  startRuntime();
});

// ---------- live unit: stubbed RPC ----------

const holder = live as unknown as { rpc: { call: (m: string, p?: Record<string, unknown>) => Promise<unknown> } };
const realRpc = holder.rpc;

function stubRpc(handler: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  holder.rpc = {
    call: (method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      return handler(method, params);
    },
  };
  return calls;
}

afterEach(() => {
  holder.rpc = realRpc;
});

const CATALOG = {
  providers: [
    { slug: 'nous', name: 'Nous Portal', models: ['moonshotai/kimi-k3', 'anthropic/claude-sonnet-5'], authenticated: true },
    { slug: 'openrouter', name: 'OpenRouter', models: ['deepseek/deepseek-v4-flash'], authenticated: true },
  ],
};

describe('live agent factory (stubbed RPC)', () => {
  it('listModelOptions groups the catalog by provider', async () => {
    stubRpc(async (m) => (m === 'model.options' ? CATALOG : Promise.reject(new Error(`unexpected ${m}`))));
    const groups = await live.listModelOptions();
    expect(groups.map((g) => g.slug)).toEqual(['nous', 'openrouter']);
    expect(groups[0].models).toContain('moonshotai/kimi-k3');
  });

  it('listModelOptions falls back to mock on RPC failure', async () => {
    stubRpc(async () => Promise.reject(new Error('down')));
    const groups = await live.listModelOptions();
    expect(groups.length).toBeGreaterThan(0); // mock catalog
  });

  it('createAgent rejects a bad slug without touching the gateway', async () => {
    const calls = stubRpc(async () => ({}));
    const res = await live.createAgent({ name: 'Bad Name!', role: 'x', model: { provider: 'nous', model: 'moonshotai/kimi-k3' } });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('invalid_name');
    expect(calls).toHaveLength(0);
  });

  it('createAgent posts name/role/model pin to profiles.create', async () => {
    const calls = stubRpc(async (m) => {
      if (m === 'profiles.create') return {};
      throw new Error(`unexpected ${m}`);
    });
    const res = await live.createAgent({
      name: 'scout',
      role: 'Competitive intelligence analyst',
      model: { provider: 'nous', model: 'moonshotai/kimi-k3' },
      soul: 'You are Scout.',
    });
    expect(res.ok).toBe(true);
    expect(res.auditEventId).toContain('agent-create-scout');
    expect(calls[0].params).toEqual({
      name: 'scout',
      description: 'Competitive intelligence analyst',
      model: 'moonshotai/kimi-k3',
      provider: 'nous',
      soul: 'You are Scout.',
    });
  });

  it('createAgent surfaces duplicate errors honestly', async () => {
    stubRpc(async () => {
      throw new Error("profile 'scout' already exists");
    });
    const res = await live.createAgent({ name: 'scout', role: 'x', model: { provider: 'nous', model: 'moonshotai/kimi-k3' } });
    expect(res.ok).toBe(false);
    expect(res.error?.safeMessage).toContain('already exists');
  });

  it('updateAgentConfig validates against the catalog, then configures', async () => {
    const calls = stubRpc(async (m) => {
      if (m === 'model.options') return CATALOG;
      if (m === 'profiles.configure') return {};
      throw new Error(`unexpected ${m}`);
    });
    const bad = await live.updateAgentConfig('scout', { model: { provider: 'nous', model: 'openai/gpt-5.5' } });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('model_not_allowed');
    expect(calls.some((c) => c.method === 'profiles.configure')).toBe(false);

    const good = await live.updateAgentConfig('scout', { model: { provider: 'nous', model: 'anthropic/claude-sonnet-5' } });
    expect(good.ok).toBe(true);
    const cfg = calls.find((c) => c.method === 'profiles.configure');
    expect(cfg?.params).toEqual({ name: 'scout', model: 'anthropic/claude-sonnet-5', provider: 'nous' });
  });
});

// ---------- mock parity ----------

describe('mock agent factory', () => {
  it('validates slug and duplicates, then staffs the new agent', async () => {
    const bad = await hermes.createAgent({ name: 'NOPE', role: 'x', model: { provider: 'nous', model: 'moonshotai/kimi-k3' } });
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('invalid_name');

    const res = await hermes.createAgent({ name: 'factory-test', role: 'Test specialist', model: { provider: 'nous', model: 'moonshotai/kimi-k3' } });
    expect(res.ok).toBe(true);
    const agents = await hermes.listAgents();
    expect(agents.some((a) => a.id === 'factory-test' && a.role === 'Test specialist')).toBe(true);

    const dup = await hermes.createAgent({ name: 'factory-test', role: 'x', model: { provider: 'nous', model: 'moonshotai/kimi-k3' } });
    expect(dup.ok).toBe(false);
    expect(dup.error?.code).toBe('duplicate');
  });
});

// ---------- page ----------

describe('Staff page — Add Agent drawer (mock mode)', () => {
  it('opens the drawer with the grouped catalog and creates an agent that lands on the grid', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '+ Add agent' }, { timeout: 4000 }));
    // catalog loaded with provider groups (optgroup = ARIA 'group')
    const select = await screen.findByLabelText('Model', undefined, { timeout: 4000 });
    expect(await within(select).findByRole('group', { name: 'Nous Portal' }, { timeout: 4000 })).toBeInTheDocument();

    // invalid slug → hint + disabled create
    await user.type(screen.getByLabelText('Agent id'), 'Bad Name');
    expect(screen.getByText(/Lowercase slug/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create agent' })).toBeDisabled();

    await user.clear(screen.getByLabelText('Agent id'));
    await user.type(screen.getByLabelText('Agent id'), 'page-test');
    await user.type(screen.getByLabelText('Role'), 'Drawer-created specialist');
    await user.click(screen.getByRole('button', { name: 'Create agent' }));

    // drawer closes on success and the new card appears
    expect(await screen.findByText('Page-test', undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});
