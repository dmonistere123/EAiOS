/**
 * F29 usage-daily tests — rate-card spend estimation in the Usage page.
 * apiCore queryDailySpend is unit-tested against a hermetic fixture DB
 * (node env); the page card is tested against the mock (bar strip, breach
 * styling, drill-down, threshold edit round-trip); the live adapter's
 * passthrough + graceful degradation use stubbed fetch.
 */
import { describe, expect, it, beforeAll, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Usage from '../pages/Usage';
import { startRuntime } from '../state/runtime';
import { hermes, live } from '../adapters';
import { dailySpendReport as fixture } from '../mocks/fixtures';
import { queryDailySpend, DEFAULT_RATE_CARD } from '../../server/apiCore.ts';

beforeAll(() => {
  startRuntime();
});

/* ------------------------------------------------ apiCore (node) ------- */

/** Build a fixture state.db: two sessions over three days, two models. */
function makeFixtureDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eaios-spend-'));
  const dbPath = join(dir, 'state.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, source TEXT, started_at REAL, profile_name TEXT);
           CREATE TABLE session_model_usage (
             session_id TEXT NOT NULL, model TEXT NOT NULL, billing_provider TEXT NOT NULL DEFAULT '',
             billing_base_url TEXT NOT NULL DEFAULT '', billing_mode TEXT NOT NULL DEFAULT '', task TEXT NOT NULL DEFAULT '',
             api_call_count INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0,
             output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0,
             cache_write_tokens INTEGER NOT NULL DEFAULT 0, reasoning_tokens INTEGER NOT NULL DEFAULT 0,
             estimated_cost_usd REAL NOT NULL DEFAULT 0, actual_cost_usd REAL NOT NULL DEFAULT 0,
             cost_status TEXT, cost_source TEXT, first_seen REAL, last_seen REAL,
             PRIMARY KEY (session_id, model, billing_provider, billing_base_url, billing_mode, task));`);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const at = (daysBack: number, hour: number) => (dayStart.getTime() - daysBack * 86_400_000 + hour * 3_600_000) / 1000;
  const insS = db.prepare('INSERT INTO sessions (id, title, source, started_at) VALUES (?, ?, ?, ?)');
  const insU = db.prepare('INSERT INTO session_model_usage (session_id, model, input_tokens, output_tokens, last_seen) VALUES (?, ?, ?, ?, ?)');
  insS.run('sess-a', 'Big chat', 'desktop', at(1, 9));
  insS.run('sess-b', 'Morning cron', 'cron', at(2, 7));
  // yesterday: 1M in + 100K out on kimi-k3 → 3.00 + 1.40 = $4.40
  insU.run('sess-a', 'kimi-k3', 1_000_000, 100_000, at(1, 12));
  // 2 days ago: 1M in + 100K out on deepseek flash → 0.088 + 0.0176 ≈ $0.11
  insU.run('sess-b', 'deepseek/deepseek-v4-flash', 1_000_000, 100_000, at(2, 8));
  db.close();
  return dbPath;
}

describe('queryDailySpend (apiCore, F29)', () => {
  it('buckets cost per local day at rate-card prices, zero-fills, flags breaches, ranks top sessions', () => {
    const dbPath = makeFixtureDb();
    const report = queryDailySpend([dbPath, '/nonexistent/profile/state.db'], 4, DEFAULT_RATE_CARD.rates, DEFAULT_RATE_CARD.fallback, 5.0);

    expect(report.thresholdUsd).toBe(5.0);
    expect(report.estimatedWith).toBe('eaios-rate-card');
    expect(report.days.length).toBe(4); // zero-filled window

    const today = report.days[3];
    const yesterday = report.days[2];
    const twoBack = report.days[1];
    const threeBack = report.days[0];

    expect(yesterday.costUsd).toBeCloseTo(4.4, 2);
    expect(yesterday.overThreshold).toBe(false);
    expect(yesterday.topSessions[0].title).toBe('Big chat');
    expect(yesterday.topSessions[0].model).toBe('kimi-k3');

    expect(twoBack.costUsd).toBeCloseTo(0.11, 2);
    expect(twoBack.topSessions[0].title).toBe('Morning cron');

    expect(threeBack.costUsd).toBe(0);
    expect(threeBack.topSessions.length).toBe(0);
    expect(today.costUsd).toBe(0);

    // a missing profile DB is skipped honestly — the run did not throw
    // and a low threshold flags the same day
    const flagged = queryDailySpend([dbPath], 4, DEFAULT_RATE_CARD.rates, DEFAULT_RATE_CARD.fallback, 1.0);
    expect(flagged.days[2].overThreshold).toBe(true);
  });

  it('unknown model falls back to the conservative default rate', () => {
    const dbPath = makeFixtureDb();
    const db = new DatabaseSync(dbPath);
    db.prepare('INSERT INTO session_model_usage (session_id, model, input_tokens, output_tokens, last_seen) VALUES (?, ?, ?, ?, ?)').run(
      'sess-a',
      'some-future-model-9000',
      1_000_000,
      0,
      Date.now() / 1000,
    );
    db.close();
    const report = queryDailySpend([dbPath], 1, DEFAULT_RATE_CARD.rates, DEFAULT_RATE_CARD.fallback, 5.0);
    expect(report.days[0].costUsd).toBeCloseTo(3.0, 2); // default 3.00/M input
  });
});

/* ------------------------------------------- live adapter (stubbed) ---- */

describe('live adapter getDailySpend — passthrough + graceful degradation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('passes the middleware response through on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/usage/daily')) return { ok: true, json: async () => ({ thresholdUsd: 5, estimatedWith: 'eaios-rate-card', days: [{ date: '2026-09-04', costUsd: 0.42, inputTokens: 1, outputTokens: 1, overThreshold: false, topSessions: [] }], freshnessAt: '2026-09-04T12:00:00Z' }) };
      throw new Error(`unexpected ${url}`);
    }));
    const r = await live.getDailySpend(14);
    expect(r.days.length).toBe(1);
    expect(r.days[0].costUsd).toBe(0.42);
    expect(live.getDegradedSlices().includes('usage-daily')).toBe(false);
  });

  it('falls back to the mock report + marks degraded when the endpoint is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    const r = await live.getDailySpend(14);
    expect(r.days.length).toBe(fixture.days.length);
    expect(r.estimatedWith).toBe('eaios-rate-card');
    expect(live.getDegradedSlices().includes('usage-daily')).toBe(true);
  });
});

/* ------------------------------------------------- Usage page (mock) --- */

describe('Usage page — Daily estimated spend card (F29)', () => {
  it('renders the 14-day strip, flags the breach day, drills into top sessions', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Usage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Daily estimated spend')).toBeInTheDocument();
    expect(screen.getByText(/Alert above \$5\/day/)).toBeInTheDocument();

    // fixture day -3 is the $11.35 breach — risk styling + flagged label
    const breach = await screen.findByRole('listitem', { name: /over threshold/ });
    expect(breach.className).toContain('bg-risk');

    // drill-down: the guilty sessions surface with their costs
    await user.click(breach);
    expect(await screen.findByText('Casual check-in')).toBeInTheDocument();
    expect(screen.getByText('$5.96')).toBeInTheDocument();
    expect(screen.getByText('$11.35')).toBeInTheDocument();
  });

  it('threshold edit round-trips through the adapter and recomputes breach flags', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Usage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Daily estimated spend')).toBeInTheDocument();

    await user.click(screen.getByText(/Alert above \$5\/day/));
    const input = screen.getByLabelText('Daily spend alert threshold in USD');
    await user.clear(input);
    await user.type(input, '20');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    // mock recomputed: nothing is over $20 anymore
    await waitFor(() => expect(screen.queryByRole('listitem', { name: /over threshold/ })).not.toBeInTheDocument(), { timeout: 6000 });
    expect(screen.getByText(/Alert above \$20\/day/)).toBeInTheDocument();

    // restore the fixture default for any later tests in this file
    await hermes.setDailySpendAlert(5);
  });
});
