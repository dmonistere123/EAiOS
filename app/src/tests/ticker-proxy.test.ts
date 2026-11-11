// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { createTickerHandler } from '../../server/ticker';
import type { IncomingMessage, ServerResponse } from 'node:http';
async function call(handler: ReturnType<typeof createTickerHandler>, url = '/ticker-api/sports', method = 'GET') {
  let body = ''; const res = { statusCode: 200, setHeader() {}, end(value: string) { body = value; } };
  const handled = await handler({ url, method } as IncomingMessage, res as unknown as ServerResponse);
  return { handled, status: res.statusCode, body };
}
describe('bounded ticker proxy', () => {
  it('rejects queries and writes, passes unrelated routes through', async () => {
    const fetcher = vi.fn(); const handler = createTickerHandler(fetcher);
    expect((await call(handler, '/ticker-api/sports?refresh=1')).status).toBe(400);
    expect((await call(handler, '/ticker-api/sports', 'POST')).status).toBe(405);
    expect((await call(handler, '/api/kanban')).handled).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('coalesces requests and caches, forwarding only the fixed source', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 1, state: 'live', sports: {} })));
    const handler = createTickerHandler(fetcher);
    await Promise.all([call(handler), call(handler)]); await call(handler);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://allygnment.com/ticker/api/sports.php');
    expect(fetcher.mock.calls[0][1].redirect).toBe('error');
    expect(fetcher.mock.calls[0][1].headers).toEqual({ Accept: 'application/json' });
  });
  it('contains oversized, invalid and failed upstream responses', async () => {
    for (const response of [new Response('x'.repeat(300_000)), new Response('{}'), new Response('offline', { status: 503 })]) {
      const handler = createTickerHandler(vi.fn().mockResolvedValue(response));
      expect(JSON.parse((await call(handler)).body).state).toBe('unavailable');
    }
    expect(JSON.parse((await call(createTickerHandler(vi.fn().mockRejectedValue(new Error('timeout'))))).body).state).toBe('unavailable');
  });
});
