/**
 * W5+W6+W8 batch tests.
 * W5: Schedule rail groups live cron by owning agent (profile-scoped
 *   listCronJobs; creator-gap note shown honestly). Live unit: profile
 *   param + scoped marker → ownerAgentId.
 * W6: Knowledge sources grouped by visibility (private / workspace /
 *   agent-scoped) with agent names resolved.
 * W8: Artifacts rail agent-filter chips compose with the search box.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Schedule from '../pages/Schedule';
import Knowledge from '../pages/Knowledge';
import Artifacts from '../pages/Artifacts';
import AppShell from '../app/AppShell';
import { startRuntime } from '../state/runtime';
import { hermes, live } from '../adapters';

beforeAll(() => {
  startRuntime();
});

function renderAt(route: string, element: React.ReactElement, path: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path={path} element={element} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('W5 — Schedule ownership rail', () => {
  it('groups cron jobs by owning agent; creator gap noted honestly', async () => {
    renderAt('/schedule', <Schedule />, 'schedule');
    expect(await screen.findByRole('heading', { name: 'Calendar' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Work in flight' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Cron jobs' })).toBeInTheDocument();
    expect(screen.queryByText('Operational Watchtower')).not.toBeInTheDocument();
    // mock fixtures: ally → morning briefing, scout → competitor digest, sentinel → watchdog
    const cronSection = (await screen.findByRole('heading', { name: 'Cron jobs' })).closest('[data-rail-section]') as HTMLElement;
    expect(cronSection).toBeTruthy();
    expect(await within(cronSection).findByText("Morning briefing → Ally's Portal")).toBeInTheDocument();
    expect(await within(cronSection).findByText('Competitor news digest')).toBeInTheDocument();
    expect(await screen.findByText(/doesn't record who created each job/)).toBeInTheDocument();
  });

  it('mock listCronJobs scopes by profile', async () => {
    expect((await hermes.listCronJobs('ally')).map((j) => j.id)).toEqual(['c-01']);
    expect((await hermes.listCronJobs('sentinel')).map((j) => j.id)).toEqual(['c-04']);
    expect((await hermes.listCronJobs()).length).toBeGreaterThan(3); // unscoped = all
  });

  it('live listCronJobs passes profile and stamps ownerAgentId from the scoped marker', async () => {
    const holder = live as unknown as { rpc: { call: (m: string, p?: Record<string, unknown>) => Promise<unknown> } };
    const realRpc = holder.rpc;
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    holder.rpc = {
      call: async (method: string, params: Record<string, unknown> = {}) => {
        calls.push({ method, params });
        if (method === 'cron.manage') {
          return { jobs: [{ job_id: 'j1', name: 'Quill weekly', schedule: '0 9 * * 1', next_run_at: '2026-08-31T09:00:00-05:00', enabled: true }], scoped: 'quill' };
        }
        throw new Error(`unexpected ${method}`);
      },
    } as typeof realRpc;
    try {
      const jobs = await live.listCronJobs('quill');
      expect(calls[0].params).toEqual({ action: 'list', include_disabled: true, profile: 'quill' });
      expect(jobs[0]).toMatchObject({ name: 'Quill weekly', ownerAgentId: 'quill' });
    } finally {
      holder.rpc = realRpc;
    }
  });
});

describe('W6 — Knowledge visibility groups', () => {
  it('groups sources into Executive only / All staff agents / Specific agents with names', async () => {
    render(
      <MemoryRouter>
        <Knowledge />
      </MemoryRouter>,
    );
    const execOnly = (await screen.findByText('Executive only')).closest('div.rounded-xl') as HTMLElement;
    expect(within(execOnly).getByText('Q3 board deck (working).pptx')).toBeInTheDocument(); // k-01 private
    expect(within(execOnly).getByText('Vendor contracts 2026.zip')).toBeInTheDocument(); // k-04 private (failed)
    const workspace = (await screen.findByText('All staff agents')).closest('div.rounded-xl') as HTMLElement;
    expect(within(workspace).getByText('allygnment.com — brand guidelines')).toBeInTheDocument(); // k-02
    const specific = (await screen.findByText('Specific agents')).closest('div.rounded-xl') as HTMLElement;
    expect(within(specific).getByText('Investor call — Aug 12')).toBeInTheDocument(); // k-03 agent [ally]
    expect(within(specific).getByText('Only: Ally')).toBeInTheDocument(); // name, not raw id
  });
});

describe('W8 — Artifacts agent filter rail', () => {
  it('rail chips filter rows; All restores', async () => {
    const user = userEvent.setup();
    renderAt('/artifacts', <Artifacts />, 'artifacts');
    expect(await screen.findByText('Filter by agent')).toBeInTheDocument();
    // all four fixture artifacts visible initially
    expect(await screen.findByText('AI_Ops_Tooling_Market_Scan.md')).toBeInTheDocument();
    expect(screen.getByText('Expense_Anomaly_Digest_Aug.xlsx')).toBeInTheDocument();
    // scout chip → only scout's artifact
    await user.click(screen.getByRole('button', { name: /^Scout/ }));
    expect(screen.getByText('AI_Ops_Tooling_Market_Scan.md')).toBeInTheDocument();
    expect(screen.queryByText('Expense_Anomaly_Digest_Aug.xlsx')).not.toBeInTheDocument();
    // All restores
    await user.click(screen.getByRole('button', { name: /^All agents/ }));
    expect(await screen.findByText('Expense_Anomaly_Digest_Aug.xlsx')).toBeInTheDocument();
  });
});
