/**
 * Delegated-run visibility (Don 2026-08-29): every executed task appears as
 * a read-only session in the Assistant rail's "Delegated runs" section and
 * is clickable on Schedule's completed-24h list — result up top, worker
 * transcript below. Mock parity via the fixture run 'Email triage'.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Assistant from '../pages/Assistant';
import Schedule from '../pages/Schedule';
import AppShell from '../app/AppShell';
import { startRuntime } from '../state/runtime';

beforeAll(() => {
  startRuntime();
});

function renderAt(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="assistant" element={<Assistant />} />
          <Route path="schedule" element={<Schedule />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('Assistant rail — Delegated runs', () => {
  it('worker sessions appear IN Conversations — Ally (they are Ally sessions), tagged kanban', async () => {
    renderAt('/assistant');
    const convo = await screen.findByText(/Conversations —/);
    expect(convo).toBeInTheDocument();
    // the fixture run's worker session is merged into the conversations list
    // (it also appears in the Delegated runs section — both, by design)
    const entries = await screen.findAllByRole('button', { name: /Email triage — both inboxes/ });
    expect(entries.length).toBe(2);
    expect(within(entries[0]).getByText('kanban')).toBeInTheDocument();
  });

  it('lists delegated runs; clicking one opens the result + worker transcript', async () => {
    const user = userEvent.setup();
    renderAt('/assistant');
    // rail section appears with the fixture run
    expect(await screen.findByText('Delegated runs')).toBeInTheDocument();
    const runButton = (await screen.findAllByRole('button', { name: /Email triage — both inboxes/ }))[0];
    await user.click(runButton);
    // drawer: result up top, real transcript below (read-only)
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Result')).toBeInTheDocument();
    expect(within(dialog).getByText(/Triaged Gmail \+ Outlook: 3 actionable items/)).toBeInTheDocument();
    expect(await within(dialog).findByText(/Reading both inboxes now/)).toBeInTheDocument();
    expect(within(dialog).getByText('read-only')).toBeInTheDocument();
  });
});

describe('Schedule — completed runs are readable', () => {
  it('clicking a completed-24h row opens the run drawer', async () => {
    const user = userEvent.setup();
    renderAt('/schedule');
    const row = await screen.findByText('Expense anomaly digest');
    await user.click(row);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Expense anomaly digest')).toBeInTheDocument();
    // fixture task has no worker session — honest empty state, not a fake transcript
    expect(within(dialog).getByText(/No worker session was recorded/)).toBeInTheDocument();
  });
});
