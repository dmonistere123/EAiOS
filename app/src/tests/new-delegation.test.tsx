/**
 * On-the-fly task delegation (dogfood 2026-08-29) — Today & Schedule can
 * create a kanban task directly: assigned = auto-delegated (dispatcher),
 * unassigned = potential delegation in the executive queue.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Today from '../pages/Today';
import Schedule from '../pages/Schedule';
import { startRuntime, refreshWork } from '../state/runtime';
import { hermes, live } from '../adapters';

beforeAll(() => {
  startRuntime();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createWorkItem — mock contract', () => {
  it('unassigned → executive-owned potential delegation', async () => {
    const res = await hermes.createWorkItem({ title: 'Draft board Q&A prep', priority: 'high' });
    expect(res.ok).toBe(true);
    expect(res.id).toBeTruthy();
    await refreshWork();
    const work = await hermes.listWorkItems();
    const item = work.find((w) => w.id === res.id);
    expect(item?.ownerType).toBe('executive');
    expect(item?.state).toBe('ready');
    expect(item?.delegationCandidate).toBe(true);
  });

  it('assigned → delegated to the agent immediately', async () => {
    const res = await hermes.createWorkItem({ title: 'Write the launch post', agentId: 'quill' });
    expect(res.ok).toBe(true);
    const work = await hermes.listWorkItems();
    const item = work.find((w) => w.id === res.id);
    expect(item?.ownerType).toBe('agent');
    expect(item?.ownerId).toBe('quill');
    expect(item?.state).toBe('delegated');
  });

  it('empty title is refused', async () => {
    const res = await hermes.createWorkItem({ title: '   ' });
    expect(res.ok).toBe(false);
  });
});

describe('createWorkItem — live adapter builds the kanban create call', () => {
  it('kanban create with priority map + assignee + --json', async () => {
    const calls: string[][] = [];
    (live as unknown as { rpc: { call: (m: string, p: { argv: string[] }) => Promise<unknown> } }).rpc = {
      call: vi.fn(async (_m: string, params: { argv: string[] }) => {
        calls.push(params.argv);
        return { code: 0, output: JSON.stringify({ id: 't_new123' }) };
      }),
    };
    const res = await live.createWorkItem({ title: 'Investor Q&A doc', summary: 'Cover margins.', priority: 'critical', agentId: 'quill' });
    expect(res.ok).toBe(true);
    expect(res.id).toBe('t_new123');
    const argv = calls[0];
    expect(argv).toContain('create');
    expect(argv).toContain('Investor Q&A doc');
    expect(argv[argv.indexOf('--priority') + 1]).toBe('1'); // critical → 1
    expect(argv[argv.indexOf('--assignee') + 1]).toBe('quill');
    expect(argv[argv.indexOf('--body') + 1]).toBe('Cover margins.');
    expect(argv).toContain('--json');
  });

  it('unassigned omits --assignee (stays in the executive queue)', async () => {
    const calls: string[][] = [];
    (live as unknown as { rpc: { call: (m: string, p: { argv: string[] }) => Promise<unknown> } }).rpc = {
      call: vi.fn(async (_m: string, params: { argv: string[] }) => {
        calls.push(params.argv);
        return { code: 0, output: JSON.stringify({ id: 't_new456' }) };
      }),
    };
    const res = await live.createWorkItem({ title: 'Maybe delegate this', priority: 'low' });
    expect(res.ok).toBe(true);
    expect(calls[0]).not.toContain('--assignee');
    expect(calls[0][calls[0].indexOf('--priority') + 1]).toBe('4'); // low → 4
  });
});

describe('Today — New delegated task drawer', () => {
  it('creates an unassigned task that lands in the operating queue', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '＋ New delegated task' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Title'), 'Prep the pricing review');
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'high');
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }));
    await vi.waitFor(async () => {
      const work = await hermes.listWorkItems();
      expect(work.some((w) => w.title === 'Prep the pricing review' && w.ownerType === 'executive')).toBe(true);
    }, { timeout: 6000 });
  });

  it('assigning flips the submit copy to Create & delegate', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '＋ New delegated task' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Assign to'), 'quill');
    expect(within(dialog).getByRole('button', { name: /Create & delegate to Quill/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/picked up by the agent automatically/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });
});

describe('Schedule — delegation beside scheduled work', () => {
  it('offers New delegated task next to New scheduled task', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>,
    );
    const btn = await screen.findByRole('button', { name: '＋ New delegated task' });
    await user.click(btn);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    await user.keyboard('{Escape}');
  });
});
