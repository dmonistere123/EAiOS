/** Schedule — cron creation flow (spec §8.6 acceptance). */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Schedule from '../pages/Schedule';
import { startRuntime } from '../state/runtime';
import { hermes } from '../adapters';

beforeAll(() => startRuntime());

describe('Schedule — create cron job', () => {
  it('creates a job through the adapter with schedule and prompt', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Schedule /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: 'New scheduled task' }));
    await user.type(screen.getByLabelText('Name'), 'Test briefing');
    await user.type(screen.getByLabelText('What should Ally do?'), 'Draft the test digest');
    await user.click(screen.getByLabelText(/Deliver results to Telegram/));

    const spy = vi.spyOn(hermes, 'createCronJob');
    await user.click(screen.getByRole('button', { name: 'Create job' }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const input = spy.mock.calls[0][0] as { name: string; scheduleExpression: string; actionRef: string; deliver?: string };
    expect(input.name).toBe('Test briefing');
    expect(input.scheduleExpression).toBe('0 7 * * 1-5');
    expect(input.actionRef).toBe('Draft the test digest');
    expect(input.deliver).toContain('telegram:');
  });

  it('requires all fields before submitting', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><Schedule /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'New scheduled task' }));
    const spy = vi.spyOn(hermes, 'createCronJob');
    spy.mockClear(); // re-spying a wrapped method shares history across tests
    await user.click(screen.getByRole('button', { name: 'Create job' }));
    expect(spy).not.toHaveBeenCalled();
  });
});
