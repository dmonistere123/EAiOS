// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { reconcileReleaseArtifact, listReleaseArtifacts, releaseArtifact } from '../../server/releaseArtifacts.ts';
import { handleApiRequest } from '../../server/httpApi.ts';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'release-report-')); roots.push(root);
  mkdirSync(join(root, 'eaios'), { recursive: true }); mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'RELEASE-NOTES-v0.1.7.md'), '# What changed\n\nApproval fixes.\n');
  const ctx = { eaiosRoot: root, hermesHome: root, buildVersion: { version: '0.1.7', gitSha: 'a'.repeat(40), gitBranch: 'main', releaseChannel: 'stable', dirty: false, builtAt: new Date().toISOString() } };
  const receipt = (status = 'succeeded', gitSha = ctx.buildVersion.gitSha) => writeFileSync(join(root, 'eaios', 'install-status.json'), JSON.stringify({ status, gitSha, version: '0.1.7', finishedAt: '2026-10-09T12:00:00Z' }));
  return { root, ctx, receipt };
}
it('recovers old Settings installer success and never duplicates or overwrites reports', () => {
  const { root, ctx, receipt } = fixture();
  for (const status of ['installing', 'failed']) { receipt(status); expect(reconcileReleaseArtifact(ctx)).toBe(false); }
  receipt('succeeded', 'b'.repeat(40)); expect(reconcileReleaseArtifact(ctx)).toBe(false);
  receipt(); expect(reconcileReleaseArtifact({ ...ctx, buildVersion: { ...ctx.buildVersion, releaseChannel: 'dev' } })).toBe(false);
  expect(reconcileReleaseArtifact(ctx)).toBe(true);
  const [row] = listReleaseArtifacts(ctx); expect(row.name).toBe('EAiOS-v0.1.7-Whats-New.md');
  expect(releaseArtifact(ctx, row.id)?.content).toContain('Approval fixes.');
  const path = join(root, 'eaios', 'release-notes', `${row.id}.md`);
  writeFileSync(path, 'Kept report'); expect(reconcileReleaseArtifact(ctx)).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe('Kept report'); expect(listReleaseArtifacts(ctx)).toHaveLength(1);
});
it('uses the real CLI SQLite success journal without changing customer data; ignores rollback', () => {
  const { root, ctx } = fixture(); const db = new DatabaseSync(join(root, 'state.db'));
  db.exec("CREATE TABLE eaios_update_log (id INTEGER, success INTEGER, action TEXT, new_git_sha TEXT, new_version TEXT, finished_at INTEGER); CREATE TABLE conversations (body TEXT); INSERT INTO conversations VALUES ('private conversation');");
  const insert = db.prepare('INSERT INTO eaios_update_log VALUES (1,1,?,?,?,1791547200)');
  insert.run('rollback', ctx.buildVersion.gitSha, '0.1.7'); expect(reconcileReleaseArtifact(ctx)).toBe(false);
  insert.run('update-to', ctx.buildVersion.gitSha, '0.1.7'); expect(reconcileReleaseArtifact(ctx)).toBe(true);
  expect(db.prepare('SELECT body FROM conversations').get()?.body).toBe('private conversation'); db.close();
});
it('serves saved Markdown through actual HTTP routes and confines file access', async () => {
  const { root, ctx, receipt } = fixture(); receipt();
  const db = new DatabaseSync(join(root, 'kanban.db'));
  db.exec('CREATE TABLE tasks (id TEXT, title TEXT, assignee TEXT, status TEXT); CREATE TABLE task_attachments (id INTEGER,task_id TEXT,filename TEXT,stored_path TEXT,content_type TEXT,size INTEGER,uploaded_by TEXT,created_at INTEGER)'); db.close();
  const server = createServer((req, res) => { void handleApiRequest(req, res, ctx).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const list = await (await fetch(`${base}/api/artifacts`)).json(); const row = list.artifacts[0];
    const download = await fetch(`${base}${row.downloadUrl}?download=1`);
    expect(download.headers.get('content-disposition')).toContain('.md'); expect(await download.text()).toContain('Installed successfully');
    expect(releaseArtifact(ctx, '../../state.db')).toBeNull();
    const malicious = `release-0.1.8-${'b'.repeat(40)}`;
    symlinkSync(join(root, 'kanban.db'), join(root, 'eaios', 'release-notes', `${malicious}.md`));
    expect(releaseArtifact(ctx, malicious)).toBeNull(); expect(listReleaseArtifacts(ctx)).toHaveLength(1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
