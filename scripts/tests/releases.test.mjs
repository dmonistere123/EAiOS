import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { checkUpdates, getUpdateStatus, atomicJson, WEEK_MS } from '../check-updates.mjs';
import { installRelease, runCommand, assertIdle } from '../install-release.mjs';
import { generateVersion } from '../generate-version.mjs';
import { runMigrations } from '../run-migrations.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
const release = { id: 42, tag_name: 'v0.2.0', name: 'EAiOS 0.2.0', body: 'Release notes', draft: false, prerelease: false, published_at: '2026-09-16T12:00:00Z' };
function write(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function temp(t) { const path = mkdtempSync(join(tmpdir(), 'eaios-release-test-')); t.after(() => rmSync(path, { recursive: true, force: true })); return path; }
function options(t, fetcher) { const dir = temp(t); return { stateDir: join(dir, 'state'), hermesHome: join(dir, 'hermes'), dataRoot: join(dir, 'data'), codeRoot: join(dir, 'data'), fetcher }; }

test('manual and weekly check discover a published release without modifying persistent data', async t => {
  let calls = 0;
  const opts = options(t, async () => { calls++; return Response.json(release); });
  write(join(opts.dataRoot, 'settings.local.json'), '{"sentinel":true}');
  await checkUpdates(opts); const info = getUpdateStatus(opts, '0.1.0');
  assert.equal(info.status, 'available'); assert.equal(info.checkIntervalDays, 7); assert.equal(calls, 1);
  assert.equal(readFileSync(join(opts.dataRoot, 'settings.local.json'), 'utf8'), '{"sentinel":true}');
  assert.equal(getUpdateStatus(opts, '0.2.0').status, 'current'); assert.equal(getUpdateStatus(opts, '0.3.0').status, 'ahead');
});
test('no release is distinguished from inaccessible repositories; failures retain previous success', async t => {
  const opts = options(t, async () => Response.json(release)); await checkUpdates(opts);
  const success = getUpdateStatus(opts, '0.1.0').lastSuccessfulCheckAt;
  opts.fetcher = async () => new Response('', { status: 403 }); await checkUpdates(opts);
  const failed = getUpdateStatus(opts, '0.1.0'); assert.equal(failed.status, 'check_failed'); assert.equal(failed.lastSuccessfulCheckAt, success);
  opts.fetcher = async url => url.endsWith('/releases/latest') ? new Response('', { status: 404 }) : Response.json({ name: 'EAiOS' });
  await checkUpdates(opts); assert.equal(getUpdateStatus(opts, '0.1.0').status, 'no_releases');
  opts.fetcher = async () => new Response('', { status: 404 }); await checkUpdates(opts); assert.equal(getUpdateStatus(opts, '0.1.0').status, 'check_failed');
});
test('drafts, prereleases and malformed versions cannot become install candidates', async t => {
  const opts = options(t, async () => Response.json(release));
  for (const patch of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.2.0-beta' }, { tag_name: 'v0.02.0' }]) {
    opts.fetcher = async () => Response.json({ ...release, ...patch }); await checkUpdates(opts);
    assert.equal(getUpdateStatus(opts, '0.1.0').status, 'check_failed');
  }
});
test('concurrent checks share a request within a process', async t => {
  let calls = 0; const opts = options(t, async () => { calls++; await new Promise(resolve => setTimeout(resolve, 20)); return Response.json(release); });
  await Promise.all([checkUpdates(opts), checkUpdates(opts)]); assert.equal(calls, 1);
});

async function installFixture(t, failure = '') {
  const dir = temp(t), root = join(dir, 'repo'); mkdirSync(root);
  git(root, 'init', '--initial-branch=main'); git(root, 'config', 'user.name', 'Release Test'); git(root, 'config', 'user.email', 'release@example.invalid');
  write(join(root, '.gitignore'), 'app/dist/\napp/public/version.json\napp/.env.local\nsidecar/.env\nsidecar/data/\nsidecar/.venv/\nsettings.local.json\ndismissed.json\n');
  for (const file of ['generate-version.mjs', 'run-migrations.mjs']) cpSync(join(scripts, file), join(root, 'scripts', file));
  write(join(root, 'app/package.json'), JSON.stringify({ version: '0.1.0' }));
  write(join(root, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, version: '0.1.0', minimumNodeMajor: 24, dataRootSupported: true, migrationPolicy: 'additive' }));
  write(join(root, 'sidecar/requirements.txt'), '# test'); write(join(root, 'playbooks/owned.md'), 'Customer-authored playbook');
  write(join(root, 'scripts/install-systemd-user.sh'), '# fixture'); write(join(root, 'scripts/verify-install.sh'), '# fixture');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'bootstrap'); const a = git(root, 'rev-parse', 'HEAD');
  write(join(root, 'app/package.json'), JSON.stringify({ version: '0.2.0' }));
  write(join(root, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, version: '0.2.0', minimumNodeMajor: 24, dataRootSupported: failure !== 'manifest', migrationPolicy: 'additive' }));
  write(join(root, 'playbooks/owned.md'), 'Different release defaults must not overwrite customer playbooks');
  write(join(root, 'migrations/001-additive.sql'), 'CREATE TABLE IF NOT EXISTS release_feature (id INTEGER);');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'release'); const b = git(root, 'rev-parse', 'HEAD'); git(root, 'tag', 'v0.2.0');
  const remote = join(dir, 'origin.git'); git(dir, 'clone', '--bare', root, remote); git(root, 'remote', 'add', 'origin', remote); git(root, 'reset', '--hard', a);
  generateVersion(root); mkdirSync(join(root, 'app/dist'), { recursive: true }); cpSync(join(root, 'app/public/version.json'), join(root, 'app/dist/version.json'));
  const sentinels = ['settings.local.json', 'dismissed.json', 'app/.env.local', 'sidecar/.env', 'sidecar/data/podcasts/audio/saved.mp3'];
  for (const name of sentinels) write(join(root, name), `keep:${name}`);
  const hermesHome = join(dir, 'hermes'); mkdirSync(hermesHome);
  const state = new DatabaseSync(join(hermesHome, 'state.db')); state.exec("PRAGMA journal_mode=WAL; CREATE TABLE customer_records (text); INSERT INTO customer_records VALUES ('keep chat');"); state.close();
  let activeRoot = root; const calls = [];
  const opts = { codeRoot: root, dataRoot: root, repoRoot: root, hermesHome, stateDir: join(hermesHome, 'eaios'), releasesDir: join(dir, 'releases'), fetcher: async () => Response.json(release), idleCheck: () => {},
    healthFetcher: async () => Response.json({ current: JSON.parse(readFileSync(join(activeRoot, 'app/dist/version.json'), 'utf8')) }),
    runner: async (command, args, config) => {
      calls.push({ command, args, cwd: config.cwd });
      if (command === 'git') {
        if (args.includes('get-url')) return { stdout: 'https://github.com/dmonistere123/EAiOS.git\n' };
        return runCommand(command, args, config);
      }
      if (command === 'npm' && args[0] === 'run') {
        if (failure === 'build') throw new Error('Build failure');
        const target = dirname(config.cwd); generateVersion(target); mkdirSync(join(config.cwd, 'dist')); cpSync(join(config.cwd, 'public/version.json'), join(config.cwd, 'dist/version.json'));
      }
      if (command === 'uv') {
        if (failure === 'dependencies') throw new Error('Dependency failure');
        write(join(config.cwd, '.venv/bin/python'), '# test');
      }
      if (args[0] === 'scripts/run-migrations.mjs') await runMigrations({ dbPath: join(hermesHome, 'state.db'), migrationsDir: join(config.cwd, 'migrations') });
      if (command === 'bash' && args[0].includes('install-systemd')) activeRoot = config.cwd;
      if (command === 'bash' && args[0].includes('verify-install') && failure === 'verification' && config.cwd !== root) throw new Error('Verification failure');
      return { stdout: '' };
    } };
  await checkUpdates(opts);
  return { root, a, b, opts, calls, sentinels, active: () => activeRoot };
}
for (const failure of ['', 'manifest', 'build', 'dependencies', 'verification']) {
  test(`release installation ${failure || 'success'} preserves customer files and shared data`, async t => {
    const f = await installFixture(t, failure); const result = await installRelease(42, f.opts);
    assert.equal(result.ok, !failure, result.error);
    for (const name of f.sentinels) assert.equal(readFileSync(join(f.root, name), 'utf8'), `keep:${name}`);
    assert.equal(readFileSync(join(f.root, 'playbooks/owned.md'), 'utf8'), 'Customer-authored playbook');
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), f.a, 'original checkout was not changed');
    const db = new DatabaseSync(join(f.opts.hermesHome, 'state.db')); assert.equal(db.prepare('SELECT text FROM customer_records').get().text, 'keep chat'); db.close();
    if (failure === 'verification') { assert.equal(f.active(), f.root); assert.equal(getUpdateStatus(f.opts, '0.1.0').install.recovered, true); }
    else if (failure) assert.equal(f.calls.some(call => call.command === 'systemctl'), false);
    else { assert.notEqual(f.active(), f.root); assert.equal(getUpdateStatus(f.opts, '0.2.0').status, 'current'); assert.ok(readdirSync(join(f.opts.stateDir, 'release-backups')).length); }
  });
}
test('expired checks and changed release identities cannot install', async t => {
  const f = await installFixture(t); const path = join(f.opts.stateDir, 'update-check.json');
  const state = JSON.parse(readFileSync(path, 'utf8')); state.lastSuccessfulCheckAt = new Date(Date.now() - WEEK_MS - 1000).toISOString(); atomicJson(path, state);
  assert.equal((await installRelease(42, f.opts)).ok, false); assert.equal(f.calls.length, 0);
  await checkUpdates(f.opts); assert.equal((await installRelease(99, f.opts)).ok, false); assert.equal(f.calls.length, 0);
});
test('active delegated or podcast work blocks activation', t => {
  const dir = temp(t), opts = { hermesHome: join(dir, 'hermes'), dataRoot: join(dir, 'data') }; mkdirSync(opts.hermesHome);
  const db = new DatabaseSync(join(opts.hermesHome, 'kanban.db')); db.exec("CREATE TABLE tasks (status); INSERT INTO tasks VALUES ('running');"); db.close();
  assert.throws(() => assertIdle(opts), /active/);
});

test('installation enables a weekly timer without enabling or starting the check service directly', async t => {
  const dir = temp(t), root = join(dir, 'code'), home = join(dir, 'home'), bin = join(dir, 'bin');
  cpSync(join(scripts, 'install-systemd-user.sh'), join(root, 'scripts/install-systemd-user.sh'));
  cpSync(join(scripts, '..', 'install/systemd'), join(root, 'install/systemd'), { recursive: true });
  cpSync(join(scripts, 'check-updates.mjs'), join(root, 'scripts/check-updates.mjs'));
  write(join(root, 'sidecar/.venv/bin/python'), '#!/bin/sh\nexit 0');
  const { chmodSync } = await import('node:fs'); chmodSync(join(root, 'sidecar/.venv/bin/python'), 0o755);
  const log = join(dir, 'calls');
  write(join(bin, 'systemctl'), '#!/bin/sh\necho "$*" >> "$CALL_LOG"\n'); chmodSync(join(bin, 'systemctl'), 0o755);
  write(join(bin, 'loginctl'), '#!/bin/sh\necho yes\n'); chmodSync(join(bin, 'loginctl'), 0o755);
  await runCommand('bash', ['scripts/install-systemd-user.sh', '--start'], { cwd: root, env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, CALL_LOG: log, EAIOS_DATA_ROOT: join(dir, 'customer-data'), EAIOS_REPO_ROOT: join(dir, 'repo'), HERMES_HOME: join(dir, 'hermes') } });
  const calls = readFileSync(log, 'utf8'); assert.match(calls, /enable --now eaios-update-check.timer/);
  assert.doesNotMatch(calls, /(?:enable|restart) eaios-update-check.service/);
  const units = join(home, '.config/systemd/user');
  assert.match(readFileSync(join(units, 'eaios-update-check.timer'), 'utf8'), /OnCalendar=weekly/);
  assert.match(readFileSync(join(units, 'eaios-update-check.timer'), 'utf8'), /Persistent=true/);
  const service = readFileSync(join(units, 'eaios-update-check.service'), 'utf8');
  assert.doesNotMatch(service, /install-release|@[A-Z_]+@/); assert.ok(service.includes(join(dir, 'customer-data')));
});
