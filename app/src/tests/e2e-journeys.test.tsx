/**
 * H4 — End-to-End Executive Journeys (spec §14.3, verbatim paths).
 * Full AppShell renders in mock mode; each journey walks the spec's expected
 * path end to end. (The spec's runbook: "before merging, run the complete
 * E2E executive journeys in Section 14.3" — this suite is that gate.)
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AppShell from '../app/AppShell';
import Today from '../pages/Today';
import Staff from '../pages/Staff';
import Approvals from '../pages/Approvals';
import Schedule from '../pages/Schedule';
import Knowledge from '../pages/Knowledge';
import Assistant from '../pages/Assistant';
import Settings from '../pages/Settings';
import { startRuntime, refreshAll } from '../state/runtime';
import { hermes } from '../adapters';
import { SCENARIOS } from '../mocks/scenarios';
import * as fx from '../mocks/fixtures';
import type { Agent, Approval, Artifact, CronJob, ActivityEvent, WorkItem } from '../domain/types';

const mock = hermes as unknown as {
  __loadFixture(patch: { agents?: Agent[]; work?: WorkItem[]; approvals?: Approval[]; cron?: CronJob[]; activity?: ActivityEvent[]; artifacts?: Artifact[] }): void;
};

beforeAll(() => {
  startRuntime();
});

function Shell() {
  return (
    <Routes>
      <Route path="/" element={<AppShell />}>
        <Route path="today" element={<Today />} />
        <Route path="staff" element={<Staff />} />
        <Route path="approvals" element={<Approvals />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}

describe('Journey 1 — Morning review', () => {
  it('Today → delegate one item → open oldest approval → approve → rail reflects', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/today']}><Shell /></MemoryRouter>);
    // scan priorities
    expect(await screen.findByText('Operating queue')).toBeInTheDocument();
    // delegate one recommendation
    await user.click((await screen.findAllByRole('button', { name: 'Delegate' }))[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm delegation' }));
    // open oldest approval via the rail
    expect((await screen.findAllByText('Awaiting Approval')).length).toBeGreaterThan(0);
    await user.click(await screen.findByRole('link', { name: /Approvals/ }));
    const inspect = (await screen.findAllByRole('button', { name: 'Inspect' }))[0]; // oldest first
    await user.click(inspect);
    const inspector = await screen.findByRole('dialog');
    await user.click(within(inspector).getByRole('button', { name: 'Approve' }));
    // rail reflects: pending count in the nav badge drops 3 → 2
    const navLink = await screen.findByRole('link', { name: /Approvals/ });
    await within(navLink).findByText('2', undefined, { timeout: 4000 });
  }, 15000);
});

describe('Journey 2 — Investigate lag', () => {
  it('S4 lag → Staff → locate active agent → inspect last activity', async () => {
    mock.__loadFixture(SCENARIOS.S4);
    await refreshAll();
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/staff']}><Shell /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Scout, working' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Scout — properties')).toBeInTheDocument();
    // last event/activity visible — 8 minutes stale, shown honestly
    expect(within(dialog).getByText(/Last activity/)).toBeInTheDocument();
    expect(within(dialog).getByText('8m ago')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    mock.__loadFixture({ agents: fx.agents, work: fx.workItems });
    await refreshAll();
  });
});

describe('Journey 3 — Schedule automation', () => {
  it('Schedule → create recurring task → verify it lands in the overlay', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/schedule']}><Shell /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'New scheduled task' }));
    await user.type(screen.getByLabelText('Name'), 'Weekly competitor scan');
    await user.type(screen.getByLabelText('What should Ally do?'), 'Scan competitor blogs and draft a digest.');
    await user.click(screen.getByRole('button', { name: 'Create job' }));
    // appears in the calendar overlay (and the live-jobs badge ticks up)
    expect(await screen.findAllByText('Weekly competitor scan', undefined, { timeout: 4000 })).not.toHaveLength(0);
  }, 15000);
});

describe('Journey 4 — Ground a request', () => {
  it('add knowledge source → ready → ask Ally → open citation', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/knowledge']}><Shell /></MemoryRouter>);
    // add a URL source
    await user.click(await screen.findByRole('button', { name: 'Add source' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: 'Add URL' }));
    await user.type(within(dialog).getByLabelText('URL'), 'https://allygnment.com/board-notes');
    await user.click(within(dialog).getByRole('button', { name: 'Add & index' }));
    // mock indexes to ready
    expect(await screen.findByText('https://allygnment.com/board-notes', undefined, { timeout: 4000 })).toBeInTheDocument();
    // ask Ally; the mock reply cites eaios://chunk/k-01-0
    await user.click(screen.getByRole('link', { name: /My Assistant/ }));
    await user.type(await screen.findByLabelText('Message Ally'), 'what does the board deck say about margins?');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const chips = await screen.findAllByRole('button', { name: /⧉ source 1/ }, { timeout: 8000 });
    await user.click(chips[chips.length - 1]);
    const chunkDialog = await screen.findByRole('dialog');
    expect(await within(chunkDialog).findByText('Q3 board deck (working).pptx')).toBeInTheDocument();
    await user.keyboard('{Escape}');
  }, 20000);
});

describe('Journey 5 — Admin change', () => {
  it('Settings → edit allowlisted env file → save → audit event', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/settings']}><Shell /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'ALLY.md' }));
    const editor = await screen.findByLabelText('Editing ALLY.md');
    await user.type(editor, '\n4. Prefer concise briefings.');
    await user.click(screen.getByRole('button', { name: 'Save (version-checked)' }));
    // audited save toast + editor closes
    expect(await screen.findByText(/saved\. Audit/, undefined, { timeout: 4000 })).toBeInTheDocument();
  }, 15000);
});
