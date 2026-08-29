/**
 * Profile-env binding (dogfood 2026-08-29) — per-profile secret binding for
 * agent Telegram bots. Writes ONE allowlisted key into
 * ~/.hermes/profiles/<slug>/.env (replace-or-append, tmp+rename, chmod 600).
 * Values are NEVER returned or logged — existence checks report booleans
 * only. The default profile's .env is refused (user-edits-only, HANDOFF #3).
 * Pure node: shared by vite.config middleware AND unit tests.
 */
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const ALLOWED_ENV_KEYS = new Set(['TELEGRAM_BOT_TOKEN']);
const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const MAX_VALUE = 4096;

/** Resolve the profile's .env, proving containment. 'default' is refused. */
export function profileEnvPath(profilesRoot: string, profile: string): string {
  if (!SLUG_RE.test(profile) || profile === 'default') {
    throw new Error(`invalid profile "${profile}" (default profile .env is user-edits-only)`);
  }
  const root = resolve(profilesRoot);
  const dir = resolve(root, profile);
  if (dir !== root && !dir.startsWith(root + sep)) throw new Error('path escapes profiles root — refused');
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`no profile '${profile}'`);
  return join(dir, '.env');
}

/** Existence ONLY — never the value. */
export function hasProfileEnvKey(profilesRoot: string, profile: string, key: string): boolean {
  if (!ALLOWED_ENV_KEYS.has(key)) throw new Error(`key not allowlisted: ${key}`);
  const path = profileEnvPath(profilesRoot, profile);
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path, 'utf8')
      .split('\n')
      .some((l) => l.startsWith(`${key}=`) && l.slice(key.length + 1).trim() !== '');
  } catch {
    return false;
  }
}

/** Replace-or-append KEY=value in the profile's .env. Returns nothing sensitive. */
export function setProfileEnvKey(profilesRoot: string, profile: string, key: string, value: string): { path: string } {
  if (!ALLOWED_ENV_KEYS.has(key)) throw new Error(`key not allowlisted: ${key}`);
  const v = value.trim();
  if (!v || v.length > MAX_VALUE || /[\r\n]/.test(v)) throw new Error('value must be a single non-empty line');
  const path = profileEnvPath(profilesRoot, profile);
  let lines: string[] = [];
  try {
    lines = readFileSync(path, 'utf8').split('\n');
  } catch {
    lines = [];
  }
  const line = `${key}=${v}`;
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) lines[idx] = line;
  else lines.push(line);
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, lines.join('\n'), 'utf8');
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  return { path };
}
