/**
 * H3 — Required mock scenarios S1–S10 (spec §13, verbatim).
 * S2/S6/S7/S8 ride the default fixtures (built to those scenarios);
 * S9/S10 are behavioral (optimistic-concurrency conflict / stream loss).
 */
import { describe, expect, it, beforeAll, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Today from '../pages/Today';
import Staff from '../pages/Staff';
import Approvals from '../pages/Approvals';
import Connections from '../pages/Connections';
import Knowledge from '../pages/Knowledge';
import AppShell from '../app/AppShell';
import { startRuntime, refreshAll } from '../state/runtime';
import { hermes } from '../adapters';
import * as fx from '../mocks/fixtures';
import { SCENARIOS } from '../mocks/scenarios';
import type { Agent, Approval, Artifact, CronJob, ActivityEvent, RuntimeEvent, WorkItem } from '../domain/types';

const mock = hermes as unknown as {
  __loadFixture(patch: { agents?: Agent[]; work?: WorkItem[]; approvals?: Approval[]; cron?: CronJob[]; activity?: ActivityEvent[]; artifacts?: Artifact[] }): void;
  __emit(type: RuntimeEvent['type'], agentId: string | undefined, action: string, workItemId?: string): void;
};

beforeAll(() => {
  startRuntime();
});

afterEach(async () => {
  mock.__loadFixture({ agents: fx.agents, work: fx.workItems, approvals: fx.approvals, cron: fx.cronJobs, activity: fx.activity, artifacts: fx.artifacts });
  await refreshAll();
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

describe('S1 Quiet Morning — empty/positive states', () => {
  it('2 priorities, 0 approvals, all idle — no fabricated activity', async () => {
    mock.__loadFixture(SCENARIOS.S1);
    await refreshAll();
    renderAt('/today', <Today />, 'today');
    expect(await screen.findByText('Read the board pre-read')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // priorities KPI
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(); // nobody working
  });
});

describe('S2 Busy Day — the default fixture IS the busy day', () => {
  it('KPIs reflect the full operating picture', async () => {
    renderAt('/today', <Today />, 'today');
    expect(await screen.findByText('Operating queue')).toBeInTheDocument();
    // KPI cards, scoped by label (bare numbers match times elsewhere)
    expect(screen.getByText('Your priorities').parentElement).toHaveTextContent('8'); // 8 executive-owned open items
    expect(screen.getByText('Delegatable').parentElement).toHaveTextContent('4');
    expect(screen.getByText('Approvals waiting').parentElement).toHaveTextContent('3');
  });
});

describe('S3 Agent in Motion — live status, indeterminate by design', () => {
  it('working agent shows its work with an indeterminate bar', async () => {
    mock.__loadFixture(SCENARIOS.S3);
    await refreshAll();
    renderAt('/staff', <Staff />, 'staff');
    const org = await screen.findByRole('group', { name: 'Org chart' });
    expect(within(org).getByRole('button', { name: 'Scout, working' })).toBeInTheDocument();
    // List view carries the live-work detail + indeterminate bar
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'List' }));
    expect(await screen.findByText('Market scan: AI ops tooling')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Working' })).toBeInTheDocument();
  });
});

describe('S4 Agent Lag — lag diagnostics surface honestly', () => {
  it('working agent with stale last-activity shows the staleness', async () => {
    mock.__loadFixture(SCENARIOS.S4);
    await refreshAll();
    renderAt('/staff', <Staff />, 'staff');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'List' }));
    const card = (await screen.findByText('Deep dive: competitor pricing model')).closest('div.rounded-xl') as HTMLElement;
    expect(within(card).getByText('8m ago')).toBeInTheDocument(); // no event for 8 minutes — visible, not hidden
    expect(within(card).getByText('Working')).toBeInTheDocument();
  });
});

describe('S5 Approval Backlog — sorting, filters, inspector', () => {
  it('5 approvals sort oldest-first; risk filter narrows; inspector opens', async () => {
    mock.__loadFixture(SCENARIOS.S5);
    await refreshAll();
    renderAt('/approvals', <Approvals />, 'approvals');
    const rows = await screen.findAllByRole('button', { name: 'Inspect' });
    expect(rows.length).toBe(5);
    // oldest first (26h-old X thread leads)
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('Market scan teaser thread');
    // risk filter: critical only → the Gmail investor send
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Filter by risk'), 'critical');
    expect((await screen.findAllByRole('button', { name: 'Inspect' })).length).toBe(1);
    expect(within(table).getByText('Investor update — 14 recipients')).toBeInTheDocument();
    // inspector
    await user.click(screen.getByRole('button', { name: 'Inspect' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('S6 Connector Degraded — reconnect warning', () => {
  it("expired-OAuth connector renders 'incomplete' with Resume connect", async () => {
    renderAt('/connections', <Connections />, 'connections');
    expect(await screen.findByText('incomplete')).toBeInTheDocument(); // wordpress fixture
    expect(screen.getByRole('button', { name: 'Resume connect' })).toBeInTheDocument();
  });
});

describe('S7 Cron Running — event lands in rail + ledger while on Today', () => {
  it('a cron completion event appears in the rail activity ledger', async () => {
    renderAt('/today', <Today />, 'today');
    await screen.findByText('Operating queue');
    mock.__emit('cron.completed', 'ally', 'Cron fired: Weekly metrics digest');
    expect(await screen.findByText('Cron fired: Weekly metrics digest', undefined, { timeout: 4000 })).toBeInTheDocument();
  });
});

describe('S8 Knowledge Index Failure — error kept, retry offered', () => {
  it('failed source shows its error and a Reindex action', async () => {
    renderAt('/knowledge', <Knowledge />, 'knowledge');
    expect(await screen.findByText(/Unsupported archive format/)).toBeInTheDocument();
    const row = screen.getByText('Vendor contracts 2026.zip').closest('tr') as HTMLElement;
    expect(within(row).getByText('failed')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Reindex' })).toBeInTheDocument();
  });
});

describe('S9 Environment Conflict — optimistic concurrency', () => {
  it('stale expectedVersion is rejected, never an overwrite', async () => {
    const res = await hermes.writeEnvironmentFile('env-01', 'stale-version-xyz', 'overwrite attempt');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('version_conflict');
  });
});

describe('S10 Event Stream Lost — covered at the socket layer', () => {
  it('live-reconnect suite owns the disconnect/recovery path (see live-reconnect.test.ts)', () => {
    // The socket-level paused/recovery behavior is tested in
    // live-reconnect.test.ts (gateway drop → reconnect → refresh).
    // This scenario is asserted there; recorded here for §13 completeness.
    expect(true).toBe(true);
  });
});
