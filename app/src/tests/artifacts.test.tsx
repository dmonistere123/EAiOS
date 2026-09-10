/**
 * Artifacts tests — Phase 6.3 (spec §8.9). mapArtifactRow state/preview
 * rules; live listArtifacts/preview with stubbed fetch (+ mock fallback);
 * governed share creating an UNASSIGNED approval task live and a pending
 * approval in mock; page renders from the runtime store with working
 * preview drawer and honest mock-mode download.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Artifacts from '../pages/Artifacts';
import { startRuntime, getState } from '../state/runtime';
import { hermes, live } from '../adapters';
import { mapArtifactRow, type ArtifactIndexRow } from '../adapters/live/LiveHermesAdapter';
import { artifacts as fixture } from '../mocks/fixtures';

beforeAll(() => {
  startRuntime();
});

const row = (over: Partial<ArtifactIndexRow> = {}): ArtifactIndexRow => ({
  id: 'att-1',
  taskId: 't_abc',
  taskTitle: 'Weekly metrics',
  name: 'weekly-metrics.md',
  mimeType: 'text/markdown',
  sizeBytes: 3577,
  uploadedBy: 'kanban_complete',
  agentId: 'default',
  taskStatus: 'done',
  createdAt: '2026-08-25T21:18:07.000Z',
  ...over,
});

describe('mapArtifactRow', () => {
  it('derives state from the parent task status', () => {
    expect(mapArtifactRow(row({ taskStatus: 'done' })).state).toBe('ready');
    expect(mapArtifactRow(row({ taskStatus: 'archived' })).state).toBe('archived');
    expect(mapArtifactRow(row({ taskStatus: 'running' })).state).toBe('draft');
  });

  it('preview only for text-ish types at sane sizes', () => {
    expect(mapArtifactRow(row()).previewAvailable).toBe(true);
    expect(mapArtifactRow(row({ mimeType: 'application/octet-stream' })).previewAvailable).toBe(false);
    expect(mapArtifactRow(row({ sizeBytes: 5_000_000 })).previewAvailable).toBe(false);
  });

  it('carries provenance: agent, work item, never emits approved/shared', () => {
    const a = mapArtifactRow(row({ agentId: 'scout' }));
    expect(a.createdByAgentId).toBe('scout');
    expect(a.workItemId).toBe('t_abc');
    expect(['approved', 'shared']).not.toContain(a.state);
  });
});

describe('live artifacts (stubbed fetch)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listArtifacts maps middleware rows and applies filters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ artifacts: [row(), row({ id: 'att-2', name: 'data.bin', mimeType: 'application/octet-stream', taskStatus: 'running', agentId: 'scout' })] }),
    })));
    const all = await live.listArtifacts();
    expect(all).toHaveLength(2);
    expect(all[0].state).toBe('ready');
    const drafts = await live.listArtifacts({ state: ['draft'] });
    expect(drafts.map((a) => a.id)).toEqual(['att-2']);
    const scout = await live.listArtifacts({ createdByAgentId: 'scout' });
    expect(scout).toHaveLength(1);
  });

  it('middleware down → mock fallback (spec §2)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const rows = await live.listArtifacts();
    expect(rows.map((a) => a.id)).toEqual(fixture.map((a) => a.id));
  });

  it('getArtifactPreview returns text, null on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '# Report\nbody' })));
    expect(await live.getArtifactPreview('att-1')).toBe('# Report\nbody');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await live.getArtifactPreview('att-9')).toBeNull();
  });
});

describe('governed share (§8.9 — approval route, never direct)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('live: creates an UNASSIGNED approval task with artifact evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ artifacts: [row()] }) })));
    const calls: { argv: string[] }[] = [];
    const holder = live as unknown as { rpc: { call: (m: string, p?: Record<string, unknown>) => Promise<unknown> } };
    const real = holder.rpc;
    holder.rpc = {
      call: async (_m: string, p?: Record<string, unknown>) => {
        calls.push(p as { argv: string[] });
        return { code: 0, output: '{"id":"t_share1"}' };
      },
    };
    try {
      const res = await live.shareArtifact('att-1');
      expect(res.ok).toBe(true);
      const argv = calls[0].argv;
      expect(argv[0]).toBe('kanban');
      expect(argv[1]).toBe('create');
      expect(argv).not.toContain('--assignee'); // dispatcher must never execute approvals
      const body = JSON.parse(argv[argv.indexOf('--body') + 1]);
      expect(body.eaios).toBe('approval');
      expect(body.actionType).toBe('send');
      expect(body.targetObject).toBe('weekly-metrics.md');
      expect(body.evidence[0].uri).toBe('eaios://artifact/att-1');
    } finally {
      holder.rpc = real;
    }
  });

  it('live: unknown artifact → not_found, no kanban call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ artifacts: [] }) })));
    const res = await live.shareArtifact('att-nope');
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('not_found');
  });

  it('mock: appends a pending approval linked to the artifact', async () => {
    const res = await hermes.shareArtifact('f-02');
    expect(res.ok).toBe(true);
    const pending = await hermes.listApprovals({ status: ['pending'] });
    const ap = pending.find((a) => a.id === 'a-share-f-02');
    expect(ap).toBeDefined();
    expect(ap!.actionType).toBe('send');
    expect(ap!.targetObject).toBe('AI_Ops_Tooling_Market_Scan.md');
  });
});

describe('Artifacts page (mock mode)', () => {
  it('renders from the store, preview drawer works, download honest in mock', async () => {
    await waitFor(() => expect(getState().artifacts.length).toBeGreaterThan(0), { timeout: 4000 });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Artifacts />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Investor_Update_Sept_Draft.md', undefined, { timeout: 4000 })).toBeInTheDocument();
    // preview drawer with mock content
    const previewButtons = screen.getAllByRole('button', { name: 'Preview' });
    await user.click(previewButtons[0]);
    expect(await screen.findByText(/Mock preview content/)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    // mock mode: downloads are disabled buttons, not fake links
    for (const b of screen.getAllByRole('button', { name: 'Download' })) expect(b).toBeDisabled();
  });

  it('HTML artifacts get an Open control; non-HTML artifacts do not', async () => {
    await waitFor(() => expect(getState().artifacts.length).toBeGreaterThan(0), { timeout: 4000 });
    render(
      <MemoryRouter>
        <Artifacts />
      </MemoryRouter>,
    );
    expect(await screen.findByText('inbox-triage-report.html', undefined, { timeout: 4000 })).toBeInTheDocument();
    // In mock mode Open is an honest disabled button (live artifact store is not present).
    const openButton = screen.getByRole('button', { name: 'Open' });
    expect(openButton).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Open' }).length).toBe(1);
  });

  it('Preview renders HTML artifacts in a sandboxed iframe', async () => {
    await waitFor(() => expect(getState().artifacts.length).toBeGreaterThan(0), { timeout: 4000 });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Artifacts />
      </MemoryRouter>,
    );
    expect(await screen.findByText('inbox-triage-report.html', undefined, { timeout: 4000 })).toBeInTheDocument();
    const htmlRow = screen.getByText('inbox-triage-report.html').closest('div.rounded-xl') as HTMLElement;
    await user.click(within(htmlRow).getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    const iframe = await within(dialog).findByTitle('inbox-triage-report.html', undefined, { timeout: 4000 });
    expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin');
  });

  it('HTML preview drawer is resizable and has a Pop-out control', async () => {
    await waitFor(() => expect(getState().artifacts.length).toBeGreaterThan(0), { timeout: 4000 });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Artifacts />
      </MemoryRouter>,
    );
    expect(await screen.findByText('inbox-triage-report.html', undefined, { timeout: 4000 })).toBeInTheDocument();
    const htmlRow = screen.getByText('inbox-triage-report.html').closest('div.rounded-xl') as HTMLElement;
    await user.click(within(htmlRow).getByRole('button', { name: 'Preview' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Resize drawer')).toBeInTheDocument();
    // In mock mode Pop-out is an honest disabled button.
    const popOut = within(dialog).getByRole('button', { name: 'Pop out' });
    expect(popOut).toBeDisabled();
  });
});
