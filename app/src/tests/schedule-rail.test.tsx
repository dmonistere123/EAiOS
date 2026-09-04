/**
 * Schedule right-rail management: Calendar, Agent schedules, and Cron jobs
 * all expose inline Delete with confirmation.
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
  it('renders My calendar, Agent schedules, and Cron jobs sections with Delete buttons', async () => {
    renderAtSchedule();
    const railEl = rail();

    const calendarSection = within(railEl).getByText('My calendar').closest('section') as HTMLElement;
    expect(within(calendarSection).getAllByRole('button', { name: 'Delete' }).length).toBeGreaterThan(0);

    const agentSection = within(railEl).getByText('Agent schedules').closest('section') as HTMLElement;
    expect(await within(agentSection).findAllByRole('button', { name: 'Delete' }, { timeout: 4000 })).toHaveLength(3);

    // Cron jobs load asynchronously by agent; wait for them.
    const cronSection = await within(railEl).findByText('Cron jobs', undefined, { timeout: 4000 });
    const cronWrapper = cronSection.closest('section') as HTMLElement;
    expect(await within(cronWrapper).findAllByRole('button', { name: 'Delete' }, { timeout: 4000 })).toHaveLength(4);
  });
});
