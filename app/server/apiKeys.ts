/** Allowlisted credential editing. Values never leave the server in responses. */
import { AsyncLocalStorage } from 'node:async_hooks';
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';
import { API_KEY_CATALOG, API_KEY_SCOPES, type ApiKeyScope, type ApiKeySettings } from '../src/domain/apiKeys.ts';
export interface KeyContext { hermesHome: string; eaiosRoot: string; dataRoot?: string; requestKeys?: Map<string, string>; }
export const keyContext = new AsyncLocalStorage<KeyContext>();
export class KeySettingsError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
function scopePath(ctx: KeyContext, scope: ApiKeyScope) {
  const root = scope === 'hermes' ? ctx.hermesHome : ctx.dataRoot ?? ctx.eaiosRoot;
  const file = scope === 'hermes' ? join(root, '.env') : join(root, scope === 'app' ? 'app' : 'sidecar', scope === 'app' ? '.env.local' : '.env');
  // Never follow a credentials-file symlink or a parent escaping the configured root.
  const resolvedRoot = realpathSync(root);
  let resolvedParent: string;
  try { resolvedParent = realpathSync(dirname(file)); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return file; throw e; }
  const rel = relative(resolvedRoot, resolvedParent);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Unsafe credentials path');
  const st = lstatSync(file, { throwIfNoEntry: false });
  if (st && (!st.isFile() || st.isSymbolicLink())) throw new Error('Unsafe credentials file');
  return file;
}
function readFile(path: string): { text: string; version: string } {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { text: '', version: 'absent' }; throw e; }
  try {
    const st = fstatSync(fd, { bigint: true });
    if (!st.isFile() || st.size > 1024n * 1024n) throw new Error('Unsafe credentials file');
    return { text: readFileSync(fd, 'utf8'), version: `${st.ino}:${st.mtimeNs}:${st.size}` };
  } finally { closeSync(fd); }
}
export function savedKey(ctx: KeyContext, scope: ApiKeyScope, key: string): string {
  return parseEnv(readFile(scopePath(ctx, scope)).text)[key] ?? '';
}
/** Request-scoped paths prevent one preview or customer from using another home's keys. */
export function appKey(key: string, ctx = keyContext.getStore(), fallback = process.env[key] ?? ''): string {
  if (!ctx) return fallback;
  if (ctx.requestKeys?.has(key)) return ctx.requestKeys.get(key)!;
  const value = savedKey(ctx, 'app', key) || fallback;
  ctx.requestKeys?.set(key, value);
  return value;
}
export function keySettings(ctx: KeyContext, scope: ApiKeyScope): ApiKeySettings {
  if (!Object.hasOwn(API_KEY_SCOPES, scope)) throw new KeySettingsError(400, 'Unknown key section.');
  const file = readFile(scopePath(ctx, scope)), values = parseEnv(file.text);
  return { scope, version: file.version, keys: API_KEY_CATALOG.filter(row => (row.scopes as readonly string[]).includes(scope)).map(row => {
    const saved = values[row.key];
    // A separate podcast process may have a different environment; never claim its keys from the dashboard's environment.
    const inherited = scope === 'podcasts' && !Object.hasOwn(values, row.key) ? savedKey(ctx, 'hermes', row.key) : '';
    const environment = scope !== 'podcasts' ? process.env[row.key] : '';
    const value = saved || inherited || environment || '';
    return { key: row.key, name: row.name, description: row.description, configured: !!value,
      source: saved ? 'saved' : inherited ? 'inherited' : environment ? 'environment' : 'missing',
      ...(row.key === 'DUFFEL_API_KEY' && /^duffel_(test|live)_/.test(value) ? { mode: value.startsWith('duffel_test_') ? 'test' as const : 'live' as const } : {}) };
  }) };
}
export function saveKey(ctx: KeyContext, input: Record<string, unknown>): void {
  const { scope, key, value, version } = input;
  if (typeof scope !== 'string' || !Object.hasOwn(API_KEY_SCOPES, scope) || typeof key !== 'string'
    || !API_KEY_CATALOG.some(row => row.key === key && (row.scopes as readonly string[]).includes(scope))) throw new KeySettingsError(400, 'Unknown provider or key section.');
  // Shell-safe as these files are also sourced by existing service launchers.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_./:+=-]{1,4096}$/.test(value.trim())) throw new KeySettingsError(400, 'Enter a single API token without spaces, quotes or shell characters.');
  if (typeof version !== 'string') throw new KeySettingsError(400, 'Reload settings before saving.');
  const path = scopePath(ctx, scope as ApiKeyScope), lock = path + '.eaios-lock';
  let lockFd: number;
  try { lockFd = openSync(lock, 'wx', 0o600); }
  catch { throw new KeySettingsError(409, 'Another key update is in progress. Reload and try again.'); }
  const tmp = path + '.tmp-' + randomUUID();
  try {
    const current = readFile(path);
    if (current.version !== version) throw new KeySettingsError(409, 'Configuration changed. Reload settings before saving.');
    const before = parseEnv(current.text);
    const lines = current.text.split(/\r?\n/), matcher = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);
    // Refuse complex/multiline values instead of guessing and damaging adjacent settings.
    const remaining = lines.filter(line => {
      if (!matcher.test(line)) return true;
      const rhs = line.slice(line.indexOf('=') + 1).trim();
      if ((rhs.startsWith('"') && !/^"[^"\n]*"\s*(?:#.*)?$/.test(rhs)) || (rhs.startsWith("'") && !/^'[^'\n]*'\s*(?:#.*)?$/.test(rhs)) || rhs.startsWith('`')) throw new KeySettingsError(409, 'This key uses a complex file format. Ask your administrator to update it.');
      return false;
    });
    const next = remaining.join('\n').replace(/\n?$/, '\n') + `${key}=${value.trim()}\n`;
    const after = parseEnv(next);
    if (after[key] !== value.trim() || Object.keys(before).some(k => k !== key && before[k] !== after[k])) throw new Error('Configuration preservation check failed');
    const fd = openSync(tmp, 'wx', 0o600);
    try { writeFileSync(fd, next); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, path);
    // No values, suffixes or hashes of credentials in the audit event.
    console.info('API key saved', { scope, key, at: new Date().toISOString() });
  } finally {
    try { unlinkSync(tmp); } catch { /* renamed or never created */ }
    closeSync(lockFd); unlinkSync(lock);
  }
}
