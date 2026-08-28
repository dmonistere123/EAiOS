/**
 * H2 — Performance (spec §15).
 * - Event-rate: 100 rapid runtime events collapse into ONE debounced refresh
 *   cycle (trailing 800ms) — the gateway can storm; the UI must not.
 * - Large lists: >50-row lists paginate with Show more (Today queue,
 *   Artifacts) — "virtualize or paginate", no new deps.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Today from '../pages/Today';
import Artifacts from '../pages/Artifacts';
import { startRuntime, refreshAll } from '../state/runtime';
import { hermes } from '../adapters';
import * as fx from '../mocks/fixtures';
import type { Agent, Approval, Artifact, CronJob, ActivityEvent, RuntimeEvent, WorkItem } from '../domain/types';

/** Tests run in mock mode — hermes IS the mock adapter instance (fixture API §13). */
const mock = hermes as unknown as {
  __loadFixture(patch: { agents?: Agent[]; work?: WorkItem[]; approvals?: Approval[]; cron?: CronJob[]; activity?: ActivityEvent[]; artifacts?: Artifact[] }): void;
  __emit(type: RuntimeEvent['type'], agentId: string | undefined, action: string, workItemId?: string): void;
};

beforeAll(() => {
  startRuntime();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // restore default fixtures for later suites
  mock.__loadFixture({ agents: fx.agents, work: fx.workItems, approvals: fx.approvals, cron: fx.cronJobs, activity: fx.activity, artifacts: fx.artifacts });
});

describe('§15 event-rate: bursts debounce to one refresh cycle', () => {
  it('100 rapid events → one refresh, not one hundred', async () => {
    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(2000); // let the boot refresh settle
    const listAgents = vi.spyOn(hermes, 'listAgents');
    const listWork = vi.spyOn(hermes, 'listWorkItems');
    listAgents.mockClear();
    listWork.mockClear();

    for (let i = 0; i < 100; i++) mock.__emit('agent.progress', 'ally', `burst event ${i}`);
    await vi.advanceTimersByTimeAsync(1000); // past the 800ms trailing debounce

    expect(listAgents.mock.calls.length).toBe(1);
    expect(listWork.mock.calls.length).toBe(1);
  });
});

describe('§15 large lists paginate', () => {
  it('Today queue caps at 50 with Show more', async () => {
    const sixty: WorkItem[] = Array.from({ length: 60 }, (_, i) => ({
      id: `bulk-${i}`,
      title: `Bulk item ${i + 1}`,
      priority: 'low',
      ownerType: 'executive',
      state: 'ready',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    mock.__loadFixture({ work: sixty });
    await refreshAll();
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Bulk item 50')).toBeInTheDocument();
    expect(screen.queryByText('Bulk item 51')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Show more \(10 remaining\)/ }));
    expect(await screen.findByText('Bulk item 60')).toBeInTheDocument();
  });

  it('Artifacts caps at 50 with Show more', async () => {
    const many: Artifact[] = Array.from({ length: 55 }, (_, i) => ({
      id: `fa-${i}`,
      name: `Bulk_Artifact_${String(i + 1).padStart(2, '0')}.md`,
      mimeType: 'text/markdown',
      createdAt: new Date().toISOString(),
      createdByAgentId: 'ally',
      state: 'draft',
      previewAvailable: false,
    }));
    mock.__loadFixture({ artifacts: many });
    await refreshAll();
    render(
      <MemoryRouter>
        <Artifacts />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Bulk_Artifact_50.md')).toBeInTheDocument();
    expect(screen.queryByText('Bulk_Artifact_51.md')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Show more \(5 remaining\)/ }));
    expect(await screen.findByText('Bulk_Artifact_55.md')).toBeInTheDocument();
  });
});
