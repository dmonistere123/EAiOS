/**
 * Reconnect regression tests — covers the live UI failure:
 * `gateway not connected (readyState=3)` when an action is attempted while
 * the gateway socket is closed/reconnecting, and the stale "Reconnecting"
 * pill when a listener is attached after the socket is already open.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const loadLive = async () => (await import('../adapters/live/LiveHermesAdapter')).live;

describe('live gateway reconnect', () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('queues an RPC attempted while the socket is closed and sends it after reconnect', async () => {
    const live = await loadLive();
    live.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0];

    const pending = live.createCronJob({ name: 'Reconnect probe', scheduleExpression: '0 9 * * *', approvalPolicy: 'pre_approved' });
    socket.open();

    const first = await Promise.race([pending, delay(250).then(() => 'pending' as const)]);
    if (first !== 'pending') {
      // Broken behavior: rejects immediately with readyState=3.
      expect(first.ok).toBe(true);
      return;
    }

    await vi.waitFor(() => expect(socket.sent).toHaveLength(1), { timeout: 1000 });
    const req = JSON.parse(socket.sent[0]) as { id: number; method: string };
    expect(req.method).toBe('cron.manage');
    socket.message({ jsonrpc: '2.0', id: req.id, result: {} });

    const res = await pending;
    expect(res.ok).toBe(true);
  });

  it('notifies a listener attached after the socket is already open', async () => {
    const live = await loadLive();
    live.connect();
    const socket = FakeWebSocket.instances[0];
    socket.open();

    const seen: boolean[] = [];
    live.onConnectionChange((connected) => seen.push(connected));
    expect(seen).toEqual([true]);
  });
});
