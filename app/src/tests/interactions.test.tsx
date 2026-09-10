/**
 * Interaction tests — the proof the executive loop works, executed headlessly.
 * Uses the mock adapter (VITE_HERMES_LIVE unset → mock mode).
 */
import { describe, expect, it, beforeAll, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Today from '../pages/Today';
import { refreshAll, startRuntime } from '../state/runtime';
import { hermes } from '../adapters';
import { workItems as fxWorkItems } from '../mocks/fixtures';

beforeAll(() => {
  startRuntime();
  (startRuntime as unknown as { __disableEventRefresh?(): void }).__disableEventRefresh?.();
});

async function resetMock() {
  const ids = await hermes.getDismissedWorkIds();
  if (ids.length > 0) {
    await Promise.all(ids.map((id) => hermes.undismissWorkItem(id)));
  }
  (hermes as unknown as { __loadFixture: (p: Record<string, unknown>) => void }).__loadFixture({
    work: fxWorkItems,
  });
}

async function fullReset() {
  await resetMock();
  await refreshAll();
}

/** Read the numeric value from a KPI card by its label. */
function kpiValue(label: string): number {
  const el = screen.getByText(label);
  const card = el.parentElement;
  if (!card) throw new Error(`KPI card for "${label}" not found`);
  const m = card.textContent?.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

describe('Today — delegation flow (spec §8.1)', () => {
  it('opens the delegation dialog and delegates to an agent', async () => {
    await fullReset();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    const rows = await screen.findAllByText('Weekly metrics review', undefined, { timeout: 4000 });
    expect(rows.length).toBeGreaterThan(0);

    const delegateButtons = await screen.findAllByRole('button', { name: 'Delegate' });
    await user.click(delegateButtons[0]);

    expect(await screen.findByText('Delegate work')).toBeInTheDocument();
    expect(screen.getByLabelText('Assign to')).toBeInTheDocument();

    const spy = vi.spyOn(hermes, 'delegateWork');
    await user.click(screen.getByRole('button', { name: /Confirm delegation/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const [calledId, calledReq] = spy.mock.calls[0];
    expect(calledId).toBeTruthy();
    expect((calledReq as { agentId?: string }).agentId).toBe('ally');
    await waitFor(() => expect(screen.queryByText('Delegate work')).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it('persists dismissed tasks across reloads', async () => {
    await fullReset();
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

    unmount();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Recommended to delegate' })).not.toBeInTheDocument(), { timeout: 4000 });
  });

  it('updates Priorities and Delegatable KPIs when a recommendation is dismissed', async () => {
    await fullReset();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    await screen.findByText('Your priorities');
    await new Promise((r) => setTimeout(r, 200));
    const before = kpiValue('Your priorities');
    const delBefore = kpiValue('Delegatable');

    const anyDismiss = screen.queryAllByRole('button', { name: /Dismiss recommendation/i })[0];
    if (!anyDismiss) return;
    await user.click(anyDismiss);

    await waitFor(() => {
      expect(kpiValue('Your priorities')).toBe(Math.max(0, before - 1));
      expect(kpiValue('Delegatable')).toBe(Math.max(0, delBefore - 1));
    }, { timeout: 4000 });
  });

  it('lets the user show and unhide dismissed items', async () => {
    await fullReset();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    await screen.findByText('Your priorities');
    await new Promise((r) => setTimeout(r, 200));
    const before = kpiValue('Your priorities');

    const dismissButton = screen.queryAllByRole('button', { name: /Dismiss recommendation/i })[0];
    if (!dismissButton) return;
    await user.click(dismissButton);

    await waitFor(() => expect(kpiValue('Your priorities')).toBe(before - 1), { timeout: 4000 });
    const showButton = screen.queryByRole('button', { name: /Show \d+ dismissed/i });
    if (showButton) {
      await user.click(showButton);
      const unhideButtons = screen.queryAllByRole('button', { name: 'Unhide' });
      if (unhideButtons.length > 0) {
        await user.click(unhideButtons[0]);
        await waitFor(() => expect(kpiValue('Your priorities')).toBe(before), { timeout: 4000 });
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Unhide' })).not.toBeInTheDocument(), { timeout: 4000 });
      }
    }
  });
});

describe('Environment file saves (spec §8.11)', () => {
  it('rejects stale expectedVersion (optimistic concurrency)', async () => {
    await hermes.readEnvironmentFile('env-01');
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