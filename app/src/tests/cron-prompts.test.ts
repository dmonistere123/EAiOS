// @vitest-environment node
import { expect, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { readCronPrompts } from '../../server/cronPrompts.ts';
import { handleApiRequest } from '../../server/httpApi.ts';
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
it('loads full prompts in both store formats, scopes profiles and does not rewrite scheduler data', () => {
  const home = mkdtempSync(join(tmpdir(), 'cron-prompts-')); roots.push(home);
  const prompt = 'Review the full report.\n'.repeat(200) + 'Final instruction beyond the preview.';
  for (const [profile, data] of [['', { jobs: [{ id: 'same-id', prompt, provider_snapshot: { secret: 'not-for-browser' } }] }], ['quill', [{ id: 'same-id', prompt: 'Quill only' }]]] as const) {
    const dir = join(home, ...(profile ? ['profiles', profile] : []), 'cron'); mkdirSync(dir, { recursive: true });
    const path = join(dir, 'jobs.json'); const original = JSON.stringify(data); writeFileSync(path, original);
    const result = readCronPrompts(home, profile || undefined);
    expect(result.jobs).toEqual([{ id: 'same-id', prompt: profile ? 'Quill only' : prompt }]);
    expect(readFileSync(path, 'utf8')).toBe(original);
  }
  expect(readCronPrompts(home, 'default').jobs[0].prompt).toBe(prompt);
  expect(() => readCronPrompts(home, '../quill')).toThrow();
  expect(() => readCronPrompts(home, 'missing')).toThrow();
  mkdirSync(join(home, 'profiles', 'escape', 'cron'), { recursive: true });
  symlinkSync('/etc/passwd', join(home, 'profiles', 'escape', 'cron', 'jobs.json'));
  expect(() => readCronPrompts(home, 'escape')).toThrow('outside Hermes home');
});
it('HTTP route is read-only and reports missing stores without an empty success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cron-http-')); roots.push(root);
  mkdirSync(join(root, 'cron')); writeFileSync(join(root, 'cron', 'jobs.json'), JSON.stringify([{ id: 'job', prompt: 'Complete instructions' }]));
  const server = createServer((req, res) => { void handleApiRequest(req, res, { hermesHome: root, eaiosRoot: root }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/cron-prompts`;
    expect(await (await fetch(url)).json()).toEqual({ jobs: [{ id: 'job', prompt: 'Complete instructions' }] });
    expect((await fetch(url + '?profile=missing')).status).toBe(503);
    expect((await fetch(url, { method: 'POST' })).status).toBe(405);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
