import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations } from '../run-migrations.mjs';
import { generateVersion } from '../generate-version.mjs';

const scripts = join(dirname(fileURLToPath(import.meta.url)), '..');
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
function write(path, text, executable = false) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text, { mode: executable ? 0o755 : 0o600 }); }
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'eaios-updater-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo'); mkdirSync(repo);
  git(repo, 'init', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Updater Test'); git(repo, 'config', 'user.email', 'updater@example.invalid');
  for (const name of ['eaios-update.sh', 'update-state.mjs', 'run-migrations.mjs', 'generate-version.mjs', 'release.sh']) {
    cpSync(join(scripts, name), join(repo, 'scripts', name), { recursive: true });
  }
  write(join(repo, '.gitignore'), 'app/dist/\napp/public/version.json\nsidecar/.venv/\n');
  write(join(repo, 'app/package.json'), JSON.stringify({ version: '0.1.0' }));
  write(join(repo, 'app/package-lock.json'), JSON.stringify({ version: '0.1.0' }));
  write(join(repo, 'sidecar/requirements.txt'), '# Fixture only\n');
  write(join(repo, 'sidecar/.venv/bin/python'), '#!/bin/sh\nexit 0\n', true);
  write(join(repo, 'scripts/install-systemd-user.sh'), '#!/bin/sh\necho install >> "$CALL_LOG"\n[ "$FAIL_STEP" != install ]\n', true);
  write(join(repo, 'scripts/verify-install.sh'), '#!/bin/sh\necho verify >> "$CALL_LOG"\n[ "$FAIL_STEP" != verify ]\n', true);
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'baseline'); const a = git(repo, 'rev-parse', 'HEAD');
  const remote = join(dir, 'origin.git'); git(dir, 'clone', '--bare', repo, remote); git(repo, 'remote', 'add', 'origin', remote);
  write(join(repo, 'app/package.json'), JSON.stringify({ version: '0.2.0' }));
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'next release'); const b = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'tag', 'v0.2.0'); git(repo, 'push', 'origin', 'main', '--tags'); git(repo, 'checkout', '--detach', a); git(repo, 'checkout', 'main'); git(repo, 'reset', '--hard', a);
  const bin = join(dir, 'bin');
  write(join(bin, 'npm'), `#!/bin/sh
echo "npm $*" >> "$CALL_LOG"
if [ "$1" = ci ]; then
  if [ "$FAIL_STEP" = wait ]; then touch "$WAIT_MARKER"; sleep 2; fi
  [ "$FAIL_STEP" != ci ]; exit $?
fi
if [ "$1" = test ]; then [ "$FAIL_STEP" != test ]; exit $?; fi
if [ "$1" = version ]; then
  node -e 'const fs=require("fs"); for(const file of ["package.json","package-lock.json"]) { const p=JSON.parse(fs.readFileSync(file)); p.version=process.argv[1]; fs.writeFileSync(file,JSON.stringify(p)); }' "$2"
  exit $?
fi
if [ "$1 $2" = 'run build' ]; then
  [ "$FAIL_STEP" != build ] || exit 7
  mkdir -p dist
  if [ -f ../scripts/generate-version.mjs ]; then
    node ../scripts/generate-version.mjs
    cp public/version.json dist/version.json
  fi
  exit $?
fi
exit 0
`, true);
  write(join(bin, 'uv'), '#!/bin/sh\necho uv >> "$CALL_LOG"\n[ "$FAIL_STEP" != uv ]\n', true);
  write(join(bin, 'systemctl'), '#!/bin/sh\necho "systemctl $*" >> "$CALL_LOG"\n[ "$FAIL_STEP" != restart ] || [ "$2" != restart ]\n', true);
  const dbPath = join(dir, 'state.db'); const callLog = join(dir, 'calls');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, EAIOS_STATE_DB: dbPath, CALL_LOG: callLog, FAIL_STEP: '', EAIOS_BRANCH: 'main' };
  delete env.EAIOS_UPDATE_RUNTIME;
  function run(args = [], extra = {}) { return spawnSync('bash', ['scripts/eaios-update.sh', ...args], { cwd: repo, env: { ...env, ...extra }, encoding: 'utf8' }); }
  function rows() { const db = new DatabaseSync(dbPath); try { return db.prepare('SELECT * FROM eaios_update_log ORDER BY id').all(); } finally { db.close(); } }
  return { dir, repo, remote, a, b, run, rows, env, callLog };
}

test('migrations preserve comments, semicolons, triggers, and apply once; backups include WAL', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'eaios-migration-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.db'); const migrationsDir = join(dir, 'migrations');
  const source = new DatabaseSync(dbPath); source.exec("PRAGMA journal_mode=WAL; CREATE TABLE original (text); INSERT INTO original VALUES ('keep');");
  write(join(migrationsDir, '001-comments.sql'), `-- Must execute, not discard
CREATE TABLE probe (text);
INSERT INTO probe VALUES ('a;b');
CREATE TABLE audit (text);
CREATE TRIGGER probe_audit AFTER INSERT ON probe BEGIN
 INSERT INTO audit VALUES (NEW.text);
 INSERT INTO audit VALUES ('second;statement');
END;
INSERT INTO probe VALUES ('trigger');`);
  const result = await runMigrations({ dbPath, migrationsDir }); assert.equal(result.applied, 1);
  const db = new DatabaseSync(dbPath); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit').get().n, 2); db.close();
  const saved = new DatabaseSync(result.backupPath); assert.equal(saved.prepare('SELECT text FROM original').get().text, 'keep');
  assert.equal(saved.prepare("SELECT name FROM sqlite_master WHERE name='probe'").get(), undefined); saved.close(); source.close();
  assert.equal((await runMigrations({ dbPath, migrationsDir })).applied, 0);
});

test('failed migrations undo all statements and do not advance the ledger; edits and duplicate ids fail', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'eaios-migration-test-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'state.db'); const migrationsDir = join(dir, 'migrations');
  write(join(migrationsDir, '001-invalid.sql'), 'CREATE TABLE partial (id); INSERT INTO missing VALUES (1);');
  await assert.rejects(runMigrations({ dbPath, migrationsDir }), /failed/);
  const db = new DatabaseSync(dbPath); assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get(), undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM _eaios_migrations').get().n, 0); db.close();
  write(join(migrationsDir, '001-invalid.sql'), 'CREATE TABLE partial (id);'); await runMigrations({ dbPath, migrationsDir });
  write(join(migrationsDir, '001-invalid.sql'), 'CREATE TABLE changed (id);'); await assert.rejects(runMigrations({ dbPath, migrationsDir }), /changed/);
  write(join(migrationsDir, '001-duplicate.sql'), 'SELECT 1;'); await assert.rejects(runMigrations({ dbPath, migrationsDir }), /Duplicate/);
});

for (const failure of ['ci', 'build', 'uv', 'install', 'restart', 'verify']) {
  test(`${failure} failure finishes the log and retry builds/verifies the same revision`, t => {
    const f = fixture(t); const failed = f.run([], { FAIL_STEP: failure }); assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.b);
    const row = f.rows()[0]; assert.equal(row.success, 0); assert.ok(row.finished_at); assert.match(row.error_message, /Failed during/);
    const retry = f.run(); assert.equal(retry.status, 0, retry.stdout + retry.stderr);
    const log = readFileSync(f.callLog, 'utf8'); assert.ok(log.includes('npm run build')); assert.ok(log.endsWith('verify\n'));
    assert.equal(f.rows().at(-1).success, 1);
    assert.equal(f.run(['--rollback']).status, 0); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.a);
  });
}

test('no-op success cannot replace the rollback point, and rollback works offline', t => {
  const f = fixture(t); assert.equal(f.run(['--to', 'v0.2.0']).status, 0); assert.equal(f.run(['--to', 'v0.2.0']).status, 0);
  git(f.repo, 'remote', 'set-url', 'origin', join(f.dir, 'missing.git'));
  const rollback = f.run(['--rollback']); assert.equal(rollback.status, 0, rollback.stderr); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.a);
});

test('failed update rollback returns to its own pre-update revision', t => {
  const f = fixture(t); assert.equal(f.run().status, 0);
  write(join(f.repo, 'app/package.json'), JSON.stringify({ version: '0.3.0' })); git(f.repo, 'add', '.'); git(f.repo, 'commit', '-m', 'third'); git(f.repo, 'push', 'origin', 'main'); git(f.repo, 'reset', '--hard', f.b);
  assert.notEqual(f.run([], { FAIL_STEP: 'build' }).status, 0);
  assert.equal(f.run(['--rollback']).status, 0); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.b);
});

test('network failure is logged and local modifications are refused', t => {
  const f = fixture(t); git(f.repo, 'remote', 'set-url', 'origin', join(f.dir, 'missing.git'));
  assert.notEqual(f.run().status, 0); assert.ok(f.rows()[0].finished_at); assert.match(f.rows()[0].error_message, /resolve target/);
  write(join(f.repo, 'local-work.txt'), 'preserve me'); const failed = f.run(); assert.notEqual(failed.status, 0); assert.match(failed.stderr, /local changes/);
  assert.equal(readFileSync(join(f.repo, 'local-work.txt'), 'utf8'), 'preserve me');
});

test('version channel requires a matching semver tag AND a clean tree', t => {
  const f = fixture(t); git(f.repo, 'checkout', '--detach', f.b);
  assert.equal(generateVersion(f.repo).releaseChannel, 'stable');
  write(join(f.repo, 'untracked.txt'), 'work'); assert.equal(generateVersion(f.repo).releaseChannel, 'dev'); assert.equal(generateVersion(f.repo).dirty, true);
  rmSync(join(f.repo, 'untracked.txt')); git(f.repo, 'tag', '-d', 'v0.2.0'); git(f.repo, 'tag', 'prototype');
  assert.equal(generateVersion(f.repo).releaseChannel, 'dev');
});

test('release refuses untracked files before changing version or pushing', t => {
  const f = fixture(t); write(join(f.repo, 'untracked.txt'), 'work');
  const result = spawnSync('bash', ['scripts/release.sh', 'v0.3.0'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /not clean/); assert.equal(JSON.parse(readFileSync(join(f.repo, 'app/package.json'))).version, '0.1.0');
});

test('release keeps package and lockfile versions in sync and publishes an atomic tag', t => {
  const f = fixture(t); git(f.repo, 'merge', '--ff-only', f.b);
  const result = spawnSync('bash', ['scripts/release.sh', 'v0.3.0'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const name of ['package.json', 'package-lock.json']) assert.equal(JSON.parse(readFileSync(join(f.repo, 'app', name))).version, '0.3.0');
  assert.equal(git(f.repo, 'status', '--porcelain'), '');
  assert.equal(git(f.remote, 'rev-parse', 'refs/tags/v0.3.0^{}'), git(f.repo, 'rev-parse', 'HEAD'));
});

test('failed release tests prevent version changes and publication', t => {
  const f = fixture(t);
  const result = spawnSync('bash', ['scripts/release.sh', 'v0.3.0'], { cwd: f.repo, env: { ...f.env, FAIL_STEP: 'test' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.a);
  assert.equal(git(f.repo, 'tag', '--list', 'v0.3.0'), ''); assert.equal(JSON.parse(readFileSync(join(f.repo, 'app/package.json'))).version, '0.1.0');
});

test('rollback can check out a release without migration or update scripts', t => {
  const f = fixture(t);
  const saved = new Map(['eaios-update.sh', 'update-state.mjs', 'run-migrations.mjs', 'generate-version.mjs'].map(name => [name, readFileSync(join(f.repo, 'scripts', name))]));
  for (const name of saved.keys()) rmSync(join(f.repo, 'scripts', name));
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-m', 'old release without update tools'); const old = git(f.repo, 'rev-parse', 'HEAD');
  for (const [name, contents] of saved) write(join(f.repo, 'scripts', name), contents, true);
  git(f.repo, 'add', '-A'); git(f.repo, 'commit', '-m', 'install fixed tools'); const current = git(f.repo, 'rev-parse', 'HEAD');
  const state = (...args) => execFileSync('node', ['scripts/update-state.mjs', ...args], { cwd: f.repo, env: f.env, encoding: 'utf8' }).trim();
  const id = state('start', 'update', old, '0.1.0'); state('target', id, current); state('finish', id, '1', '', current, '0.1.0');
  const result = f.run(['--rollback']); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(git(f.repo, 'rev-parse', 'HEAD'), old); assert.equal(f.rows().at(-1).success, 1);
  assert.equal(existsSync(join(f.repo, 'scripts/run-migrations.mjs')), false);
});

test('an interrupted update records failure and releases its lock', async t => {
  const f = fixture(t); const marker = join(f.dir, 'waiting');
  const child = spawn('bash', ['scripts/eaios-update.sh'], { cwd: f.repo, env: { ...f.env, FAIL_STEP: 'wait', WAIT_MARKER: marker }, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const finished = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + 5000;
  while (!existsSync(marker) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(existsSync(marker), 'fixture reached dependency installation');
  const concurrent = f.run(); assert.notEqual(concurrent.status, 0); assert.match(concurrent.stderr, /Another EAiOS update/);
  child.kill('SIGTERM'); await finished;
  assert.ok(f.rows()[0].finished_at); assert.match(f.rows()[0].error_message, /Terminated/);
  assert.equal(f.run().status, 0, 'lock released after termination');
});
