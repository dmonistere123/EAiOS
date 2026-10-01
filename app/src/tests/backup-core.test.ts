/**
 * backupCore tests — real tar on synthetic source trees in a temp dir.
 * Verifies: archive creation, exclusion list (Ollama models, runtimes,
 * node_modules, dist, .venv), duplicate-source dedup, target validation
 * against detected media, one-at-a-time concurrency, and job lifecycle.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectMedia,
  getBackupPlan,
  listJobs,
  startBackupJob,
  BackupRequestError,
  type BackupRoots,
} from '../../server/backupCore.ts';

let root = '';
let usb = '';
let roots: BackupRoots;

async function put(path: string, content = 'x') {
  await mkdir(join(path, '..'), { recursive: true }).catch(() => undefined);
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  await writeFile(path, content);
}

async function waitForJob(id: string, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const jobs = await listJobs(roots);
    const job = jobs.find((j) => j.id === id);
    if (job && job.status !== 'running') return job;
    if (Date.now() > deadline) throw new Error('job did not finish in time');
    await new Promise((r) => setTimeout(r, 100));
  }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'backup-core-'));
  usb = join(root, 'usb');
  await mkdir(usb, { recursive: true });

  const hermesHome = join(root, '.hermes');
  const eaios = join(root, 'eaios');
  const systemdUser = join(root, 'systemd', 'user');

  // Hermes home: keep config/skills, exclude runtime + ollama + caches
  await put(join(hermesHome, 'config.yaml'), 'model: test');
  await put(join(hermesHome, 'skills', 'demo', 'SKILL.md'), '# demo');
  await put(join(hermesHome, 'hermes-agent', 'venv', 'bin', 'python'), 'bin');
  await put(join(hermesHome, 'node', 'bin', 'node'), 'bin');
  await put(join(hermesHome, 'lsp', 'bin', 'tsserver'), 'bin');
  await put(join(hermesHome, 'cache', 'blob'), 'blob');
  await put(join(hermesHome, '.ollama', 'models', 'llama.gguf'), 'weights');

  // EAiOS root doubles as the data root (same path — dedup target)
  await put(join(eaios, 'app', 'src', 'main.tsx'), 'app');
  await put(join(eaios, 'app', 'node_modules', 'dep', 'index.js'), 'dep');
  await put(join(eaios, 'app', 'dist', 'index.html'), 'built');
  await put(join(eaios, 'sidecar', '.venv', 'lib', 'pkg.py'), 'venv');
  await put(join(eaios, 'settings.local.json'), '{}');
  await put(join(systemdUser, 'eaios-server.service'), '[Unit]');

  roots = { hermesHome, eaiosRoot: eaios, eaiosDataRoot: eaios, systemdUser };
  process.env.EAIOS_BACKUP_MEDIA_ROOTS = usb;
});

afterAll(async () => {
  delete process.env.EAIOS_BACKUP_MEDIA_ROOTS;
  await rm(root, { recursive: true, force: true });
});

describe('getBackupPlan', () => {
  it('deduplicates identical repo/data roots and lists all sources', () => {
    const plan = getBackupPlan(roots);
    const paths = plan.sources.map((s) => s.path);
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain(roots.hermesHome);
    expect(paths).toContain(roots.eaiosRoot);
    expect(paths).toContain(roots.systemdUser);
    expect(plan.exclusions.some((e) => e.includes('ollama'))).toBe(true);
    expect(plan.exclusions).toContain('node_modules');
  });
});

describe('detectMedia', () => {
  it('includes configured EAIOS_BACKUP_MEDIA_ROOTS roots', async () => {
    const media = await detectMedia();
    expect(media.some((m) => m.path === usb)).toBe(true);
  });
});

describe('startBackupJob', () => {
  it('rejects targets outside detected media', async () => {
    await expect(startBackupJob(join(root, 'nowhere'), roots)).rejects.toMatchObject({ status: 400 });
    await expect(startBackupJob('', roots)).rejects.toMatchObject({ status: 400 });
  });

  it('runs a backup to completion with correct contents and exclusions', async () => {
    const job = await startBackupJob(usb, roots);
    expect(job.status).toBe('running');

    // One-at-a-time: a second start while running must 409
    await expect(startBackupJob(usb, roots)).rejects.toBeInstanceOf(BackupRequestError);
    await expect(startBackupJob(usb, roots)).rejects.toMatchObject({ status: 409 });

    const done = await waitForJob(job.id);
    expect(done.status).toBe('done');
    expect(done.archivePath).toBeDefined();
    expect((await stat(done.archivePath!)).size).toBeGreaterThan(0);
    expect(done.archiveSizeBytes).toBeGreaterThan(0);

    const listing = execFileSync('tar', ['-tzf', done.archivePath!], { encoding: 'utf8' });
    const members = listing.trim().split('\n');

    // Included
    expect(members).toContain('.hermes/config.yaml');
    expect(members).toContain('.hermes/skills/demo/SKILL.md');
    expect(members).toContain('eaios/app/src/main.tsx');
    expect(members).toContain('eaios/settings.local.json');
    expect(members).toContain('user/eaios-server.service');

    // Excluded: Ollama weights, Hermes runtime, node_modules, dist, venv
    expect(members.some((m) => m.includes('.ollama'))).toBe(false);
    expect(members.some((m) => m.includes('hermes-agent'))).toBe(false);
    expect(members.some((m) => m.includes('node_modules'))).toBe(false);
    expect(members.some((m) => m.includes('/dist/'))).toBe(false);
    expect(members.some((m) => m.includes('.venv'))).toBe(false);
    expect(members.some((m) => m === '.hermes/node' || m.startsWith('.hermes/node/'))).toBe(false);
    expect(members.some((m) => m === '.hermes/lsp' || m.startsWith('.hermes/lsp/'))).toBe(false);
    expect(members.some((m) => m === '.hermes/cache' || m.startsWith('.hermes/cache/'))).toBe(false);

    // Dedup: eaios tree appears exactly once (repo root == data root)
    const mainTsx = members.filter((m) => m === 'eaios/app/src/main.tsx');
    expect(mainTsx).toHaveLength(1);

    // History persisted for the next server start
    const history = JSON.parse(await readFile(join(roots.hermesHome, 'eaios', 'backup-jobs.json'), 'utf8')) as { id: string; status: string }[];
    expect(history.some((j) => j.id === job.id && j.status === 'done')).toBe(true);
  });
});
