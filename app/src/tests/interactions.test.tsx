/**
 * Interaction tests — the proof the executive loop works, executed headlessly.
 * Uses the mock adapter (VITE_HERMES_LIVE unset → mock mode).
 */
import { describe, expect, it, beforeAll, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Today from '../pages/Today';
import { startRuntime } from '../state/runtime';
import { hermes } from '../adapters';

beforeAll(() => {
  startRuntime();
});

describe('Today — delegation flow (spec §8.1)', () => {
  beforeEach(() => {
    localStorage.removeItem('eaios:today:dismissed');
  });

  it('opens the delegation dialog and delegates to an agent', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    // Queue hydrates from the mock adapter (item appears in both the
    // recommendations strip and the queue table — expect multiple)
    const rows = await screen.findAllByText('Weekly metrics review', undefined, { timeout: 4000 });
    expect(rows.length).toBeGreaterThan(0);

    // Click the first Delegate button in the recommendations strip
    const delegateButtons = await screen.findAllByRole('button', { name: 'Delegate' });
    await user.click(delegateButtons[0]);

    // Dialog opens with agent chooser
    expect(await screen.findByText('Delegate work')).toBeInTheDocument();
    expect(screen.getByLabelText('Assign to')).toBeInTheDocument();

    // Confirm → adapter called, dialog closes (toast lives in AppShell, not this tree)
    const spy = vi.spyOn(hermes, 'delegateWork');
    await user.click(screen.getByRole('button', { name: /Confirm delegation/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const [calledId, calledReq] = spy.mock.calls[0];
    expect(calledId).toBeTruthy();
    expect((calledReq as { agentId?: string }).agentId).toBe('ally');
    await waitFor(() => expect(screen.queryByText('Delegate work')).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it('persists dismissed tasks across reloads', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    const recommendationsHeading = await screen.findByRole('heading', { name: 'Recommended to delegate' });
    expect(recommendationsHeading).toBeInTheDocument();

    let dismissButtons = screen.getAllByRole('button', { name: /Dismiss recommendation/i });
    while (dismissButtons.length > 0) {
      await user.click(dismissButtons[0]);
      await waitFor(() => expect(screen.queryAllByRole('button', { name: /Dismiss recommendation/i }).length).toBeLessThan(dismissButtons.length), { timeout: 4000 });
      dismissButtons = screen.queryAllByRole('button', { name: /Dismiss recommendation/i });
    }

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Recommended to delegate' })).not.toBeInTheDocument(), { timeout: 4000 });
    expect(localStorage.getItem('eaios:today:dismissed')).toBeTruthy();

    unmount();

    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Recommended to delegate' })).not.toBeInTheDocument(), { timeout: 4000 });
  });
});

describe('Environment file saves (spec §8.11)', () => {
  it('rejects stale expectedVersion (optimistic concurrency)', async () => {
    await hermes.readEnvironmentFile('env-01'); // ensure file exists
    const res = await hermes.writeEnvironmentFile('env-01', 'stale-version', 'new content');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('version_conflict');
    expect(res.error?.retryable).toBe(true);
  });

  it('accepts a save with the current version and returns an audit id', async () => {
    const file = await hermes.readEnvironmentFile('env-02');
    const res = await hermes.writeEnvironmentFile('env-02', file.version, 'updated rules');
    expect(res.ok).toBe(true);
    expect(res.auditEventId).toMatch(/^aud-/);
  });
});

describe('Agent config validation (spec §8.3)', () => {
  it('rejects a model outside the agent allowed list', async () => {
    const res = await hermes.updateAgentConfig('ally', { model: { provider: 'evil', model: 'not-allowed' } });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('model_not_allowed');
  });
});
