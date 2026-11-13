// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { boxIdentity, assistantName } from '../../server/identity';
import { keyContext } from '../../server/apiKeys';
import { handleApiRequest } from '../../server/httpApi';
import { itineraryText } from '../../server/travelHandoff';
import type { TravelTrip } from '../domain/types';
const roots: string[] = [];
function box(name: string) {
  const root = mkdtempSync(join(tmpdir(), '2ep-identity-')); roots.push(root);
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app/.env.local'), `VITE_AGENT_NAME="${name}"\nVITE_EXECUTIVE_NAME="Test Executive"\nOPENROUTER_API_KEY=secret-fixture\n`);
  return { eaiosRoot: root, hermesHome: root };
}
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
it('resolves each originating box independently, even with an inherited Ally environment', async () => {
  vi.stubEnv('VITE_AGENT_NAME', 'Ally');
  const pepper = box('Pepper'), ally = box('Ally');
  const names = await Promise.all([pepper, ally].map(ctx => keyContext.run(ctx, async () => { await Promise.resolve(); return assistantName(); })));
  expect(names).toEqual(['Pepper', 'Ally']);
  writeFileSync(join(pepper.eaiosRoot, 'app/.env.local'), 'VITE_AGENT_NAME="Juniper"');
  expect(boxIdentity(pepper).assistantName).toBe('Juniper');
});
it('follows preserved installer identity symlinks and prefers the active release over old data', () => {
  const release = box('unused'), data = box('Old Name'), privateBox = box('Pepper');
  rmSync(join(release.eaiosRoot, 'app/.env.local'));
  symlinkSync(join(privateBox.eaiosRoot, 'app/.env.local'), join(release.eaiosRoot, 'app/.env.local'));
  expect(boxIdentity({ ...release, dataRoot: data.eaiosRoot }).assistantName).toBe('Pepper');
});
it('serves only public identity fields without caching or accepting writes', async () => {
  const ctx = box('Pepper');
  const server = createServer((req,res) => { void handleApiRequest(req,res,ctx); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/identity`;
    const response = await fetch(url);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ assistantName: 'Pepper', executiveName: 'Test Executive' });
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
it('labels new itinerary conversations with the box name while preserving original message text', () => {
  const ctx = box('Pepper');
  const trip = { name:'Test trip', destination:'Boston', startsAt:'2026-12-01', endsAt:'2026-12-02', bookings:[], conversation:[{role:'assistant',text:'An old note mentions Ally.'}] } as unknown as TravelTrip;
  const text = keyContext.run(ctx, () => itineraryText(trip, ''));
  expect(text).toContain('Pepper: An old note mentions Ally.');
});
