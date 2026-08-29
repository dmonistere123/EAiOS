/**
 * Dogfood 2026-08-29 — delegated-work visibility + governance seeding:
 * - Schedule shows real "Work in flight" (agent-owned kanban tasks)
 * - Add Agent seeds the governance SOUL block (approval gate + output delivery)
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Schedule from '../pages/Schedule';
import Staff from '../pages/Staff';
import { startRuntime } from '../state/runtime';
import { AGENT_GOVERNANCE_SOUL } from '../domain/governance';

beforeAll(() => {
  startRuntime();
});

describe('Schedule — Work in flight', () => {
  it('lists agent-owned active tasks with owner + state, excluding terminal ones', async () => {
    render(
      <MemoryRouter>
        <Schedule />
      </MemoryRouter>,
    );
    const card = (await screen.findByText('Work in flight — delegated tasks')).closest('div.rounded-xl') as HTMLElement;
    // fixtures: w-03 (ally, in_progress), w-05 (quill, waiting_approval), w-07 (scout, in_progress)
    expect(await within(card).findByText('Prepare investor update email', undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(within(card).getByText('Customer newsletter — September')).toBeInTheDocument();
    expect(within(card).getByText('Market scan: AI ops tooling')).toBeInTheDocument();
    expect(await within(card).findByText(/^Ally$/, undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(within(card).getByText('waiting approval')).toBeInTheDocument();
    // w-09 is complete — must NOT appear
    expect(within(card).queryByText('Expense anomaly digest')).not.toBeInTheDocument();
    // the approval-gate assurance copy is on the card
    expect(within(card).getByText(/nothing here bypasses them/)).toBeInTheDocument();
  });
});

describe('Add Agent — governance seed', () => {
  it('SOUL seed is prefilled with the approval-gate + output-delivery rules', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Staff />
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: '+ Add agent' }));
    const dialog = await screen.findByRole('dialog');
    const seed = within(dialog).getByLabelText(/SOUL.md seed/) as HTMLTextAreaElement;
    expect(seed.value).toBe(AGENT_GOVERNANCE_SOUL);
    expect(seed.value).toContain('approval gate (never bypass)');
    expect(seed.value).toContain('kanban attach');
    expect(seed.value).toContain('telegram:-1004268167166');
    await user.keyboard('{Escape}');
  });
});
