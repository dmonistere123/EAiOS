/**
 * Schedule right-rail management: My calendar, Work in flight, and Cron jobs
 * all expose inline Delete with confirmation.
 *
 * Regression (t_fa671981): the source filter for agent-owned calendar events
 * is now "Agent calendar" and the delegated-task rail section is now
 * "Work in flight", so the same label no longer refers to two different
 * sources.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppShell from '../app/AppShell';
import Schedule from '../pages/Schedule';
import { startRuntime, refreshWork } from '../state/runtime';
import { hermes } from '../adapters';
import * as fx from '../mocks/fixtures';
import { resetRailForTests } from '../state/rail';

beforeAll(() => {
  startRuntime();
  (hermes as unknown as { __stopEvents(): void }).__stopEvents();
});

afterEach(async () => {
  vi.restoreAllMocks();
  resetRailForTests();
  (hermes as unknown as { __loadFixture(patch: { work?: typeof fx.workItems; cron?: typeof fx.cronJobs }): void }).__loadFixture({ work: fx.workItems, cron: fx.cronJobs });
  await refreshWork();
});

function renderAtSchedule() {
  return render(
    <MemoryRouter initialEntries={['/schedule']}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="schedule" element={<Schedule />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function rail() {
  return screen.getByRole('complementary', { name: 'Operational watchtower' });
}

describe('Schedule right-rail delete actions', () => {
  it('renders My calendar, Work in flight, and Cron jobs sections with Delete buttons', async () => {
    renderAtSchedule();
    const railEl = rail();

    const calendarSection = within(railEl).getByText('My calendar').closest('section') as HTMLElement;
    expect(within(calendarSection).getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0);

    const agentSection = within(railEl).getByText('Work in flight').closest('section') as HTMLElement;
    expect(await within(agentSection).findAllByRole('button', { name: 'Delete' }, { timeout: 4000 })).toHaveLength(3);

    // Cron jobs load asynchronously by agent; wait for them.
    const cronSection = await within(railEl).findByText('Cron jobs', undefined, { timeout: 4000 });
    const cronWrapper = cronSection.closest('section') as HTMLElement;
    expect(await within(cronWrapper).findAllByRole('button', { name: 'Delete' }, { timeout: 4000 })).toHaveLength(4);
  });
});

describe('Schedule center vs right-rail consistency (t_fa671981)', () => {
  it('uses distinct labels for agent calendar events and delegated tasks', async () => {
    renderAtSchedule();

    // Center-panel source filter: agent-owned items are calendar events.
    expect(screen.getByLabelText('Agent calendar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent schedules')).not.toBeInTheDocument();

    // Right rail: delegated tasks live under "Work in flight".
    const railEl = rail();
    expect(await within(railEl).findByRole('heading', { name: 'Work in flight' })).toBeInTheDocument();
    expect(within(railEl).queryByRole('heading', { name: 'Agent schedules' })).not.toBeInTheDocument();
  });

  it('shows the same active delegated count in the center card and right rail', async () => {
    renderAtSchedule();

    // fixtures: w-03, w-05, w-07 are agent-owned and not complete/cancelled = 3
    const centerCard = (await screen.findByText('Work in flight — delegated tasks')).closest('div.rounded-xl') as HTMLElement;
    expect(await within(centerCard).findByText('3 active')).toBeInTheDocument();

    const railEl = rail();
    const railSection = (await within(railEl).findByRole('heading', { name: 'Work in flight' })).closest('section') as HTMLElement;
    expect(within(railSection).getByText('3')).toBeInTheDocument();
  });
});
