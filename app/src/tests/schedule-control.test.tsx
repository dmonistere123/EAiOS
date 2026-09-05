/**
 * Dogfood 2026-08-29 (visibility batch): kanban lifecycle in the activity
 * ledger, dynamic work-item control (pause/resume/defer/done/stop/reclaim),
 * stale-run surfacing, recently-completed, and the cron inspector
 * (view prompt / edit / pause-resume / delete).
 */
import { describe, expect, it, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Schedule from '../pages/Schedule';
import { startRuntime, refreshWork, getState, __setAsyncPolling } from '../state/runtime';
import { hermes, live } from '../adapters';
import * as fx from '../mocks/fixtures';

beforeAll(async () => {
  startRuntime();
  (hermes as unknown as { __stopEvents(): void }).__stopEvents();
  (startRuntime as unknown as { __disableEventRefresh(): void }).__disableEventRefresh();
  // The Schedule page has mount-time polling effects (health/cron/delegated-runs)
  // that fire async state updates and produce act(...) warnings under jsdom.
  // Disable them for this suite; the stale-badge test re-enables health polling.
  __setAsyncPolling(false);
  // Drain the unawaited initial refreshAll() so it cannot race with fixture
  // patches in individual tests.
  await vi.waitFor(() => expect(getState().ready).toBe(true), { timeout: 8000 });
});

afterEach(async () => {
  vi.restoreAllMocks();
  cleanup();
  mock().__loadFixture({ work: fx.workItems, cron: fx.cronJobs });
  await refreshWork();
});

const mock = () =>
  hermes as unknown as {
    __loadFixture(patch: { work?: typeof fx.workItems; cron?: typeof fx.cronJobs }): void;
  };

const DAY_MS = 24 * 3600_000;

function stubLiveRpc(behavior: (argv: string[]) => { code: number; output: string }) {
  const calls: string[][] = [];
  (live as unknown as { rpc: { call: (m: string, p: { argv: string[] }) => Promise<unknown> } }).rpc = {
    call: vi.fn(async (_m: string, params: { argv: string[] }) => {
      calls.push(params.argv);
      return behavior(params.argv);
    }),
  };
  (live as unknown as { tasksCache?: unknown }).tasksCache = undefined;
  return calls;
}

describe('live listActivity merges kanban lifecycle events', () => {
  it('kanban completed tasks appear with their result summary', async () => {
    const completed = Math.floor(Date.now() / 1000) - 3600;
    (live as unknown as { rpc: { call: (m: string, p?: unknown) => Promise<unknown> } }).rpc = {
      call: vi.fn(async (method: string, _params?: unknown) => {
        if (method === 'session.list') return { sessions: [] };
        if (method === 'cli.exec') {
          return {
            code: 0,
            output: JSON.stringify([
              { id: 't_wx', title: 'SEnd me weather info', status: 'done', assignee: 'default', created_at: completed - 180, started_at: completed - 120, completed_at: completed, result: 'Fetched the 5-day forecast for Birmingham, AL and sent it to Don on Telegram.' },
            ]),
          };
        }
        throw new Error('unexpected ' + method);
      }),
    };
    (live as unknown as { tasksCache?: unknown }).tasksCache = undefined;
    const events = await live.listActivity();
    const weather = events.find((e) => e.workItemId === 't_wx' && e.type === 'agent.completed');
    expect(weather).toBeTruthy();
    expect(weather!.action).toBe('Task completed: SEnd me weather info');
    expect(weather!.result).toContain('5-day forecast');
    // lifecycle events for created + started exist too
    expect(events.some((e) => e.workItemId === 't_wx' && e.type === 'work.created')).toBe(true);
    expect(events.some((e) => e.workItemId === 't_wx' && e.type === 'agent.started')).toBe(true);
  });
});

describe('setWorkItemState — live kanban mapping', () => {
  it.each([
    ['pause', 'block'],
    ['resume', 'unblock'],
    ['stop', 'archive'],
    ['delete', 'archive'],
    ['defer', 'schedule'],
  ] as const)('%s → kanban %s', async (action, sub) => {
    const calls = stubLiveRpc(() => ({ code: 0, output: '✔ ok\n' }));
    const res = await live.setWorkItemState('t_x1', action, 'note');
    expect(res.ok).toBe(true);
    expect(calls.some((a) => a[1] === sub && a[2] === 't_x1')).toBe(true);
  });

  it('reclaim is GUARDED: a host-healthy run is refused, never killed', async () => {
    stubLiveRpc((argv) =>
      argv.includes('diagnostics')
        ? { code: 0, output: JSON.stringify([]) } // no flagged tasks → healthy
        : { code: 0, output: '✔ ok\n' },
    );
    const res = await live.setWorkItemState('t_x1', 'reclaim');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('run_healthy');
    expect(res.error?.safeMessage).toContain('actually healthy');
  });

  it('reclaim proceeds when the host FLAGS the task', async () => {
    const calls = stubLiveRpc((argv) =>
      argv.includes('diagnostics')
        ? { code: 0, output: JSON.stringify([{ task_id: 't_x1', diagnostics: [{ kind: 'lock_expired' }] }]) }
        : { code: 0, output: '✔ reclaimed\n' },
    );
    const res = await live.setWorkItemState('t_x1', 'reclaim');
    expect(res.ok).toBe(true);
    expect(calls.some((a) => a[1] === 'reclaim' && a[2] === 't_x1')).toBe(true);
  });

  it('getWorkItemHealth maps host-flagged tasks to stale, others healthy', async () => {
    stubLiveRpc((argv) =>
      argv.includes('diagnostics')
        ? { code: 0, output: JSON.stringify([{ task_id: 't_zombie', diagnostics: [{ kind: 'worker_dead' }] }]) }
        : { code: 0, output: '' },
    );
    const health = await live.getWorkItemHealth!(['t_zombie', 't_fine']);
    expect(health.t_zombie).toBe('stale');
    expect(health.t_fine).toBe('healthy');
  });

  it('complete passes --result', async () => {
    const calls = stubLiveRpc(() => ({ code: 0, output: '✔ ok\n' }));
    await live.setWorkItemState('t_x1', 'complete');
    const complete = calls.find((a) => a[1] === 'complete');
    expect(complete).toContain('--result');
  });
});

describe('setWorkItemState — mock transitions', () => {
  it('pause blocks, resume restores, stop cancels, delete removes', async () => {
    await hermes.setWorkItemState('w-03', 'pause');
    expect((await hermes.listWorkItems()).find((w) => w.id === 'w-03')?.state).toBe('blocked');
    await hermes.setWorkItemState('w-03', 'resume');
    expect((await hermes.listWorkItems()).find((w) => w.id === 'w-03')?.state).toBe('delegated');
    await hermes.setWorkItemState('w-03', 'stop');
    expect((await hermes.listWorkItems()).find((w) => w.id === 'w-03')?.state).toBe('cancelled');
    await hermes.setWorkItemState('w-04', 'delete');
    expect((await hermes.listWorkItems()).find((w) => w.id === 'w-04')).toBeUndefined();
  });

  it('unknown task is an honest not_found', async () => {
    const res = await hermes.setWorkItemState('w-nope', 'pause');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('not_found');
  });
});

describe('Schedule — dynamic work control + visibility', () => {
  beforeEach(() => {
    __setAsyncPolling(false);
  });

  it('rows carry actions; pause flips the row to blocked with a Resume button', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>,
    );
    const card = (await screen.findByText('Work in flight — delegated tasks')).closest('div.rounded-xl') as HTMLElement;
    const row = (await within(card).findByText('Prepare investor update email', undefined, { timeout: 4000 })).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Pause' }));
    await waitFor(async () => {
      expect((await hermes.listWorkItems()).find((w) => w.id === 'w-03')?.state).toBe('blocked');
    }, { timeout: 5000 });
    expect(await within(row).findByRole('button', { name: 'Resume' }, { timeout: 4000 })).toBeInTheDocument();
  });

  it('stale in-progress tasks get the stale badge + Reclaim action', async () => {
    mock().__loadFixture({
      work: fx.workItems.map((w) =>
        w.id === 'w-03' ? { ...w, state: 'in_progress' as const, updatedAt: new Date(Date.now() - 45 * 60_000).toISOString() } : w,
      ),
    });
    await refreshWork();
    // This is the only Schedule test that asserts the health-polling UI.
    __setAsyncPolling(true);
    render(
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>,
    );
    const card = (await screen.findByText('Work in flight — delegated tasks')).closest('div.rounded-xl') as HTMLElement;
    const row = (await within(card).findByText('Prepare investor update email', undefined, { timeout: 8000 })).closest('li') as HTMLElement;
    // full-suite load can delay the debounced refresh past default waits
    expect(await within(row).findByText('stale — no heartbeat', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(await within(row).findByRole('button', { name: 'Reclaim' }, { timeout: 8000 })).toBeInTheDocument();
  });

  it('Done on a healthy in-progress run asks first (worker-active guard)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>,
    );
    const card = (await screen.findByText('Work in flight — delegated tasks')).closest('div.rounded-xl') as HTMLElement;
    const row = (await within(card).findByText('Prepare investor update email', undefined, { timeout: 8000 })).closest('li') as HTMLElement;
    // first click does NOT complete — it warns about the live worker
    await user.click(within(row).getByRole('button', { name: 'Done' }));
    const confirm = await within(row).findByRole('button', { name: 'Worker may be active — confirm Done' }, { timeout: 8000 });
    expect((await hermes.listWorkItems()).find((w) => w.id === 'w-03')?.state).toBe('in_progress');
    // second click completes
    await user.click(confirm);
    await waitFor(async () => {
      expect((await hermes.listWorkItems()).find((w) => w.id === 'w-03')?.state).toBe('complete');
    }, { timeout: 5000 });
  });

  it('completed tasks within 3 days appear in the recently-completed list, with their result', async () => {
    mock().__loadFixture({
      work: fx.workItems.map((w) =>
        w.id === 'w-09' ? { ...w, updatedAt: new Date(Date.now() - 2 * DAY_MS).toISOString(), result: 'Digest produced and sent to Don on Telegram.' } : w,
      ),
    });
    await refreshWork();
    render(
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Completed in the last 3 days', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Expense anomaly digest')).toBeInTheDocument();
    expect(screen.getByText(/Digest produced and sent to Don/)).toBeInTheDocument();
  });

  it('main delegated task list has a Delete button', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>,
    );
    const card = (await screen.findByText('Work in flight — delegated tasks')).closest('div.rounded-xl') as HTMLElement;
    const row = (await within(card).findByText('Prepare investor update email', undefined, { timeout: 4000 })).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(await within(row).findByRole('button', { name: 'Confirm delete' }, { timeout: 4000 }));
    await waitFor(async () => {
      expect((await hermes.listWorkItems()).find((w) => w.id === 'w-03')).toBeUndefined();
    }, { timeout: 5000 });
  });
});

describe('cron inspector + management', () => {
  it('mock delete removes the job', async () => {
    const res = await hermes.deleteCronJob('c-01');
    expect(res.ok).toBe(true);
    expect((await hermes.listCronJobs()).some((c) => c.id === 'c-01')).toBe(false);
  });

  it('live content edits go through cron edit; enabled goes through cron.manage', async () => {
    const calls: string[][] = [];
    const manageCalls: unknown[] = [];
    (live as unknown as { rpc: { call: (m: string, p?: unknown) => Promise<unknown> } }).rpc = {
      call: vi.fn(async (method: string, params?: unknown) => {
        if (method === 'cron.manage') {
          manageCalls.push(params);
          return { ok: true };
        }
        if (method === 'cli.exec') {
          calls.push((params as { argv: string[] }).argv);
          return { code: 0, output: 'updated' };
        }
        throw new Error('unexpected ' + method);
      }),
    };
    const res = await live.updateCronJob('job-1', { name: 'LinkedIn brief', prompt: 'Draft the weekly LinkedIn brief.', scheduleExpression: '0 8 * * 1', enabled: false });
    expect(res.ok).toBe(true);
    expect(manageCalls[0]).toMatchObject({ action: 'pause', name: 'job-1' });
    const edit = calls.find((a) => a[0] === 'cron' && a[1] === 'edit');
    expect(edit).toBeTruthy();
    expect(edit).toContain('--name');
    expect(edit).toContain('--prompt');
    expect(edit).toContain('--schedule');
  });

  it('live delete goes through cron remove', async () => {
    const calls = stubLiveRpc(() => ({ code: 0, output: 'removed' }));
    const res = await live.deleteCronJob('job-9');
    expect(res.ok).toBe(true);
    expect(calls.some((a) => a[0] === 'cron' && a[1] === 'remove' && a[2] === 'job-9')).toBe(true);
  });
});
