#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, existsSync, symlinkSync, readFileSync, copyFileSync, openSync, closeSync, unlinkSync, writeFileSync, statSync, chmodSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync, backup } from 'node:sqlite';
import { checkUpdates, getUpdateStatus, githubJson, normalizeRelease, compareVersions, updateOptions, atomicJson, readJson, WEEK_MS } from './check-updates.mjs';

const execute = promisify(execFile);
export async function runCommand(command, args, options = {}) {
  return execute(command, args, { timeout: 20 * 60 * 1000, maxBuffer: 8 * 1024 * 1024, ...options });
}
export function knowledgeDir(options) {
  let path = process.env.EAIOS_KNOWLEDGE_DATA_DIR;
  for (const file of [join(options.hermesHome, '.env'), join(options.dataRoot, 'sidecar', '.env')]) {
    if (!existsSync(file)) continue;
    const setting = readFileSync(file, 'utf8').match(/^(?:export\s+)?EAIOS_KNOWLEDGE_DATA_DIR\s*=\s*(.+)$/m)?.[1]?.trim();
    if (setting) path = setting.replace(/^["']|["']$/g, '');
  }
  if (!path) return join(options.dataRoot, 'sidecar', 'data');
  if (!isAbsolute(path) || path.includes('$') || path.includes('`')) throw new Error('Configure an absolute knowledge data path before installing updates.');
  return path;
}
export function assertIdle(options) {
  for (const [path, sql] of [
    [join(options.hermesHome, 'kanban.db'), "SELECT COUNT(*) AS count FROM tasks WHERE status='running'"],
    [join(knowledgeDir(options), 'knowledge.db'), "SELECT COUNT(*) AS count FROM podcasts WHERE status IN ('pending','processing')"],
  ]) {
    if (!existsSync(path)) continue;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const table = sql.includes('FROM tasks') ? 'tasks' : 'podcasts';
      if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table) && db.prepare(sql).get().count > 0) {
        throw new Error('Work or podcast generation is active. Wait for it to finish before installing.');
      }
    } finally { db.close(); }
  }
}
export async function backupPersistentData(options, backupDir) {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  for (const [source, name] of [
    [join(options.hermesHome, 'state.db'), 'hermes-state.db'],
    [join(options.hermesHome, 'kanban.db'), 'hermes-kanban.db'],
    [join(knowledgeDir(options), 'knowledge.db'), 'knowledge.db'],
  ]) {
    if (!existsSync(source)) continue;
    const db = new DatabaseSync(source, { readOnly: true });
    try { await backup(db, join(backupDir, name)); chmodSync(join(backupDir, name), 0o600); } finally { db.close(); }
  }
  for (const name of ['settings.local.json', 'dismissed.json', 'notify-state.json']) {
    const path = join(options.dataRoot, name);
    if (existsSync(path)) { copyFileSync(path, join(backupDir, name)); chmodSync(join(backupDir, name), 0o600); }
  }
}
export function validateManifest(manifest, release) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.version !== release.version || manifest.dataRootSupported !== true || manifest.migrationPolicy !== 'additive') {
    throw new Error('This release does not declare safe persistent-data support. Ask your administrator to publish a compatible release.');
  }
  if (!Number.isInteger(manifest.minimumNodeMajor) || manifest.minimumNodeMajor < 24 || Number(process.versions.node.split('.')[0]) < manifest.minimumNodeMajor) {
    throw new Error('This release requires a newer Node runtime. Ask your administrator to upgrade this box first.');
  }
}

export async function installRelease(releaseId, options = {}) {
  const opts = updateOptions(options), run = opts.runner || runCommand;
  const statusPath = join(opts.stateDir, 'install-status.json');
  mkdirSync(opts.stateDir, { recursive: true, mode: 0o700 });
  const lockPath = join(opts.stateDir, 'install.lock');
  let bootId; try { bootId = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { /* non-Linux test host */ }
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch {
    const owner = readJson(lockPath);
    let live = true;
    try { if (bootId && owner?.bootId && bootId !== owner.bootId) live = false;
      else if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) process.kill(owner.pid, 0);
      else live = Date.now() - statSync(lockPath).mtimeMs < 120000; }
    catch (error) { if (error.code === 'ESRCH') live = false; }
    if (live) throw new Error('Another release installation is running.');
    unlinkSync(lockPath);
    lock = openSync(lockPath, 'wx', 0o600);
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, bootId }));
  const env = { ...process.env, PATH: `${process.execPath.slice(0, process.execPath.lastIndexOf('/'))}:${process.env.PATH}`, HERMES_HOME: opts.hermesHome,
    EAIOS_DATA_ROOT: opts.dataRoot, EAIOS_REPO_ROOT: opts.repoRoot, EAIOS_STATE_DB: join(opts.hermesHome, 'state.db') };
  const previousDeployment = readJson(join(opts.stateDir, 'deployment.json'));
  const previousRoot = previousDeployment?.activeRoot || opts.codeRoot;
  const startedAt = new Date().toISOString();
  let stage = 'Checking the release', activated = false, release, preparedRoot, sha, previousSha;
  const save = patch => atomicJson(statusPath, { releaseId, startedAt, stage, ...patch });
  const step = name => { stage = name; save({ status: 'installing' }); };
  try {
    save({ status: 'installing' });
    const current = readJson(join(previousRoot, 'app', 'dist', 'version.json'));
    if (!current?.version) throw new Error('Cannot identify the running release.');
    previousSha = current.gitSha;
    const checked = getUpdateStatus(opts, current.version);
    const checkedAt = Date.parse(checked.lastSuccessfulCheckAt);
    if (checked.status !== 'available' || checked.release?.id !== releaseId || !Number.isFinite(checkedAt) || Date.now() - checkedAt > WEEK_MS || checkedAt > Date.now()) {
      throw new Error('Check for updates again before installing this release.');
    }
    release = normalizeRelease(await githubJson(`/releases/${releaseId}`, opts), opts.repository);
    if (release.tag !== checked.release.tag || compareVersions(release.version, current.version) <= 0) throw new Error('The selected release changed. Check for updates again.');
    (opts.idleCheck || assertIdle)(opts);
    const remote = (await run('git', ['-C', opts.repoRoot, 'remote', 'get-url', 'origin'], { env })).stdout.trim();
    if (![ `git@github.com:${opts.repository}.git`, `https://github.com/${opts.repository}.git`, `https://github.com/${opts.repository}` ].includes(remote)) {
      throw new Error('The repository remote does not match the configured GitHub release source.');
    }
    step('Downloading release code');
    await run('git', ['-C', opts.repoRoot, 'fetch', '--no-tags', 'origin', `refs/tags/${release.tag}:refs/tags/${release.tag}`], { env });
    sha = (await run('git', ['-C', opts.repoRoot, 'rev-parse', '--verify', 'FETCH_HEAD^{commit}'], { env })).stdout.trim();
    if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Invalid release revision.');
    const manifest = JSON.parse((await run('git', ['-C', opts.repoRoot, 'show', `${sha}:release-manifest.json`], { env })).stdout);
    validateManifest(manifest, release);
    mkdirSync(opts.releasesDir, { recursive: true, mode: 0o700 });
    preparedRoot = join(opts.releasesDir, `${sha}-${Date.now()}`);
    await run('git', ['-C', opts.repoRoot, 'worktree', 'add', '--detach', preparedRoot, sha], { env });
    // Only credentials are linked as files. Mutable data is resolved through
    // EAIOS_DATA_ROOT, so atomic writes cannot replace a persistence symlink.
    for (const file of ['app/.env.local', 'sidecar/.env']) {
      const source = join(opts.dataRoot, file), target = join(preparedRoot, file);
      if (existsSync(target)) throw new Error('Release contains a machine-local credentials file.');
      if (existsSync(source)) symlinkSync(source, target);
    }
    step('Preparing application dependencies');
    await run('npm', ['ci'], { cwd: join(preparedRoot, 'app'), env });
    step('Building the application');
    await run('npm', ['run', 'build'], { cwd: join(preparedRoot, 'app'), env });
    const build = readJson(join(preparedRoot, 'app', 'dist', 'version.json'));
    if (build?.version !== release.version || build.gitSha !== sha || build.dirty || build.releaseChannel !== 'stable') throw new Error('Built release identity did not match its tag.');
    step('Preparing knowledge and podcast dependencies');
    await run('uv', ['venv', '.venv', '--python', '3.11'], { cwd: join(preparedRoot, 'sidecar'), env });
    await run('uv', ['pip', 'install', '--python', '.venv/bin/python', '-r', 'requirements.txt'], { cwd: join(preparedRoot, 'sidecar'), env });
    (opts.idleCheck || assertIdle)(opts);
    step('Backing up databases and local settings');
    const backupDir = join(opts.stateDir, 'release-backups', `${Date.now()}-${sha}`);
    await backupPersistentData(opts, backupDir);
    step('Applying compatible migrations');
    await run(process.execPath, ['scripts/run-migrations.mjs'], { cwd: preparedRoot, env });
    // Recheck immediately before activation. Preparation never restarts services.
    (opts.idleCheck || assertIdle)(opts);
    step('Activating the release');
    activated = true;
    await run('bash', ['scripts/install-systemd-user.sh'], { cwd: preparedRoot, env });
    await run('systemctl', ['--user', 'restart', 'eaios-knowledge-sidecar', 'eaios-server', 'eaios-server-5173'], { env });
    step('Verifying the running application');
    await run('bash', ['scripts/verify-install.sh'], { cwd: preparedRoot, env });
    for (const port of [5200, 5173]) {
      const response = await (opts.healthFetcher || fetch)(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok || (await response.json()).current?.gitSha !== sha) throw new Error('Running version verification failed.');
    }
    atomicJson(join(opts.stateDir, 'deployment.json'), { activeRoot: preparedRoot, previousRoot, repoRoot: opts.repoRoot, dataRoot: opts.dataRoot, sha, version: release.version, backupDir });
    save({ status: 'succeeded', finishedAt: new Date().toISOString(), version: release.version, gitSha: sha, backupDir });
    await checkUpdates(opts);
    return { ok: true };
  } catch (error) {
    let recovered = false;
    if (activated) {
      try {
        await run('bash', ['scripts/install-systemd-user.sh'], { cwd: previousRoot, env });
        await run('systemctl', ['--user', 'restart', 'eaios-knowledge-sidecar', 'eaios-server', 'eaios-server-5173'], { env });
        await run('bash', ['scripts/verify-install.sh'], { cwd: previousRoot, env });
        for (const port of [5200, 5173]) {
          const response = await (opts.healthFetcher || fetch)(`http://127.0.0.1:${port}/api/version`, { signal: AbortSignal.timeout(10000) });
          if (!response.ok || (await response.json()).current?.gitSha !== previousSha) throw new Error('Previous version recovery failed');
        }
        recovered = true;
      } catch { /* report required administrator recovery */ }
    }
    const message = activated ? (recovered ? 'Installation failed. The previous application was restored; persistent data was retained.' : 'Installation failed and automatic application recovery failed. Administrator assistance is required; backups were retained.') :
      (['Checking the release', 'Downloading release code'].includes(stage) ? error.message : `Installation failed during ${stage.toLowerCase()}. The running application was not replaced.`);
    save({ status: 'failed', recovered, finishedAt: new Date().toISOString(), error: message });
    return { ok: false, error: message };
  } finally { closeSync(lock); unlinkSync(lockPath); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    const opts = updateOptions(), path = join(opts.stateDir, 'install-status.json');
    atomicJson(path, { ...readJson(path, {}), status: 'failed', finishedAt: new Date().toISOString(), error: 'Installation was interrupted. Administrator verification is required before retrying.' });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
  const id = Number(process.argv[2]);
  if (!Number.isSafeInteger(id) || id <= 0) { console.error('A checked release ID is required'); process.exitCode = 1; }
  else installRelease(id).then(result => { if (!result.ok) { console.error(result.error); process.exitCode = 1; } }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
