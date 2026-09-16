#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export function versionParts(version) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || match.slice(1).some(n => !Number.isSafeInteger(Number(n)))) throw new Error('Invalid stable release version');
  return match.slice(1).map(Number);
}
export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function updateOptions(options = {}) {
  const hermesHome = options.hermesHome || process.env.HERMES_HOME || join(homedir(), '.hermes');
  const codeRoot = options.codeRoot || process.env.EAIOS_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
  const dataRoot = options.dataRoot || process.env.EAIOS_DATA_ROOT || codeRoot;
  const repository = options.repository || process.env.EAIOS_UPDATE_REPOSITORY || 'dmonistere123/EAiOS';
  if (!/^[\w-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid update repository');
  return { ...options, hermesHome, codeRoot, dataRoot, repository,
    repoRoot: options.repoRoot || process.env.EAIOS_REPO_ROOT || dataRoot,
    stateDir: options.stateDir || join(hermesHome, 'eaios'),
    releasesDir: options.releasesDir || join(homedir(), '.local', 'share', 'eaios', 'releases'),
  };
}
export function readJson(path, fallback = null) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; } }
export function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}
export async function githubJson(path, options = {}) {
  const opts = updateOptions(options);
  const token = process.env.EAIOS_GITHUB_TOKEN || (() => { try { return readFileSync(join(opts.stateDir, 'github-token'), 'utf8').trim(); } catch { return ''; } })();
  const response = await (opts.fetcher || fetch)(`https://api.github.com/repos/${opts.repository}${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'EAiOS-release-check', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) {
    const error = new Error(response.status === 403 || response.status === 429 ? 'GitHub request limited or access denied. Try again later.' : `GitHub release check failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
export function normalizeRelease(value, repository) {
  if (!value || value.draft || value.prerelease || !Number.isSafeInteger(value.id) || value.id <= 0) throw new Error('Not a published stable release');
  versionParts(value.tag_name);
  if (!value.tag_name.startsWith('v')) throw new Error('Release tags must start with v');
  const url = `https://github.com/${repository}/releases/tag/${value.tag_name}`;
  return { id: value.id, tag: value.tag_name, version: value.tag_name.slice(1), name: typeof value.name === 'string' ? value.name.slice(0, 200) : value.tag_name,
    notes: typeof value.body === 'string' ? value.body.slice(0, 20000) : '', url, publishedAt: value.published_at };
}
const checks = new Map();
export async function checkUpdates(options = {}) {
  const opts = updateOptions(options), path = join(opts.stateDir, 'update-check.json');
  if (checks.has(path)) return checks.get(path);
  const task = (async () => {
    const previous = readJson(path, {}), lastCheckedAt = new Date().toISOString();
    let result;
    try {
      let release = null;
      try { release = normalizeRelease(await githubJson('/releases/latest', opts), opts.repository); }
      catch (error) {
        if (error.status !== 404) throw error;
        // A 404 can also mean a private/unreachable repository. Verify access.
        await githubJson('', opts);
      }
      result = { repository: opts.repository, lastCheckedAt, lastSuccessfulCheckAt: lastCheckedAt, release, error: null };
    } catch (error) {
      result = { ...previous, repository: opts.repository, lastCheckedAt, error: error.status ? error.message : 'Unable to check GitHub releases. Check network access and try again.' };
    }
    atomicJson(path, result);
    return result;
  })();
  checks.set(path, task);
  try { return await task; } finally { checks.delete(path); }
}
export function getUpdateStatus(options = {}, currentVersion) {
  const opts = updateOptions(options), cached = readJson(join(opts.stateDir, 'update-check.json'), {});
  const checked = cached.repository === opts.repository ? cached : {};
  let install = readJson(join(opts.stateDir, 'install-status.json'));
  if (install && ['queued','installing'].includes(install.status) && Date.now() - Date.parse(install.startedAt ?? '') > 35 * 60 * 1000) {
    install = { ...install, status: 'failed', error: 'Installation was interrupted. Ask your administrator to verify the box before retrying.' };
  }
  let status = !checked.lastCheckedAt ? 'not_checked' : checked.error ? 'check_failed' : !checked.release ? 'no_releases' : 'current';
  if (checked.release && !checked.error) {
    const compare = compareVersions(checked.release.version, currentVersion);
    status = compare > 0 ? 'available' : compare < 0 ? 'ahead' : 'current';
  }
  return { ...checked, repository: opts.repository, status, checkIntervalDays: 7, install };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  checkUpdates().then(result => { console.log(result.error || (result.release ? `Published release: ${result.release.tag}` : 'No releases published')); if (result.error) process.exitCode = 1; });
}
