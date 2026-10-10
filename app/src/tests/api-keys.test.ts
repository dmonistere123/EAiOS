// @vitest-environment node
import { expect, it, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { createServer } from 'node:http';
import { keySettings, saveKey, keyContext, appKey } from '../../server/apiKeys.ts';
import { conciergeConfig } from '../../server/concierge.ts';
import { handleApiRequest } from '../../server/httpApi.ts';
import { duffelTestMode, duffel } from '../../server/duffel.ts';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eaios-keys-')); roots.push(root);
  const home = join(root, 'home'), data = join(root, 'data'), code = join(root, 'release');
  for (const dir of [home, join(data, 'app'), join(data, 'sidecar'), join(code, 'app')]) mkdirSync(dir, { recursive: true });
  return { hermesHome: home, eaiosRoot: code, dataRoot: data };
}
it('writes only the requested key atomically with private permissions and rejects stale edits', () => {
  const ctx = fixture(), path = join(ctx.dataRoot, 'app/.env.local');
  const initial = '# operator settings\nCOMPOSIO_API_KEY="old-secret"\nUNKNOWN=untouched\nMULTILINE="first\nsecond"\nDUFFEL_API_KEY=duffel_test_old\n';
  writeFileSync(path, initial);
  writeFileSync(join(ctx.hermesHome, '.env'), 'TAVILY_API_KEY=private-hermes\n');
  const status = keySettings(ctx, 'app');
  expect(JSON.stringify(status)).not.toContain('old-secret');
  expect(status.keys.find(k => k.key === 'DUFFEL_API_KEY')?.mode).toBe('test');
  saveKey(ctx, { scope: 'app', key: 'DUFFEL_API_KEY', value: 'duffel_live_new', version: status.version });
  const result = readFileSync(path, 'utf8');
  expect(result).toContain('# operator settings');
  expect(parseEnv(result)).toEqual({ ...parseEnv(initial), DUFFEL_API_KEY: 'duffel_live_new' });
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(ctx.hermesHome, '.env'), 'utf8')).toBe('TAVILY_API_KEY=private-hermes\n');
  expect(() => saveKey(ctx, { scope: 'app', key: 'COMPOSIO_API_KEY', value: 'new', version: status.version })).toThrow('Configuration changed');
  expect(appKey('DUFFEL_API_KEY', ctx, 'duffel_test_stale_process')).toBe('duffel_live_new');
});
it('rejects shell injection, unknown settings, multiline edits, symlinks and concurrent writers', () => {
  const ctx = fixture(), path = join(ctx.dataRoot, 'app/.env.local');
  const save = (key: string, value: string, version = 'absent') => saveKey(ctx, { scope: 'app', key, value, version });
  for (const value of ['abc\nEVIL=1', '$(touch nope)', 'a`id`', 'a;id', '', 'x'.repeat(4097)]) expect(() => save('DUFFEL_API_KEY', value)).toThrow();
  expect(() => save('EAIOS_DUFFEL_LIVE_BOOKING', '1')).toThrow('Unknown');
  writeFileSync(path, 'DUFFEL_API_KEY="line1\nline2"\nOTHER=keep\n');
  expect(() => save('DUFFEL_API_KEY', 'new', keySettings(ctx, 'app').version)).toThrow('complex');
  rmSync(path); const outside = join(ctx.eaiosRoot, 'secret'); writeFileSync(outside, 'untouched'); symlinkSync(outside, path);
  expect(() => keySettings(ctx, 'app')).toThrow(); expect(() => save('DUFFEL_API_KEY', 'new')).toThrow();
  expect(readFileSync(outside, 'utf8')).toBe('untouched'); rmSync(path);
  writeFileSync(path + '.eaios-lock', ''); expect(() => save('DUFFEL_API_KEY', 'new')).toThrow('in progress');
});
it('handles duplicate keys, different request roots, and podcast inheritance honestly', async () => {
  const ctx = fixture(), other = fixture();
  writeFileSync(join(ctx.dataRoot, 'app/.env.local'), 'DUFFEL_API_KEY=one\nexport DUFFEL_API_KEY=two\n');
  saveKey(ctx, { scope: 'app', key: 'DUFFEL_API_KEY', value: 'duffel_live_new', version: keySettings(ctx, 'app').version });
  saveKey(other, { scope: 'app', key: 'DUFFEL_API_KEY', value: 'duffel_test_other', version: 'absent' });
  expect(await keyContext.run(ctx, async () => { await Promise.resolve(); return duffelTestMode(); })).toBe(false);
  expect(keyContext.run(other, () => duffelTestMode())).toBe(true);
  writeFileSync(join(ctx.hermesHome, '.env'), 'OPENAI_API_KEY=inherited\n');
  expect(keySettings(ctx, 'podcasts').keys.find(k => k.key === 'OPENAI_API_KEY')?.source).toBe('inherited');
  writeFileSync(join(ctx.dataRoot, 'sidecar/.env'), 'OPENAI_API_KEY=\n');
  expect(keySettings(ctx, 'podcasts').keys.find(k => k.key === 'OPENAI_API_KEY')?.configured).toBe(false);
});
it('uses the saved Duffel key for the next provider request (stubbed network, no purchase)', async () => {
  const ctx = fixture();
  saveKey(ctx, { scope: 'app', key: 'DUFFEL_API_KEY', value: 'duffel_live_fixture', version: 'absent' });
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] })));
  vi.stubGlobal('fetch', request);
  await keyContext.run(ctx, () => duffel('/places/suggestions?query=Boston'));
  expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer duffel_live_fixture');
  expect(request.mock.calls[0][1].method).toBe('GET');
});
it('HTTP never returns secrets, rejects cross-origin/oversize requests and fails closed', async () => {
  const ctx = fixture(); const server = createServer((req, res) => { void handleApiRequest(req, res, ctx); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`, url = base + '/api/settings/api-keys';
    const response = await fetch(url); expect(response.headers.get('cache-control')).toBe('no-store');
    const status = await response.json();
    const body = { scope: 'app', key: 'DUFFEL_API_KEY', value: 'duffel_live_privatefixture', version: status.version };
    const save = (origin: string, data = body) => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(data) });
    expect((await save('https://attacker.invalid')).status).toBe(403);
    const saved = await save(base); expect(saved.status).toBe(200); expect(await saved.text()).not.toContain(body.value);
    expect(await (await fetch(url)).text()).not.toContain(body.value);
    expect((await save(base, { ...body, value: 'a'.repeat(10000) })).status).toBe(400);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
    expect((await fetch(url + '?scope=../../etc')).status).toBe(400);
    expect((await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: 'null' })).status).toBe(400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('saved model keys reach Concierge and survive changing the code release without changing profiles', () => {
  const ctx = fixture();
  mkdirSync(join(ctx.eaiosRoot, 'concierge')); writeFileSync(join(ctx.eaiosRoot, 'concierge/SOUL.md'), 'Help users navigate EAiOS.');
  mkdirSync(join(ctx.hermesHome, 'profiles/scout'), { recursive: true });
  const profile = join(ctx.hermesHome, 'profiles/scout/.env'); writeFileSync(profile, 'OPENROUTER_API_KEY=profile-specific\n');
  saveKey(ctx, { scope: 'hermes', key: 'OPENROUTER_API_KEY', value: 'replacement', version: 'absent' });
  expect(conciergeConfig(ctx.eaiosRoot, ctx.hermesHome, { OPENROUTER_API_KEY: 'stale-process' }).key).toBe('replacement');
  expect(readFileSync(profile, 'utf8')).toBe('OPENROUTER_API_KEY=profile-specific\n');
  saveKey(ctx, { scope: 'app', key: 'DUFFEL_API_KEY', value: 'duffel_test_first', version: 'absent' });
  keyContext.run({ ...ctx, requestKeys: new Map() }, () => {
    expect(duffelTestMode()).toBe(true);
    saveKey(ctx, { scope: 'app', key: 'DUFFEL_API_KEY', value: 'duffel_live_second', version: keySettings(ctx, 'app').version });
    expect(duffelTestMode()).toBe(true); // rotation cannot change credentials midway through this request
  });
  expect(keyContext.run({ ...ctx, requestKeys: new Map() }, () => duffelTestMode())).toBe(false);
  expect(appKey('DUFFEL_API_KEY', { ...ctx, eaiosRoot: join(ctx.eaiosRoot, 'next-release') })).toBe('duffel_live_second');
  writeFileSync(join(ctx.hermesHome, '.env'), '');
  expect(conciergeConfig(ctx.eaiosRoot, ctx.hermesHome, { OPENROUTER_API_KEY: 'fallback' }).key).toBe('fallback');
});
