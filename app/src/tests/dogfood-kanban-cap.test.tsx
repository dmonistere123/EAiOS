/**
 * Dogfood 2026-08-29 — the 48K cli.exec cap bug: the kanban board grew past
 * the RPC's 48000-char output cap, JSON.parse died on the truncated payload,
 * and every kanban-backed slice SILENTLY fell back to mock (● LIVE badge
 * showing fixture data; Don's real tasks invisible). Covers:
 *  1. kanbanTasks is HTTP-first (/api/kanban, node:sqlite) — no cli.exec
 *  2. a truncated cli.exec payload → honest mock fallback + VISIBLE
 *     degradation (spec §2) — never silent again
 *  3. healthy cli.exec fallback still works (old servers without /api/kanban)
 *  4. Today: delegated work completed in the last 24h shows with its result
 *     (the "it only responded on Telegram" gap)
 *  5. AppShell surfaces degraded slices next to the LIVE badge
 */
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Today from '../pages/Today';
import AppShell from '../app/AppShell';
import { startRuntime, refreshWork } from '../state/runtime';
import { hermes } from '../adapters';

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = FakeWebSocket.CLOSED;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

const loadLive = async () => (await import('../adapters/live/LiveHermesAdapter')).live;

describe('kanban board read path (48K cap regression)', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the board via /api/kanban (HTTP-first) — cli.exec is never touched', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tasks: [{ id: 't_real1', title: 'Real board task', body: 'do it', assignee: null, status: 'ready', priority: 2, created_at: 1788000000 }] }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const live = await loadLive();
    live.connect();
    FakeWebSocket.instances[0].open();

    const items = await live.listWorkItems();
    expect(items.map((w: { id: string }) => w.id)).toEqual(['t_real1']);
    expect(fetchMock).toHaveBeenCalledWith('/api/kanban');
    // no cli.exec kanban list over the socket
    const cliCalls = FakeWebSocket.instances[0].sent.filter((s) => s.includes('cli.exec'));
    expect(cliCalls).toHaveLength(0);
  });

  it('truncated cli.exec payload → mock fallback + VISIBLE degradation (never silent)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const live = await loadLive();
    live.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    const pending = live.listWorkItems();
    await vi.waitFor(() => expect(socket.sent.some((s) => s.includes('cli.exec'))).toBe(true), { timeout: 1000 });
    const req = JSON.parse(socket.sent.find((s) => s.includes('cli.exec'))!) as { id: number };
    // Exactly what the gateway does past 48000 chars: cut mid-JSON.
    socket.message({ jsonrpc: '2.0', id: req.id, result: { code: 0, output: '[{"id":"t_x","title":"cut off halfw' } });

    const items = await pending;
    // honest fallback: mock fixture items, NOT an empty or half-parsed board
    expect(items.some((w: { id: string }) => w.id === 'w-01')).toBe(true);
    // …and the degradation is VISIBLE
    expect(live.getDegradedSlices()).toContain('work');
  });

  it('healthy cli.exec fallback still serves the board when /api/kanban is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const live = await loadLive();
    live.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    const pending = live.listWorkItems();
    await vi.waitFor(() => expect(socket.sent.some((s) => s.includes('cli.exec'))).toBe(true), { timeout: 1000 });
    const req = JSON.parse(socket.sent.find((s) => s.includes('cli.exec'))!) as { id: number };
    socket.message({
      jsonrpc: '2.0',
      id: req.id,
      result: { code: 0, output: JSON.stringify([{ id: 't_legacy', title: 'Legacy path task', body: '', assignee: null, status: 'ready', priority: 2, created_at: 1788000000 }]) },
    });

    const items = await pending;
    expect(items.map((w: { id: string }) => w.id)).toEqual(['t_legacy']);
    expect(live.getDegradedSlices()).not.toContain('work');
  });
});

describe('front-screen visibility of delegated results', () => {
  beforeAll(() => {
    startRuntime();
  });

  it('Today shows work delivered in the last 24h (mock parity: Expense anomaly digest)', async () => {
    render(
      <MemoryRouter>
        <Today />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Delivered in the last 24h')).toBeInTheDocument();
    expect(screen.getByText('Expense anomaly digest')).toBeInTheDocument();
  });

  it('AppShell flags degraded slices next to the LIVE badge', async () => {
    // Simulate the live adapter reporting a fallen-back slice.
    (hermes as { getDegradedSlices?: () => string[] }).getDegradedSlices = () => ['work'];
    await refreshWork(); // guarded() pulls the degradation list into runtime state
    render(
      <MemoryRouter>
        <AppShell />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/degraded: work/)).toBeInTheDocument();
    delete (hermes as { getDegradedSlices?: () => string[] }).getDegradedSlices;
  });
});
