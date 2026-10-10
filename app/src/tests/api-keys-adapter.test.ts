import { afterEach, expect, it, vi } from 'vitest';
import { apiKeys } from '../adapters/apiKeys';
import { liveComposio } from '../adapters/live/LiveComposioAdapter';
afterEach(() => { vi.unstubAllGlobals(); liveComposio.resetCredentials(); });
it('a saved Composio key clears a previously failed connection check without a page restart', async () => {
  liveComposio.resetCredentials();
  const request = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
  vi.stubGlobal('fetch', request);
  await liveComposio.listConnections();
  expect(request).toHaveBeenCalledTimes(1);
  request.mockReset().mockImplementation(async (url: string) => new Response(JSON.stringify(url.startsWith('/api/settings/') ? { ok: true } : { items: [{ id: 'real-fixture-account', toolkit: { slug: 'gmail', name: 'Gmail' }, status: 'ACTIVE' }] })));
  await apiKeys.save('app', 'COMPOSIO_API_KEY', 'fixture', 'before');
  const connections = await liveComposio.listConnections();
  expect(connections.map(row => row.id)).toEqual(['real-fixture-account']);
  expect(request).toHaveBeenCalledTimes(3); // save, fresh access check, account list
});
