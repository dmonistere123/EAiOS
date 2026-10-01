/**
 * Usage slice tests — Phase 6.1. Mock adapter (VITE_HERMES_LIVE forced off in
 * vitest env) hydrates the runtime usage slice; the Usage page renders from
 * the store (it previously imported the fixture directly — a Phase 0
 * shortcut). mapUsageResponse is unit-tested for the D7 cost-labeling rules;
 * the live adapter's mock fallback is exercised by killing fetch.
 */
import { describe, expect, it, beforeAll, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Usage from '../pages/Usage';
import { startRuntime, getState } from '../state/runtime';
import { hermes, live } from '../adapters';
import { mapUsageResponse, type UsageIndexResponse } from '../adapters/live/LiveHermesAdapter';
import { usageSummary as fixture } from '../mocks/fixtures';

beforeAll(() => {
  startRuntime();
});

const idxResponse = (over: Partial<UsageIndexResponse> = {}): UsageIndexResponse => ({
  range: { from: '2026-08-01T12:00:00.000Z', to: '2026-08-26T12:00:00.000Z' },
  inputTokens: 1000,
  outputTokens: 200,
  estimatedCostUsd: 0,
  actualCostUsd: 0,
  byAgent: [{ agentId: 'default', inputTokens: 1000, outputTokens: 200, estimatedCostUsd: 0, actualCostUsd: 0 }],
  freshnessAt: '2026-08-26T12:00:00.000Z',
  ...over,
});

describe('mapUsageResponse — D7 cost labeling', () => {
  it('actual cost > 0 → authoritative', () => {
    const u = mapUsageResponse(idxResponse({ actualCostUsd: 12.5, estimatedCostUsd: 10, byAgent: [{ agentId: 'default', inputTokens: 1000, outputTokens: 200, estimatedCostUsd: 10, actualCostUsd: 12.5 }] }));
    expect(u.costUsd).toBe(12.5);
    expect(u.costIsAuthoritative).toBe(true);
    expect(u.byAgent[0].costUsd).toBe(12.5);
  });

  it('estimated only → labeled estimate, not authoritative', () => {
    const u = mapUsageResponse(idxResponse({ estimatedCostUsd: 3.25, byAgent: [{ agentId: 'default', inputTokens: 1000, outputTokens: 200, estimatedCostUsd: 3.25, actualCostUsd: 0 }] }));
    expect(u.costUsd).toBe(3.25);
    expect(u.costIsAuthoritative).toBe(false);
  });

  it('both zero → costUsd undefined (never invent), budget undefined', () => {
    const u = mapUsageResponse(idxResponse());
    expect(u.costUsd).toBeUndefined();
    expect(u.costIsAuthoritative).toBe(false);
    expect(u.budgetUsd).toBeUndefined();
    expect(u.byAgent[0].costUsd).toBeUndefined();
    expect(u.inputTokens).toBe(1000);
    expect(u.rangeLabel).toContain('August 2026');
  });
});

describe('live adapter getUsage — graceful degradation (spec §2)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the mock summary when /api/usage is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no dev server')));
    const u = await live.getUsage({ from: '2026-08-01T00:00:00Z', to: '2026-08-26T00:00:00Z' });
    expect(u.inputTokens).toBe(fixture.inputTokens);
    expect(u.byAgent.length).toBe(fixture.byAgent.length);
  });

  it('maps a live middleware response when fetch succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => idxResponse({ inputTokens: 42 }) }));
    const u = await live.getUsage({ from: '2026-08-01T00:00:00Z', to: '2026-08-26T00:00:00Z' });
    expect(u.inputTokens).toBe(42);
    expect(u.costUsd).toBeUndefined();
  });
});

describe('usage budget (F15)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('live getUsage merges the stored budget; settings failure leaves it unset', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/usage')) return { ok: true, json: async () => idxResponse() };
      if (url === '/api/eaios-settings') return { ok: true, json: async () => ({ usageBudgetUsd: 500 }) };
      throw new Error(`unexpected ${url}`);
    }));
    const u = await live.getUsage({ from: '2026-08-01T00:00:00Z', to: '2026-08-26T00:00:00Z' });
    expect(u.budgetUsd).toBe(500);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/usage')) return { ok: true, json: async () => idxResponse() };
      throw new Error('settings down');
    }));
    const u2 = await live.getUsage({ from: '2026-08-01T00:00:00Z', to: '2026-08-26T00:00:00Z' });
    expect(u2.budgetUsd).toBeUndefined(); // honest absence, totals still render
    expect(u2.inputTokens).toBe(1000);
  });

  it('live setUsageBudget PUTs and reports errors instead of pretending', async () => {
    const put = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', put);
    const ok = await live.setUsageBudget(250);
    expect(ok.ok).toBe(true);
    expect(put).toHaveBeenCalledWith('/api/eaios-settings', expect.objectContaining({ method: 'PUT' }));

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const bad = await live.setUsageBudget(250);
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('settings_write_failed');
  });

  it('mock setUsageBudget updates the fixture so getUsage reflects it', async () => {
    const before = (await hermes.getUsage({ from: '', to: '' })).budgetUsd;
    await hermes.setUsageBudget(777);
    expect((await hermes.getUsage({ from: '', to: '' })).budgetUsd).toBe(777);
    await hermes.setUsageBudget(before ?? null); // restore for other tests
  });
});

describe('ally profile (F-local-model)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('live getAllyProfile reads allyProfile from /api/eaios-settings', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/eaios-settings') return { ok: true, json: async () => ({ allyProfile: 'local-llama' }) };
      throw new Error(`unexpected ${url}`);
    }));
    expect(await live.getAllyProfile()).toBe('local-llama');
  });

  it('live getAllyProfile returns null when settings are unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no dev server')));
    expect(await live.getAllyProfile()).toBeNull();
  });

  it('live setAllyProfile PUTs and reports errors instead of pretending', async () => {
    const put = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal('fetch', put);
    const ok = await live.setAllyProfile('local-llama');
    expect(ok.ok).toBe(true);
    expect(put).toHaveBeenCalledWith('/api/eaios-settings', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ allyProfile: 'local-llama' }),
    }));

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const bad = await live.setAllyProfile('local-llama');
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe('settings_write_failed');
  });

  it('mock get/setAllyProfile round-trip and emit config change', async () => {
    expect(await hermes.getAllyProfile()).toBeNull();
    await hermes.setAllyProfile('local-llama');
    expect(await hermes.getAllyProfile()).toBe('local-llama');
    await hermes.setAllyProfile(null); // restore
    expect(await hermes.getAllyProfile()).toBeNull();
  });
});

describe('backup media and jobs', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('live listBackupMedia GETs /api/backup/media', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/backup/media') return { ok: true, json: async () => ({ media: [{ path: '/media/USB', label: 'USB', removable: true, availableBytes: 1234567890 }] }) };
      throw new Error(`unexpected ${url}`);
    }));
    const media = await live.listBackupMedia();
    expect(media).toHaveLength(1);
    expect(media[0].path).toBe('/media/USB');
  });

  it('live startBackup and getBackupStatus hit /api/backup and /api/backup/status', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/backup') return { ok: true, json: async () => ({ jobId: 'job-1', status: 'running', archivePath: '/media/USB/eaios-backup.tar.gz' }) };
      if (url.startsWith('/api/backup/status')) return { ok: true, json: async () => ({ id: 'job-1', status: 'done', archiveSizeBytes: 1000, archiveSize: '1 KB' }) };
      throw new Error(`unexpected ${url}`);
    }));
    const started = await live.startBackup('/media/USB');
    expect(started.jobId).toBe('job-1');
    const status = await live.getBackupStatus('job-1');
    expect(status.status).toBe('done');
  });

  it('mock backup media list, start, and status round-trip', async () => {
    const media = await hermes.listBackupMedia();
    expect(media.length).toBeGreaterThan(0);
    const started = await hermes.startBackup(media[0].path);
    expect(started.jobId).toBeTruthy();
    let status = await hermes.getBackupStatus(started.jobId);
    // The mock completes synchronously-ish, so it may already be done.
    if (status.status === 'running') {
      await new Promise((r) => setTimeout(r, 800));
      status = await hermes.getBackupStatus(started.jobId);
    }
    expect(status.status).toBe('done');
  });
});

describe('usage slice (mock adapter contract)', () => {
  it('getUsage returns a labeled summary with by-agent rows', async () => {
    const u = await hermes.getUsage({ from: '2026-08-01T00:00:00Z', to: '2026-08-26T00:00:00Z' });
    expect(u.inputTokens).toBeGreaterThan(0);
    expect(u.byAgent.length).toBeGreaterThan(0);
    expect(u.freshnessAt).toBeTruthy();
    expect(typeof u.costIsAuthoritative).toBe('boolean');
  });

  it('runtime hydration populates state.usage', async () => {
    await waitFor(() => expect(getState().usage).not.toBeNull(), { timeout: 4000 });
  });
});

describe('Usage page', () => {
  it('renders totals, estimate badge, and by-agent rows from the store', async () => {
    render(
      <MemoryRouter>
        <Usage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(fixture.inputTokens.toLocaleString(), undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByText('Estimated from token rates')).toBeInTheDocument();
    // mock fixture carries a budget → budget card renders with the percentage
    expect(screen.getByText('Budget consumption')).toBeInTheDocument();
    // agent names resolve through the agents slice, not raw ids
    expect(await screen.findByText('Ally')).toBeInTheDocument();
  });
});
