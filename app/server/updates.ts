import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { checkUpdates, getUpdateStatus, updateOptions, atomicJson, WEEK_MS } from '../../scripts/check-updates.mjs';
import type { ApiContext } from './httpApi.ts';

const execute = promisify(execFile);
export function optionsFor(ctx: ApiContext) {
  return updateOptions({ codeRoot: ctx.eaiosRoot, dataRoot: ctx.dataRoot ?? ctx.eaiosRoot, hermesHome: ctx.hermesHome });
}
export function requireSameOriginJson(req: IncomingMessage) {
  if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) throw new Error('JSON request required');
  if (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) throw new Error('Same-origin request required');
  if (req.headers.origin && new URL(String(req.headers.origin)).host !== req.headers.host) throw new Error('Same-origin request required');
}
export async function launchReleaseInstall(ctx: ApiContext, currentVersion: string, releaseId: number) {
  const options = optionsFor(ctx), info = getUpdateStatus(options, currentVersion);
  if (['queued', 'installing'].includes(info.install?.status ?? '')) throw new Error('An update is already being installed');
  const checkedAt = Date.parse(info.lastSuccessfulCheckAt ?? '');
  if (info.status !== 'available' || info.release?.id !== releaseId || !Number.isFinite(checkedAt) || Date.now() - checkedAt > WEEK_MS || checkedAt > Date.now()) throw new Error('Check for updates again before installing');
  // A separate systemd unit owns installation and survives dashboard restarts.
  const statusPath = join(options.stateDir, 'install-status.json');
  atomicJson(statusPath, { status: 'queued', releaseId, startedAt: new Date().toISOString(), stage: 'Starting installation' });
  try {
    await execute('systemd-run', ['--user', '--collect', '--unit=eaios-release-install', '--property=Type=exec', '--property=RuntimeMaxSec=1800',
      `--setenv=EAIOS_ROOT=${options.codeRoot}`, `--setenv=EAIOS_DATA_ROOT=${options.dataRoot}`, `--setenv=EAIOS_REPO_ROOT=${options.repoRoot}`, `--setenv=HERMES_HOME=${options.hermesHome}`, `--setenv=EAIOS_UPDATE_REPOSITORY=${options.repository}`,
      process.execPath, join(options.codeRoot, 'scripts', 'install-release.mjs'), String(releaseId)], { timeout: 15000 });
  } catch {
    atomicJson(statusPath, { status: 'failed', releaseId, finishedAt: new Date().toISOString(), error: 'Could not start installation. Check that user systemd services are available.' });
    throw new Error('Could not start installation');
  }
  return { ok: true, auditEventId: `release-install-${releaseId}-${Date.now()}` };
}
export { checkUpdates, getUpdateStatus };
