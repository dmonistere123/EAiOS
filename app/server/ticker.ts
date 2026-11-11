import type { IncomingMessage, ServerResponse } from 'node:http';

// Public, cached data only. No incoming URL, headers, credentials or query is forwarded.
const SOURCE = 'https://allygnment.com/ticker/api/sports.php';
const LIMIT = 256 * 1024;
export function createTickerHandler(fetcher: typeof fetch = fetch) {
  let cached = '';
  let expires = 0;
  let pending: Promise<string> | undefined;
  async function read(): Promise<string> {
    const response = await fetcher(SOURCE, {
      headers: { Accept: 'application/json' }, redirect: 'error',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok || !response.body) throw new Error('unavailable');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > LIMIT) throw new Error('oversized');
        chunks.push(value);
      }
      const body = Buffer.concat(chunks).toString('utf8');
      const data = JSON.parse(body);
      if (data?.version !== 1 || !data.sports || typeof data.state !== 'string') throw new Error('invalid');
      if (data.state === 'unavailable') throw new Error('unavailable');
      return body;
    } finally { await reader.cancel().catch(() => {}); }
  }
  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    if (!(req.url ?? '').startsWith('/ticker-api/')) return false;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.url !== '/ticker-api/sports' || req.method !== 'GET') {
      res.statusCode = req.method !== 'GET' ? 405 : 400;
      res.end(JSON.stringify({ error: 'Only GET /ticker-api/sports is supported.' }));
      return true;
    }
    if (Date.now() >= expires) {
      pending ??= read().then(body => { cached = body; }).catch(() => {
        cached = JSON.stringify(cached ? { ...JSON.parse(cached), state: 'stale', stale: true, message: 'Refresh failed; showing last received scores.' } : { version: 1, state: 'unavailable', stale: true, sports: {}, message: 'Sports temporarily unavailable.' });
      }).then(() => { expires = Date.now() + 60_000; pending = undefined; return cached; });
      await pending;
    }
    res.end(cached);
    return true;
  };
}
export const handleTickerRequest = createTickerHandler();
export function tickerPlugin() {
  return { name: 'public-ticker', configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
    server.middlewares.use((req, res, next) => { void handleTickerRequest(req, res).then(handled => { if (!handled) next(); }); });
  } };
}
