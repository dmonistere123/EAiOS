/**
 * Today dismissal sync (dogfood 2026-09-10): dismissing a work item must
 * persist server-side so the same user sees the same filtered counts from any
 * browser/machine. Tests the adapter contract; the real server-side store is
 * exercised by the integration probe.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Today from '../pages/Today';
import { startRuntime } from '../state/runtime';
import { hermes } from '../adapters';

// Restore real mock adapter behavior between tests.
const resetDismissed = async () => {
  for (const id of await hermes.getDismissedWorkIds()) {
    await hermes.undismissWorkItem(id);
  }
};

describe('Today dismissal server-side sync', () => {
  beforeAll(() => {
    startRuntime();
  });

  it('loads dismissed ids from the adapter and hides them from the queue', async () => {
    await resetDismissed();
    await hermes.dismissWorkItem('w-04'); // Weekly metrics review (executive, ready)

    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    await screen.findByText('Operating queue');
    expect(screen.queryByText('Weekly metrics review')).not.toBeInTheDocument();

    // "Show 1 dismissed" toggle appears and reveals the hidden item.
    const toggle = await screen.findByRole('button', { name: /Show 1 dismissed/ });
    await userEvent.click(toggle);
    expect(await screen.findByText('Weekly metrics review')).toBeInTheDocument();

    await hermes.undismissWorkItem('w-04');
  });

  it('dismissing an item calls the adapter and drops the count', async () => {
    await resetDismissed();

    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );

    await screen.findByText('Recommended to delegate');
    const before = await hermes.getDismissedWorkIds();

    const dismiss = screen.getAllByRole('button', { name: /Dismiss recommendation/ })[0];
    await userEvent.click(dismiss);

    await waitFor(async () => {
      const after = await hermes.getDismissedWorkIds();
      expect(after.length).toBe(before.length + 1);
    });
  });
});
